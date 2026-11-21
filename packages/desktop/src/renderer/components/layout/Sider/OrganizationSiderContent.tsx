/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Tooltip, Modal, Input, Message, Dropdown, Menu, Button } from '@arco-design/web-react';
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
import {
  chatsWithMember,
  listDepartmentTeamMembers,
  listProjectTeamMembers,
  teamRoster,
} from '@/renderer/pages/organization/utils/orgRoster';

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
import SiderMemberRow from './SiderMemberRow';
import SiderChatRow from './SiderChatRow';
import SiderEmptyState from './SiderEmptyState';
import type { DepartmentRowAction } from './SiderDepartmentHeader';

import { NetworkTree, AlarmClock, SunOne, Finance, Play, Plus } from '@icon-park/react';

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
    members: storeMembers = [],
    conversations,
    cronJobs,
    nodeStatuses,
    updateNodeStatus,
    addOrgConversation,
    addDepartment,
    updateDepartment,
    addSubTeam,
    addOrgProject,
    addTeamMember,
    updateRootCeo,
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
    openChat,
    activeFilter: storeActiveFilter,
    setActiveFilter: storeSetActiveFilter,
  } = useOrgStore();

  const activeFilter = storeActiveFilter || 'all';
  const setActiveFilter = storeSetActiveFilter || (() => {});

  const [deptSubTabs, setDeptSubTabs] = useState<Record<string, 'teams' | 'projects'>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(new Set());
  const [collapsedMemberIds, setCollapsedMemberIds] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [targetDeptIdForTeam, setTargetDeptIdForTeam] = useState<string | null>(null);
  const [newSubTeamName, setNewSubTeamName] = useState('');
  const [createDeptModalVisible, setCreateDeptModalVisible] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');
  const [allMembersVisible, setAllMembersVisible] = useState(false);
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

  const isCanvasActive = location.pathname === '/organization' && orgViewMode === 'canvas';
  const isAutomationsActive = location.pathname === '/scheduled';
  const isTodayActive = location.pathname === '/today';
  const isCostsActive = location.pathname === '/costs';
  const isPipelineActive = location.pathname.startsWith('/pipeline');
  const organizationMembers = useMemo(() => {
    const fromTeams = hierarchy.departments.flatMap((department) =>
      department.teams.flatMap((team) => {
        const roster = [
          team.teamLeadAgent,
          ...(team.hrCoordinatorAgent ? [team.hrCoordinatorAgent] : []),
          ...team.specialistMembers,
        ];
        return roster.map((member) => ({
          member,
          departmentId: department.id,
          teamId: team.id,
          teamName: team.name,
        }));
      })
    );
    const seenIds = new Set(fromTeams.map((entry) => entry.member.id));
    for (const m of storeMembers || []) {
      if (!seenIds.has(m.id)) {
        seenIds.add(m.id);
        const dept = hierarchy.departments.find((d) => d.id === m.departmentId);
        fromTeams.push({
          member: m,
          departmentId: dept?.id || '',
          teamId: m.assignedTeamIds?.[0] || '',
          teamName: dept?.teams[0]?.name || '',
        });
      }
    }
    return fromTeams;
  }, [hierarchy.departments, storeMembers]);

  const toggleDept = (deptId: string) => {
    setCollapsedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  };

  const toggleProject = (projectId: string) => {
    setCollapsedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
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

  // CEO Conversations (newest first, filtering empty abandoned chats)
  const ceoConversations = useMemo(() => {
    return conversations
      .filter(
        (c) => c.type === 'ceo_directive' && !c.projectId && (c.messages.length > 0 || c.id === selectedConversationId)
      )
      .toSorted((a, b) => b.timestamp - a.timestamp);
  }, [conversations, selectedConversationId]);
  const [showAllCeoChats, setShowAllCeoChats] = useState(false);

  const allAgentMembers = useMemo(() => {
    const membersList: OrgAgentMember[] = [];
    if (hierarchy.rootCeo.ceoAgent) membersList.push(hierarchy.rootCeo.ceoAgent);
    if (hierarchy.rootCeo.chiefOfStaffAgent) membersList.push(hierarchy.rootCeo.chiefOfStaffAgent);
    for (const department of hierarchy.departments) {
      if (department.departmentCeoAgent) membersList.push(department.departmentCeoAgent);
      if (department.pmAgent) membersList.push(department.pmAgent);
      for (const team of department.teams) membersList.push(...teamRoster(team));
    }
    const seenIds = new Set(membersList.map((m) => m.id));
    for (const m of storeMembers || []) {
      if (!seenIds.has(m.id)) {
        seenIds.add(m.id);
        membersList.push(m);
      }
    }
    return membersList;
  }, [hierarchy, storeMembers]);

  const handleNewCeoChat = () => {
    onSessionClick?.();
    clearOrgSelection();
    const newConvId = `conv-ceo-${Date.now()}`;
    addOrgConversation({
      id: newConvId,
      title: t('team.organization.newChat', { defaultValue: 'New chat' }),
      type: 'ceo_directive',
      sourceNodeId: 'root-ceo',
      targetNodeId: 'root-ceo',
      targetAgentId: hierarchy.rootCeo.ceoAgent.id,
      targetAgentName: hierarchy.rootCeo.ceoAgent.name,
      targetRole: hierarchy.rootCeo.ceoAgent.role,
      timestamp: Date.now(),
      summary: '',
      messages: [],
    });
    setSelectedConversationId(newConvId);
    setOrgViewMode('chat');
    void navigate('/organization');
  };

  const handleOpenCeoChat = () => {
    onSessionClick?.();
    clearOrgSelection();
    if (ceoConversations.length > 0) {
      setSelectedConversationId(ceoConversations[0].id);
      setOrgViewMode('chat');
      void navigate('/organization');
    } else {
      handleNewCeoChat();
    }
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

  const isProjectActivelyWorking = useCallback(
    (proj: OrgProject): boolean => {
      if (selectedProjectId === proj.id) return true;
      const currentConv = conversations.find((c) => c.id === selectedConversationId);
      if (currentConv?.projectId === proj.id) return true;
      if (nodeStatuses[proj.id] === 'working') return true;
      if (proj.teamIds?.some((tId) => nodeStatuses[tId] === 'working' || (selectedTeamId && selectedTeamId === tId))) {
        return true;
      }
      return false;
    },
    [selectedProjectId, selectedConversationId, conversations, nodeStatuses, selectedTeamId]
  );

  const query = searchQuery.trim().toLowerCase();
  const filteredDepartments = useMemo(() => {
    let list = hierarchy.departments;
    if (activeFilter === 'active') {
      const hasAnyWorkingOrSelected =
        projects.some(isProjectActivelyWorking) ||
        allTeams.some((t) => nodeStatuses[t.id] === 'working' || (selectedTeamId && selectedTeamId === t.id));
      list = list.filter((dept) => {
        const dStatus = deptStatus(dept);
        const deptTeams = allTeams.filter((t) => t.departmentId === dept.id);
        const deptProjects = projects.filter((p) => p.departmentId === dept.id);
        if (hasAnyWorkingOrSelected) {
          return (
            deptProjects.some(isProjectActivelyWorking) ||
            deptTeams.some((t) => nodeStatuses[t.id] === 'working' || selectedTeamId === t.id)
          );
        }
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
      if (
        deptTeams.some((teamItem) => teamRoster(teamItem).some((member) => member.name.toLowerCase().includes(query)))
      )
        return true;
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

  const handleOpenDepartmentChat = (deptId: string) => {
    setSelectedDepartment(deptId);
    setSelectedTeam(null);
    setSelectedProject(null);
    openChat({ type: 'department_head', id: deptId });
    onSessionClick?.();
    void navigate('/organization');
  };

  const handleOpenProjectChat = (projectId: string) => {
    setSelectedProject(projectId);
    openChat({ type: 'project_head', id: projectId });
    onSessionClick?.();
    void navigate('/organization');
  };

  const handleOpenMemberChat = (memberId: string, projectId?: string, createNew?: boolean) => {
    openChat(
      projectId ? { type: 'member', id: memberId, projectId, createNew } : { type: 'member', id: memberId, createNew }
    );
    onSessionClick?.();
    void navigate('/organization');
  };

  const handleSelectConversation = (conversationId: string) => {
    setSelectedConversationId(conversationId);
    setOrgViewMode('chat');
    onSessionClick?.();
    void navigate('/organization');
  };

  const toggleMemberCollapse = (key: string) => {
    setCollapsedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderMemberThread = (member: OrgAgentMember, memberChats: OrgConversation[], projectId?: string) => {
    const memberKey = `${projectId ?? 'dept'}:${member.canonicalAgentId || member.id}`;
    const isCollapsed =
      memberChats.length === 0 ? !collapsedMemberIds.has(memberKey) : collapsedMemberIds.has(memberKey);
    return (
      <div key={memberKey} className='flex flex-col'>
        <SiderMemberRow
          member={member}
          isSelected={memberChats.some((chat) => chat.id === selectedConversationId)}
          hasChats={memberChats.length > 0}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => toggleMemberCollapse(memberKey)}
          onEditMember={() =>
            setEditEntity({
              type: 'member',
              data: member,
              context: { departmentId: selectedDepartmentId || undefined },
            })
          }
          onNewChat={() => handleOpenMemberChat(member.id, projectId, true)}
        />
        {!isCollapsed && (
          <div className='flex flex-col gap-0.5px pl-16px pr-4px py-1px border-l border-[var(--color-border-2)]/20 ml-10px'>
            {memberChats.length > 0 ? (
              memberChats.map((conv) => {
                const projectName = conv.projectId
                  ? projects.find((item) => item.id === conv.projectId)?.name
                  : undefined;
                return (
                  <SiderChatRow
                    key={conv.id}
                    conversation={conv}
                    isSelected={selectedConversationId === conv.id}
                    badge={projectId ? undefined : projectName}
                    relativeTime={formatChatTime(conv.timestamp)}
                    onSelect={() => handleSelectConversation(conv.id)}
                  />
                );
              })
            ) : (
              <div className='px-6px py-2px text-10px text-t-tertiary italic'>
                {t('team.organization.noChatsYet', { defaultValue: 'No chats yet' })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const handleSelectTeam = (teamId: string) => {
    setSelectedTeam(teamId);
    setSelectedProject(null);
    const teamChats = conversations.filter((c) => c.teamId === teamId && !c.projectId);
    if (teamChats.length > 0) {
      const latest = teamChats[0];
      setSelectedConversationId(latest.id);
    } else {
      setSelectedConversationId(null);
    }
    setOrgViewMode('chat');
    onSessionClick?.();
    void navigate('/organization');
  };

  const handleNewTeamChat = (deptId: string, team: OrgTeamNode) => {
    const newConvId = `conv-team-${team.id}-${Date.now()}`;
    addOrgConversation({
      id: newConvId,
      // Step 1b: start as "New chat" — auto-title comes from first user message
      title: t('team.organization.newChat', { defaultValue: 'New chat' }),
      type: 'team_execution',
      sourceNodeId: team.id,
      targetNodeId: team.id,
      teamId: team.id,
      timestamp: Date.now(),
      summary: '',
      messages: [],
    });
    setSelectedTeam(team.id);
    setSelectedProject(null);
    setSelectedConversationId(newConvId);
    setOrgViewMode('chat');
    onSessionClick?.();
    void navigate('/organization');
  };

  const handleSelectProject = (projectId: string) => {
    setSelectedProject(projectId);
    const projChats = conversations.filter((c) => c.projectId === projectId);
    if (projChats.length > 0) {
      const latest = projChats[0];
      setSelectedConversationId(latest.id);
    } else {
      setSelectedConversationId(null);
    }
    setOrgViewMode('chat');
    onSessionClick?.();
    void navigate('/organization');
  };

  const handleOpenEntityEdit = (
    type: 'department' | 'team' | 'member' | 'project',
    data: OrgDepartmentNode | OrgTeamNode | OrgAgentMember | OrgProject | null,
    context: { departmentId?: string; teamId?: string }
  ) => {
    setEditEntity({ type, data, context });
  };

  const handleNewChat = (deptId: string, proj: OrgProject) => {
    const teamId = proj.teamIds?.[0] ?? '';
    const newConvId = `conv-proj-${proj.id}-${Date.now()}`;
    addOrgConversation({
      id: newConvId,
      title: t('team.organization.newChat', { defaultValue: 'New chat' }),
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
    setSelectedConversationId(newConvId);
    setOrgViewMode('chat');
    onSessionClick?.();
    void navigate('/organization');
  };

  const handleEditSave = () => {
    if (editEntity) {
      Message.success('Saved.');
    }
    setEditEntity(null);
  };

  // ---- Step 1a: ALL hooks must be above the early return ----

  // Filter options with counts (moved above early return to fix Rules-of-Hooks violation)
  const filterOptions = useMemo(() => {
    let activeCount = 0;
    let dormantCount = 0;
    let sharedCount = 0;

    const workingProjects = projects.filter(isProjectActivelyWorking);
    const workingTeams = allTeams.filter((t) => nodeStatuses[t.id] === 'working' || selectedTeamId === t.id);

    allTeams.forEach((team) => {
      const status = teamStatus(team);
      if (status === 'dormant') dormantCount++;
      if (team.specialistMembers.some((m) => m.assignedTeamIds.length > 1)) sharedCount++;
    });

    projects.forEach((proj) => {
      if (proj.status === 'dormant') dormantCount++;
      if (proj.teamIds.length > 1) sharedCount++;
    });

    if (workingProjects.length > 0 || workingTeams.length > 0) {
      activeCount = workingProjects.length + workingTeams.length;
    } else {
      allTeams.forEach((team) => {
        const status = teamStatus(team);
        if (status !== 'dormant') activeCount++;
      });
      projects.forEach((proj) => {
        if (proj.status !== 'dormant') activeCount++;
      });
    }

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
  }, [
    hierarchy.departments,
    allTeams,
    projects,
    t,
    teamStatus,
    isProjectActivelyWorking,
    nodeStatuses,
    selectedTeamId,
  ]);

  if (collapsed) {
    return (
      <div className='flex flex-col gap-4px items-center px-4px'>
        <Tooltip
          {...siderTooltipProps}
          content={t('team.organization.talkToRootCeo', { defaultValue: 'Talk to Root CEO' })}
          position='right'
        >
          <SiderCommandCard onNewChat={handleNewCeoChat} onOpenChat={handleOpenCeoChat} />
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
              setOrgViewMode('canvas');
              setSelectedConversationId(null);
              clearOrgSelection();
              onSessionClick?.();
              void navigate('/organization');
            }}
          />
        </Tooltip>
        {cronJobs.length > 0 && (
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
        )}
        <Tooltip
          {...siderTooltipProps}
          content={t('today.navTitle', { defaultValue: 'Today — Morning Digest' })}
          position='right'
        >
          <SiderNavRow
            icon={<SunOne size={16} theme='outline' fill='currentColor' />}
            label=''
            selected={isTodayActive}
            onClick={() => {
              onSessionClick?.();
              void navigate('/today');
            }}
          />
        </Tooltip>
        <Tooltip
          {...siderTooltipProps}
          content={t('costs.navTitle', { defaultValue: 'Cost Tracking & Budgets' })}
          position='right'
        >
          <SiderNavRow
            icon={<Finance size={16} theme='outline' fill='currentColor' />}
            label=''
            selected={isCostsActive}
            onClick={() => {
              onSessionClick?.();
              void navigate('/costs');
            }}
          />
        </Tooltip>
        <Tooltip
          {...siderTooltipProps}
          content={t('pipeline.navTitle', { defaultValue: 'Active Pipeline Runs' })}
          position='right'
        >
          <SiderNavRow
            icon={<Play size={16} theme='outline' fill='currentColor' />}
            label=''
            selected={isPipelineActive}
            onClick={() => {
              onSessionClick?.();
              void navigate('/pipeline/active');
            }}
          />
        </Tooltip>
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full overflow-hidden'>
      <div className='flex-1 overflow-y-auto custom-scrollbar'>
        {/* Primary Actions */}
        <div className='px-8px mb-4px flex flex-col gap-2px'>
          {/* CEO button + "+ New" dropdown in a flex row */}
          <div className='flex items-center gap-4px'>
            <div className='flex-1 min-w-0'>
              <SiderCommandCard
                onNewChat={handleNewCeoChat}
                onOpenChat={handleOpenCeoChat}
                selected={orgViewMode === 'chat' && !selectedProjectId && !selectedTeamId && !selectedDepartmentId}
              />
            </div>
            <Dropdown
              trigger='click'
              position='br'
              droplist={
                <Menu>
                  <Menu.Item key='dept' onClick={() => setCreateDeptModalVisible(true)}>
                    {t('team.organization.newDepartment', { defaultValue: 'Department' })}
                  </Menu.Item>
                  <Menu.Item key='project' onClick={() => openProjectModal(selectedDepartmentId ?? undefined)}>
                    {t('team.organization.newProject', { defaultValue: 'Project' })}
                  </Menu.Item>
                  <Menu.Item
                    key='member'
                    onClick={() => {
                      const dept = selectedDepartmentId
                        ? hierarchy.departments.find((d) => d.id === selectedDepartmentId)
                        : hierarchy.departments[0];
                      const targetTeam = dept?.teams[0] || hierarchy.departments[0]?.teams[0];
                      handleOpenEntityEdit('member', null, {
                        departmentId: dept?.id || hierarchy.departments[0]?.id,
                        teamId: targetTeam?.id,
                      });
                    }}
                  >
                    {t('team.organization.newMember', { defaultValue: 'Member' })}
                  </Menu.Item>
                  <Menu.Item
                    key='chat'
                    onClick={() => {
                      if (selectedProjectId) {
                        const proj = projects.find((p) => p.id === selectedProjectId);
                        if (proj) handleNewChat(proj.departmentId, proj);
                      } else {
                        handleNewCeoChat();
                      }
                    }}
                  >
                    {t('team.organization.newChat', { defaultValue: 'New chat' })}
                  </Menu.Item>
                </Menu>
              }
            >
              <Tooltip
                {...siderTooltipProps}
                content={t('team.organization.newMenuLabel', { defaultValue: 'New…' })}
                position='right'
              >
                <button
                  type='button'
                  aria-label={t('team.organization.newMenuLabel', { defaultValue: 'New…' })}
                  className='flex items-center justify-center size-32px rounded-6px border border-[var(--color-border-2)] bg-fill-1 hover:bg-fill-2 text-t-secondary hover:text-t-primary transition-colors shrink-0 cursor-pointer'
                >
                  <Plus size={14} theme='outline' fill='currentColor' />
                </button>
              </Tooltip>
            </Dropdown>
          </div>
          <Button size='mini' type='text' className='!justify-start' onClick={() => setAllMembersVisible(true)}>
            {t('team.allMembers', { defaultValue: 'All members' })} ({organizationMembers.length})
          </Button>
          {/* CEO chat threads (last 3, with Show all) */}
          {ceoConversations.length > 0 && (
            <div className='flex flex-col gap-1px pl-6px pr-2px py-1px'>
              {(showAllCeoChats ? ceoConversations : ceoConversations.slice(0, 3)).map((conv) => {
                const isChatSelected = selectedConversationId === conv.id;
                return (
                  <SiderChatRow
                    key={conv.id}
                    conversation={conv}
                    isSelected={isChatSelected}
                    relativeTime={formatChatTime(conv.timestamp)}
                    onSelect={() => {
                      clearOrgSelection();
                      setSelectedConversationId(conv.id);
                      setOrgViewMode('chat');
                      onSessionClick?.();
                      void navigate('/organization');
                    }}
                  />
                );
              })}
              {ceoConversations.length > 3 && (
                <button
                  type='button'
                  onClick={() => setShowAllCeoChats(!showAllCeoChats)}
                  className='text-10px text-primary hover:underline self-start px-4px py-2px bg-transparent border-none cursor-pointer'
                >
                  {showAllCeoChats ? 'Show less' : `Show all (${ceoConversations.length})`}
                </button>
              )}
            </div>
          )}
          <SiderNavRow
            icon={<NetworkTree size={14} theme='outline' fill='currentColor' />}
            label={t('team.organization.canvas', { defaultValue: 'Organization Canvas' })}
            selected={isCanvasActive}
            badge='Live'
            onClick={() => {
              setOrgViewMode('canvas');
              setSelectedConversationId(null);
              clearOrgSelection();
              onSessionClick?.();
              void navigate('/organization');
            }}
          />
          {cronJobs.length > 0 && (
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
          )}
          <SiderNavRow
            icon={<SunOne size={14} theme='outline' fill='currentColor' />}
            label={t('today.navTitle', { defaultValue: 'Today — Morning Digest' })}
            selected={isTodayActive}
            onClick={() => {
              onSessionClick?.();
              void navigate('/today');
            }}
          />
          <SiderNavRow
            icon={<Finance size={14} theme='outline' fill='currentColor' />}
            label={t('costs.navTitle', { defaultValue: 'Costs & Budgets' })}
            selected={isCostsActive}
            onClick={() => {
              onSessionClick?.();
              void navigate('/costs');
            }}
          />
          <SiderNavRow
            icon={<Play size={14} theme='outline' fill='currentColor' />}
            label={t('pipeline.navTitle', { defaultValue: 'Active Runs' })}
            selected={isPipelineActive}
            onClick={() => {
              onSessionClick?.();
              void navigate('/pipeline/active');
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
                const subTab =
                  deptSubTabs[dept.id] ?? (deptProjects.length > 0 && deptTeams.length === 0 ? 'projects' : 'teams');

                const sharedCanonicalIds = new Set<string>();
                deptTeams.forEach((teamItem) =>
                  teamItem.specialistMembers.forEach((m) => {
                    if (m.assignedTeamIds.length > 1) sharedCanonicalIds.add(m.canonicalAgentId);
                  })
                );

                const memberVisible = (member: OrgAgentMember): boolean => {
                  if (activeFilter === 'all') return true;
                  if (activeFilter === 'shared') {
                    return member.assignedTeamIds.length > 1 || sharedCanonicalIds.has(member.canonicalAgentId);
                  }
                  const onDormantTeam = deptTeams.some(
                    (team) =>
                      teamStatus(team) === 'dormant' &&
                      teamRoster(team).some(
                        (person) => person.id === member.id || person.canonicalAgentId === member.canonicalAgentId
                      )
                  );
                  if (activeFilter === 'dormant') return member.status === 'dormant' || onDormantTeam;
                  return member.status !== 'dormant' && !onDormantTeam;
                };
                const departmentMembers = listDepartmentTeamMembers(dept).filter(memberVisible);

                const hasWorkingProjectsInDept = deptProjects.some(isProjectActivelyWorking);
                const filteredProjects = deptProjects.filter((proj) => {
                  if (activeFilter === 'all') return true;
                  if (activeFilter === 'shared') return proj.teamIds.length > 1;
                  if (activeFilter === 'dormant') return proj.status === 'dormant';
                  if (hasWorkingProjectsInDept || projects.some(isProjectActivelyWorking)) {
                    return isProjectActivelyWorking(proj);
                  }
                  return proj.status === 'active';
                });

                const filteredTeams = deptTeams.filter((team) => {
                  if (query) {
                    const matchesName = team.name.toLowerCase().includes(query);
                    const matchesMember = teamRoster(team).some((m) => m.name.toLowerCase().includes(query));
                    if (!matchesName && !matchesMember) return false;
                  }
                  if (activeFilter === 'all') return true;
                  if (activeFilter === 'shared') {
                    return team.specialistMembers.some((m) => m.assignedTeamIds.length > 1);
                  }
                  return teamStatus(team) === activeFilter;
                });

                const unassignedMembers = departmentMembers.filter(
                  (m) =>
                    !deptTeams.some((t) =>
                      teamRoster(t).some((tm) => tm.id === m.id || tm.canonicalAgentId === m.canonicalAgentId)
                    )
                );

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
                      onOpenChat={() => handleOpenDepartmentChat(dept.id)}
                      onToggleExpand={() => toggleDept(dept.id)}
                      onToggleSubTab={(tab) => setDeptSubTab(dept.id, tab)}
                      onAction={(action: DepartmentRowAction) => {
                        if (action === 'edit' || action === 'set-folder') {
                          handleOpenEntityEdit('department', dept, { departmentId: dept.id });
                          return;
                        }
                        if (action === 'add-project') {
                          openProjectModal(dept.id);
                          return;
                        }
                        setTargetDeptIdForTeam(dept.id);
                      }}
                      siderTooltipProps={siderTooltipProps}
                    />

                    {isDeptExpanded && (
                      <div className='flex flex-col gap-1px pl-16px pr-4px py-2px border-l border-[var(--color-border-2)]/40 ml-10px animate-expand'>
                        {subTab === 'teams' ? (
                          <>
                            <SiderSubSectionLabel
                              label={t('team.organization.teams', { defaultValue: 'Teams' })}
                              count={filteredTeams.length}
                            />
                            <div className='flex flex-col gap-1px'>
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
                                  const teamMembers = teamRoster(team).filter(memberVisible);
                                  return (
                                    <div key={team.id} className='flex flex-col'>
                                      <SiderTeamRow
                                        team={team}
                                        status={tStatus}
                                        isSelected={isTeamSelected}
                                        onSelect={() => handleSelectTeam(team.id)}
                                        onEdit={(e) => {
                                          e?.stopPropagation();
                                          handleOpenEntityEdit('team', team, {
                                            departmentId: dept.id,
                                            teamId: team.id,
                                          });
                                        }}
                                        onNewChat={(e) => {
                                          e?.stopPropagation();
                                          handleNewTeamChat(dept.id, team);
                                        }}
                                        siderTooltipProps={siderTooltipProps}
                                      />
                                      {teamMembers.length === 0 ? (
                                        <div className='h-24px px-6px flex items-center text-11px text-t-tertiary pl-16px pr-4px border-l border-[var(--color-border-2)]/20 ml-10px'>
                                          {t('team.organization.noProjectMembers', {
                                            defaultValue: 'No team members on this team.',
                                          })}
                                        </div>
                                      ) : (
                                        <div className='flex flex-col gap-0.5px pl-16px pr-4px py-1px border-l border-[var(--color-border-2)]/20 ml-10px'>
                                          {teamMembers.map((member) =>
                                            renderMemberThread(
                                              member,
                                              chatsWithMember(conversations, member, allAgentMembers, {
                                                departments: hierarchy.departments,
                                              }).filter((c) => c.messages.length > 0 || c.id === selectedConversationId)
                                            )
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                              {unassignedMembers.length > 0 && (
                                <div className='mt-4px flex flex-col gap-0.5px'>
                                  <SiderSubSectionLabel
                                    label={t('team.organization.unassignedMembers', { defaultValue: 'Other members' })}
                                    count={unassignedMembers.length}
                                  />
                                  {unassignedMembers.map((member) =>
                                    renderMemberThread(
                                      member,
                                      chatsWithMember(conversations, member, allAgentMembers, {
                                        departments: hierarchy.departments,
                                      }).filter((c) => c.messages.length > 0 || c.id === selectedConversationId)
                                    )
                                  )}
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
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
                                  const isProjectSelected = selectedProjectId === proj.id;
                                  const isProjectExpanded = !collapsedProjectIds.has(proj.id);
                                  const projectMembers = listProjectTeamMembers(proj, dept, allAgentMembers);
                                  const visibleProjectMembers = projectMembers.filter(memberVisible);
                                  return (
                                    <div key={proj.id} className='flex flex-col'>
                                      <SiderProjectRow
                                        project={proj}
                                        isSelected={isProjectSelected}
                                        isExpanded={isProjectExpanded}
                                        onToggleExpand={() => toggleProject(proj.id)}
                                        onOpenChat={() => handleOpenProjectChat(proj.id)}
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
                                      {isProjectExpanded &&
                                        (visibleProjectMembers.length === 0 ? (
                                          <div className='h-24px px-6px flex items-center text-11px text-t-tertiary pl-16px pr-4px border-l border-[var(--color-border-2)]/20 ml-10px'>
                                            {projectMembers.length === 0
                                              ? t('team.organization.noProjectMembers', {
                                                  defaultValue: 'No team members on this project.',
                                                })
                                              : t('team.noMatchingMembers')}
                                          </div>
                                        ) : (
                                          <div className='flex flex-col gap-0.5px pl-16px pr-4px py-1px border-l border-[var(--color-border-2)]/20 ml-10px'>
                                            {visibleProjectMembers.map((member) =>
                                              renderMemberThread(
                                                member,
                                                chatsWithMember(conversations, member, allAgentMembers, {
                                                  projectId: proj.id,
                                                  departments: hierarchy.departments,
                                                }).filter(
                                                  (c) => c.messages.length > 0 || c.id === selectedConversationId
                                                ),
                                                proj.id
                                              )
                                            )}
                                          </div>
                                        ))}
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
      <Modal
        title={t('team.allMembers', { defaultValue: 'All members' })}
        visible={allMembersVisible}
        footer={null}
        onCancel={() => setAllMembersVisible(false)}
      >
        <div className='max-h-60vh overflow-y-auto flex flex-col gap-4px'>
          {organizationMembers.map(({ member, departmentId, teamId, teamName }) => (
            <div
              key={`${teamId}:${member.id}`}
              className='flex items-center justify-between gap-8px px-6px py-4px rounded-6px hover:bg-fill-2'
            >
              <div className='min-w-0'>
                <div className='truncate text-12px text-t-primary'>{member.name}</div>
                <div className='truncate text-10px text-t-tertiary'>
                  {teamName} · {member.title || member.role}
                </div>
              </div>
              <Button
                size='mini'
                onClick={() => {
                  setAllMembersVisible(false);
                  setEditEntity({ type: 'member', data: member, context: { departmentId, teamId } });
                }}
              >
                {t('common.edit', { defaultValue: 'Edit' })}
              </Button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
};

export default React.memo(OrganizationSiderContent);
