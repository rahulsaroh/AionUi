/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import type {
  OrgHierarchy,
  OrgDepartmentNode,
  OrgTeamNode,
  OrgAgentMember,
  OrgNodeStatus,
  OrgProject,
  OrgConversation,
  OrgCronJob,
  OrgScope,
} from '@/types/organization';
import {
  createDefaultOrgHierarchy,
  createDefaultOrgProjects,
  createDefaultOrgConversations,
  createDefaultOrgCronJobs,
} from '../utils/defaultOrgSeed';
import {
  applyProjectMutation,
  applyProjectRemoval,
  normalizeOrgProject,
  reconcileProjectsWithHierarchy,
  syncHierarchyProjectReferences,
  updateDepartmentInHierarchy,
  updateTeamInHierarchy,
} from '../utils/orgCoherence';
import {
  migrateOrgStorageV2,
  reconcileConversationsWithProjects,
  ORG_STORAGE_VERSION,
  loadOrgStorageVersion,
  saveOrgStorageVersion,
} from '../utils/orgMigration';

const STORAGE_KEYS = {
  SCOPE: 'aionui:active-scope',
  HIERARCHY: 'aionui:org-hierarchy',
  PROJECTS: 'aionui:org-projects',
  CONVERSATIONS: 'aionui:org-conversations',
  CRON_JOBS: 'aionui:org-cron-jobs',
  VERSION: 'aionui:org-storage-version',
};

function loadStored<T>(key: string, fallback: () => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback();
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`[useOrgStore] Failed to load key "${key}" from localStorage:`, e);
    return fallback();
  }
}

function saveStored<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`[useOrgStore] Failed to save key "${key}" to localStorage:`, e);
  }
}

type OrgStoreState = {
  activeScope: OrgScope;
  hierarchy: OrgHierarchy;
  projects: OrgProject[];
  conversations: OrgConversation[];
  cronJobs: OrgCronJob[];
  nodeStatuses: Record<string, OrgNodeStatus>;
  hoveredCanonicalAgentId: string | null;
  selectedCanonicalAgentId: string | null;
  // Contextual drill-down selection (Sidebar <-> Canvas synchronization)
  selectedDepartmentId: string | null;
  selectedTeamId: string | null;
  selectedProjectId: string | null;
  focusedNodeId: string | null;
  isSimulating: boolean;
  simulationStep: number;
  simulationMessage: string;
  orgViewMode: 'chat' | 'canvas';
  selectedConversationId: string | null;
};

function createInitialState(): OrgStoreState {
  const storedVersion = loadStored(STORAGE_KEYS.VERSION, () => 0);
  // Force blank canvas on version bump: discard persisted org data
  const useDefaults = storedVersion < ORG_STORAGE_VERSION;
  if (useDefaults && storedVersion > 0) {
    try {
      const backup = {
        version: storedVersion,
        hierarchy: localStorage.getItem(STORAGE_KEYS.HIERARCHY),
        projects: localStorage.getItem(STORAGE_KEYS.PROJECTS),
        conversations: localStorage.getItem(STORAGE_KEYS.CONVERSATIONS),
        cronJobs: localStorage.getItem(STORAGE_KEYS.CRON_JOBS),
        ts: Date.now(),
      };
      localStorage.setItem('aionui:org-backup-' + backup.ts, JSON.stringify(backup));
    } catch {}
  }
  let rawHierarchy = useDefaults
    ? createDefaultOrgHierarchy()
    : loadStored(STORAGE_KEYS.HIERARCHY, createDefaultOrgHierarchy);
  if (!rawHierarchy?.departments || rawHierarchy.departments.length === 0) {
    rawHierarchy = createDefaultOrgHierarchy();
  }
  let rawProjects = useDefaults
    ? createDefaultOrgProjects()
    : loadStored(STORAGE_KEYS.PROJECTS, createDefaultOrgProjects);
  if (!rawProjects || rawProjects.length === 0) {
    rawProjects = createDefaultOrgProjects();
  }
  let rawConversations = useDefaults
    ? createDefaultOrgConversations()
    : loadStored(STORAGE_KEYS.CONVERSATIONS, createDefaultOrgConversations);
  if (!rawConversations || rawConversations.length === 0) {
    rawConversations = createDefaultOrgConversations();
  }
  const migration = migrateOrgStorageV2(rawHierarchy, rawProjects, rawConversations, storedVersion);
  if (useDefaults || migration.migrated) {
    try {
      localStorage.setItem(STORAGE_KEYS.VERSION, String(ORG_STORAGE_VERSION));
      localStorage.setItem(STORAGE_KEYS.HIERARCHY, JSON.stringify(rawHierarchy));
      localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(rawProjects));
      localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(rawConversations));
      localStorage.setItem(STORAGE_KEYS.CRON_JOBS, JSON.stringify([]));
    } catch {}
  }
  const reconciled = reconcileProjectsWithHierarchy(migration.hierarchy, migration.projects);
  const conversationReconciled = reconcileConversationsWithProjects(
    reconciled.hierarchy,
    reconciled.projects,
    migration.conversations
  );
  return {
    activeScope:
      (typeof localStorage !== 'undefined' && (localStorage.getItem(STORAGE_KEYS.SCOPE) as OrgScope)) || 'workplace',
    hierarchy: reconciled.hierarchy,
    projects: conversationReconciled.projects,
    conversations: conversationReconciled.conversations,
    cronJobs: loadStored(STORAGE_KEYS.CRON_JOBS, createDefaultOrgCronJobs),
    nodeStatuses: {},
    hoveredCanonicalAgentId: null,
    selectedCanonicalAgentId: null,
    selectedDepartmentId: null,
    selectedTeamId: null,
    selectedProjectId: null,
    focusedNodeId: null,
    isSimulating: false,
    simulationStep: 0,
    simulationMessage: '',
    orgViewMode: 'chat',
    selectedConversationId: null,
  };
}

let globalState: OrgStoreState = createInitialState();

const listeners = new Set<(state: OrgStoreState) => void>();

function notify() {
  const snapshot = { ...globalState };
  listeners.forEach((l) => l(snapshot));
}

function persistHierarchyAndProjects(next: Pick<OrgStoreState, 'hierarchy' | 'projects'>) {
  saveStored(STORAGE_KEYS.HIERARCHY, next.hierarchy);
  saveStored(STORAGE_KEYS.PROJECTS, next.projects);
}

export function useOrgStore() {
  const [state, setState] = useState<OrgStoreState>(globalState);

  useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);

  const setActiveScope = useCallback((scope: OrgScope) => {
    globalState = { ...globalState, activeScope: scope };
    try {
      localStorage.setItem(STORAGE_KEYS.SCOPE, scope);
    } catch {}
    notify();
  }, []);

  const updateNodeStatus = useCallback((nodeId: string, status: OrgNodeStatus) => {
    globalState = {
      ...globalState,
      nodeStatuses: {
        ...globalState.nodeStatuses,
        [nodeId]: status,
      },
    };
    notify();
  }, []);

  const setHoveredCanonicalAgentId = useCallback((agentId: string | null) => {
    if (globalState.hoveredCanonicalAgentId === agentId) return;
    globalState = { ...globalState, hoveredCanonicalAgentId: agentId };
    notify();
  }, []);

  const setSelectedCanonicalAgentId = useCallback((agentId: string | null) => {
    globalState = { ...globalState, selectedCanonicalAgentId: agentId };
    notify();
  }, []);

  const setSelectedDepartment = useCallback((departmentId: string | null) => {
    globalState = {
      ...globalState,
      selectedDepartmentId: departmentId,
      selectedTeamId: null,
      selectedProjectId: null,
      focusedNodeId: departmentId,
    };
    notify();
  }, []);

  const setSelectedTeam = useCallback((teamId: string | null) => {
    globalState = { ...globalState, selectedTeamId: teamId, selectedProjectId: null, focusedNodeId: teamId };
    notify();
  }, []);

  const setSelectedProject = useCallback((projectId: string | null) => {
    globalState = {
      ...globalState,
      selectedProjectId: projectId,
      focusedNodeId: projectId ? `project-${projectId}` : null,
    };
    notify();
  }, []);

  const clearOrgSelection = useCallback(() => {
    globalState = {
      ...globalState,
      selectedDepartmentId: null,
      selectedTeamId: null,
      selectedProjectId: null,
      focusedNodeId: null,
    };
    notify();
  }, []);

  const setFocusedNode = useCallback((nodeId: string | null) => {
    globalState = { ...globalState, focusedNodeId: nodeId };
    notify();
  }, []);

  const setOrgViewMode = useCallback((mode: 'chat' | 'canvas') => {
    globalState = { ...globalState, orgViewMode: mode };
    notify();
  }, []);

  const setSelectedConversationId = useCallback((id: string | null) => {
    globalState = { ...globalState, selectedConversationId: id };
    notify();
  }, []);

  const resetToDefault = useCallback(() => {
    const defHierarchy = createDefaultOrgHierarchy();
    const defProjects = createDefaultOrgProjects();
    const defConversations = createDefaultOrgConversations();
    const defCron = createDefaultOrgCronJobs();
    const reconciled = reconcileProjectsWithHierarchy(defHierarchy, defProjects);

    globalState = {
      ...globalState,
      hierarchy: reconciled.hierarchy,
      projects: reconciled.projects,
      conversations: defConversations,
      cronJobs: defCron,
      nodeStatuses: {},
      isSimulating: false,
      simulationStep: 0,
      simulationMessage: '',
    };
    persistHierarchyAndProjects(reconciled);
    saveStored(STORAGE_KEYS.CONVERSATIONS, defConversations);
    saveStored(STORAGE_KEYS.CRON_JOBS, defCron);
    notify();
  }, []);

  const addDepartment = useCallback((dept: OrgDepartmentNode) => {
    const nextHierarchy = syncHierarchyProjectReferences(
      {
        ...globalState.hierarchy,
        departments: [...globalState.hierarchy.departments, { ...dept, linkedProjects: dept.linkedProjects ?? [] }],
        lastUpdated: Date.now(),
      },
      globalState.projects
    );
    globalState = { ...globalState, hierarchy: nextHierarchy };
    saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
    notify();
  }, []);

  const removeDepartment = useCallback((departmentId: string): boolean => {
    const dept = globalState.hierarchy.departments.find((d) => d.id === departmentId);
    if (!dept) return false;
    const hasTeams = dept.teams.length > 0;
    const hasProjects = globalState.projects.some((p) => p.departmentId === departmentId);
    const hasAutomations = globalState.cronJobs.some(
      (c) => (c as { orgDepartmentId?: string }).orgDepartmentId === departmentId
    );
    if (hasTeams || hasProjects || hasAutomations) return false;
    const nextHierarchy = {
      ...globalState.hierarchy,
      departments: globalState.hierarchy.departments.filter((d) => d.id !== departmentId),
      lastUpdated: Date.now(),
    };
    globalState = { ...globalState, hierarchy: nextHierarchy };
    saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
    notify();
    return true;
  }, []);

  const archiveDepartment = useCallback(
    (departmentId: string): boolean => {
      return removeDepartment(departmentId);
    },
    [removeDepartment]
  );

  const updateDepartment = useCallback((departmentId: string, patch: Partial<OrgDepartmentNode>) => {
    const nextHierarchy = syncHierarchyProjectReferences(
      updateDepartmentInHierarchy(globalState.hierarchy, departmentId, patch),
      globalState.projects
    );
    globalState = { ...globalState, hierarchy: nextHierarchy };
    saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
    notify();
  }, []);

  const addSubTeam = useCallback((departmentId: string, team: OrgTeamNode) => {
    const nextHierarchy = syncHierarchyProjectReferences(
      {
        ...globalState.hierarchy,
        lastUpdated: Date.now(),
        departments: globalState.hierarchy.departments.map((d) =>
          d.id === departmentId
            ? {
                ...d,
                teams: [...d.teams, team],
                lastActiveAt: Date.now(),
              }
            : d
        ),
      },
      globalState.projects
    );
    globalState = { ...globalState, hierarchy: nextHierarchy };
    saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
    notify();
  }, []);

  const updateTeamNode = useCallback((teamId: string, patch: Partial<OrgTeamNode>) => {
    const nextHierarchy = syncHierarchyProjectReferences(
      updateTeamInHierarchy(globalState.hierarchy, teamId, patch),
      globalState.projects
    );
    globalState = { ...globalState, hierarchy: nextHierarchy };
    saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
    notify();
  }, []);

  const updateTeamMember = useCallback((teamId: string, memberId: string, patch: Partial<OrgAgentMember>) => {
    const nextHierarchy = {
      ...globalState.hierarchy,
      lastUpdated: Date.now(),
      departments: globalState.hierarchy.departments.map((department) => ({
        ...department,
        teams: department.teams.map((team) =>
          team.id === teamId
            ? {
                ...team,
                specialistMembers: team.specialistMembers.map((member) =>
                  member.id === memberId ? { ...member, ...patch, id: member.id } : member
                ),
              }
            : team
        ),
      })),
    };
    globalState = { ...globalState, hierarchy: nextHierarchy };
    saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
    notify();
  }, []);

  const addOrgConversation = useCallback((conv: OrgConversation) => {
    const nextConversations = [conv, ...globalState.conversations];
    globalState = { ...globalState, conversations: nextConversations };
    saveStored(STORAGE_KEYS.CONVERSATIONS, nextConversations);
    notify();
  }, []);

  const upsertOrgProject = useCallback((project: OrgProject) => {
    const next = applyProjectMutation(globalState.hierarchy, globalState.projects, normalizeOrgProject(project));
    globalState = { ...globalState, ...next };
    persistHierarchyAndProjects(next);
    notify();
  }, []);

  const addOrgProject = useCallback((project: OrgProject) => {
    const next = applyProjectMutation(globalState.hierarchy, globalState.projects, normalizeOrgProject(project));
    globalState = { ...globalState, ...next };
    persistHierarchyAndProjects(next);
    notify();
  }, []);

  const deleteOrgProject = useCallback((projectId: string) => {
    const next = applyProjectRemoval(globalState.hierarchy, globalState.projects, projectId);
    globalState = { ...globalState, ...next };
    persistHierarchyAndProjects(next);
    notify();
  }, []);

  const toggleCronJob = useCallback((jobId: string) => {
    const nextCron = globalState.cronJobs.map((c) => (c.id === jobId ? { ...c, enabled: !c.enabled } : c));
    globalState = { ...globalState, cronJobs: nextCron };
    saveStored(STORAGE_KEYS.CRON_JOBS, nextCron);
    notify();
  }, []);

  // Interactive CEO Delegation Simulation
  const runSimulation = useCallback(async () => {
    if (globalState.isSimulating) return;

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    if (globalState.hierarchy.departments.length === 0) {
      globalState = {
        ...globalState,
        isSimulating: true,
        simulationStep: 1,
        simulationMessage: 'Step 1/3: Root CEO receives high-level strategic directive at Global Executive HQ...',
        nodeStatuses: {
          'root-ceo': 'working',
        },
      };
      notify();

      await delay(1600);

      globalState = {
        ...globalState,
        simulationStep: 2,
        simulationMessage: 'Step 2/3: Root CEO evaluates organizational topology and formulates department roadmap...',
        nodeStatuses: {
          'root-ceo': 'working',
        },
      };
      notify();

      await delay(1800);

      globalState = {
        ...globalState,
        simulationStep: 3,
        simulationMessage:
          'Step 3/3: Strategic plan established! Ready for department instantiation via chat or + Add Department.',
        nodeStatuses: {
          'root-ceo': 'recently_finished',
        },
      };
      notify();

      await delay(2000);

      globalState = {
        ...globalState,
        isSimulating: false,
        simulationStep: 0,
        simulationMessage: '',
        nodeStatuses: {},
      };
      notify();
      return;
    }

    const firstDept = globalState.hierarchy.departments[0];
    const firstTeam = firstDept?.teams?.[0];

    globalState = {
      ...globalState,
      isSimulating: true,
      simulationStep: 1,
      simulationMessage: 'Step 1/4: Root CEO receives high-level directive...',
      nodeStatuses: {
        'root-ceo': 'working',
      },
    };
    notify();

    await delay(1600);

    globalState = {
      ...globalState,
      simulationStep: 2,
      simulationMessage: `Step 2/4: Root CEO delegates to ${firstDept.name}. Department Head begins sprint planning...`,
      nodeStatuses: {
        'root-ceo': 'department_standby',
        [firstDept.id]: 'working',
        [firstDept.departmentCeoAgent.id]: 'working',
      },
    };
    notify();

    await delay(1800);

    if (firstTeam) {
      globalState = {
        ...globalState,
        simulationStep: 3,
        simulationMessage: `Step 3/4: ${firstDept.name} delegates sprint deliverables to ${firstTeam.name}...`,
        nodeStatuses: {
          'root-ceo': 'department_standby',
          [firstDept.id]: 'department_standby',
          [firstTeam.id]: 'working',
        },
      };
      notify();

      await delay(2000);
    }

    globalState = {
      ...globalState,
      simulationStep: 4,
      simulationMessage:
        'Step 4/4: Deliverables verified and synthesized! Executive report delivered back up to Root CEO.',
      nodeStatuses: {
        'root-ceo': 'working',
        [firstDept.id]: 'recently_finished',
        ...(firstTeam ? { [firstTeam.id]: 'recently_finished' } : {}),
      },
    };
    notify();

    await delay(2000);

    globalState = {
      ...globalState,
      isSimulating: false,
      simulationStep: 0,
      simulationMessage: '',
      nodeStatuses: {},
    };
    notify();
  }, []);

  return {
    ...state,
    setActiveScope,
    updateNodeStatus,
    setHoveredCanonicalAgentId,
    setSelectedCanonicalAgentId,
    setSelectedDepartment,
    setSelectedTeam,
    setSelectedProject,
    setFocusedNode,
    clearOrgSelection,
    resetToDefault,
    addDepartment,
    removeDepartment,
    archiveDepartment,
    updateDepartment,
    addSubTeam,
    updateTeamNode,
    updateTeamMember,
    addOrgConversation,
    addOrgProject,
    upsertOrgProject,
    deleteOrgProject,
    toggleCronJob,
    runSimulation,
    setOrgViewMode,
    setSelectedConversationId,
  };
}
