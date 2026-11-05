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

const STORAGE_KEYS = {
  SCOPE: 'aionui:active-scope',
  HIERARCHY: 'aionui:org-hierarchy',
  PROJECTS: 'aionui:org-projects',
  CONVERSATIONS: 'aionui:org-conversations',
  CRON_JOBS: 'aionui:org-cron-jobs',
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

interface OrgStoreState {
  activeScope: OrgScope;
  hierarchy: OrgHierarchy;
  projects: OrgProject[];
  conversations: OrgConversation[];
  cronJobs: OrgCronJob[];
  nodeStatuses: Record<string, OrgNodeStatus>;
  hoveredCanonicalAgentId: string | null;
  selectedCanonicalAgentId: string | null;
  isSimulating: boolean;
  simulationStep: number;
  simulationMessage: string;
}

let globalState: OrgStoreState = {
  activeScope: (typeof localStorage !== 'undefined' && (localStorage.getItem(STORAGE_KEYS.SCOPE) as OrgScope)) || 'workplace',
  hierarchy: loadStored(STORAGE_KEYS.HIERARCHY, createDefaultOrgHierarchy),
  projects: loadStored(STORAGE_KEYS.PROJECTS, createDefaultOrgProjects),
  conversations: loadStored(STORAGE_KEYS.CONVERSATIONS, createDefaultOrgConversations),
  cronJobs: loadStored(STORAGE_KEYS.CRON_JOBS, createDefaultOrgCronJobs),
  nodeStatuses: {},
  hoveredCanonicalAgentId: null,
  selectedCanonicalAgentId: null,
  isSimulating: false,
  simulationStep: 0,
  simulationMessage: '',
};

const listeners = new Set<(state: OrgStoreState) => void>();

function notify() {
  const snapshot = { ...globalState };
  listeners.forEach((l) => l(snapshot));
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

  const resetToDefault = useCallback(() => {
    const defHierarchy = createDefaultOrgHierarchy();
    const defProjects = createDefaultOrgProjects();
    const defConversations = createDefaultOrgConversations();
    const defCron = createDefaultOrgCronJobs();

    globalState = {
      ...globalState,
      hierarchy: defHierarchy,
      projects: defProjects,
      conversations: defConversations,
      cronJobs: defCron,
      nodeStatuses: {},
      isSimulating: false,
      simulationStep: 0,
      simulationMessage: '',
    };
    saveStored(STORAGE_KEYS.HIERARCHY, defHierarchy);
    saveStored(STORAGE_KEYS.PROJECTS, defProjects);
    saveStored(STORAGE_KEYS.CONVERSATIONS, defConversations);
    saveStored(STORAGE_KEYS.CRON_JOBS, defCron);
    notify();
  }, []);

  const addDepartment = useCallback((dept: OrgDepartmentNode) => {
    const nextDepartments = [...globalState.hierarchy.departments, dept];
    const nextHierarchy = { ...globalState.hierarchy, departments: nextDepartments, lastUpdated: Date.now() };
    globalState = { ...globalState, hierarchy: nextHierarchy };
    saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
    notify();
  }, []);

  const addSubTeam = useCallback((departmentId: string, team: OrgTeamNode) => {
    const nextDepartments = globalState.hierarchy.departments.map((d) => {
      if (d.id === departmentId) {
        return {
          ...d,
          teams: [...d.teams, team],
          lastActiveAt: Date.now(),
        };
      }
      return d;
    });
    const nextHierarchy = { ...globalState.hierarchy, departments: nextDepartments, lastUpdated: Date.now() };
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

  const addOrgProject = useCallback((project: OrgProject) => {
    const nextProjects = [...globalState.projects, project];
    globalState = { ...globalState, projects: nextProjects };
    saveStored(STORAGE_KEYS.PROJECTS, nextProjects);
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
      simulationMessage: 'Step 1/6: Root CEO receives high-level directive: "Deploy Mobile Biometrics & Video Pipeline"...',
      nodeStatuses: {
        'root-ceo': 'working',
      },
    };
    notify();

    await delay(1800);

    // Step 2: Root CEO delegates to App Builder Department
    globalState = {
      ...globalState,
      simulationStep: 2,
      simulationMessage: 'Step 2/6: Root CEO delegates to App Builder Department. CEO transitions to Standby (Amber), Dept CEO wakes up (Emerald)...',
      nodeStatuses: {
        'root-ceo': 'department_standby',
        'dept-app-builder': 'working',
        'agent-head-apps': 'working',
      },
    };
    notify();

    await delay(2000);

    // Step 3: App Builder Dept CEO delegates to AionUi Team & Gym Mentor App Team
    globalState = {
      ...globalState,
      simulationStep: 3,
      simulationMessage: 'Step 3/6: Department CEO delegates to Team Manager & HR. Team in Standby (Amber), UI/UX Specialist working (Emerald), Backend queued next (Steel Cyan)...',
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

    // Step 4: UI/UX Specialist completes -> Just Finished (Teal). Backend Integration turns Emerald (Working).
    globalState = {
      ...globalState,
      simulationStep: 4,
      simulationMessage: 'Step 4/6: UI/UX Specialist finished (Muted Teal-Mint). Backend Integration now actively working (Soft Sage Emerald)...',
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

    // Step 5: Shared Member Visual Designer lights up across YouTube Automation and Social Media
    globalState = {
      ...globalState,
      simulationStep: 5,
      simulationMessage: 'Step 5/6: Shared Visual Designer working in YouTube Automation; Social Media pill displays "Busy in YouTube Dept" with Emerald ring...',
      nodeStatuses: {
        'root-ceo': 'department_standby',
        'dept-app-builder': 'department_standby',
        'team-aionui': 'department_standby',
        'spec-uiux-1': 'recently_finished',
        'spec-be-1': 'recently_finished',
        'dept-youtube': 'working',
        'spec-vis-shared': 'working',
        'team-dormant-vitality': 'dormant', // 7d+ Unused remains dimmed in Charcoal
      },
    };
    notify();

    await delay(2400);

    // Step 6: Completion rolled back up to Root CEO
    globalState = {
      ...globalState,
      simulationStep: 6,
      simulationMessage: 'Step 6/6: Deliverables verified and synthesized! Executive report delivered back up to Root CEO.',
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

    // End simulation, return to idle
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
    resetToDefault,
    addDepartment,
    addSubTeam,
    addOrgConversation,
    addOrgProject,
    toggleCronJob,
    runSimulation,
  };
}
