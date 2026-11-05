/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Select, Tag, InputNumber } from '@arco-design/web-react';
import { Edit, FolderOpen, Setting, Terminal, LinkOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { OrgAgentMember, OrgDepartmentNode, OrgProject, OrgTeamNode } from '@/types/organization';
import { useOrgStore } from '../store/useOrgStore';
import { WorkspaceFolderSelect } from '@renderer/components/workspace';

type EditEntityType = 'department' | 'team' | 'member' | 'project';

type OrgEntityEditModalProps = {
  visible: boolean;
  entity: EditEntityType;
  /** The entity being edited. For members, also pass teamId via `context.teamId`. */
  data: OrgDepartmentNode | OrgTeamNode | OrgAgentMember | OrgProject | null;
  context?: { departmentId?: string; teamId?: string };
  onClose: () => void;
  onSave?: () => void;
};

export const OrgEntityEditModal: React.FC<OrgEntityEditModalProps> = ({
  visible,
  entity,
  data,
  context = {},
  onClose,
  onSave,
}) => {
  const { t } = useTranslation();
  const { updateDepartment, updateTeamNode, updateTeamMember, upsertOrgProject, hierarchy, projects } = useOrgStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [headName, setHeadName] = useState('');
  const [headPrompt, setHeadPrompt] = useState('');
  const [hrName, setHrName] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberRole, setMemberRole] = useState('');
  const [memberPrompt, setMemberPrompt] = useState('');
  const [memberMcp, setMemberMcp] = useState('');
  const [parentDeptId, setParentDeptId] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [buildCmd, setBuildCmd] = useState('');
  const [runCmd, setRunCmd] = useState('');
  const [projectDeptId, setProjectDeptId] = useState('');
  const [projectTeamId, setProjectTeamId] = useState('');
  const [projectStatus, setProjectStatus] = useState<'active' | 'dormant' | 'done'>('active');

  const departmentOptions = useMemo(
    () => hierarchy.departments.map((d) => ({ label: d.name, value: d.id })),
    [hierarchy.departments]
  );

  const teamOptions = useMemo(() => {
    const dept = hierarchy.departments.find((d) => d.id === projectDeptId);
    return dept?.teams.map((t) => ({ label: t.name, value: t.id })) ?? [];
  }, [hierarchy.departments, projectDeptId]);

  const isEdit = Boolean(data);

  useEffect(() => {
    if (!visible || !data) return;
    setFolderPath('');
    setProjectDeptId('');
    setProjectTeamId('');

    if (entity === 'department') {
      const dept = data as OrgDepartmentNode;
      setName(dept.name);
      setDescription(dept.description ?? '');
      setHeadName(dept.departmentCeoAgent.name);
      setHeadPrompt(dept.departmentCeoAgent.title ?? '');
      setParentDeptId(dept.parentDepartmentId ?? '');
      setFolderPath(dept.workspacePath ?? '');
    } else if (entity === 'team') {
      const team = data as OrgTeamNode;
      setName(team.name);
      setDescription(team.description ?? '');
      setHeadName(team.teamLeadAgent.name);
      setHeadPrompt(team.teamLeadAgent.title ?? '');
      setHrName(team.hrCoordinatorAgent.name);
      setFolderPath(team.workspacePath ?? '');
    } else if (entity === 'member') {
      const member = data as OrgAgentMember;
      setMemberName(member.name);
      setMemberRole(member.title ?? member.role);
      setMemberPrompt(member.title ?? '');
      setMemberMcp(member.assistant_backend ?? '');
    } else if (entity === 'project') {
      const project = data as OrgProject;
      setName(project.name);
      setDescription(project.description ?? '');
      setProjectDeptId(project.departmentId);
      setProjectTeamId(project.teamIds?.[0] ?? '');
      setFolderPath(project.workspacePath ?? project.path ?? '');
      setProjectStatus((project.status ?? 'active') as 'active' | 'dormant' | 'done');
    }
  }, [visible, data, entity]);

  const handleSave = useCallback(() => {
    if (entity === 'department' && data) {
      const dept = data as OrgDepartmentNode;
      if (!name.trim()) return;
      updateDepartment(dept.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        departmentCeoAgent: {
          ...dept.departmentCeoAgent,
          name: headName.trim() || dept.departmentCeoAgent.name,
          title: headPrompt.trim() || dept.departmentCeoAgent.title,
        },
        parentDepartmentId: parentDeptId.trim() || null,
        workspacePath: folderPath.trim() || undefined,
      });
      onSave?.();
      onClose();
      return;
    }

    if (entity === 'team' && data && context.teamId) {
      const team = data as OrgTeamNode;
      if (!name.trim()) return;
      updateTeamNode(team.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        workspacePath: folderPath.trim() || undefined,
        teamLeadAgent: {
          ...team.teamLeadAgent,
          name: headName.trim() || team.teamLeadAgent.name,
          title: headPrompt.trim() || team.teamLeadAgent.title,
        },
        hrCoordinatorAgent: {
          ...team.hrCoordinatorAgent,
          name: hrName.trim() || team.hrCoordinatorAgent.name,
        },
      });
      onSave?.();
      onClose();
      return;
    }

    if (entity === 'member' && data && context.teamId) {
      const member = data as OrgAgentMember;
      if (!memberName.trim()) return;
      updateTeamMember(context.teamId, member.id, {
        name: memberName.trim(),
        title: memberPrompt.trim() || undefined,
        role: (memberRole.trim() || member.role) as OrgAgentMember['role'],
        assistant_backend: memberMcp.trim() || undefined,
      });
      onSave?.();
      onClose();
      return;
    }

    if (entity === 'project') {
      if (!name.trim() || !projectDeptId) return;
      upsertOrgProject({
        id: (data as OrgProject | null)?.id ?? `proj-${Date.now()}`,
        name: name.trim(),
        departmentId: projectDeptId,
        teamIds: projectTeamId ? [projectTeamId] : [],
        path: folderPath.trim() || undefined,
        workspacePath: folderPath.trim() || undefined,
        description: description.trim() || undefined,
        status: projectStatus,
      });
      onSave?.();
      onClose();
      return;
    }
  }, [
    entity,
    data,
    context.teamId,
    name,
    description,
    headName,
    headPrompt,
    hrName,
    memberName,
    memberRole,
    memberPrompt,
    memberMcp,
    parentDeptId,
    folderPath,
    buildCmd,
    runCmd,
    projectDeptId,
    projectTeamId,
    projectStatus,
    updateDepartment,
    updateTeamNode,
    updateTeamMember,
    upsertOrgProject,
    onSave,
    onClose,
  ]);

  const isProject = entity === 'project';
  const isMember = entity === 'member';
  const isTeam = entity === 'team';
  const isDept = entity === 'department';

  return (
    <Modal
      title={
        <div className='flex items-center gap-6px'>
          <Setting size={16} theme='outline' />
          <span className='font-bold text-13px text-t-primary'>
            {isDept ? t('team.organization.editDepartment', { defaultValue: 'Edit Department' }) : ''}
            {isTeam ? 'Edit Team' : ''}
            {isMember ? 'Edit Team Member' : ''}
            {isProject ? t('team.organization.editProject', { defaultValue: 'Edit Project' }) : ''}
          </span>
        </div>
      }
      visible={visible}
      onCancel={onClose}
      onOk={handleSave}
      okText={t('team.organization.save', { defaultValue: 'Save' })}
      cancelText={t('team.organization.cancel', { defaultValue: 'Cancel' })}
      okButtonProps={{ disabled: !name.trim() && !isMember && !isProject ? !name.trim() : false }}
    >
      <div className='flex flex-col gap-10px'>
        {isDept && (
          <>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>
                {t('team.organization.departmentName', { defaultValue: 'Department name' })}
              </span>
              <Input value={name} onChange={setName} autoFocus />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>
                {t('team.organization.description', { defaultValue: 'Description' })}
              </span>
              <Input.TextArea value={description} onChange={setDescription} rows={2} />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>Head / CEO Agent Name</span>
              <Input value={headName} onChange={setHeadName} />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>System Prompt / Role</span>
              <Input.TextArea value={headPrompt} onChange={setHeadPrompt} rows={2} />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>Parent Department</span>
              <Select value={parentDeptId} onChange={setParentDeptId} allowClear placeholder='Top-level (Root CEO)'>
                {departmentOptions.map((opt) => (
                  <Select.Option key={opt.value} value={opt.value}>
                    {opt.label}
                  </Select.Option>
                ))}
              </Select>
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>Local Workspace Folder Path</span>
              <div className='flex items-center gap-6px'>
                <WorkspaceFolderSelect
                  value={folderPath}
                  onChange={setFolderPath}
                  placeholder='Choose a folder...'
                  recentLabel='Recent'
                  chooseDifferentLabel='Browse Folder...'
                />
                <Button
                  size='small'
                  type='text'
                  icon={<FolderOpen size={13} />}
                  onClick={async () => {
                    try {
                      const paths = await window.electronAPI.selectDirectory({ defaultPath: folderPath || undefined });
                      if (paths?.[0]) {
                        setFolderPath(paths[0]);
                      }
                    } catch (err) {
                      console.error('[OrgEntityEditModal] selectDirectory failed:', err);
                    }
                  }}
                >
                  Browse Folder
                </Button>
              </div>
            </div>
          </>
        )}

        {isTeam && (
          <>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>Team Name</span>
              <Input value={name} onChange={setName} autoFocus />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>
                {t('team.organization.description', { defaultValue: 'Description' })}
              </span>
              <Input.TextArea value={description} onChange={setDescription} rows={2} />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>Team Lead / Head Name</span>
              <Input value={headName} onChange={setHeadName} />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>Team Lead System Prompt</span>
              <Input.TextArea value={headPrompt} onChange={setHeadPrompt} rows={2} />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>HR Coordinator Name</span>
              <Input value={hrName} onChange={setHrName} />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>Local Workspace Folder Path</span>
              <WorkspaceFolderSelect
                value={folderPath}
                onChange={setFolderPath}
                placeholder='Choose a folder...'
                recentLabel='Recent'
                chooseDifferentLabel='Browse Folder...'
              />
            </div>
          </>
        )}

        {isMember && (
          <>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>Member Name</span>
              <Input value={memberName} onChange={setMemberName} autoFocus />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>Role</span>
              <Input value={memberRole} onChange={setMemberRole} />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>System Prompt</span>
              <Input.TextArea value={memberPrompt} onChange={setMemberPrompt} rows={2} />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>MCP Tools / Backend</span>
              <Input value={memberMcp} onChange={setMemberMcp} placeholder='e.g. acp, filesystem, ...' />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>Shared Departments</span>
              <Tag className='text-10px text-t-tertiary'>{context.departmentId || 'Current department'}</Tag>
            </div>
          </>
        )}

        {isProject && (
          <>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>
                {t('team.organization.projectName', { defaultValue: 'Project name' })}
              </span>
              <Input value={name} onChange={setName} autoFocus />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>
                {t('team.organization.department', { defaultValue: 'Department' })}
              </span>
              <Select value={projectDeptId} onChange={setProjectDeptId}>
                {departmentOptions.map((opt) => (
                  <Select.Option key={opt.value} value={opt.value}>
                    {opt.label}
                  </Select.Option>
                ))}
              </Select>
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>
                {t('team.organization.team', { defaultValue: 'Team' })}
              </span>
              <Select value={projectTeamId} onChange={setProjectTeamId} allowClear placeholder='No team'>
                {teamOptions.map((opt) => (
                  <Select.Option key={opt.value} value={opt.value}>
                    {opt.label}
                  </Select.Option>
                ))}
              </Select>
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>Local Git / Workspace Folder Path</span>
              <WorkspaceFolderSelect
                value={folderPath}
                onChange={setFolderPath}
                placeholder='Assign folder...'
                recentLabel='Recent'
                chooseDifferentLabel='Browse Folder...'
              />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>Build Command</span>
              <Input value={buildCmd} onChange={setBuildCmd} placeholder='e.g. bun run build' />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>Run Command</span>
              <Input value={runCmd} onChange={setRunCmd} placeholder='e.g. bun run dev' />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>
                {t('team.organization.description', { defaultValue: 'Description' })}
              </span>
              <Input.TextArea value={description} onChange={setDescription} rows={2} />
            </div>
            <div className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>Status</span>
              <Select value={projectStatus} onChange={setProjectStatus}>
                <Select.Option value='active'>
                  {t('team.organization.statusActive', { defaultValue: 'Active' })}
                </Select.Option>
                <Select.Option value='dormant'>
                  {t('team.organization.statusDormant', { defaultValue: 'Dormant' })}
                </Select.Option>
                <Select.Option value='done'>
                  {t('team.organization.statusDone', { defaultValue: 'Done' })}
                </Select.Option>
              </Select>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default React.memo(OrgEntityEditModal);
