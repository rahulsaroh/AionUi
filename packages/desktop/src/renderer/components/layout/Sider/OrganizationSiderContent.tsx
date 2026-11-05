/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Tooltip, Tag, Modal, Input, Message } from '@arco-design/web-react';
import {
  NetworkTree,
  AlarmClock,
  Plus,
  Right,
  Down,
  FolderClose,
  MessageOne,
  Send,
  User,
  Peoples,
} from '@icon-park/react';
import classNames from 'classnames';
import { useNavigate, useLocation } from 'react-router-dom';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { useOrgStore } from '@/renderer/pages/organization/store/useOrgStore';
import { ORG_THEME_PALETTE, computeLifecycleStatus } from '@/renderer/pages/organization/utils/orgTheme';
import type { OrgNodeStatus } from '@/types/organization';

interface OrganizationSiderContentProps {
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onSessionClick?: () => void;
}

export const OrganizationSiderContent: React.FC<OrganizationSiderContentProps> = ({
  collapsed,
  siderTooltipProps,
  onSessionClick,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    hierarchy,
    projects,
    conversations,
    cronJobs,
    nodeStatuses,
    addOrgConversation,
    addSubTeam,
  } = useOrgStore();

  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'dormant' | 'shared'>('all');
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Direct CEO chat modal
  const [ceoChatModalVisible, setCeoChatModalVisible] = useState(false);
  const [ceoPrompt, setCeoPrompt] = useState('');

  // Add Sub-Team modal
  const [targetDeptIdForTeam, setTargetDeptIdForTeam] = useState<string | null>(null);
  const [newSubTeamName, setNewSubTeamName] = useState('');

  const isCanvasActive = location.pathname === '/organization';

  const toggleDept = (deptId: string) => {
    setCollapsedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  };

  const toggleSection = (sectionKey: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  };

  // Filter departments & teams
  const filteredDepartments = useMemo(() => {
    if (activeFilter === 'all') return hierarchy.departments;

    return hierarchy.departments
      .map((dept) => {
        const deptStatus: OrgNodeStatus = computeLifecycleStatus(
          dept.lastActiveAt,
          nodeStatuses[dept.id] || dept.status
        );

        if (activeFilter === 'active') {
          const activeTeams = dept.teams.filter((t) => {
            const s = computeLifecycleStatus(t.lastActiveAt, nodeStatuses[t.id] || t.status);
            return s === 'working' || s === 'department_standby' || s === 'queued_next';
          });
          if (deptStatus === 'working' || deptStatus === 'department_standby' || activeTeams.length > 0) {
            return { ...dept, teams: activeTeams.length > 0 ? activeTeams : dept.teams };
          }
          return null;
        }

        if (activeFilter === 'dormant') {
          const dormantTeams = dept.teams.filter((t) => {
            const s = computeLifecycleStatus(t.lastActiveAt, nodeStatuses[t.id] || t.status);
            return s === 'dormant';
          });
          if (deptStatus === 'dormant' || dormantTeams.length > 0) {
            return { ...dept, teams: dormantTeams.length > 0 ? dormantTeams : dept.teams };
          }
          return null;
        }

        if (activeFilter === 'shared') {
          const sharedTeams = dept.teams.filter((t) =>
            t.specialistMembers.some((s) => s.assignedTeamIds.length > 1)
          );
          if (sharedTeams.length > 0) {
            return { ...dept, teams: sharedTeams };
          }
          return null;
        }

        return dept;
      })
      .filter((d): d is NonNullable<typeof d> => Boolean(d));
  }, [hierarchy.departments, activeFilter, nodeStatuses]);

  const handleOpenCeoChat = () => {
    onSessionClick?.();
    setCeoChatModalVisible(true);
  };

  const handleConfirmSendToCeo = () => {
    if (!ceoPrompt.trim()) return;
    const prompt = ceoPrompt.trim();
    setCeoPrompt('');
    setCeoChatModalVisible(false);

    addOrgConversation({
      id: `conv-ceo-${Date.now()}`,
      title: `Directive to Root CEO: ${prompt.slice(0, 35)}...`,
      type: 'ceo_directive',
      sourceNodeId: 'root-ceo',
      targetNodeId: 'dept-app-builder',
      timestamp: Date.now(),
      summary: `Direct user instruction to Root CEO: ${prompt}`,
      messages: [
        {
          id: `msg-${Date.now()}`,
          sender: 'Executive User',
          role: 'user',
          content: prompt,
          timestamp: Date.now(),
        },
      ],
    });
    Message.success('Executive directive sent to Root CEO! Check 2D Canvas for live cascading glow.');
    void navigate('/organization');
  };

  const handleConfirmAddTeam = () => {
    if (!targetDeptIdForTeam || !newSubTeamName.trim()) return;
    const teamId = `team-${Date.now()}`;
    addSubTeam(targetDeptIdForTeam, {
      id: teamId,
      departmentId: targetDeptIdForTeam,
      name: newSubTeamName.trim(),
      lastActiveAt: Date.now(),
      status: 'idle',
      teamLeadAgent: {
        id: `lead-${teamId}`,
        canonicalAgentId: `canonical-lead-${teamId}`,
        name: 'Team Manager',
        role: 'team_lead',
        assignedTeamIds: [teamId],
        lastActiveAt: Date.now(),
        status: 'idle',
      },
      hrCoordinatorAgent: {
        id: `hr-${teamId}`,
        canonicalAgentId: `canonical-hr-${teamId}`,
        name: 'HR Coordinator',
        role: 'hr_coordinator',
        assignedTeamIds: [teamId],
        lastActiveAt: Date.now(),
        status: 'idle',
      },
      specialistMembers: [],
    });
    setNewSubTeamName('');
    setTargetDeptIdForTeam(null);
    Message.success('Sub-team created in department!');
  };

  if (collapsed) {
    return (
      <div className='flex flex-col gap-4px items-center px-4px'>
        <Tooltip {...siderTooltipProps} content='👑 Talk to Root CEO' position='right'>
          <button
            type='button'
            onClick={handleOpenCeoChat}
            className='size-32px rounded-8px flex items-center justify-center bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 cursor-pointer border-none transition-colors'
          >
            👑
          </button>
        </Tooltip>

        <Tooltip {...siderTooltipProps} content='🗺️ 2D Org-Chart Canvas' position='right'>
          <button
            type='button'
            onClick={() => {
              onSessionClick?.();
              void navigate('/organization');
            }}
            className={classNames(
              'size-32px rounded-8px flex items-center justify-center cursor-pointer border-none transition-colors',
              isCanvasActive ? 'bg-primary text-white font-bold' : 'bg-transparent text-t-primary hover:bg-fill-2'
            )}
          >
            <NetworkTree size={16} theme='outline' fill='currentColor' />
          </button>
        </Tooltip>

        <Tooltip {...siderTooltipProps} content='⏱️ Org Automations' position='right'>
          <button
            type='button'
            onClick={() => {
              onSessionClick?.();
              void navigate('/scheduled');
            }}
            className='size-32px rounded-8px flex items-center justify-center bg-transparent text-t-primary hover:bg-fill-2 cursor-pointer border-none transition-colors'
          >
            <AlarmClock size={16} theme='outline' fill='currentColor' />
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-4px select-none'>
      {/* 👑 Talk to Root CEO Button */}
      <div className='px-8px mb-2px'>
        <button
          type='button'
          onClick={handleOpenCeoChat}
          className='w-full h-34px flex items-center gap-8px px-10px rounded-8px bg-gradient-to-r from-amber-500/15 via-primary/10 to-emerald-500/15 hover:from-amber-500/25 hover:to-emerald-500/25 border border-amber-500/30 text-amber-200 cursor-pointer transition-all shadow-sm group'
        >
          <span className='text-14px leading-none group-hover:scale-110 transition-transform'>👑</span>
          <span className='font-semibold text-12px tracking-wide truncate'>Talk to Root CEO</span>
          <span className='ms-auto text-9px font-mono bg-amber-500/20 text-amber-300 px-4px py-1px rounded'>
            Command
          </span>
        </button>
      </div>

      {/* 🗺️ 2D Org-Chart Canvas Entry */}
      <div className='px-8px mb-2px'>
        <button
          type='button'
          onClick={() => {
            onSessionClick?.();
            void navigate('/organization');
          }}
          className={classNames(
            'w-full h-32px flex items-center gap-8px px-10px rounded-8px cursor-pointer border-none transition-all',
            isCanvasActive
              ? 'bg-fill-3 text-primary font-semibold ring-1 ring-primary/20'
              : 'bg-transparent text-t-primary hover:bg-fill-2'
          )}
        >
          <span className='text-13px'>🗺️</span>
          <span className='text-12px font-medium truncate'>2D Org-Chart Canvas</span>
          <span className='ms-auto text-9px font-mono text-t-tertiary px-4px py-0.5px rounded bg-fill-2'>
            Live
          </span>
        </button>
      </div>

      {/* ⏱️ Org Scheduled Automations */}
      <div className='px-8px mb-4px'>
        <button
          type='button'
          onClick={() => {
            onSessionClick?.();
            void navigate('/scheduled');
          }}
          className='w-full h-30px flex items-center gap-8px px-10px rounded-8px bg-transparent text-t-secondary hover:text-t-primary hover:bg-fill-2 cursor-pointer border-none transition-all'
        >
          <AlarmClock size={14} theme='outline' fill='currentColor' className='text-cyan-400' />
          <span className='text-12px font-medium truncate'>Org Automations</span>
          <span className='ms-auto text-9px font-mono text-cyan-300 px-5px py-0.5px rounded bg-cyan-500/10 border border-cyan-500/20'>
            {cronJobs.length} active
          </span>
        </button>
      </div>

      {/* Filter Pills: All | Active | Dormant | Shared */}
      <div className='px-12px py-4px flex items-center gap-4px flex-wrap text-11px'>
        {(['all', 'active', 'dormant', 'shared'] as const).map((filter) => (
          <Tag
            key={filter}
            size='small'
            color={activeFilter === filter ? 'arcoblue' : undefined}
            className='cursor-pointer capitalize text-10px font-medium px-6px py-0.5px rounded-full'
            onClick={() => setActiveFilter(filter)}
          >
            {filter}
          </Tag>
        ))}
      </div>

      <div className='h-1px bg-[var(--color-border-2)] mx-10px my-4px' />

      {/* Section 1: 🏢 Departments & Sub-Teams */}
      <div className='flex flex-col'>
        <div
          className='flex items-center justify-between px-12px h-26px text-t-tertiary hover:text-t-primary cursor-pointer'
          onClick={() => toggleSection('departments')}
        >
          <div className='flex items-center gap-6px'>
            <span className='text-11px font-semibold uppercase tracking-wider'>
              Departments ({filteredDepartments.length})
            </span>
            {collapsedSections.has('departments') ? (
              <Right size={11} theme='outline' />
            ) : (
              <Down size={11} theme='outline' />
            )}
          </div>
        </div>

        {!collapsedSections.has('departments') && (
          <div className='flex flex-col gap-2px px-6px mt-2px'>
            {filteredDepartments.map((dept) => {
              const isDeptExpanded = !collapsedDepts.has(dept.id);
              const deptStatus: OrgNodeStatus = computeLifecycleStatus(
                dept.lastActiveAt,
                nodeStatuses[dept.id] || dept.status
              );
              const theme = ORG_THEME_PALETTE[deptStatus];

              return (
                <div key={dept.id} className='flex flex-col rounded-8px overflow-hidden'>
                  {/* Department Item Header */}
                  <div
                    onClick={() => toggleDept(dept.id)}
                    className='group flex items-center justify-between px-8px py-5px rounded-6px hover:bg-fill-2 cursor-pointer transition-colors text-12px text-t-primary'
                  >
                    <div className='flex items-center gap-6px min-w-0'>
                      <span className='size-5px rounded-full shrink-0' style={{ backgroundColor: theme.borderColor }} />
                      <span className='font-semibold truncate' title={dept.name}>
                        {dept.name}
                      </span>
                    </div>

                    <div className='flex items-center gap-4px shrink-0'>
                      <Tooltip content='Add Sub-Team' position='top'>
                        <span
                          role='button'
                          className='size-18px rounded flex items-center justify-center text-t-tertiary hover:text-t-primary hover:bg-fill-3 opacity-0 group-hover:opacity-100 transition-opacity'
                          onClick={(e) => {
                            e.stopPropagation();
                            setTargetDeptIdForTeam(dept.id);
                          }}
                        >
                          <Plus size={11} theme='outline' />
                        </span>
                      </Tooltip>
                      {dept.teams.length > 0 && (
                        <span className='text-t-tertiary'>
                          {isDeptExpanded ? <Down size={10} theme='outline' /> : <Right size={10} theme='outline' />}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Child Teams Tree */}
                  {isDeptExpanded && dept.teams.length > 0 && (
                    <div className='flex flex-col gap-1px pl-18px pr-4px py-2px border-l border-slate-700/40 ml-12px'>
                      {dept.teams.map((team) => {
                        const teamStatus = computeLifecycleStatus(
                          team.lastActiveAt,
                          nodeStatuses[team.id] || team.status
                        );
                        const teamTheme = ORG_THEME_PALETTE[teamStatus];

                        return (
                          <div
                            key={team.id}
                            onClick={() => {
                              onSessionClick?.();
                              void navigate('/organization');
                            }}
                            className='flex items-center justify-between px-6px py-3px rounded hover:bg-fill-2 cursor-pointer text-11px text-t-secondary hover:text-t-primary transition-colors'
                          >
                            <div className='flex items-center gap-5px truncate min-w-0'>
                              <User size={11} theme='outline' className='text-primary shrink-0' />
                              <span className='truncate'>{team.name}</span>
                            </div>
                            <span
                              className='size-5px rounded-full shrink-0'
                              style={{ backgroundColor: teamTheme.borderColor }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className='h-1px bg-[var(--color-border-2)] mx-10px my-4px' />

      {/* Section 2: 📁 Org Projects */}
      <div className='flex flex-col'>
        <div
          className='flex items-center justify-between px-12px h-26px text-t-tertiary hover:text-t-primary cursor-pointer'
          onClick={() => toggleSection('projects')}
        >
          <span className='text-11px font-semibold uppercase tracking-wider'>
            Org Projects ({projects.length})
          </span>
          {collapsedSections.has('projects') ? (
            <Right size={11} theme='outline' />
          ) : (
            <Down size={11} theme='outline' />
          )}
        </div>

        {!collapsedSections.has('projects') && (
          <div className='flex flex-col gap-1px px-6px mt-2px'>
            {projects.map((proj) => (
              <div
                key={proj.id}
                onClick={() => {
                  onSessionClick?.();
                  void navigate('/organization');
                }}
                className='flex items-center justify-between px-8px py-4px rounded-6px hover:bg-fill-2 cursor-pointer text-12px text-t-primary transition-colors'
              >
                <div className='flex items-center gap-6px truncate min-w-0'>
                  <FolderClose size={13} theme='outline' className='text-amber-400 shrink-0' />
                  <span className='truncate font-medium'>{proj.name}</span>
                </div>
                <span className='text-9px font-mono text-t-tertiary'>Active</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className='h-1px bg-[var(--color-border-2)] mx-10px my-4px' />

      {/* Section 3: 💬 Org Conversations */}
      <div className='flex flex-col'>
        <div
          className='flex items-center justify-between px-12px h-26px text-t-tertiary hover:text-t-primary cursor-pointer'
          onClick={() => toggleSection('conversations')}
        >
          <span className='text-11px font-semibold uppercase tracking-wider'>
            Org Conversations ({conversations.length})
          </span>
          {collapsedSections.has('conversations') ? (
            <Right size={11} theme='outline' />
          ) : (
            <Down size={11} theme='outline' />
          )}
        </div>

        {!collapsedSections.has('conversations') && (
          <div className='flex flex-col gap-2px px-6px mt-2px pb-16px'>
            {conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => {
                  onSessionClick?.();
                  void navigate('/organization');
                }}
                className='p-6px rounded-6px hover:bg-fill-2 cursor-pointer transition-colors flex flex-col gap-2px text-11px border border-transparent hover:border-[var(--color-border-2)]'
              >
                <div className='flex items-center justify-between'>
                  <span className='font-semibold text-t-primary truncate' title={conv.title}>
                    {conv.title}
                  </span>
                </div>
                {conv.summary && (
                  <span className='text-10px text-t-secondary truncate'>{conv.summary}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: Talk to Root CEO */}
      <Modal
        title='👑 Directive Command to Root CEO'
        visible={ceoChatModalVisible}
        onOk={handleConfirmSendToCeo}
        onCancel={() => setCeoChatModalVisible(false)}
        okText='Dispatch Directive'
        okButtonProps={{ disabled: !ceoPrompt.trim() }}
      >
        <div className='flex flex-col gap-8px'>
          <span className='text-12px text-t-secondary'>
            Assign an executive strategic objective to the Global Organization CEO:
          </span>
          <Input.TextArea
            rows={3}
            value={ceoPrompt}
            onChange={setCeoPrompt}
            placeholder='e.g., Roll out the new 2D Org-Chart Canvas and integrate biometrics across App Builder Department...'
            autoFocus
          />
        </div>
      </Modal>

      {/* Modal: Add Sub-Team */}
      <Modal
        title='Add Sub-Team to Department'
        visible={Boolean(targetDeptIdForTeam)}
        onOk={handleConfirmAddTeam}
        onCancel={() => setTargetDeptIdForTeam(null)}
        okText='Create Team'
        okButtonProps={{ disabled: !newSubTeamName.trim() }}
      >
        <div className='flex flex-col gap-8px'>
          <span className='text-12px text-t-secondary'>Team Name:</span>
          <Input
            value={newSubTeamName}
            onChange={setNewSubTeamName}
            placeholder='e.g., Growth Automation Team'
            onPressEnter={handleConfirmAddTeam}
            autoFocus
          />
        </div>
      </Modal>
    </div>
  );
};

export default React.memo(OrganizationSiderContent);
