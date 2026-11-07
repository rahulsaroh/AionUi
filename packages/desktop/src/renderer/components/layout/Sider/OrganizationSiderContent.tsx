/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Tooltip, Modal, Input, Message } from '@arco-design/web-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { useOrgStore } from '@/renderer/pages/organization/store/useOrgStore';
import { OrgDelegationEngine } from '@/renderer/pages/organization/utils/orgDelegationEngine';
import { computeLifecycleStatus } from '@/renderer/pages/organization/utils/orgTheme';
import { createDepartmentShell, createTeamShell } from '@/renderer/pages/organization/utils/orgCoherence';
import type {
  OrgConversation,
  OrgNodeStatus,
  OrgProject,
  OrgDepartmentNode,
  OrgTeamNode,
  OrgAgentMember,
} from '@/types/organization';
import OrgProjectModal from '@/renderer/pages/organization/components/OrgProjectModal';
import OrgDepartmentModal from '@/renderer/pages/organization/components/OrgDepartmentModal';
import OrgEntityEditModal from '@/renderer/pages/organization/components/OrgEntityEditModal';

import SiderCommandCard from './SiderCommandCard';
import SiderNavRow from './SiderNavRow';
import SiderSearchInput from './SiderSearchInput';
import SiderFilterSegment from './SiderFilterSegment';
import SiderBreadcrumb from './SiderBreadcrumb';
import SiderSectionLabel from './SiderSectionLabel';
import SiderDepartmentHeader from './SiderDepartmentHeader';
import SiderSubSectionLabel from './SiderSubSectionLabel';
import SiderTeamRow from './SiderTeamRow';
import SiderProjectRow from './SiderProjectRow';
import SiderChatRow from './SiderChatRow';
import SiderEmptyState from './SiderEmptyState';

import { NetworkTree, AlarmClock, Robot } from '@icon-park/react';

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
    addOrgProject,
    addTeamMember,
    selectedDepartmentId,
    selectedTeamId,
    selectedProjectId,
    setSelectedDepartment,
    setSelectedTeam,
    setSelectedProject,
    clearOrgSelection,
    orgViewMode,
    setOrgViewMode,
    selectedConversationId,
    setSelectedConversationId,
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
    data: OrgDepartmentNode | OrgTeamNode | OrgAgentMember | OrgProject | null;
    context: { departmentId?: string; teamId?: string };
  } | null>(null);

  const isCanvasActive = location.pathname === '/organization';
  const isAutomationsActive = location.pathname === '/scheduled';

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
    if (result.createdProjects && result.createdProjects.length > 0) {
      for (const proj of result.createdProjects) {
        addOrgProject(proj);
      }
    }
    if (result.createdMembers && result.createdMembers.length > 0) {
      for (const { teamId, member } of result.createdMembers) {
        addTeamMember(teamId, member);
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

  const deptStatus = useCallback(
    (dept: OrgDepartmentNode): OrgNodeStatus =>
      computeLifecycleStatus(dept.lastActiveAt, nodeStatuses[dept.id] || dept.status),
    [nodeStatuses]
  );

  const teamStatus = useCallback(
    (team: OrgTeamNode): OrgNodeStatus =>
      computeLifecycleStatus(team.lastActiveAt, nodeStatuses[team.id] || team.status),
    [nodeStatuses]
  );

  const query = searchQuery.trim().toLowerCase();
  const filteredDepartments = useMemo(() => {
    let list = hierarchy.departments;
    if (activeFilter === 'active') {
      list = list.filter((dept) => {
        const dStatus = deptStatus(dept);
        const deptTeams = allTeams.filter((t) => t.departmentId === dept.id);
        const deptProjects = projects.filter((p) => p.departmentId === dept.id);
        return (
          dStatus !== 'dormant' ||
          deptTeams.some((t) => teamStatus(t) !== 'dormant') ||
          deptProjects.some((p) => p.status !== 'dormant')
        );
      });
    } else if (activeFilter === 'dormant') {
      list = list.filter((dept) => {
        const dStatus = deptStatus(dept);
        const deptTeams = allTeams.filter((t) => t.departmentId === dept.id);
        const deptProjects = projects.filter((p) => p.departmentId === dept.id);
        return (
          dStatus === 'dormant' ||
          deptTeams.some((t) => teamStatus(t) === 'dormant') ||
          deptProjects.some((p) => p.status === 'dormant')
        );
      });
    } else if (activeFilter === 'shared') {
      list = list.filter((dept) => {
        const deptTeams = allTeams.filter((t) => t.departmentId === dept.id);
        const deptProjects = projects.filter((p) => p.departmentId === dept.id);
        const hasSharedMember = deptTeams.some((t) => t.specialistMembers.some((m) => m.assignedTeamIds.length > 1));
        const hasSharedProject = deptProjects.some((p) => p.teamIds.length > 1);
        return hasSharedMember || hasSharedProject;
      });
    }

    if (!query) return list;
    return list.filter((dept) => {
      if (dept.name.toLowerCase().includes(query)) return true;
      const deptTeams = allTeams.filter((teamItem) => teamItem.departmentId === dept.id);
      if (deptTeams.some((teamItem) => teamItem.name.toLowerCase().includes(query))) return true;
      const deptProjects = projects.filter((p) => p.departmentId === dept.id);
      return deptProjects.some((p) => p.name.toLowerCase().includes(query));
    });
  }, [hierarchy.departments, allTeams, projects, activeFilter, deptStatus, teamStatus, query]);

  const teamsInSelectedDept = useMemo(() => {
    if (selectedDepartmentId) {
      return hierarchy.departments.find((d) => d.id === selectedDepartmentId)?.teams ?? [];
    }
    return allTeams;
  }, [hierarchy.departments, selectedDepartmentId, allTeams]);

  const selectedTeam = useMemo(
    () => teamsInSelectedDept.find((teamItem) => teamItem.id === selectedTeamId),
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
      const team = teamsInSelectedDept.find((teamItem) => teamItem.id === selectedProject.teamIds?.[0]);
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

  // Returns a short label for the chat row badge: team name or agent role
  const chatBadgeLabel = (conv: OrgConversation): string => {
    if (conv.teamId) {
      const team = allTeams.find((teamItem) => teamItem.id === conv.teamId);
      if (team) return team.name;
    }
    if (conv.agentId) {
      const agent = allTeams
        .flatMap((teamItem) => [...teamItem.specialistMembers, teamItem.teamLeadAgent, teamItem.hrCoordinatorAgent])
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
    data: OrgDepartmentNode | OrgTeamNode | OrgAgentMember | OrgProject,
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
        <Tooltip {...siderTooltipProps} content='Talk to Root CEO' position='right'>
          <SiderCommandCard onClick={handleOpenCeoChat} />
        </Tooltip>
        <Tooltip
          {...siderTooltipProps}
          content={t('team.organization.canvas', { defaultValue: 'Organization Canvas' })}
          position='right'
        >
          <SiderNavRow
            icon={<NetworkTree size={16} theme='outline' fill='currentColor' />}
            label=''
            selected={isCanvasActive}
            onClick={() => {
              onSessionClick?.();
              void navigate('/organization');
            }}
          />
        </Tooltip>
        <Tooltip
          {...siderTooltipProps}
          content={t('team.organization.automations', { defaultValue: 'Org Automations' })}
          position='right'
        >
          <SiderNavRow
            icon={<AlarmClock size={16} theme='outline' fill='currentColor' />}
            label=''
            selected={isAutomationsActive}
            onClick={() => {
              onSessionClick?.();
              void navigate('/scheduled');
            }}
          />
        </Tooltip>
      </div>
    );
  }

  // Filter options with counts
  const filterOptions = useMemo(() => {
    let activeCount = 0;
    let dormantCount = 0;
    let sharedCount = 0;

    allTeams.forEach((team) => {
      const status = teamStatus(team);
      if (status !== 'dormant') activeCount++;
      if (status === 'dormant') dormantCount++;
      if (team.specialistMembers.some((m) => m.assignedTeamIds.length > 1)) sharedCount++;
    });

    projects.forEach((proj) => {
      if (proj.status !== 'dormant') activeCount++;
      if (proj.status === 'dormant') dormantCount++;
      if (proj.teamIds.length > 1) sharedCount++;
    });

    return [
      {
        key: 'all' as const,
        label: t('team.organization.filterAll', { defaultValue: 'All' }),
        count: hierarchy.departments.length,
      },
      {
        key: 'active' as const,
        label: t('team.organization.filterActive', { defaultValue: 'Active' }),
        count: activeCount,
      },
      {
        key: 'dormant' as const,
        label: t('team.organization.filterDormant', { defaultValue: 'Dormant' }),
        count: dormantCount,
      },
      {
        key: 'shared' as const,
        label: t('team.organization.filterShared', { defaultValue: 'Shared' }),
        count: sharedCount,
      },
    ];
  }, [hierarchy.departments, allTeams, projects, t]);

  return (
    <div className='flex flex-col h-full overflow-hidden'>
      <div className='flex-1 overflow-y-auto custom-scrollbar'>
        {/* Primary Actions */}
        <div className='px-8px mb-4px flex flex-col gap-2px'>
          <SiderCommandCard onClick={handleOpenCeoChat} selected={ceoChatModalVisible} />
          <SiderNavRow
            icon={<NetworkTree size={14} theme='outline' fill='currentColor' />}
            label={t('team.organization.canvas', { defaultValue: 'Organization Canvas' })}
            selected={isCanvasActive}
            badge='Live'
            onClick={() => {
              onSessionClick?.();
              void navigate('/organization');
            }}
          />
          <SiderNavRow
            icon={<AlarmClock size={14} theme='outline' fill='currentColor' />}
            label={t('team.organization.automations', { defaultValue: 'Org Automations' })}
            selected={isAutomationsActive}
            badgeCount={cronJobs.length}
            onClick={() => {
              onSessionClick?.();
              void navigate('/scheduled');
            }}
          />
        </div>

        {/* Search and Filters */}
        <div className='px-8px mb-8px flex flex-col gap-6px'>
          <SiderSearchInput value={searchQuery} onChange={setSearchQuery} siderTooltipProps={siderTooltipProps} />
          <SiderFilterSegment
            activeFilter={activeFilter}
            onChange={setActiveFilter}
            options={filterOptions}
            siderTooltipProps={siderTooltipProps}
          />
        </div>

        <div className='h-1px bg-[var(--color-border-2)] mx-10px my-4px' />

        {/* Breadcrumb */}
        <SiderBreadcrumb
          parts={breadcrumb}
          onSelect={(part) => {
            if (!part.id) {
              clearOrgSelection();
              return;
            }
            if (part.type === 'dept') handleSelectDept(part.id);
            if (part.type === 'team') handleSelectTeam(part.id);
            if (part.type === 'project') handleSelectProject(part.id);
          }}
          onClear={clearOrgSelection}
          siderTooltipProps={siderTooltipProps}
        />

        {/* Departments Section */}
        <SiderSectionLabel
          label={t('team.organization.departments', { defaultValue: 'Departments' })}
          count={filteredDepartments.length}
          collapsed={collapsedSections.has('departments')}
          onToggle={() => toggleSection('departments')}
        />

        {!collapsedSections.has('departments') && (
          <div className='flex flex-col gap-2px px-6px mt-2px flex-1 min-h-0'>
            {filteredDepartments.length === 0 ? (
              <SiderEmptyState hasSearchQuery={!!searchQuery} />
            ) : (
              filteredDepartments.map((dept) => {
                const status = deptStatus(dept);
                const isSelected = selectedDepartmentId === dept.id;
                const isDeptExpanded = !collapsedDepts.has(dept.id);
                const deptTeams = allTeams.filter((teamItem) => teamItem.departmentId === dept.id);
                const deptProjects = projects.filter((p) => p.departmentId === dept.id);
                const subTab = deptSubTabs[dept.id] ?? 'teams';

                const sharedCanonicalIds = new Set<string>();
                deptTeams.forEach((teamItem) =>
                  teamItem.specialistMembers.forEach((m) => {
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
                  <div key={dept.id} className='flex flex-col'>
                    <SiderDepartmentHeader
                      department={dept}
                      status={status}
                      isSelected={isSelected}
                      isExpanded={isDeptExpanded}
                      teamsCount={deptTeams.length}
                      projectsCount={deptProjects.length}
                      subTab={subTab}
                      onSelect={() => handleSelectDept(dept.id)}
                      onToggleExpand={() => toggleDept(dept.id)}
                      onToggleSubTab={(tab) => setDeptSubTab(dept.id, tab)}
                      onEdit={(e) => {
                        e.stopPropagation();
                        handleOpenEntityEdit('department', dept, { departmentId: dept.id });
                      }}
                      onSetFolder={(e) => {
                        e.stopPropagation();
                        handleOpenEntityEdit('department', dept, { departmentId: dept.id });
                      }}
                      onAddProject={(e) => {
                        e.stopPropagation();
                        openProjectModal(dept.id);
                      }}
                      onAddTeam={(e) => {
                        e.stopPropagation();
                        setTargetDeptIdForTeam(dept.id);
                      }}
                      siderTooltipProps={siderTooltipProps}
                    />

                    {isDeptExpanded && (
                      <div className='flex flex-col gap-1px pl-16px pr-4px py-2px border-l border-[var(--color-border-2)]/40 ml-10px animate-expand'>
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
                                  <span className='text-8px text-t-tertiary'>
                                    {t('team.organization.pm', { defaultValue: 'PM' })}
                                  </span>
                                </div>
                                <span className='text-9px text-amber-400'>
                                  {t('team.organization.pinned', { defaultValue: 'Pinned' })}
                                </span>
                              </div>
                            )}
                            {/* Teams list */}
                            <SiderSubSectionLabel
                              label={t('team.organization.teams', { defaultValue: 'Teams' })}
                              count={filteredTeams.length}
                            />
                            <div className='flex flex-col gap-0.5px'>
                              {filteredTeams.length === 0 ? (
                                <div className='px-6px py-4px text-10px text-t-tertiary'>
                                  {activeFilter === 'all'
                                    ? t('team.organization.noTeams', {
                                        defaultValue: 'No teams in this department yet.',
                                      })
                                    : t('team.organization.noMatchingTeams', { defaultValue: 'No matching teams.' })}
                                </div>
                              ) : (
                                filteredTeams.map((team) => {
                                  const tStatus = teamStatus(team);
                                  const isTeamSelected = selectedTeamId === team.id;
                                  return (
                                    <SiderTeamRow
                                      key={team.id}
                                      team={team}
                                      status={tStatus}
                                      isSelected={isTeamSelected}
                                      onSelect={() => handleSelectTeam(team.id)}
                                      onEdit={(e) => {
                                        e.stopPropagation();
                                        handleOpenEntityEdit('team', team, {
                                          departmentId: dept.id,
                                          teamId: team.id,
                                        });
                                      }}
                                      siderTooltipProps={siderTooltipProps}
                                    />
                                  );
                                })
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            {/* Projects list with chats nested underneath */}
                            <SiderSubSectionLabel
                              label={t('team.organization.projects', { defaultValue: 'Projects' })}
                              count={filteredProjects.length}
                            />
                            <div className='flex flex-col gap-1px'>
                              {filteredProjects.length === 0 ? (
                                <div className='px-6px py-4px text-10px text-t-tertiary'>
                                  {activeFilter === 'all'
                                    ? t('team.organization.noProjects', {
                                        defaultValue: 'No projects in this department.',
                                      })
                                    : t('team.organization.noMatchingProjects', {
                                        defaultValue: 'No matching projects.',
                                      })}
                                </div>
                              ) : (
                                filteredProjects.map((proj) => {
                                  const chats = projectConversationsMap.get(proj.id) ?? [];
                                  const isProjectSelected = selectedProjectId === proj.id;
                                  return (
                                    <div key={proj.id} className='flex flex-col'>
                                      {/* Project row */}
                                      <SiderProjectRow
                                        project={proj}
                                        isSelected={isProjectSelected}
                                        onSelect={() => handleSelectProject(proj.id)}
                                        onEdit={(e) => {
                                          e.stopPropagation();
                                          handleOpenEntityEdit('project', proj, {
                                            departmentId: proj.departmentId,
                                            teamId: proj.teamIds?.[0],
                                          });
                                        }}
                                        onNewChat={(e) => {
                                          e.stopPropagation();
                                          handleNewChat(dept.id, proj);
                                        }}
                                        siderTooltipProps={siderTooltipProps}
                                      />
                                      {/* Chats nested under project */}
                                      {chats.length > 0 && (
                                        <div className='flex flex-col gap-0.5px pl-16px pr-4px py-1px border-l border-[var(--color-border-2)]/20 ml-10px'>
                                          {chats.map((conv) => {
                                            const isChatSelected = selectedChatId === conv.id;
                                            return (
                                              <SiderChatRow
                                                key={conv.id}
                                                conversation={conv}
                                                isSelected={isChatSelected}
                                                badge={chatBadgeLabel(conv)}
                                                relativeTime={formatChatTime(conv.timestamp)}
                                                onSelect={() => {
                                                  setSelectedChatId(conv.id);
                                                  setSelectedConversationId(conv.id);
                                                  setOrgViewMode('chat');
                                                  onSessionClick?.();
                                                  void navigate('/organization');
                                                }}
                                              />
                                            );
                                          })}
                                        </div>
                                      )}
                                      {chats.length === 0 && (
                                        <div className='h-24px px-6px flex items-center text-11px text-t-tertiary pl-16px pr-4px border-l border-[var(--color-border-2)]/20 ml-10px'>
                                          {t('team.organization.noChats', { defaultValue: 'No chats' })}
                                        </div>
                                      )}
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

        <div className='h-1px bg-[var(--color-border-2)] mx-10px my-4px' />
      </div>

      {/* Modals */}
      <Modal
        title={t('team.organization.ceoDirectiveTitle', { defaultValue: 'Directive Command to Root CEO' })}
        visible={ceoChatModalVisible}
        onOk={handleConfirmSendToCeo}
        onCancel={() => setCeoChatModalVisible(false)}
        okText={t('team.organization.dispatchDirective', { defaultValue: 'Dispatch Directive' })}
        okButtonProps={{ disabled: !ceoPrompt.trim() }}
      >
        <Input.TextArea
          rows={3}
          value={ceoPrompt}
          onChange={setCeoPrompt}
          autoFocus
          placeholder={t('team.organization.directivePlaceholder', {
            defaultValue: 'Enter your executive directive...',
          })}
        />
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
