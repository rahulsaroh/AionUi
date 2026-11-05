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
};

function createInitialState(): OrgStoreState {
  const rawHierarchy = loadStored(STORAGE_KEYS.HIERARCHY, createDefaultOrgHierarchy);
  const rawProjects = loadStored(STORAGE_KEYS.PROJECTS, createDefaultOrgProjects);
  const rawConversations = loadStored(STORAGE_KEYS.CONVERSATIONS, createDefaultOrgConversations);
  const storedVersion = loadStored(STORAGE_KEYS.VERSION, () => 0);
  const migration = migrateOrgStorageV2(rawHierarchy, rawProjects, rawConversations, storedVersion);
  if (migration.migrated) {
    try {
      localStorage.setItem(STORAGE_KEYS.VERSION, String(ORG_STORAGE_VERSION));
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

  // Interactive CEO Delegation Simulation (Phase 7)
  const runSimulation = useCallback(async () => {
    if (globalState.isSimulating) return;

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    globalState = {
      ...globalState,
      isSimulating: true,
      simulationStep: 1,
      simulationMessage:
        'Step 1/6: Root CEO receives high-level directive: "Deploy Mobile Biometrics & Video Pipeline"...',
      nodeStatuses: {
        'root-ceo': 'working',
      },
    };
    notify();

    await delay(1800);

    globalState = {
      ...globalState,
      simulationStep: 2,
      simulationMessage:
        'Step 2/6: Root CEO delegates to App Builder Department. CEO transitions to Standby (Amber), Dept CEO wakes up (Emerald)...',
      nodeStatuses: {
        'root-ceo': 'department_standby',
        'dept-app-builder': 'working',
        'agent-head-apps': 'working',
      },
    };
    notify();

    await delay(2000);

    globalState = {
      ...globalState,
      simulationStep: 3,
      simulationMessage:
        'Step 3/6: Department CEO delegates to Team Manager & HR. Team in Standby (Amber), UI/UX Specialist working (Emerald), Backend queued next (Steel Cyan)...',
      nodeStatuses: {
        'root-ceo': 'department_standby',
        'dept-app-builder': 'department_standby',
        'team-aionui': 'department_standby',
        'lead-aionui': 'department_standby',
        'hr-aionui': 'department_standby',
        'spec-uiux-1': 'working',
        'spec-be-1': 'queued_next',
      },
    };
    notify();

    await delay(2200);

    globalState = {
      ...globalState,
      simulationStep: 4,
      simulationMessage:
        'Step 4/6: UI/UX Specialist finished (Muted Teal-Mint). Backend Integration now actively working (Soft Sage Emerald)...',
      nodeStatuses: {
        'root-ceo': 'department_standby',
        'dept-app-builder': 'department_standby',
        'team-aionui': 'department_standby',
        'spec-uiux-1': 'recently_finished',
        'spec-be-1': 'working',
      },
    };
    notify();

    await delay(2200);

    globalState = {
      ...globalState,
      simulationStep: 5,
      simulationMessage:
        'Step 5/6: Shared Visual Designer working in YouTube Automation; Social Media pill displays "Busy in YouTube Dept" with Emerald ring...',
      nodeStatuses: {
        'root-ceo': 'department_standby',
        'dept-app-builder': 'department_standby',
        'team-aionui': 'department_standby',
        'spec-uiux-1': 'recently_finished',
        'spec-be-1': 'recently_finished',
        'dept-youtube': 'working',
        'spec-vis-shared': 'working',
        'team-dormant-vitality': 'dormant',
      },
    };
    notify();

    await delay(2400);

    globalState = {
      ...globalState,
      simulationStep: 6,
      simulationMessage:
        'Step 6/6: Deliverables verified and synthesized! Executive report delivered back up to Root CEO.',
      nodeStatuses: {
        'root-ceo': 'working',
        'dept-app-builder': 'recently_finished',
        'team-aionui': 'recently_finished',
        'spec-uiux-1': 'recently_finished',
        'spec-be-1': 'recently_finished',
        'spec-vis-shared': 'recently_finished',
      },
    };
    notify();

    await delay(2200);

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
  };
}
