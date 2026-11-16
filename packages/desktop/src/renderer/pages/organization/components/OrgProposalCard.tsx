/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Card, Button, Typography, Space, Input, Message } from '@arco-design/web-react';
import { FolderClose, Check, Close, Edit, Peoples } from '@icon-park/react';
import { executeOrgToolInStore } from '../store/orgToolExecutor';
import { recordApprovedLineupInStore } from '../store/useOrgStore';
import type { ProposalCardData } from '../utils/rootCeoAgent';
import type { OrgCreatedEntityRef } from '@/types/organization';

export interface StructureProposalDept {
  name: string;
  folder: string;
  description?: string;
  projects?: Array<{
    name: string;
    folder: string;
    description?: string;
  }>;
}

export interface StructureProposalData {
  id?: string;
  departments: StructureProposalDept[];
  suggestedMembers?: Array<{
    name: string;
    role: string;
  }>;
  rejected?: Array<{ folder: string; reason: string }>;
}

export interface OrgProposalCardProps {
  cardData: StructureProposalData | ProposalCardData;
  onApprove: (createdRefs: OrgCreatedEntityRef[], lineupId?: string) => void;
  onReject: () => void;
}

function normalizeProposalData(data: StructureProposalData | ProposalCardData): StructureProposalData {
  if ('departments' in data && Array.isArray(data.departments)) {
    return {
      id: (data as StructureProposalData).id,
      departments: data.departments,
      suggestedMembers: data.suggestedMembers || [],
      rejected: data.rejected,
    };
  }

  // Handle legacy ProposalCardData
  const legacy = data as ProposalCardData;
  return {
    departments: [
      {
        name: legacy.departmentName || 'Department',
        folder: '',
        projects: legacy.projects || [],
      },
    ],
    rejected: legacy.rejected,
  };
}

export const OrgProposalCard: React.FC<OrgProposalCardProps> = ({ cardData, onApprove, onReject }) => {
  const [proposal, setProposal] = useState<StructureProposalData>(() => normalizeProposalData(cardData));
  const [isEditing, setIsEditing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  const totalProjects = proposal.departments.reduce((sum, d) => sum + (d.projects?.length || 0), 0);

  const handleUpdateDeptName = (deptIdx: number, newName: string) => {
    const updated = [...proposal.departments];
    updated[deptIdx] = { ...updated[deptIdx], name: newName };
    setProposal({ ...proposal, departments: updated });
  };

  const handleUpdateDeptFolder = (deptIdx: number, newFolder: string) => {
    const updated = [...proposal.departments];
    updated[deptIdx] = { ...updated[deptIdx], folder: newFolder };
    setProposal({ ...proposal, departments: updated });
  };

  const handleUpdateProjectName = (deptIdx: number, projIdx: number, newName: string) => {
    const updated = [...proposal.departments];
    const projs = [...(updated[deptIdx].projects || [])];
    projs[projIdx] = { ...projs[projIdx], name: newName };
    updated[deptIdx] = { ...updated[deptIdx], projects: projs };
    setProposal({ ...proposal, departments: updated });
  };

  const handleUpdateProjectFolder = (deptIdx: number, projIdx: number, newFolder: string) => {
    const updated = [...proposal.departments];
    const projs = [...(updated[deptIdx].projects || [])];
    projs[projIdx] = { ...projs[projIdx], folder: newFolder };
    updated[deptIdx] = { ...updated[deptIdx], projects: projs };
    setProposal({ ...proposal, departments: updated });
  };

  const handleApproveAll = async () => {
    setIsApproving(true);
    const createdRefs: OrgCreatedEntityRef[] = [];

    try {
      let lineupId: string | undefined;
      if (proposal.suggestedMembers && proposal.suggestedMembers.length > 0) {
        lineupId = recordApprovedLineupInStore(proposal.suggestedMembers, proposal.id);
      }
      for (const dept of proposal.departments) {
        let deptId = '';
        if (dept.name && dept.folder) {
          const deptRes = await executeOrgToolInStore('create_department', {
            name: dept.name,
            folder: dept.folder,
            description: dept.description,
          });
          deptId = deptRes.id;
          createdRefs.push({
            type: 'department',
            id: deptRes.id,
            name: deptRes.name,
          });
        }

        for (const proj of dept.projects || []) {
          const projRes = await executeOrgToolInStore('create_project', {
            departmentId: deptId || dept.name,
            name: proj.name,
            folder: proj.folder,
            goal: proj.description,
          });
          createdRefs.push({
            type: 'project',
            id: projRes.id,
            name: projRes.name,
            departmentId: deptId,
          });
        }
      }

      for (const member of proposal.suggestedMembers || []) {
        const memRes = await executeOrgToolInStore('hire_member', {
          name: member.name,
          role: member.role,
        });
        createdRefs.push({
          type: 'member',
          id: memRes.id,
          name: memRes.name,
        });
      }

      Message.success(`Successfully instantiated ${createdRefs.length} organizational entities.`);
      onApprove(createdRefs, lineupId);
    } catch (err) {
      Message.error(`Failed to approve structure: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsApproving(false);
    }
  };

  return (
    <Card
      size='small'
      className='my-8px border-primary/40 bg-bg-2 shadow-sm rounded-8px overflow-hidden max-w-640px w-full'
      title={
        <div className='flex items-center gap-6px text-13px font-semibold text-primary'>
          <FolderClose size={16} />
          <span>
            Organizational Proposal ({proposal.departments.length} Depts, {totalProjects} Projects)
          </span>
        </div>
      }
      extra={
        <Space size='small'>
          <Button
            size='mini'
            type={isEditing ? 'outline' : 'secondary'}
            icon={<Edit size={12} />}
            onClick={() => setIsEditing(!isEditing)}
          >
            {isEditing ? 'Done Editing' : 'Edit'}
          </Button>
          <Button size='mini' type='secondary' icon={<Close size={12} />} onClick={onReject} disabled={isApproving}>
            Reject
          </Button>
          <Button
            size='mini'
            type='primary'
            icon={<Check size={12} />}
            loading={isApproving}
            onClick={handleApproveAll}
          >
            Approve All
          </Button>
        </Space>
      }
    >
      <div className='flex flex-col gap-10px'>
        <Typography.Text type='secondary' className='text-12px'>
          Root CEO analyzed the workspace folders. Review the proposed structure and click Approve to instantiate:
        </Typography.Text>

        <div className='flex flex-col gap-8px max-h-320px overflow-y-auto pr-4px'>
          {proposal.departments.map((dept, dIdx) => (
            <div key={dIdx} className='p-8px rounded-6px bg-fill-2 border border-border-2 flex flex-col gap-4px'>
              <div className='flex items-center justify-between gap-6px'>
                {isEditing ? (
                  <Input
                    size='mini'
                    value={dept.name}
                    onChange={(val) => handleUpdateDeptName(dIdx, val)}
                    placeholder='Department Name'
                    className='font-semibold text-12px flex-1'
                  />
                ) : (
                  <span className='font-semibold text-12px text-t-primary'>{dept.name}</span>
                )}
              </div>

              {isEditing ? (
                <Input
                  size='mini'
                  value={dept.folder}
                  onChange={(val) => handleUpdateDeptFolder(dIdx, val)}
                  placeholder='Department Folder Path'
                  className='font-mono text-11px'
                />
              ) : (
                <div className='text-11px font-mono text-t-tertiary truncate'>{dept.folder}</div>
              )}

              {dept.projects && dept.projects.length > 0 && (
                <div className='mt-4px pl-8px border-l-2 border-primary/30 flex flex-col gap-4px'>
                  {dept.projects.map((proj, pIdx) => (
                    <div
                      key={pIdx}
                      className='p-6px rounded-4px bg-fill-1 border border-border-1 flex flex-col gap-2px'
                    >
                      <div className='flex items-center justify-between'>
                        {isEditing ? (
                          <Input
                            size='mini'
                            value={proj.name}
                            onChange={(val) => handleUpdateProjectName(dIdx, pIdx, val)}
                            placeholder='Project Name'
                            className='text-11px'
                          />
                        ) : (
                          <span className='font-medium text-11px text-t-primary'>{proj.name}</span>
                        )}
                      </div>
                      {isEditing ? (
                        <Input
                          size='mini'
                          value={proj.folder}
                          onChange={(val) => handleUpdateProjectFolder(dIdx, pIdx, val)}
                          placeholder='Project Folder Path'
                          className='font-mono text-10px'
                        />
                      ) : (
                        <span className='text-10px font-mono text-t-tertiary truncate'>{proj.folder}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {proposal.suggestedMembers && proposal.suggestedMembers.length > 0 && (
            <div className='p-8px rounded-6px bg-blue-500/10 border border-blue-500/20 flex flex-col gap-4px'>
              <div className='flex items-center gap-4px text-11px font-semibold text-primary'>
                <Peoples size={14} />
                <span>Suggested Autonomous Specialists ({proposal.suggestedMembers.length}):</span>
              </div>
              <div className='flex flex-wrap gap-4px'>
                {proposal.suggestedMembers.map((m, idx) => (
                  <span key={idx} className='px-6px py-2px rounded bg-primary/10 text-primary text-10px'>
                    {m.name} ({m.role})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {proposal.rejected && proposal.rejected.length > 0 && (
          <div className='flex flex-col gap-4px p-8px rounded-6px bg-red-500/10 border border-red-500/30 text-red-500 text-11px'>
            <span className='font-semibold'>Rejected ({proposal.rejected.length} outside scope):</span>
            {proposal.rejected.map((rej, idx) => (
              <div key={idx} className='truncate font-mono'>
                • {rej.folder}: {rej.reason}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};
