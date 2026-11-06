/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Tooltip, Tag, Modal, Input, Message } from '@arco-design/web-react';
import {
  NetworkTree,
  AlarmClock,
  Plus,
  Right,
  Down,
  FolderClose,
  Edit,
  User,
  FolderPlus,
  Close,
  Robot,
  LinkOne,
} from '@icon-park/react';
import classNames from 'classnames';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { useOrgStore } from '@/renderer/pages/organization/store/useOrgStore';
import { OrgDelegationEngine } from '@/renderer/pages/organization/utils/orgDelegationEngine';
import { ORG_THEME_PALETTE, computeLifecycleStatus } from '@/renderer/pages/organization/utils/orgTheme';
import { createDepartmentShell, createTeamShell } from '@/renderer/pages/organization/utils/orgCoherence';
import type { OrgConversation, OrgNodeStatus, OrgProject, OrgDepartmentNode, OrgTeamNode } from '@/types/organization';
import OrgProjectModal from '@/renderer/pages/organization/components/OrgProjectModal';
import OrgDepartmentModal from '@/renderer/pages/organization/components/OrgDepartmentModal';
import OrgEntityEditModal from '@/renderer/pages/organization/components/OrgEntityEditModal';

type OrganizationSiderContentProps = {
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onSessionClick?: () => void;
};

export const OrganizationSiderContent: React.FC<OrganizationSiderContentProps> = ({
  collapsed,
  siderTooltipProps,
  onSessionClick,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    hierarchy,
    projects,
    conversations,
    cronJobs,
    nodeStatuses,
    updateNodeStatus,
    addOrgConversation,
    addDepartment,
    addSubTeam,
    selectedDepartmentId,
    selectedTeamId,
    selectedProjectId,
    setSelectedDepartment,
    setSelectedTeam,
    setSelectedProject,
    clearOrgSelection,
  } = useOrgStore();

  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'dormant' | 'shared'>('all');
  const [deptSubTabs, setDeptSubTabs] = useState<Record<string, 'teams' | 'projects'>>({});
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [ceoChatModalVisible, setCeoChatModalVisible] = useState(false);
  const [ceoPrompt, setCeoPrompt] = useState('');
  const [targetDeptIdForTeam, setTargetDeptIdForTeam] = useState<string | null>(null);
  const [newSubTeamName, setNewSubTeamName] = useState('');
  const [createDeptModalVisible, setCreateDeptModalVisible] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');
  const [projectModal, setProjectModal] = useState<{
    visible: boolean;
    project: OrgProject | null;
    departmentId?: string;
    teamId?: string;
  }>({ visible: false, project: null });
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);
  const [editEntity, setEditEntity] = useState<{
    type: 'department' | 'team' | 'member' | 'project';
    data: any;
    context: { departmentId?: string; teamId?: string };
  } | null>(null);

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

  // Persist per-department sub-tab preference to localStorage
  const UI_STORAGE_KEY = 'aionui:org-ui';

  useEffect(() => {
    try {
      const raw = localStorage.getItem(UI_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.deptSubTabs === 'object') {
          setDeptSubTabs(parsed.deptSubTabs as Record<string, 'teams' | 'projects'>);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(UI_STORAGE_KEY);
      const existing = raw ? JSON.parse(raw) : {};
      localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ ...existing, deptSubTabs }));
    } catch {}
  }, [deptSubTabs]);

  const setDeptSubTab = (deptId: string, tab: 'teams' | 'projects') => {
    setDeptSubTabs((prev) => ({ ...prev, [deptId]: tab }));
  };

  // Project -> conversations (newest first)
  const projectConversationsMap = useMemo(() => {
    const map = new Map<string, OrgConversation[]>();
    conversations.forEach((c) => {
      if (c.projectId) {
        const list = map.get(c.projectId) ?? [];
        list.push(c);
        map.set(c.projectId, list);
      }
    });
    map.forEach((chats) => chats.sort((a, b) => b.timestamp - a.timestamp));
    return map;
  }, [conversations]);

  const handleOpenCeoChat = () => {
    onSessionClick?.();
    setCeoChatModalVisible(true);
  };

  const handleConfirmSendToCeo = async () => {
    if (!ceoPrompt.trim()) return;
    const prompt = ceoPrompt.trim();
    setCeoPrompt('');
    setCeoChatModalVisible(false);

    const engine = new OrgDelegationEngine(hierarchy, undefined, undefined, updateNodeStatus);
    const result = await engine.executeDirective(prompt, undefined, undefined, undefined, true);

    if (result.createdDepartments && result.createdDepartments.length > 0) {
      for (const dept of result.createdDepartments) {
        addDepartment(dept);
      }
    }
    if (result.createdTeams && result.createdTeams.length > 0) {
      for (const { departmentId, team } of result.createdTeams) {
        addSubTeam(departmentId, team);
      }
    }

    addOrgConversation({
      id: `conv-ceo-${Date.now()}`,
      title: `Directive to Root CEO: ${prompt.slice(0, 35)}...`,
      type: 'ceo_directive',
      sourceNodeId: 'root-ceo',
      targetNodeId: result.involvedDepartmentIds[0] || 'root-ceo',
      timestamp: Date.now(),
      summary: result.finalSynthesis,
      messages: [
        { id: `msg-${Date.now()}-1`, sender: 'Executive User', role: 'user', content: prompt, timestamp: Date.now() },
        {
          id: `msg-${Date.now()}-2`,
          sender: hierarchy.rootCeo.ceoAgent.name,
          role: 'ceo',
          content: result.finalSynthesis,
          timestamp: Date.now(),
        },
      ],
    });
    Message.success('Executive directive processed by Root CEO!');
    void navigate('/organization');
  };

  const handleConfirmAddTeam = () => {
    if (!targetDeptIdForTeam || !newSubTeamName.trim()) return;
    addSubTeam(targetDeptIdForTeam, createTeamShell(targetDeptIdForTeam, newSubTeamName));
    setNewSubTeamName('');
    setTargetDeptIdForTeam(null);
    Message.success(t('team.organization.teamSaved', { defaultValue: 'Sub-team saved' }));
  };

  const handleConfirmAddDepartment = () => {
    if (!newDeptName.trim()) return;
    addDepartment(createDepartmentShell(newDeptName));
    setNewDeptName('');
    setCreateDeptModalVisible(false);
    Message.success(t('team.organization.departmentSaved', { defaultValue: 'Department saved' }));
  };

  const openProjectModal = (departmentId?: string, teamId?: string, project: OrgProject | null = null) => {
    setProjectModal({ visible: true, project, departmentId, teamId });
  };

  // ---------- Drill-down derived data ----------
  const selectedDepartment = useMemo(
    () => hierarchy.departments.find((d) => d.id === selectedDepartmentId),
    [hierarchy.departments, selectedDepartmentId]
  );

  const allTeams = useMemo(() => hierarchy.departments.flatMap((d) => d.teams), [hierarchy.departments]);

  const query = searchQuery.trim().toLowerCase();
  const filteredDepartments = useMemo(() => {
    if (!query) return hierarchy.departments;
    return hierarchy.departments.filter((dept) => {
      if (dept.name.toLowerCase().includes(query)) return true;
      const deptTeams = allTeams.filter((t) => t.departmentId === dept.id);
      if (deptTeams.some((t) => t.name.toLowerCase().includes(query))) return true;
      const deptProjects = projects.filter((p) => p.departmentId === dept.id);
      return deptProjects.some((p) => p.name.toLowerCase().includes(query));
    });
  }, [hierarchy.departments, allTeams, projects, query]);

  const teamsInSelectedDept = useMemo(() => {
    if (selectedDepartmentId) {
      return hierarchy.departments.find((d) => d.id === selectedDepartmentId)?.teams ?? [];
    }
    return allTeams;
  }, [hierarchy.departments, selectedDepartmentId, allTeams]);

  const selectedTeam = useMemo(
    () => teamsInSelectedDept.find((t) => t.id === selectedTeamId),
    [teamsInSelectedDept, selectedTeamId]
  );

  const projectsForSelection = useMemo(() => {
    if (selectedTeamId) {
      return projects.filter((p) => p.teamIds.includes(selectedTeamId));
    }
    if (selectedDepartmentId) {
      return projects.filter((p) => p.departmentId === selectedDepartmentId);
    }
    return projects;
  }, [projects, selectedTeamId, selectedDepartmentId]);

  const selectedProject = useMemo(
    () => projectsForSelection.find((p) => p.id === selectedProjectId),
    [projectsForSelection, selectedProjectId]
  );

  // Breadcrumb path
  const breadcrumb = useMemo(() => {
    const parts: Array<{ label: string; id: string | null; type: 'dept' | 'team' | 'project' }> = [];
    if (selectedProject) {
      const team = teamsInSelectedDept.find((t) => t.id === selectedProject.teamIds?.[0]);
      const dept = team ? hierarchy.departments.find((d) => d.id === team.departmentId) : selectedDepartment;
      if (dept) parts.push({ label: dept.name, id: dept.id, type: 'dept' });
      if (team) parts.push({ label: team.name, id: team.id, type: 'team' });
      parts.push({ label: selectedProject.name, id: selectedProject.id, type: 'project' });
    } else if (selectedTeam) {
      const dept = hierarchy.departments.find((d) => d.id === selectedTeam.departmentId);
      if (dept) parts.push({ label: dept.name, id: dept.id, type: 'dept' });
      parts.push({ label: selectedTeam.name, id: selectedTeam.id, type: 'team' });
    } else if (selectedDepartment) {
      parts.push({ label: selectedDepartment.name, id: selectedDepartment.id, type: 'dept' });
    }
    return parts;
  }, [selectedProject, selectedTeam, selectedDepartment, teamsInSelectedDept, hierarchy.departments]);

  const deptStatus = (dept: OrgDepartmentNode): OrgNodeStatus =>
    computeLifecycleStatus(dept.lastActiveAt, nodeStatuses[dept.id] || dept.status);
  const teamStatus = (team: OrgTeamNode): OrgNodeStatus =>
    computeLifecycleStatus(team.lastActiveAt, nodeStatuses[team.id] || team.status);

  // Returns a short label for the chat row badge: team name or agent role
  const chatBadgeLabel = (conv: OrgConversation): string => {
    if (conv.teamId) {
      const team = allTeams.find((t) => t.id === conv.teamId);
      if (team) return team.name;
    }
    if (conv.agentId) {
      const agent = allTeams
        .flatMap((t) => [...t.specialistMembers, t.teamLeadAgent, t.hrCoordinatorAgent])
        .find((a) => a.id === conv.agentId);
      if (agent) return agent.name;
    }
    return '';
  };

  const formatChatTime = (timestamp: number): string => {
    const now = Date.now();
    const elapsed = now - timestamp;
    if (elapsed < 60 * 1000) return 'Just now';
    if (elapsed < 60 * 60 * 1000) return `${Math.floor(elapsed / 60000)}m ago`;
    if (elapsed < 24 * 60 * 60 * 1000) return `${Math.floor(elapsed / 3600000)}h ago`;
    return `${Math.floor(elapsed / 86400000)}d ago`;
  };

  const handleSelectDept = (deptId: string) => {
    setSelectedDepartment(deptId);
    setSelectedTeam(null);
    setSelectedProject(null);
  };

  const handleSelectTeam = (teamId: string) => {
    setSelectedTeam(teamId);
    setSelectedProject(null);
  };

  const handleSelectProject = (projectId: string) => {
    setSelectedProject(projectId);
  };

  const handleOpenEntityEdit = (
    type: 'department' | 'team' | 'member' | 'project',
    data: any,
    context: { departmentId?: string; teamId?: string }
  ) => {
    setEditEntity({ type, data, context });
  };

  const handleNewChat = (deptId: string, proj: OrgProject) => {
    const teamId = proj.teamIds?.[0] ?? '';
    addOrgConversation({
      id: `conv-${Date.now()}`,
      title: `Chat ${formatChatTime(Date.now())}`,
      type: 'team_execution',
      sourceNodeId: teamId || deptId,
      targetNodeId: teamId || deptId,
      projectId: proj.id,
      teamId: teamId || undefined,
      timestamp: Date.now(),
      summary: '',
      messages: [],
    });
    setSelectedProject(proj.id);
  };

  const handleEditSave = () => {
    if (editEntity) {
      Message.success('Saved.');
    }
    setEditEntity(null);
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
      {/* Breadcrumb header */}
      <div className='px-12px py-4px bg-fill-2 border-b border-[var(--color-border-2)] flex items-center justify-between min-h-28px'>
        <div className='flex items-center gap-3px overflow-hidden'>
          <span className='text-10px text-t-tertiary font-mono'>🏢 All Depts</span>
          {breadcrumb.map((part, idx) => (
            <span key={part.id} className='flex items-center gap-3px overflow-hidden'>
              <span className='text-t-tertiary text-9px shrink-0 opacity-60'>›</span>
              <button
                type='button'
                className='p-2px truncate hover:bg-fill-2 hover:text-primary transition-colors rounded-3px'
                onClick={(e) => {
                  e.stopPropagation();
                  if (part.type === 'dept') handleSelectDept(part.id!);
                  if (part.type === 'team') handleSelectTeam(part.id!);
                  if (part.type === 'project') handleSelectProject(part.id!);
                }}
              >
                <span className='text-11px text-t-secondary truncate' title={part.label}>
                  {part.label}
                </span>
              </button>
            </span>
          ))}
          {breadcrumb.length > 0 && (
            <button
              type='button'
              className='p-1px text-t-tertiary hover:text-t-danger transition-colors'
              onClick={clearOrgSelection}
              title='Clear Filter'
            >
              <Close size={12} theme='outline' />
            </button>
          )}
        </div>
        <span className='text-9px font-mono text-t-tertiary shrink-0'>
          {breadcrumb.length ? 'Drill-down active' : 'All organization'}
        </span>
      </div>

      <div className='px-8px mb-2px flex items-center gap-6px'>
        <button
          type='button'
          onClick={handleOpenCeoChat}
          className='flex-1 h-34px flex items-center gap-8px px-10px rounded-8px bg-gradient-to-r from-amber-500/15 via-primary/10 to-emerald-500/15 hover:from-amber-500/25 hover:to-emerald-500/25 border border-amber-500/30 text-amber-200 cursor-pointer transition-all shadow-sm group'
        >
          <span className='text-14px leading-none group-hover:scale-110 transition-transform'>👑</span>
          <span className='font-semibold text-12px tracking-wide truncate'>Talk to Root CEO</span>
        </button>
        <Tooltip content={t('team.organization.addDepartment', { defaultValue: 'Add Department' })} position='top'>
          <button
            type='button'
            onClick={() => setCreateDeptModalVisible(true)}
            className='size-34px rounded-8px flex items-center justify-center bg-fill-2 hover:bg-fill-3 text-t-primary border border-[var(--color-border-2)] cursor-pointer'
          >
            <Plus size={14} />
          </button>
        </Tooltip>
      </div>

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
          <span className='ms-auto text-9px font-mono text-t-tertiary px-4px py-0.5px rounded bg-fill-2'>Live</span>
        </button>
      </div>

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

      {/* Departments Section */}
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
            <Input
              allowClear
              className='w-full h-26px text-10px'
              placeholder={t('team.organization.searchPlaceholder', {
                defaultValue: 'Search departments, teams, projects...',
              })}
              value={searchQuery}
              onChange={setSearchQuery}
            />
            {filteredDepartments.length === 0 ? (
              <div className='px-12px py-16px text-center text-11px text-t-tertiary'>
                {searchQuery
                  ? t('team.organization.noSearchResults', {
                      defaultValue: 'No departments, teams, or projects match your search.',
                    })
                  : t('team.organization.noDepartments', { defaultValue: 'No departments found.' })}
              </div>
            ) : (
              filteredDepartments.map((dept) => {
                const status = deptStatus(dept);
                const theme = ORG_THEME_PALETTE[status];
                const isSelected = selectedDepartmentId === dept.id;
                const isDeptExpanded = !collapsedDepts.has(dept.id);
                const deptTeams = allTeams.filter((t) => t.departmentId === dept.id);
                const deptProjects = projects.filter((p) => p.departmentId === dept.id);
                const subTab = deptSubTabs[dept.id] ?? 'teams';

                const sharedCanonicalIds = new Set<string>();
                deptTeams.forEach((t) =>
                  t.specialistMembers.forEach((m) => {
                    if (m.assignedTeamIds.length > 1) sharedCanonicalIds.add(m.canonicalAgentId);
                  })
                );

                const filteredTeams = deptTeams.filter((team) => {
                  if (activeFilter === 'all') return true;
                  if (activeFilter === 'dormant') return teamStatus(team) === 'dormant';
                  if (activeFilter === 'shared') {
                    return team.specialistMembers.some((m) => sharedCanonicalIds.has(m.canonicalAgentId));
                  }
                  return teamStatus(team) !== 'dormant';
                });

                const filteredProjects = deptProjects.filter((proj) => {
                  if (activeFilter === 'all') return true;
                  if (activeFilter === 'shared') return proj.teamIds.length > 1;
                  return proj.status === activeFilter;
                });

                return (
                  <div
                    key={dept.id}
                    className='flex flex-col rounded-8px overflow-hidden mb-4px border border-[var(--color-border-2)] bg-[var(--color-bg-2)]'
                  >
                    {/* Department header */}
                    <div
                      role='button'
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectDept(dept.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectDept(dept.id);
                        }
                      }}
                      className={classNames(
                        'group flex items-center justify-between px-8px py-5px rounded-6px cursor-pointer transition-colors text-12px',
                        isSelected
                          ? 'bg-primary/10 text-t-primary border border-primary/20'
                          : 'hover:bg-fill-3 text-t-primary'
                      )}
                    >
                      <div className='flex items-center gap-6px min-w-0'>
                        <span
                          className='size-4px rounded-full shrink-0 opacity-60'
                          style={{ backgroundColor: theme.borderColor }}
                        />
                        <span className='font-semibold truncate' title={dept.name}>
                          {dept.name}
                        </span>
                      </div>
                      <div className='flex items-center gap-3px shrink-0'>
                        {/* Sub-tab pills (segmented control) */}
                        <div className='flex rounded-4px border border-[var(--color-border-2)] bg-fill-1 shrink-0'>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeptSubTab(dept.id, 'teams');
                            }}
                            className={classNames(
                              'px-5px py-1px text-9px transition-colors shrink-0 rounded-l-4px',
                              subTab === 'teams'
                                ? 'bg-fill-3 text-t-primary'
                                : 'text-t-tertiary hover:bg-fill-2 hover:text-t-primary'
                            )}
                          >
                            {t('team.organization.teamsTab', { defaultValue: 'Teams' })}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeptSubTab(dept.id, 'projects');
                            }}
                            className={classNames(
                              'px-5px py-1px text-9px transition-colors shrink-0 rounded-r-4px',
                              subTab === 'projects'
                                ? 'bg-fill-3 text-t-primary'
                                : 'text-t-tertiary hover:bg-fill-2 hover:text-t-primary'
                            )}
                          >
                            {t('team.organization.project', { defaultValue: 'Projects' })}
                          </button>
                        </div>
                        <Tooltip
                          content={t('team.organization.editDepartment', { defaultValue: 'Edit Department' })}
                          position='top'
                        >
                          <span
                            role='button'
                            className='size-18px rounded flex items-center justify-center text-t-tertiary hover:text-t-primary hover:bg-fill-3 opacity-0 group-hover:opacity-100 transition-opacity ml-2px'
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEntityEdit('department', dept, { departmentId: dept.id });
                            }}
                          >
                            <Edit size={11} theme='outline' />
                          </span>
                        </Tooltip>
                        <Tooltip content='Set Folder' position='top'>
                          <span
                            role='button'
                            className='size-18px rounded flex items-center justify-center text-t-tertiary hover:text-amber-400 hover:bg-amber-500/20 opacity-0 group-hover:opacity-100 transition-opacity'
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEntityEdit('department', dept, { departmentId: dept.id });
                            }}
                          >
                            <LinkOne size={11} theme='outline' />
                          </span>
                        </Tooltip>
                        <Tooltip
                          content={t('team.organization.addProject', { defaultValue: 'Add Project' })}
                          position='top'
                        >
                          <span
                            role='button'
                            className='size-18px rounded flex items-center justify-center text-t-tertiary hover:text-t-primary hover:bg-fill-3 opacity-0 group-hover:opacity-100 transition-opacity'
                            onClick={(e) => {
                              e.stopPropagation();
                              openProjectModal(dept.id);
                            }}
                          >
                            <FolderPlus size={11} theme='outline' />
                          </span>
                        </Tooltip>
                        <Tooltip
                          content={t('team.organization.addTeam', { defaultValue: 'Add Sub-Team' })}
                          position='top'
                        >
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
                        {deptTeams.length > 0 ? (
                          <span
                            className='text-t-tertiary'
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleDept(dept.id);
                            }}
                            role='button'
                          >
                            {isDeptExpanded ? <Down size={10} theme='outline' /> : <Right size={10} theme='outline' />}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {isDeptExpanded && (
                      <div className='flex flex-col gap-1px pl-20px pr-4px py-2px border-l border-slate-700/40 ml-12px'>
                        {subTab === 'teams' ? (
                          <>
                            {/* PM pinned at top */}
                            {dept.pmAgent && (
                              <div
                                key='pm-pinned'
                                className='flex items-center justify-between px-6px py-2px rounded cursor-pointer transition-colors text-10px hover:bg-fill-2'
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectDept(dept.id);
                                }}
                              >
                                <div className='flex items-center gap-4px truncate min-w-0'>
                                  <Robot size={10} theme='outline' className='text-t-tertiary shrink-0' />
                                  <span className='font-medium truncate' title={dept.pmAgent.name}>
                                    {dept.pmAgent.name}
                                  </span>
                                  <span className='text-8px text-t-tertiary font-mono'>
                                    {t('team.organization.pm', { defaultValue: 'PM' })}
                                  </span>
                                </div>
                                <span className='text-9px text-amber-400 font-mono'>
                                  {t('team.organization.pinned', { defaultValue: 'Pinned' })}
                                </span>
                              </div>
                            )}
                            {/* Teams list */}
                            <div className='flex flex-col gap-0.5px'>
                              {filteredTeams.length === 0 ? (
                                <div className='px-6px py-4px text-10px text-t-tertiary italic'>
                                  {activeFilter === 'all'
                                    ? t('team.organization.noTeams', {
                                        defaultValue: 'No teams in this department yet.',
                                      })
                                    : 'No matching teams.'}
                                </div>
                              ) : (
                                filteredTeams.map((team) => {
                                  const tStatus = teamStatus(team);
                                  const tTheme = ORG_THEME_PALETTE[tStatus];
                                  const isTeamSelected = selectedTeamId === team.id;
                                  return (
                                    <div
                                      key={team.id}
                                      role='button'
                                      tabIndex={0}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleSelectTeam(team.id);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          handleSelectTeam(team.id);
                                        }
                                      }}
                                      className={classNames(
                                        'flex items-center justify-between px-6px py-3px rounded cursor-pointer transition-colors text-11px',
                                        isTeamSelected
                                          ? 'bg-primary/10 text-t-primary border border-primary/20'
                                          : 'hover:bg-fill-2 text-t-secondary hover:text-t-primary'
                                      )}
                                    >
                                      <div className='flex items-center gap-5px truncate min-w-0'>
                                        <User size={11} theme='outline' className='text-primary shrink-0' />
                                        <span className='truncate' title={team.name}>
                                          {team.name}
                                        </span>
                                      </div>
                                      <div className='flex items-center gap-3px shrink-0'>
                                        <Tooltip content='Edit Team' position='top'>
                                          <span
                                            role='button'
                                            className='size-16px rounded flex items-center justify-center text-t-tertiary hover:text-t-primary hover:bg-fill-3 opacity-0 group-hover:opacity-100 transition-opacity'
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleOpenEntityEdit('team', team, {
                                                departmentId: dept.id,
                                                teamId: team.id,
                                              });
                                            }}
                                          >
                                            <Edit size={10} theme='outline' />
                                          </span>
                                        </Tooltip>
                                        <span
                                          className='size-4px rounded-full shrink-0 opacity-60'
                                          style={{ backgroundColor: tTheme.borderColor }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            {/* Projects list with chats nested underneath */}
                            <div className='flex flex-col gap-1px'>
                              {filteredProjects.length === 0 ? (
                                <div className='px-6px py-4px text-10px text-t-tertiary italic'>
                                  {activeFilter === 'all'
                                    ? t('team.organization.noProjects', {
                                        defaultValue: 'No projects in this department.',
                                      })
                                    : 'No matching projects.'}
                                </div>
                              ) : (
                                filteredProjects.map((proj) => {
                                  const chats = projectConversationsMap.get(proj.id) ?? [];
                                  const isProjectSelected = selectedProjectId === proj.id;
                                  const statusColor =
                                    proj.status === 'active'
                                      ? 'emerald'
                                      : proj.status === 'dormant'
                                        ? 'gray'
                                        : 'purple';
                                  return (
                                    <div key={proj.id} className='flex flex-col'>
                                      {/* Project row */}
                                      <div
                                        role='button'
                                        tabIndex={0}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleSelectProject(proj.id);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            handleSelectProject(proj.id);
                                          }
                                        }}
                                        className={classNames(
                                          'flex items-center justify-between px-8px py-4px rounded-6px cursor-pointer transition-colors text-12px text-t-primary',
                                          isProjectSelected
                                            ? 'bg-primary/10 border border-primary/20'
                                            : 'hover:bg-fill-2'
                                        )}
                                      >
                                        <div className='flex items-center gap-6px truncate min-w-0'>
                                          <FolderClose size={13} theme='outline' className='text-amber-400 shrink-0' />
                                          <span className='truncate font-medium' title={proj.name}>
                                            {proj.name}
                                          </span>
                                        </div>
                                        <div className='flex items-center gap-3px shrink-0'>
                                          <Tag size='small' color={statusColor} className='text-9px'>
                                            {proj.status}
                                          </Tag>
                                          <Tooltip content='Edit Project' position='top'>
                                            <span
                                              role='button'
                                              className='size-16px rounded flex items-center justify-center text-t-tertiary hover:text-t-primary hover:bg-fill-3 opacity-0 group-hover:opacity-100 transition-opacity'
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleOpenEntityEdit('project', proj, {
                                                  departmentId: proj.departmentId,
                                                  teamId: proj.teamIds?.[0],
                                                });
                                              }}
                                            >
                                              <Edit size={10} theme='outline' />
                                            </span>
                                          </Tooltip>
                                        </div>
                                      </div>
                                      {/* Chats nested under project */}
                                      <div className='flex flex-col gap-0.5px pl-16px pr-4px py-1px border-l border-slate-700/20 ml-12px'>
                                        {chats.length === 0 ? (
                                          <div className='px-6px py-2px text-9px text-t-tertiary italic'>
                                            {t('team.organization.noChats', { defaultValue: 'No chats yet.' })}
                                          </div>
                                        ) : (
                                          chats.map((conv) => {
                                            const isChatSelected = selectedChatId === conv.id;
                                            return (
                                              <div
                                                key={conv.id}
                                                role='button'
                                                tabIndex={0}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setSelectedChatId(conv.id);
                                                  onSessionClick?.();
                                                  void navigate('/organization');
                                                }}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    setSelectedChatId(conv.id);
                                                    onSessionClick?.();
                                                    void navigate('/organization');
                                                  }
                                                }}
                                                className={classNames(
                                                  'p-3px rounded-4px cursor-pointer transition-colors flex flex-col gap-1px text-10px border border-transparent',
                                                  isChatSelected
                                                    ? 'bg-primary/10 border-primary/30 text-t-primary'
                                                    : 'hover:bg-fill-2 text-t-secondary hover:text-t-primary hover:border-[var(--color-border-2)]'
                                                )}
                                              >
                                                <div className='flex items-center justify-between gap-4px'>
                                                  <span
                                                    className='font-semibold text-t-primary truncate'
                                                    title={conv.title}
                                                  >
                                                    {conv.title}
                                                  </span>
                                                  <span className='text-8px text-t-tertiary font-mono'>
                                                    {formatChatTime(conv.timestamp)}
                                                  </span>
                                                </div>
                                                {conv.summary ? (
                                                  <span className='text-9px text-t-secondary truncate'>
                                                    {conv.summary}
                                                  </span>
                                                ) : null}
                                                {chatBadgeLabel(conv) ? (
                                                  <span className='text-8px text-t-tertiary font-mono tracking-tight'>
                                                    {chatBadgeLabel(conv)}
                                                  </span>
                                                ) : null}
                                              </div>
                                            );
                                          })
                                        )}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleNewChat(dept.id, proj);
                                          }}
                                          className='px-6px py-1px text-9px text-t-tertiary hover:text-t-primary hover:bg-fill-2 rounded cursor-pointer flex items-center gap-2px'
                                        >
                                          <Plus size={10} />
                                          <span>{t('team.organization.newChat', { defaultValue: 'New chat' })}</span>
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className='h-1px bg-[var(--color-border-2)] mx-10px my-4px' />

      <Modal
        title='👑 Directive Command to Root CEO'
        visible={ceoChatModalVisible}
        onOk={handleConfirmSendToCeo}
        onCancel={() => setCeoChatModalVisible(false)}
        okText='Dispatch Directive'
        okButtonProps={{ disabled: !ceoPrompt.trim() }}
      >
        <Input.TextArea rows={3} value={ceoPrompt} onChange={setCeoPrompt} autoFocus />
      </Modal>
      <Modal
        title={t('team.organization.addDepartment', { defaultValue: 'Add Department' })}
        visible={createDeptModalVisible}
        onOk={handleConfirmAddDepartment}
        onCancel={() => setCreateDeptModalVisible(false)}
        okText={t('team.organization.save', { defaultValue: 'Save' })}
        okButtonProps={{ disabled: !newDeptName.trim() }}
      >
        <Input
          value={newDeptName}
          onChange={setNewDeptName}
          placeholder={t('team.organization.departmentName', { defaultValue: 'Department name' })}
          onPressEnter={handleConfirmAddDepartment}
          autoFocus
        />
      </Modal>
      <Modal
        title={t('team.organization.addTeam', { defaultValue: 'Add Sub-Team' })}
        visible={Boolean(targetDeptIdForTeam)}
        onOk={handleConfirmAddTeam}
        onCancel={() => setTargetDeptIdForTeam(null)}
        okText={t('team.organization.save', { defaultValue: 'Save' })}
        okButtonProps={{ disabled: !newSubTeamName.trim() }}
      >
        <Input value={newSubTeamName} onChange={setNewSubTeamName} onPressEnter={handleConfirmAddTeam} autoFocus />
      </Modal>
      <OrgProjectModal
        visible={projectModal.visible}
        project={projectModal.project}
        defaultDepartmentId={projectModal.departmentId}
        defaultTeamId={projectModal.teamId}
        onClose={() => setProjectModal({ visible: false, project: null })}
      />
      <OrgDepartmentModal
        visible={Boolean(editingDepartmentId)}
        department={hierarchy.departments.find((d) => d.id === editingDepartmentId) ?? null}
        onClose={() => setEditingDepartmentId(null)}
      />
      <OrgEntityEditModal
        visible={Boolean(editEntity)}
        entity={editEntity?.type ?? 'department'}
        data={editEntity?.data ?? null}
        context={editEntity?.context ?? {}}
        onClose={() => setEditEntity(null)}
        onSave={handleEditSave}
      />
    </div>
  );
};

export default React.memo(OrganizationSiderContent);
