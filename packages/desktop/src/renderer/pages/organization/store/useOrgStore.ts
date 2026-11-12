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
import { migrateOrgStorageV2, reconcileConversationsWithProjects, ORG_STORAGE_VERSION } from '../utils/orgMigration';
import { ipcBridge } from '@/common';
import { resolveOrgChatTarget } from '../utils/openOrgChat';
import type { OrgChatTarget } from '../utils/agentTurn';
import i18n from '@/renderer/services/i18n';

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
    const serialized = JSON.stringify(value);
    localStorage.setItem(key, serialized);
    void ipcBridge.org.saveData(key, serialized).catch(() => {});
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
  openChatError: string | null;
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
  if (!rawHierarchy || !rawHierarchy.rootCeo) {
    rawHierarchy = createDefaultOrgHierarchy();
  }
  let rawProjects = useDefaults
    ? createDefaultOrgProjects()
    : loadStored(STORAGE_KEYS.PROJECTS, createDefaultOrgProjects);
  if (!rawProjects) {
    rawProjects = createDefaultOrgProjects();
  }
  let rawConversations = useDefaults
    ? createDefaultOrgConversations()
    : loadStored(STORAGE_KEYS.CONVERSATIONS, createDefaultOrgConversations);
  if (!rawConversations) {
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
    openChatError: null,
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

    // Sync from persistent backend SQLite store on startup if available
    const syncFromPersistentStore = async () => {
      try {
        const [hierRaw, projRaw, convRaw] = await Promise.all([
          ipcBridge.org.loadData(STORAGE_KEYS.HIERARCHY),
          ipcBridge.org.loadData(STORAGE_KEYS.PROJECTS),
          ipcBridge.org.loadData(STORAGE_KEYS.CONVERSATIONS),
        ]);
        let changed = false;
        let nextHierarchy = globalState.hierarchy;
        let nextProjects = globalState.projects;
        let nextConversations = globalState.conversations;

        if (hierRaw) {
          try {
            const parsed = JSON.parse(hierRaw);
            if (parsed?.rootCeo) {
              nextHierarchy = parsed;
              changed = true;
            }
          } catch {}
        }
        if (projRaw) {
          try {
            const parsed = JSON.parse(projRaw);
            if (Array.isArray(parsed)) {
              nextProjects = parsed;
              changed = true;
            }
          } catch {}
        }
        if (convRaw) {
          try {
            const parsed = JSON.parse(convRaw);
            if (Array.isArray(parsed)) {
              nextConversations = parsed;
              changed = true;
            }
          } catch {}
        }

        if (changed) {
          globalState = {
            ...globalState,
            hierarchy: nextHierarchy,
            projects: nextProjects,
            conversations: nextConversations,
          };
          notify();
        }
      } catch (err) {
        console.warn('[useOrgStore] Backend sync notice:', err);
      }
    };

    void syncFromPersistentStore();

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

  const addTeamMember = useCallback((teamId: string, member: OrgAgentMember) => {
    const nextHierarchy = {
      ...globalState.hierarchy,
      lastUpdated: Date.now(),
      departments: globalState.hierarchy.departments.map((department) => ({
        ...department,
        teams: department.teams.map((team) =>
          team.id === teamId
            ? {
                ...team,
                specialistMembers: [...team.specialistMembers, member],
              }
            : team
        ),
      })),
    };
    globalState = { ...globalState, hierarchy: nextHierarchy };
    saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
    notify();
  }, []);

  const updateRootCeo = useCallback((patch: Partial<OrgHierarchy['rootCeo']>) => {
    const nextHierarchy: OrgHierarchy = {
      ...globalState.hierarchy,
      lastUpdated: Date.now(),
      rootCeo: {
        ...globalState.hierarchy.rootCeo,
        ...patch,
      },
    };
    globalState = { ...globalState, hierarchy: nextHierarchy };
    saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
    notify();
  }, []);

  const updateAgentModel = useCallback((agentId: string, model: import('@/types/organization').OrgAgentModelConfig) => {
    const currentHierarchy = globalState.hierarchy;
    const isRootCeo =
      currentHierarchy.rootCeo.ceoAgent.id === agentId || agentId === 'root-ceo' || agentId === 'agent-root-ceo';

    const isChiefOfStaff = currentHierarchy.rootCeo.chiefOfStaffAgent?.id === agentId;

    const nextHierarchy: OrgHierarchy = {
      ...currentHierarchy,
      lastUpdated: Date.now(),
      rootCeo: {
        ...currentHierarchy.rootCeo,
        ceoAgent: isRootCeo ? { ...currentHierarchy.rootCeo.ceoAgent, model } : currentHierarchy.rootCeo.ceoAgent,
        chiefOfStaffAgent:
          isChiefOfStaff && currentHierarchy.rootCeo.chiefOfStaffAgent
            ? { ...currentHierarchy.rootCeo.chiefOfStaffAgent, model }
            : currentHierarchy.rootCeo.chiefOfStaffAgent,
      },
      departments: currentHierarchy.departments.map((dept) => {
        const isDeptHead = dept.departmentCeoAgent.id === agentId;
        const isPm = dept.pmAgent?.id === agentId;
        return {
          ...dept,
          departmentCeoAgent: isDeptHead ? { ...dept.departmentCeoAgent, model } : dept.departmentCeoAgent,
          pmAgent: isPm && dept.pmAgent ? { ...dept.pmAgent, model } : dept.pmAgent,
          teams: dept.teams.map((team) => {
            const isTeamLead = team.teamLeadAgent.id === agentId;
            const isHr = team.hrCoordinatorAgent.id === agentId;
            return {
              ...team,
              teamLeadAgent: isTeamLead ? { ...team.teamLeadAgent, model } : team.teamLeadAgent,
              hrCoordinatorAgent: isHr ? { ...team.hrCoordinatorAgent, model } : team.hrCoordinatorAgent,
              specialistMembers: team.specialistMembers.map((member) =>
                member.id === agentId ? { ...member, model } : member
              ),
            };
          }),
        };
      }),
    };

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
    const nextConversations = [conv, ...globalState.conversations.filter((c) => c.id !== conv.id)];
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

  const upsertMember = useCallback((member: OrgAgentMember) => {
    // Shared members are part of the global pool
    void ipcBridge.org.saveMembers([member]);
    notify();
  }, []);

  const deleteMember = useCallback((_memberId: string) => {
    notify();
  }, []);

  const assignMemberToProject = useCallback((projectId: string, memberId: string) => {
    const proj = globalState.projects.find((p) => p.id === projectId);
    if (!proj) return;
    const currentMemberIds = proj.memberIds || [];
    if (currentMemberIds.includes(memberId)) return;
    const nextProj = { ...proj, memberIds: [...currentMemberIds, memberId] };
    const nextProjects = globalState.projects.map((p) => (p.id === projectId ? nextProj : p));
    globalState = { ...globalState, projects: nextProjects };
    persistHierarchyAndProjects({ hierarchy: globalState.hierarchy, projects: nextProjects });
    notify();
  }, []);

  const removeMemberFromProject = useCallback((projectId: string, memberId: string) => {
    const proj = globalState.projects.find((p) => p.id === projectId);
    if (!proj) return;
    const nextMemberIds = (proj.memberIds || []).filter((id) => id !== memberId);
    const nextProj = { ...proj, memberIds: nextMemberIds };
    const nextProjects = globalState.projects.map((p) => (p.id === projectId ? nextProj : p));
    globalState = { ...globalState, projects: nextProjects };
    persistHierarchyAndProjects({ hierarchy: globalState.hierarchy, projects: nextProjects });
    notify();
  }, []);

  const addOrgCronJob = useCallback((job: OrgCronJob) => {
    const nextCron = [...globalState.cronJobs.filter((c) => c.id !== job.id), job];
    globalState = { ...globalState, cronJobs: nextCron };
    saveStored(STORAGE_KEYS.CRON_JOBS, nextCron);
    notify();

    void ipcBridge.cron.addJob
      .invoke({
        name: `Org: ${job.name}`,
        description: `Department: ${job.departmentId}`,
        schedule: {
          kind: 'cron',
          expr: job.cronExpression || '0 9 * * *',
          description: `Org: ${job.name}`,
        },
        prompt: job.taskDirective,
        conversation_id: '',
        conversation_title: `Org Scheduled: ${job.name}`,
        created_by: 'user',
        execution_mode: 'new_conversation',
      })
      .catch((err) => {
        console.warn('[useOrgStore] Sync add cron job failed:', err);
      });
  }, []);

  const removeOrgCronJob = useCallback((jobId: string) => {
    const nextCron = globalState.cronJobs.filter((c) => c.id !== jobId);
    globalState = { ...globalState, cronJobs: nextCron };
    saveStored(STORAGE_KEYS.CRON_JOBS, nextCron);
    notify();

    void ipcBridge.cron.removeJob.invoke({ job_id: jobId }).catch((err) => {
      console.warn('[useOrgStore] Sync remove cron job failed:', err);
    });
  }, []);

  const toggleCronJob = useCallback((jobId: string) => {
    const target = globalState.cronJobs.find((c) => c.id === jobId);
    const nextCron = globalState.cronJobs.map((c) => (c.id === jobId ? { ...c, enabled: !c.enabled } : c));
    globalState = { ...globalState, cronJobs: nextCron };
    saveStored(STORAGE_KEYS.CRON_JOBS, nextCron);
    notify();

    if (target) {
      void ipcBridge.cron.updateJob
        .invoke({
          job_id: jobId,
          updates: { enabled: !target.enabled },
        })
        .catch((err) => {
          console.warn('[useOrgStore] Sync update cron job failed:', err);
        });
    }
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

  const clearOpenChatError = useCallback(() => {
    globalState = { ...globalState, openChatError: null };
    notify();
  }, []);

  const openChat = useCallback((target: OrgChatTarget): { ok: boolean; error?: string } => {
    const t = (key: string, opts?: Record<string, unknown>) =>
      (opts?.defaultValue as string) || (i18n.t(key, opts as Record<string, string>) as string) || key;

    const result = resolveOrgChatTarget(
      target,
      globalState.hierarchy,
      globalState.projects,
      globalState.conversations,
      t
    );
    if ('error' in result) {
      globalState = { ...globalState, openChatError: result.error, selectedConversationId: null, orgViewMode: 'chat' };
      notify();
      return { ok: false, error: result.error };
    }

    let nextHierarchy = result.mutatedHierarchy
      ? syncHierarchyProjectReferences(result.mutatedHierarchy, globalState.projects)
      : globalState.hierarchy;
    let nextProjects = globalState.projects;

    if (result.updatedProject) {
      const exists = nextProjects.some((p) => p.id === result.updatedProject!.id);
      nextProjects = exists
        ? nextProjects.map((p) => (p.id === result.updatedProject!.id ? result.updatedProject! : p))
        : [...nextProjects, result.updatedProject!];
      nextHierarchy = syncHierarchyProjectReferences(result.mutatedHierarchy || nextHierarchy, nextProjects);
    }

    const existingIdx = globalState.conversations.findIndex((c) => c.id === result.conversation.id);
    let nextConversations: OrgConversation[];
    if (existingIdx >= 0) {
      nextConversations = [...globalState.conversations];
      nextConversations[existingIdx] = {
        ...nextConversations[existingIdx],
        ...result.conversation,
        messages: nextConversations[existingIdx].messages,
      };
      // move to front
      const [item] = nextConversations.splice(existingIdx, 1);
      nextConversations.unshift(item);
    } else {
      nextConversations = [result.conversation, ...globalState.conversations];
    }

    const nextState: Partial<OrgStoreState> = {
      hierarchy: nextHierarchy,
      projects: nextProjects,
      conversations: nextConversations,
      selectedConversationId: result.conversation.id,
      orgViewMode: 'chat',
      openChatError: null,
    };

    if (target.type === 'department_head') {
      nextState.selectedDepartmentId = result.departmentId || target.id;
      nextState.selectedTeamId = null;
      nextState.selectedProjectId = null;
      nextState.focusedNodeId = result.departmentId || target.id;
    } else if (target.type === 'project_head') {
      nextState.selectedDepartmentId = result.departmentId || globalState.selectedDepartmentId;
      nextState.selectedTeamId = result.teamId || null;
      nextState.selectedProjectId = result.projectId || target.id;
      nextState.focusedNodeId = `project-${result.projectId || target.id}`;
    } else if (target.type === 'member') {
      if (result.projectId) {
        nextState.selectedDepartmentId = result.departmentId || globalState.selectedDepartmentId;
        nextState.selectedTeamId = result.teamId || null;
        nextState.selectedProjectId = result.projectId;
      }
      nextState.focusedNodeId = target.id;
    } else {
      nextState.selectedDepartmentId = null;
      nextState.selectedTeamId = null;
      nextState.selectedProjectId = null;
      nextState.focusedNodeId = 'root-ceo';
    }

    globalState = { ...globalState, ...(nextState as OrgStoreState) };
    persistHierarchyAndProjects({ hierarchy: nextHierarchy, projects: nextProjects });
    saveStored(STORAGE_KEYS.CONVERSATIONS, nextConversations);
    notify();
    return { ok: true };
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
    addTeamMember,
    updateTeamMember,
    updateRootCeo,
    updateAgentModel,
    addOrgConversation,
    addOrgProject,
    upsertOrgProject,
    deleteOrgProject,
    upsertMember,
    deleteMember,
    assignMemberToProject,
    removeMemberFromProject,
    addOrgCronJob,
    removeOrgCronJob,
    toggleCronJob,
    runSimulation,
    setOrgViewMode,
    setSelectedConversationId,
    openChat,
    clearOpenChatError,
  };
}
