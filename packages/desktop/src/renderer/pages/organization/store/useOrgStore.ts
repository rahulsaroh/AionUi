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
  addProjectMemberSource,
  normalizeOrgProject,
  reconcileProjectsWithHierarchy,
  removeProjectMemberSource,
  syncHierarchyProjectReferences,
  updateDepartmentInHierarchy,
  updateTeamInHierarchy,
} from '../utils/orgCoherence';
import { migrateOrgStorageV2, reconcileConversationsWithProjects, ORG_STORAGE_VERSION } from '../utils/orgMigration';
import { ipcBridge } from '@/common';
import { memberHandbook } from '@/common/adapter/ipcBridge';
import { resolveOrgChatTarget } from '../utils/openOrgChat';
import { validateOrgFolder } from '../utils/orgPathUtils';
import type { OrgChatTarget } from '../utils/agentTurn';
import i18n from '@/renderer/services/i18n';

const STORAGE_KEYS = {
  SCOPE: 'aionui:active-scope',
  HIERARCHY: 'aionui:org-hierarchy',
  PROJECTS: 'aionui:org-projects',
  MEMBERS: 'aionui:org-members',
  CONVERSATIONS: 'aionui:org-conversations',
  SELECTED_CONVERSATION: 'aionui:org-selected-conversation',
  CRON_JOBS: 'aionui:org-cron-jobs',
  VERSION: 'aionui:org-storage-version',
  APPROVED_LINEUPS: 'aionui:org-approved-lineups',
  AUTO_APPROVE_PERMISSIONS: 'aionui:org-auto-approve-permissions',
};

let orgMutationQueue: Promise<unknown> = Promise.resolve();

function enqueueOrgMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const next = orgMutationQueue.then(mutation, mutation);
  orgMutationQueue = next.catch(() => {});
  return next;
}

function loadStored<T>(key: string, fallback: () => T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback();
    const raw = localStorage.getItem(key);
    if (!raw) return fallback();
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`[useOrgStore] Failed to load key "${key}" from localStorage:`, e);
    return fallback();
  }
}

async function saveStoredWithRetry<T>(key: string, value: T, isRetry = false): Promise<void> {
  try {
    const serialized = JSON.stringify(value);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, serialized);
    }
    const savePromise = ipcBridge.org?.saveData?.(key, serialized);
    if (savePromise) {
      const ok = await savePromise;
      if (ok === false) {
        if (!isRetry) {
          console.warn(`[useOrgStore] ipc saveData returned false for key "${key}", retrying once...`);
          return await saveStoredWithRetry(key, value, true);
        }
        console.warn(`[useOrgStore] Persistence warning: ipc saveData failed for key "${key}" after retry`);
      }
    }
  } catch (err) {
    if (!isRetry) {
      console.warn(`[useOrgStore] Failed to save key "${key}", retrying once:`, err);
      return await saveStoredWithRetry(key, value, true);
    }
    console.warn(`[useOrgStore] Persistence error: failed to save key "${key}":`, err);
  }
}

function saveStored<T>(key: string, value: T): void {
  void saveStoredWithRetry(key, value);
}

let conversationSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingConversationsToSave: OrgConversation[] | null = null;

function flushPendingConversations(): void {
  if (conversationSaveTimer) {
    clearTimeout(conversationSaveTimer);
    conversationSaveTimer = null;
  }
  if (pendingConversationsToSave) {
    const convs = pendingConversationsToSave;
    pendingConversationsToSave = null;
    void saveStoredWithRetry(STORAGE_KEYS.CONVERSATIONS, convs);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPendingConversations);
  window.addEventListener('unload', flushPendingConversations);
}

let projectsByScope: Record<OrgScope, OrgProject[]> = {
  workplace: [],
  organization: [],
};

let conversationsByScope: Record<OrgScope, OrgConversation[]> = {
  workplace: [],
  organization: [],
};

let lastActiveConversationByScope: Record<OrgScope, string | null> = {
  workplace: null,
  organization: null,
};

function mergeProjects(local: OrgProject[], remote: OrgProject[]): { merged: OrgProject[]; hasChanges: boolean } {
  const map = new Map<string, OrgProject>();
  for (const p of local) {
    map.set(p.id, p);
  }
  let hasChanges = false;
  for (const r of remote) {
    const existing = map.get(r.id);
    if (!existing) {
      map.set(r.id, r);
      hasChanges = true;
    } else {
      const remoteTime = r.updatedAt ?? 0;
      const localTime = existing.updatedAt ?? 0;
      if (remoteTime > localTime) {
        // Preserve local teamIds if remote has empty array
        const teamIds = r.teamIds?.length ? r.teamIds : existing.teamIds;
        map.set(r.id, { ...existing, ...r, teamIds });
        hasChanges = true;
      }
    }
  }
  return { merged: Array.from(map.values()), hasChanges };
}

function mergeConversations(
  local: OrgConversation[],
  remote: OrgConversation[]
): { merged: OrgConversation[]; hasChanges: boolean } {
  const map = new Map<string, OrgConversation>();
  for (const c of local) {
    map.set(c.id, c);
  }
  let hasChanges = false;
  for (const r of remote) {
    const existing = map.get(r.id);
    if (!existing) {
      map.set(r.id, r);
      hasChanges = true;
    } else {
      const remoteTime = r.updatedAt ?? r.timestamp ?? 0;
      const localTime = existing.updatedAt ?? existing.timestamp ?? 0;
      const remoteMsgCount = r.messages?.length ?? 0;
      const localMsgCount = existing.messages?.length ?? 0;
      if (remoteTime > localTime || (remoteMsgCount > localMsgCount && localMsgCount === 0)) {
        map.set(r.id, { ...existing, ...r });
        hasChanges = true;
      }
    }
  }
  return { merged: Array.from(map.values()), hasChanges };
}

function mergeDepartments(
  localDepts: OrgDepartmentNode[],
  remoteDepts: OrgDepartmentNode[]
): { merged: OrgDepartmentNode[]; hasChanges: boolean } {
  if (remoteDepts.length === 0) {
    return { merged: localDepts, hasChanges: false };
  }
  if (localDepts.length === 0) {
    return { merged: remoteDepts, hasChanges: true };
  }
  const map = new Map<string, OrgDepartmentNode>();
  for (const d of localDepts) {
    map.set(d.id, d);
  }
  let hasChanges = false;
  for (const rd of remoteDepts) {
    const existing = map.get(rd.id);
    if (!existing) {
      map.set(rd.id, rd);
      hasChanges = true;
    } else {
      const remoteTime = rd.updatedAt ?? rd.lastActiveAt ?? 0;
      const localTime = existing.updatedAt ?? existing.lastActiveAt ?? 0;
      if (remoteTime > localTime) {
        // Preserve teams if remote has fewer
        const teams = rd.teams?.length ? rd.teams : existing.teams;
        map.set(rd.id, { ...existing, ...rd, teams });
        hasChanges = true;
      }
    }
  }
  return { merged: Array.from(map.values()), hasChanges };
}

/**
 * Legacy organization records predate mode-scoped storage. Treat them as
 * Organization data so existing projects and their chat history remain
 * accessible after upgrading.
 */
function belongsToScope(item: { mode?: OrgScope }, scope: OrgScope): boolean {
  return item.mode === scope || (scope === 'organization' && item.mode === undefined);
}

export type ApprovedLineupRecord = {
  id: string;
  proposalId?: string;
  projectId?: string;
  usedAt?: number;
  lineup: unknown;
  approvedAt: number;
};

export type AutoApprovePermissionsMode = 'off' | 'read_only' | 'all';

type OrgStoreState = {
  activeScope: OrgScope;
  hierarchy: OrgHierarchy;
  projects: OrgProject[];
  members: OrgAgentMember[];
  conversations: OrgConversation[];
  cronJobs: OrgCronJob[];
  approvedLineups: ApprovedLineupRecord[];
  autoApprovePermissions: AutoApprovePermissionsMode;
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
  activeFilter: 'all' | 'active' | 'dormant' | 'shared';
  selectedConversationId: string | null;
  openChatError: string | null;
};

function sanitizeHierarchyTransientStatuses(h: OrgHierarchy): OrgHierarchy {
  const sanitize = (status?: OrgNodeStatus): OrgNodeStatus | undefined => {
    if (status === 'working' || status === 'queued_next' || status === 'recently_finished') {
      return 'idle';
    }
    return status;
  };

  return {
    ...h,
    rootCeo: {
      ...h.rootCeo,
      status: sanitize(h.rootCeo.status),
      ceoAgent: {
        ...h.rootCeo.ceoAgent,
        status: sanitize(h.rootCeo.ceoAgent.status),
      },
    },
    departments: h.departments.map((dept) => ({
      ...dept,
      status: sanitize(dept.status),
      departmentCeoAgent: {
        ...dept.departmentCeoAgent,
        status: sanitize(dept.departmentCeoAgent.status),
      },
      teams: dept.teams.map((team) => ({
        ...team,
        status: sanitize(team.status),
        teamLeadAgent: {
          ...team.teamLeadAgent,
          status: sanitize(team.teamLeadAgent.status),
        },
        specialistMembers: team.specialistMembers.map((spec) => ({
          ...spec,
          status: sanitize(spec.status),
        })),
      })),
    })),
  };
}

function reconcileMembersWithHierarchy(
  hierarchy: OrgHierarchy,
  projects: OrgProject[],
  members: OrgAgentMember[]
): { hierarchy: OrgHierarchy; members: OrgAgentMember[]; modified: boolean } {
  let modified = false;
  const normalizeName = (name: string): string => (/^aion(\s*|-)?cli$/i.test(name.trim()) ? 'Shiraj CLI' : name);

  const updatedMembers = members.map((m) => {
    const renamed = normalizeName(m.name);
    if (renamed !== m.name) {
      modified = true;
      return { ...m, name: renamed };
    }
    return { ...m };
  });
  const nextDepartments = hierarchy.departments.map((dept) => {
    let deptModified = false;
    const nextTeams = dept.teams.map((team) => {
      let teamModified = false;
      let teamLeadAgent = team.teamLeadAgent;
      if (teamLeadAgent) {
        const renamed = normalizeName(teamLeadAgent.name);
        if (renamed !== teamLeadAgent.name) {
          teamLeadAgent = { ...teamLeadAgent, name: renamed };
          teamModified = true;
          modified = true;
        }
      }
      const currentSpecs = (team.specialistMembers || []).map((s) => {
        const renamed = normalizeName(s.name);
        if (renamed !== s.name) {
          teamModified = true;
          modified = true;
          return { ...s, name: renamed };
        }
        return s;
      });

      for (const m of updatedMembers) {
        const isAssignedToThisTeam = m.assignedTeamIds?.includes(team.id);
        const isAssignedViaProject = projects.some(
          (p) =>
            (p.teamIds?.includes(team.id) || (!p.teamIds?.length && p.departmentId === dept.id)) &&
            p.memberIds?.includes(m.id)
        );
        const isAssignedViaDept =
          !m.assignedTeamIds?.length && m.departmentId === dept.id && dept.teams[0]?.id === team.id;

        if (isAssignedToThisTeam || isAssignedViaProject || isAssignedViaDept) {
          const already = currentSpecs.some((s) => s.id === m.id || s.canonicalAgentId === m.canonicalAgentId);
          if (!already) {
            currentSpecs.push({
              ...m,
              assignedTeamIds: Array.from(new Set([...(m.assignedTeamIds || []), team.id])),
            });
            teamModified = true;
          }
          if (!m.assignedTeamIds?.includes(team.id)) {
            m.assignedTeamIds = Array.from(new Set([...(m.assignedTeamIds || []), team.id]));
            modified = true;
          }
        }
      }

      if (teamModified) {
        deptModified = true;
        return {
          ...team,
          teamLeadAgent,
          specialistMembers: currentSpecs,
          ...(team.members ? { members: currentSpecs } : {}),
        };
      }
      return team;
    });

    if (deptModified) {
      modified = true;
      return {
        ...dept,
        teams: nextTeams,
      };
    }
    return dept;
  });

  return {
    hierarchy: modified ? { ...hierarchy, departments: nextDepartments, lastUpdated: Date.now() } : hierarchy,
    members: updatedMembers,
    modified,
  };
}

function createInitialState(): OrgStoreState {
  const storedVersion = loadStored(STORAGE_KEYS.VERSION, () => 0);
  const useDefaults = storedVersion === 0;
  if (storedVersion > 0 && storedVersion < ORG_STORAGE_VERSION) {
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
  // Prune dead empty conversations on initialization
  rawConversations = rawConversations.filter((c) => Array.isArray(c.messages) && c.messages.length > 0);
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
  let migratedConversations = migration.conversations;
  if (reconciled.rewrittenTeamIds.size > 0) {
    migratedConversations = migratedConversations.map((c) =>
      c.teamId && reconciled.rewrittenTeamIds.has(c.teamId)
        ? { ...c, teamId: reconciled.rewrittenTeamIds.get(c.teamId)! }
        : c
    );
  }
  const conversationReconciled = reconcileConversationsWithProjects(
    reconciled.hierarchy,
    reconciled.projects,
    migratedConversations
  );

  const initialScope =
    (typeof localStorage !== 'undefined' && (localStorage.getItem(STORAGE_KEYS.SCOPE) as OrgScope)) || 'workplace';
  const allProjects = conversationReconciled.projects;
  const allConversations = conversationReconciled.conversations;
  if (allProjects.length !== rawProjects.length) {
    try {
      localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(allProjects));
    } catch {}
  }

  projectsByScope = {
    workplace: allProjects.filter((p) => p.mode === 'workplace'),
    organization: allProjects.filter((p) => belongsToScope(p, 'organization')),
  };

  conversationsByScope = {
    workplace: allConversations.filter((c) => c.mode === 'workplace'),
    organization: allConversations.filter((c) => belongsToScope(c, 'organization')),
  };

  const storedSelected = loadStored<string | null>(STORAGE_KEYS.SELECTED_CONVERSATION, () => null);
  lastActiveConversationByScope = {
    workplace: null,
    organization: null,
  };
  lastActiveConversationByScope[initialScope] = storedSelected;

  const currentScopeProjects = projectsByScope[initialScope] || [];
  const currentScopeConversations = conversationsByScope[initialScope] || [];
  const selectedConversationId = currentScopeConversations.some((c) => c.id === storedSelected)
    ? storedSelected
    : (currentScopeConversations[0]?.id ?? null);

  const rawMembers = loadStored<OrgAgentMember[]>(STORAGE_KEYS.MEMBERS, (): OrgAgentMember[] => []);
  const memberReconciled = reconcileMembersWithHierarchy(reconciled.hierarchy, allProjects, rawMembers);
  if (memberReconciled.modified) {
    try {
      localStorage.setItem(STORAGE_KEYS.HIERARCHY, JSON.stringify(memberReconciled.hierarchy));
      localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(memberReconciled.members));
    } catch {}
  }

  return {
    activeScope: initialScope,
    hierarchy: sanitizeHierarchyTransientStatuses(memberReconciled.hierarchy),
    projects: currentScopeProjects,
    members: memberReconciled.members,
    conversations: currentScopeConversations,
    cronJobs: loadStored(STORAGE_KEYS.CRON_JOBS, createDefaultOrgCronJobs),
    approvedLineups: loadStored<ApprovedLineupRecord[]>(STORAGE_KEYS.APPROVED_LINEUPS, () => []),
    autoApprovePermissions: (() => {
      const loaded = loadStored<unknown>(STORAGE_KEYS.AUTO_APPROVE_PERMISSIONS, () => 'off');
      if (loaded === true || loaded === 'all') return 'all';
      if (loaded === 'read_only') return 'read_only';
      return 'off';
    })(),
    nodeStatuses: {},
    hoveredCanonicalAgentId: null,
    selectedCanonicalAgentId: null,
    selectedDepartmentId: null,
    selectedTeamId: null,
    selectedProjectId: null,
    focusedNodeId: initialScope === 'organization' ? 'root-ceo' : null,
    isSimulating: false,
    simulationStep: 0,
    simulationMessage: '',
    orgViewMode: 'chat',
    activeFilter: 'all',
    selectedConversationId,
    openChatError: null,
  };
}

let globalState: OrgStoreState = createInitialState();

const listeners = new Set<(state: OrgStoreState) => void>();

/**
 * Persist only the active scope's conversations while retaining conversations
 * from the other scope in the shared storage record.
 */
function saveScopedConversations(conversations: OrgConversation[]): void {
  const scope = globalState.activeScope;
  conversationsByScope[scope] = conversations;
  const scopedConversations = conversations
    .filter((conversation) => belongsToScope(conversation, scope))
    .map((conversation) => ({ ...conversation, mode: conversation.mode ?? scope }));
  const scopedConversationIds = new Set(scopedConversations.map((conversation) => conversation.id));
  const retainedConversations = loadStored<OrgConversation[]>(STORAGE_KEYS.CONVERSATIONS, () => []).filter(
    (conversation) => !belongsToScope(conversation, scope) && !scopedConversationIds.has(conversation.id)
  );

  const combined = [...scopedConversations, ...retainedConversations];
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(combined));
    } catch {}
  }

  pendingConversationsToSave = combined;
  if (conversationSaveTimer) {
    clearTimeout(conversationSaveTimer);
  }
  conversationSaveTimer = setTimeout(() => {
    flushPendingConversations();
  }, 300);
}

function saveScopedProjects(projects: OrgProject[]): void {
  const scope = globalState.activeScope;
  projectsByScope[scope] = projects;
  const scopedProjects = projects
    .filter((project) => belongsToScope(project, scope))
    .map((project) => ({ ...project, mode: project.mode ?? scope }));
  const scopedProjectIds = new Set(scopedProjects.map((project) => project.id));
  const retainedProjects = loadStored<OrgProject[]>(STORAGE_KEYS.PROJECTS, () => []).filter(
    (project) => !belongsToScope(project, scope) && !scopedProjectIds.has(project.id)
  );

  const combined = [...scopedProjects, ...retainedProjects];
  saveStored(STORAGE_KEYS.PROJECTS, combined);
  ipcBridge.org.saveProjects({ projects: scopedProjects, mode: scope }).catch((err) => {
    console.warn('[useOrgStore] Failed to persist projects:', err);
  });
}

function notify() {
  const snapshot = { ...globalState };
  listeners.forEach((l) => l(snapshot));
}

function persistHierarchyAndProjects(
  next: Pick<OrgStoreState, 'hierarchy' | 'projects'>,
  _mode: 'workplace' | 'organization'
) {
  saveStored(STORAGE_KEYS.HIERARCHY, next.hierarchy);
  saveScopedProjects(next.projects);
}

/**
 * Re-validates stored department and project workspace paths against their
 * allowed parent roots. Any path outside its boundary is flagged with status 'error'
 * or 'dormant'.
 */
export async function revalidateStoredPaths(
  hierarchy: OrgHierarchy,
  projects: OrgProject[]
): Promise<{ hierarchy: OrgHierarchy; projects: OrgProject[]; changed: boolean }> {
  const masterRoot = hierarchy.rootCeo.workspacePath;
  let changed = false;

  for (const dept of hierarchy.departments) {
    if (dept.workspacePath) {
      if (!masterRoot) {
        dept.status = 'error';
        dept.departmentCeoAgent.status = 'error';
        changed = true;
      } else {
        const check = await validateOrgFolder(dept.workspacePath, masterRoot, 'department');
        if (!check.valid) {
          dept.status = 'error';
          dept.departmentCeoAgent.status = 'error';
          changed = true;
        } else if (check.resolvedPath && check.resolvedPath !== dept.workspacePath) {
          dept.workspacePath = check.resolvedPath;
          dept.departmentCeoAgent.workspacePath = check.resolvedPath;
          changed = true;
        }
      }
    }
    if (!masterRoot) continue;
    for (const team of dept.teams) {
      const requestedPaths = team.workspacePaths?.length
        ? team.workspacePaths
        : team.workspacePath
          ? [team.workspacePath]
          : [];
      const validPaths: string[] = [];
      for (const folderPath of requestedPaths) {
        const check = await validateOrgFolder(folderPath, masterRoot, 'team');
        if (!check.valid) {
          changed = true;
        } else if (check.resolvedPath) {
          validPaths.push(check.resolvedPath);
          if (check.resolvedPath !== folderPath) changed = true;
        }
      }
      if (validPaths.length > 0 || requestedPaths.length > 0) {
        team.workspacePaths = validPaths;
        team.workspacePath = validPaths[0] || null;
      }
    }
  }

  for (const proj of projects) {
    const requestedPaths = proj.workspacePaths?.length
      ? proj.workspacePaths
      : proj.workspacePath || proj.path
        ? [proj.workspacePath || proj.path || '']
        : [];
    if (requestedPaths.length > 0) {
      const dept = hierarchy.departments.find((d) => d.id === proj.departmentId);
      const parentRoot = dept?.workspacePath || masterRoot;
      if (!parentRoot) {
        proj.status = 'dormant';
        changed = true;
      } else {
        const validPaths: string[] = [];
        for (const folderPath of requestedPaths) {
          const check = await validateOrgFolder(folderPath, parentRoot, 'project');
          if (!check.valid) {
            proj.status = 'dormant';
            changed = true;
          } else if (check.resolvedPath) {
            validPaths.push(check.resolvedPath);
            if (check.resolvedPath !== folderPath) changed = true;
          }
        }
        proj.workspacePaths = validPaths;
        proj.workspacePath = validPaths[0] || null;
        proj.path = validPaths[0] || undefined;
      }
    }
  }

  return { hierarchy, projects, changed };
}

export const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes of inactivity

const nodeActivityTimestamps = new Map<string, number>();
const nodeResetTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function resolveRelatedOrgIds(nodeId: string, hierarchy: OrgHierarchy): Set<string> {
  let canonicalId: string | null = null;
  const idsToUpdate = new Set<string>([nodeId]);

  // Check Root CEO
  if (
    hierarchy.rootCeo.id === nodeId ||
    hierarchy.rootCeo.ceoAgent.id === nodeId ||
    hierarchy.rootCeo.ceoAgent.canonicalAgentId === nodeId
  ) {
    idsToUpdate.add(hierarchy.rootCeo.id);
    idsToUpdate.add(hierarchy.rootCeo.ceoAgent.id);
    if (hierarchy.rootCeo.ceoAgent.canonicalAgentId) {
      idsToUpdate.add(hierarchy.rootCeo.ceoAgent.canonicalAgentId);
    }
  }

  // Check Department CEOs & Teams & Members
  hierarchy.departments.forEach((dept) => {
    if (dept.id === nodeId || dept.departmentCeoAgent.id === nodeId) {
      idsToUpdate.add(dept.id);
      idsToUpdate.add(dept.departmentCeoAgent.id);
    }
    dept.teams.forEach((team) => {
      if (team.id === nodeId || team.teamLeadAgent.id === nodeId) {
        idsToUpdate.add(team.id);
        idsToUpdate.add(team.teamLeadAgent.id);
      }
      team.specialistMembers.forEach((spec) => {
        if (spec.id === nodeId) {
          idsToUpdate.add(spec.id);
        } else if (spec.canonicalAgentId === nodeId && !spec.backendSlotId) {
          idsToUpdate.add(spec.id);
          if (spec.canonicalAgentId) {
            canonicalId = spec.canonicalAgentId;
            idsToUpdate.add(spec.canonicalAgentId);
          }
        }
      });
    });
  });

  // If canonicalId was found, update all instances of that member in all teams that don't have separate slots
  if (canonicalId) {
    hierarchy.departments.forEach((dept) => {
      dept.teams.forEach((team) => {
        team.specialistMembers.forEach((spec) => {
          if (spec.canonicalAgentId === canonicalId && !spec.backendSlotId) {
            idsToUpdate.add(spec.id);
          }
        });
      });
    });
  }

  return idsToUpdate;
}

function scheduleNodeInactivityCheck(targetId: string) {
  if (nodeResetTimers.has(targetId)) {
    clearTimeout(nodeResetTimers.get(targetId)!);
    nodeResetTimers.delete(targetId);
  }

  const timer = setTimeout(
    () => {
      const lastActivity = nodeActivityTimestamps.get(targetId) || 0;
      const elapsed = Date.now() - lastActivity;

      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        nodeResetTimers.delete(targetId);
        if (globalState.nodeStatuses[targetId] === 'working') {
          globalState = {
            ...globalState,
            nodeStatuses: {
              ...globalState.nodeStatuses,
              [targetId]: 'idle',
            },
          };
          notify();
        }
      } else {
        // Re-schedule for remaining time
        scheduleNodeInactivityCheck(targetId);
      }
    },
    Math.max(1000, INACTIVITY_TIMEOUT_MS - (Date.now() - (nodeActivityTimestamps.get(targetId) || 0)))
  );

  nodeResetTimers.set(targetId, timer);
}

export function touchNodeActivity(nodeId: string): void {
  const ids = resolveRelatedOrgIds(nodeId, globalState.hierarchy);
  const now = Date.now();
  ids.forEach((id) => {
    nodeActivityTimestamps.set(id, now);
    if (globalState.nodeStatuses[id] === 'working') {
      scheduleNodeInactivityCheck(id);
    }
  });
}

export function getNodeLastActivity(nodeId: string): number | undefined {
  return nodeActivityTimestamps.get(nodeId);
}

// Subscribe to IPC cron job execution events
try {
  ipcBridge.cron?.onJobExecuted?.on?.((event) => {
    const job = globalState.cronJobs.find((c) => c.id === event.job_id);
    if (!job) return;

    const dept = globalState.hierarchy.departments.find((d) => d.id === job.departmentId);
    const affectedIds = new Set<string>();
    affectedIds.add(globalState.hierarchy.rootCeo.id);
    affectedIds.add(globalState.hierarchy.rootCeo.ceoAgent.id);

    if (dept) {
      affectedIds.add(dept.id);
      affectedIds.add(dept.departmentCeoAgent.id);
      if (dept.teams.length > 0) {
        affectedIds.add(dept.teams[0].id);
        affectedIds.add(dept.teams[0].teamLeadAgent.id);
        if (dept.teams[0].specialistMembers.length > 0) {
          affectedIds.add(dept.teams[0].specialistMembers[0].id);
        }
      }
    }

    if (event.status === 'ok') {
      const nextStatuses = { ...globalState.nodeStatuses };
      affectedIds.forEach((id) => {
        nextStatuses[id] = 'recently_finished';
      });
      globalState = { ...globalState, nodeStatuses: nextStatuses };
      notify();

      setTimeout(() => {
        let changed = false;
        const resetStatuses = { ...globalState.nodeStatuses };
        affectedIds.forEach((id) => {
          if (resetStatuses[id] === 'recently_finished') {
            resetStatuses[id] = 'idle';
            changed = true;
          }
        });
        if (changed) {
          globalState = { ...globalState, nodeStatuses: resetStatuses };
          notify();
        }
      }, 2000);
    } else if (event.status === 'error') {
      const nextStatuses = { ...globalState.nodeStatuses };
      affectedIds.forEach((id) => {
        nextStatuses[id] = 'error';
      });
      globalState = { ...globalState, nodeStatuses: nextStatuses };
      notify();
    }
  });
} catch (err) {
  console.warn('[useOrgStore] Cron execution subscription warning:', err);
}

export function setOrgNodeStatus(nodeId: string, status: OrgNodeStatus, durationMs = 2000): void {
  const idsToUpdate = resolveRelatedOrgIds(nodeId, globalState.hierarchy);

  const nextStatuses = { ...globalState.nodeStatuses };
  idsToUpdate.forEach((id) => {
    nextStatuses[id] = status;
  });

  globalState = {
    ...globalState,
    nodeStatuses: nextStatuses,
  };
  notify();

  // Auto-transition 'recently_finished' -> 'idle' after durationMs
  if (status === 'recently_finished') {
    idsToUpdate.forEach((id) => {
      if (nodeResetTimers.has(id)) {
        clearTimeout(nodeResetTimers.get(id)!);
        nodeResetTimers.delete(id);
      }
    });

    const timer = setTimeout(() => {
      let needsReset = false;
      const resetStatuses = { ...globalState.nodeStatuses };
      idsToUpdate.forEach((id) => {
        if (resetStatuses[id] === 'recently_finished') {
          resetStatuses[id] = 'idle';
          needsReset = true;
        }
      });
      if (needsReset) {
        globalState = {
          ...globalState,
          nodeStatuses: resetStatuses,
        };
        notify();
      }
    }, durationMs);

    idsToUpdate.forEach((id) => {
      nodeResetTimers.set(id, timer);
    });
  } else if (status === 'working') {
    const now = Date.now();
    idsToUpdate.forEach((id) => {
      nodeActivityTimestamps.set(id, now);
      scheduleNodeInactivityCheck(id);
    });
  } else {
    // Status is idle/error/dormant/etc. Cancel any pending inactivity reset timer
    idsToUpdate.forEach((id) => {
      if (nodeResetTimers.has(id)) {
        clearTimeout(nodeResetTimers.get(id)!);
        nodeResetTimers.delete(id);
      }
    });
  }
}

export function updateMemberBackendSlotId(memberId: string, slotId: string): void {
  let changed = false;

  const nextDepartments = globalState.hierarchy.departments.map((dept) => {
    let deptChanged = false;
    let deptCeo = dept.departmentCeoAgent;
    if (deptCeo && (deptCeo.id === memberId || deptCeo.canonicalAgentId === memberId)) {
      deptCeo = { ...deptCeo, backendSlotId: slotId };
      deptChanged = true;
    }

    const nextTeams = dept.teams.map((team) => {
      let teamChanged = false;
      let lead = team.teamLeadAgent;
      let hr = team.hrCoordinatorAgent;
      if (lead && (lead.id === memberId || lead.canonicalAgentId === memberId)) {
        lead = { ...lead, backendSlotId: slotId };
        teamChanged = true;
      }
      if (hr && (hr.id === memberId || hr.canonicalAgentId === memberId)) {
        hr = { ...hr, backendSlotId: slotId };
        teamChanged = true;
      }

      const nextSpecs = team.specialistMembers.map((spec) => {
        if (spec.id === memberId || spec.canonicalAgentId === memberId) {
          teamChanged = true;
          return { ...spec, backendSlotId: slotId };
        }
        return spec;
      });

      if (teamChanged) {
        deptChanged = true;
        return {
          ...team,
          teamLeadAgent: lead,
          hrCoordinatorAgent: hr,
          specialistMembers: nextSpecs,
          members: team.members?.map((m) =>
            m.id === memberId || m.canonicalAgentId === memberId ? { ...m, backendSlotId: slotId } : m
          ),
        };
      }
      return team;
    });

    if (deptChanged) {
      changed = true;
      return {
        ...dept,
        departmentCeoAgent: deptCeo,
        teams: nextTeams,
      };
    }
    return dept;
  });

  let nextRootCeo = globalState.hierarchy.rootCeo;
  if (nextRootCeo.ceoAgent.id === memberId || nextRootCeo.ceoAgent.canonicalAgentId === memberId) {
    nextRootCeo = {
      ...nextRootCeo,
      ceoAgent: { ...nextRootCeo.ceoAgent, backendSlotId: slotId },
    };
    changed = true;
  }

  const nextMembers = (globalState.members || []).map((m) => {
    if (m.id === memberId || m.canonicalAgentId === memberId) {
      changed = true;
      return { ...m, backendSlotId: slotId };
    }
    return m;
  });

  if (changed) {
    const nextHierarchy: OrgHierarchy = {
      ...globalState.hierarchy,
      departments: nextDepartments,
      rootCeo: nextRootCeo,
      lastUpdated: Date.now(),
    };
    globalState = {
      ...globalState,
      hierarchy: nextHierarchy,
      members: nextMembers,
    };
    saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
    saveStored(STORAGE_KEYS.MEMBERS, nextMembers);
    notify();
  }
}

export function addTeamMember(teamId: string, member: OrgAgentMember): void {
  let modified = false;
  const nextDepartments = globalState.hierarchy.departments.map((department) => ({
    ...department,
    teams: department.teams.map((team) => {
      if (team.id === teamId || team.backendTeamId === teamId) {
        const alreadyExists = (team.specialistMembers || []).some(
          (m) =>
            m.id === member.id ||
            (member.backendSlotId && m.backendSlotId === member.backendSlotId) ||
            (!member.backendSlotId && member.canonicalAgentId && m.canonicalAgentId === member.canonicalAgentId)
        );
        if (alreadyExists) {
          return team;
        }
        modified = true;
        const nextSpecs = [...(team.specialistMembers || []), member];
        return {
          ...team,
          specialistMembers: nextSpecs,
          ...(team.members ? { members: [...team.members, member] } : {}),
        };
      }
      return team;
    }),
  }));

  if (modified) {
    const nextHierarchy = {
      ...globalState.hierarchy,
      lastUpdated: Date.now(),
      departments: nextDepartments,
    };
    const nextProjects = globalState.projects.map((project) =>
      project.teamIds?.includes(teamId) ? addProjectMemberSource(project, member.id, teamId) : project
    );
    globalState = { ...globalState, hierarchy: nextHierarchy, projects: nextProjects };
    persistHierarchyAndProjects({ hierarchy: nextHierarchy, projects: nextProjects }, globalState.activeScope);
    void memberHandbook
      .create({
        memberKey: `org:${member.id}`,
        memberName: member.name,
        role: member.role,
        seedPrompt: member.systemPrompt,
        model: member.model?.modelId,
      })
      .catch((err) => {
        console.warn('[useOrgStore] Failed to create handbook for org member:', member.name, err);
      });
    notify();
  }
}

export function removeTeamMember(teamId: string, slotOrMemberId: string): boolean {
  let removedMemberId: string | undefined;
  let modified = false;
  const nextDepartments = globalState.hierarchy.departments.map((department) => ({
    ...department,
    teams: department.teams.map((team) => {
      if (team.id === teamId || team.backendTeamId === teamId) {
        const remainingSpecs = (team.specialistMembers || []).filter((m) => {
          const match =
            m.id === slotOrMemberId || m.backendSlotId === slotOrMemberId || m.canonicalAgentId === slotOrMemberId;
          if (match) removedMemberId = m.id;
          return !match;
        });
        if (remainingSpecs.length !== (team.specialistMembers || []).length) {
          modified = true;
        }
        const remainingMembers = team.members?.filter((m) => {
          const match =
            m.id === slotOrMemberId || m.backendSlotId === slotOrMemberId || m.canonicalAgentId === slotOrMemberId;
          if (match) removedMemberId = m.id;
          return !match;
        });
        return {
          ...team,
          specialistMembers: remainingSpecs,
          ...(team.members ? { members: remainingMembers } : {}),
        };
      }
      return team;
    }),
  }));

  if (modified) {
    const nextHierarchy = {
      ...globalState.hierarchy,
      lastUpdated: Date.now(),
      departments: nextDepartments,
    };
    const nextProjects = removedMemberId
      ? globalState.projects.map((project) =>
          project.teamIds?.includes(teamId) ? removeProjectMemberSource(project, removedMemberId!, teamId) : project
        )
      : globalState.projects;
    globalState = { ...globalState, hierarchy: nextHierarchy, projects: nextProjects };
    persistHierarchyAndProjects({ hierarchy: nextHierarchy, projects: nextProjects }, globalState.activeScope);
    if (removedMemberId) {
      void memberHandbook.delete({ memberKey: `org:${removedMemberId}`, archive: true }).catch((err) => {
        console.warn('[useOrgStore] Failed to archive handbook for removed member:', removedMemberId, err);
      });
    }
    notify();
  }
  return modified;
}

let hydrationPromise: Promise<void> | null = null;

async function syncFromPersistentStore(): Promise<void> {
  try {
    const mode = globalState.activeScope;
    const [hierRaw, projRaw, convRaw] = await Promise.all([
      ipcBridge.org.loadData(STORAGE_KEYS.HIERARCHY),
      ipcBridge.org.getProjects({ mode }),
      ipcBridge.org.loadData(STORAGE_KEYS.CONVERSATIONS),
    ]);
    let changed = false;
    let nextHierarchy = globalState.hierarchy;
    let nextProjects = globalState.projects;
    let nextConversations = globalState.conversations;

    if (hierRaw) {
      try {
        const parsed = JSON.parse(hierRaw);
        if (parsed?.departments && Array.isArray(parsed.departments)) {
          const { merged, hasChanges } = mergeDepartments(globalState.hierarchy.departments, parsed.departments);
          if (hasChanges) {
            nextHierarchy = {
              ...globalState.hierarchy,
              rootCeo: parsed.rootCeo || globalState.hierarchy.rootCeo,
              departments: merged,
              lastUpdated: Date.now(),
            };
            changed = true;
          }
        }
      } catch {}
    }
    if (projRaw && Array.isArray(projRaw)) {
      const backendScopedProjects = (projRaw as OrgProject[]).filter((project) => belongsToScope(project, mode));
      const { merged, hasChanges } = mergeProjects(nextProjects, backendScopedProjects);
      if (hasChanges) {
        nextProjects = merged;
        changed = true;
      }
    }
    if (convRaw) {
      try {
        const parsed = JSON.parse(convRaw);
        if (Array.isArray(parsed)) {
          const backendScopedConvs = (parsed as OrgConversation[]).filter((conversation) =>
            belongsToScope(conversation, mode)
          );
          const { merged, hasChanges } = mergeConversations(nextConversations, backendScopedConvs);
          if (hasChanges) {
            nextConversations = merged;
            changed = true;
          }
        }
      } catch {}
    }

    projectsByScope[mode] = nextProjects;
    conversationsByScope[mode] = nextConversations;

    if (changed) {
      const persistedSelection = loadStored<string | null>(STORAGE_KEYS.SELECTED_CONVERSATION, () => null);
      const selectedConversationId = nextConversations.some((conversation) => conversation.id === persistedSelection)
        ? persistedSelection
        : (nextConversations[0]?.id ?? null);
      globalState = {
        ...globalState,
        hierarchy: nextHierarchy,
        projects: nextProjects,
        conversations: nextConversations,
        selectedConversationId,
      };
      saveStored(STORAGE_KEYS.SELECTED_CONVERSATION, selectedConversationId);
      notify();
    }
  } catch (err) {
    console.warn('[useOrgStore] Backend sync notice:', err);
  }
}

export function useOrgStore() {
  const [state, setState] = useState<OrgStoreState>(globalState);

  useEffect(() => {
    listeners.add(setState);

    if (!hydrationPromise) {
      hydrationPromise = syncFromPersistentStore();
    }

    return () => {
      listeners.delete(setState);
    };
  }, []);

  const setActiveScope = useCallback((scope: OrgScope) => {
    const previousMode = globalState.activeScope;
    if (previousMode === scope) return;

    lastActiveConversationByScope[previousMode] = globalState.selectedConversationId;

    const restoredSelection = lastActiveConversationByScope[scope];
    const newScopeConversations = conversationsByScope[scope] || [];
    const validSelection = newScopeConversations.some((c) => c.id === restoredSelection)
      ? restoredSelection
      : (newScopeConversations[0]?.id ?? null);

    globalState = {
      ...globalState,
      activeScope: scope,
      projects: projectsByScope[scope] || [],
      conversations: newScopeConversations,
      selectedConversationId: validSelection,
      selectedDepartmentId: null,
      selectedTeamId: null,
      selectedProjectId: null,
      focusedNodeId: scope === 'organization' ? 'root-ceo' : null,
    };

    try {
      localStorage.setItem(STORAGE_KEYS.SCOPE, scope);
      localStorage.setItem(STORAGE_KEYS.SELECTED_CONVERSATION, JSON.stringify(validSelection));
    } catch {}

    notify();

    // If mode changed, refresh data from backend for the new mode and merge safely
    const reloadDataForMode = async () => {
      try {
        const [projRaw, convRaw] = await Promise.all([
          ipcBridge.org.getProjects({ mode: scope }),
          ipcBridge.org.loadData(STORAGE_KEYS.CONVERSATIONS),
        ]);
        let changed = false;
        let mergedProjects = projectsByScope[scope] || [];
        let mergedConversations = conversationsByScope[scope] || [];

        if (projRaw && Array.isArray(projRaw)) {
          const backendScopedProjects = (projRaw as OrgProject[]).filter((project) => belongsToScope(project, scope));
          const { merged, hasChanges } = mergeProjects(mergedProjects, backendScopedProjects);
          if (hasChanges) {
            mergedProjects = merged;
            changed = true;
          }
        }
        if (convRaw) {
          try {
            const parsed = JSON.parse(convRaw);
            if (Array.isArray(parsed)) {
              const backendScopedConvs = (parsed as OrgConversation[]).filter((conversation) =>
                belongsToScope(conversation, scope)
              );
              const { merged, hasChanges } = mergeConversations(mergedConversations, backendScopedConvs);
              if (hasChanges) {
                mergedConversations = merged;
                changed = true;
              }
            }
          } catch {}
        }

        if (changed) {
          projectsByScope[scope] = mergedProjects;
          conversationsByScope[scope] = mergedConversations;
          if (globalState.activeScope === scope) {
            globalState = {
              ...globalState,
              projects: mergedProjects,
              conversations: mergedConversations,
            };
            notify();
          }
        }
      } catch (err) {
        console.warn('[useOrgStore] Failed to reload data for mode:', scope, err);
      }
    };
    void reloadDataForMode();
  }, []);

  const updateNodeStatus = useCallback((nodeId: string, status: OrgNodeStatus, durationMs?: number) => {
    setOrgNodeStatus(nodeId, status, durationMs);
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
    saveStored(STORAGE_KEYS.SELECTED_CONVERSATION, id);
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
    persistHierarchyAndProjects(reconciled, globalState.activeScope);
    saveStored(STORAGE_KEYS.CONVERSATIONS, defConversations);
    saveStored(STORAGE_KEYS.CRON_JOBS, defCron);
    notify();
  }, []);

  const addDepartment = useCallback(async (dept: OrgDepartmentNode) => {
    return enqueueOrgMutation(async () => {
      let finalDept = dept;
      let masterRoot = globalState.hierarchy.rootCeo.workspacePath;
      if (!masterRoot) {
        try {
          masterRoot = (await ipcBridge.org.getMasterRoot()) || undefined;
        } catch {
          masterRoot = undefined;
        }
      }

      if (dept.workspacePath) {
        if (!masterRoot) {
          finalDept = {
            ...dept,
            workspacePath: undefined,
            status: 'error',
            departmentCeoAgent: { ...dept.departmentCeoAgent, workspacePath: undefined, status: 'error' },
          };
        } else {
          const check = await validateOrgFolder(dept.workspacePath, masterRoot, 'department');
          if (!check.valid) {
            finalDept = {
              ...dept,
              workspacePath: undefined,
              status: 'error',
              departmentCeoAgent: { ...dept.departmentCeoAgent, workspacePath: undefined, status: 'error' },
            };
          } else if (check.resolvedPath) {
            finalDept = {
              ...dept,
              workspacePath: check.resolvedPath,
              departmentCeoAgent: { ...dept.departmentCeoAgent, workspacePath: check.resolvedPath },
            };
          }
        }
      }
      const nextHierarchy = syncHierarchyProjectReferences(
        {
          ...globalState.hierarchy,
          departments: [
            ...globalState.hierarchy.departments,
            { ...finalDept, linkedProjects: finalDept.linkedProjects ?? [] },
          ],
          lastUpdated: Date.now(),
        },
        globalState.projects
      );
      globalState = { ...globalState, hierarchy: nextHierarchy };
      saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
      notify();
    });
  }, []);

  const removeDepartment = useCallback((departmentId: string): boolean => {
    const dept = globalState.hierarchy.departments.find((d) => d.id === departmentId);
    if (!dept) return false;
    const teamIds = new Set(dept.teams.map((team) => team.id));
    const projectIds = new Set(
      globalState.projects.filter((project) => project.departmentId === departmentId).map((p) => p.id)
    );
    const removedCronJobs = globalState.cronJobs.filter((job) => job.departmentId === departmentId);
    const nextHierarchy = {
      ...globalState.hierarchy,
      departments: globalState.hierarchy.departments.filter((d) => d.id !== departmentId),
      lastUpdated: Date.now(),
    };
    const nextProjects = globalState.projects.filter((project) => !projectIds.has(project.id));
    const departmentNodeIds = new Set([departmentId, dept.departmentCeoAgent.id]);
    const nextConversations = globalState.conversations.filter(
      (conversation) =>
        !projectIds.has(conversation.projectId ?? '') &&
        !teamIds.has(conversation.teamId ?? '') &&
        !departmentNodeIds.has(conversation.targetNodeId)
    );
    const nextCronJobs = globalState.cronJobs.filter((job) => job.departmentId !== departmentId);
    const nextSelection = nextConversations.some(
      (conversation) => conversation.id === globalState.selectedConversationId
    )
      ? globalState.selectedConversationId
      : (nextConversations[0]?.id ?? null);
    globalState = {
      ...globalState,
      hierarchy: nextHierarchy,
      projects: nextProjects,
      conversations: nextConversations,
      cronJobs: nextCronJobs,
      selectedConversationId: nextSelection,
      selectedDepartmentId: globalState.selectedDepartmentId === departmentId ? null : globalState.selectedDepartmentId,
      selectedTeamId:
        globalState.selectedTeamId && teamIds.has(globalState.selectedTeamId) ? null : globalState.selectedTeamId,
      selectedProjectId:
        globalState.selectedProjectId && projectIds.has(globalState.selectedProjectId)
          ? null
          : globalState.selectedProjectId,
    };
    saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
    persistHierarchyAndProjects({ hierarchy: nextHierarchy, projects: nextProjects }, globalState.activeScope);
    saveScopedConversations(nextConversations);
    saveStored(STORAGE_KEYS.CRON_JOBS, nextCronJobs);
    saveStored(STORAGE_KEYS.SELECTED_CONVERSATION, nextSelection);
    removedCronJobs.forEach((job) => {
      void ipcBridge.cron.removeJob.invoke({ job_id: job.id }).catch(() => {});
    });
    notify();
    return true;
  }, []);

  const removeOrgTeam = useCallback((teamId: string): boolean => {
    const department = globalState.hierarchy.departments.find((item) => item.teams.some((team) => team.id === teamId));
    if (!department) return false;
    const nextHierarchy = {
      ...globalState.hierarchy,
      departments: globalState.hierarchy.departments.map((item) => ({
        ...item,
        teams: item.teams.filter((team) => team.id !== teamId),
      })),
      lastUpdated: Date.now(),
    };
    const nextProjects = globalState.projects.map((project) => {
      const withoutTeam = { ...project, teamIds: (project.teamIds ?? []).filter((id) => id !== teamId) };
      const memberSources = withoutTeam.memberSources;
      if (!memberSources) return withoutTeam;
      return Object.keys(memberSources).reduce(
        (next, memberId) => removeProjectMemberSource(next, memberId, teamId),
        withoutTeam
      );
    });
    const nextConversations = globalState.conversations.filter((conversation) => conversation.teamId !== teamId);
    const nextSelection = nextConversations.some(
      (conversation) => conversation.id === globalState.selectedConversationId
    )
      ? globalState.selectedConversationId
      : (nextConversations[0]?.id ?? null);
    const coherentHierarchy = syncHierarchyProjectReferences(nextHierarchy, nextProjects);
    globalState = {
      ...globalState,
      hierarchy: coherentHierarchy,
      projects: nextProjects,
      conversations: nextConversations,
      selectedConversationId: nextSelection,
      selectedTeamId: globalState.selectedTeamId === teamId ? null : globalState.selectedTeamId,
      selectedProjectId:
        globalState.selectedProjectId && !nextProjects.some((project) => project.id === globalState.selectedProjectId)
          ? null
          : globalState.selectedProjectId,
    };
    persistHierarchyAndProjects({ hierarchy: coherentHierarchy, projects: nextProjects }, globalState.activeScope);
    saveScopedConversations(nextConversations);
    saveStored(STORAGE_KEYS.SELECTED_CONVERSATION, nextSelection);
    notify();
    return true;
  }, []);

  const archiveDepartment = useCallback(
    (departmentId: string): boolean => {
      return removeDepartment(departmentId);
    },
    [removeDepartment]
  );

  const updateDepartment = useCallback(async (departmentId: string, patch: Partial<OrgDepartmentNode>) => {
    return enqueueOrgMutation(async () => {
      let finalPatch = patch;
      let masterRoot = globalState.hierarchy.rootCeo.workspacePath;
      if (!masterRoot) {
        try {
          masterRoot = (await ipcBridge.org.getMasterRoot()) || undefined;
        } catch {
          masterRoot = undefined;
        }
      }

      if (patch.workspacePath) {
        if (!masterRoot) {
          finalPatch = { ...patch, workspacePath: undefined, status: 'error' };
        } else {
          const check = await validateOrgFolder(patch.workspacePath, masterRoot, 'department');
          if (!check.valid) {
            finalPatch = { ...patch, workspacePath: undefined, status: 'error' };
          } else if (check.resolvedPath) {
            finalPatch = { ...patch, workspacePath: check.resolvedPath };
          }
        }
      }
      if ('workspacePath' in finalPatch) {
        const department = globalState.hierarchy.departments.find((item) => item.id === departmentId);
        if (department) {
          finalPatch = {
            ...finalPatch,
            departmentCeoAgent: {
              ...(finalPatch.departmentCeoAgent ?? department.departmentCeoAgent),
              workspacePath: finalPatch.workspacePath ?? undefined,
            },
          };
        }
      }
      const nextHierarchy = syncHierarchyProjectReferences(
        updateDepartmentInHierarchy(globalState.hierarchy, departmentId, finalPatch),
        globalState.projects
      );
      globalState = { ...globalState, hierarchy: nextHierarchy };
      saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
      notify();
    });
  }, []);

  const addSubTeam = useCallback((departmentId: string, team: OrgTeamNode) => {
    const targetDept = globalState.hierarchy.departments.find((d) => d.id === departmentId);
    if (targetDept?.teams.some((t) => t.name.trim().toLowerCase() === team.name.trim().toLowerCase())) {
      console.warn(`[useOrgStore] Team "${team.name}" already exists in department "${departmentId}".`);
      return;
    }
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
    const previousTeam = globalState.hierarchy.departments
      .flatMap((department) => department.teams)
      .find((team) => team.id === teamId);
    const nextHierarchy = syncHierarchyProjectReferences(
      updateTeamInHierarchy(globalState.hierarchy, teamId, patch),
      globalState.projects
    );
    const pathsChanged =
      patch.workspacePaths !== undefined &&
      JSON.stringify(
        previousTeam?.workspacePaths ?? (previousTeam?.workspacePath ? [previousTeam.workspacePath] : [])
      ) !== JSON.stringify(patch.workspacePaths);
    const nextConversations = pathsChanged
      ? globalState.conversations.map((conversation) =>
          conversation.teamId === teamId ? { ...conversation, backendConversationId: undefined } : conversation
        )
      : globalState.conversations;
    globalState = { ...globalState, hierarchy: nextHierarchy, conversations: nextConversations };
    saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
    if (pathsChanged) saveScopedConversations(nextConversations);
    notify();
  }, []);

  const handleAddTeamMember = useCallback((teamId: string, member: OrgAgentMember) => {
    addTeamMember(teamId, member);
  }, []);

  const handleRemoveTeamMember = useCallback((teamId: string, slotOrMemberId: string) => {
    return removeTeamMember(teamId, slotOrMemberId);
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
            const isHr = team.hrCoordinatorAgent?.id === agentId;
            return {
              ...team,
              teamLeadAgent: isTeamLead ? { ...team.teamLeadAgent, model } : team.teamLeadAgent,
              hrCoordinatorAgent:
                isHr && team.hrCoordinatorAgent ? { ...team.hrCoordinatorAgent, model } : team.hrCoordinatorAgent,
              specialistMembers: team.specialistMembers.map((member) =>
                member.id === agentId || member.canonicalAgentId === agentId ? { ...member, model } : member
              ),
            };
          }),
        };
      }),
    };

    const nextMembers = (globalState.members || []).map((m) =>
      m.id === agentId || m.canonicalAgentId === agentId ? { ...m, model } : m
    );

    const nextConversations = globalState.conversations.map((c) =>
      c.targetAgentId === agentId ? { ...c, targetAgentModel: model } : c
    );

    globalState = {
      ...globalState,
      hierarchy: nextHierarchy,
      members: nextMembers,
      conversations: nextConversations,
    };
    saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
    saveStored(STORAGE_KEYS.MEMBERS, nextMembers);
    saveScopedConversations(nextConversations);
    notify();
  }, []);

  const updateTeamMember = useCallback((teamId: string, memberId: string, patch: Partial<OrgAgentMember>) => {
    const nextHierarchy = {
      ...globalState.hierarchy,
      lastUpdated: Date.now(),
      departments: globalState.hierarchy.departments.map((department) => ({
        ...department,
        teams: department.teams.map((team) => {
          if (team.id !== teamId) return team;
          const isLead = team.teamLeadAgent.id === memberId || team.teamLeadAgent.canonicalAgentId === memberId;
          const isHr =
            team.hrCoordinatorAgent &&
            (team.hrCoordinatorAgent.id === memberId || team.hrCoordinatorAgent.canonicalAgentId === memberId);
          return {
            ...team,
            teamLeadAgent: isLead ? { ...team.teamLeadAgent, ...patch, id: team.teamLeadAgent.id } : team.teamLeadAgent,
            hrCoordinatorAgent:
              isHr && team.hrCoordinatorAgent
                ? { ...team.hrCoordinatorAgent, ...patch, id: team.hrCoordinatorAgent.id }
                : team.hrCoordinatorAgent,
            specialistMembers: team.specialistMembers.map((member) =>
              member.id === memberId || member.canonicalAgentId === memberId
                ? { ...member, ...patch, id: member.id }
                : member
            ),
          };
        }),
      })),
    };
    const nextMembers = globalState.members.map((m) =>
      m.id === memberId || m.canonicalAgentId === memberId ? { ...m, ...patch, id: m.id } : m
    );
    globalState = { ...globalState, hierarchy: nextHierarchy, members: nextMembers };
    saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
    saveStored(STORAGE_KEYS.MEMBERS, nextMembers);
    if (patch.name) {
      void memberHandbook
        .rename({
          memberKey: `org:${memberId}`,
          newMemberName: patch.name,
        })
        .catch((err) => {
          console.warn('[useOrgStore] Failed to rename handbook for org member:', memberId, err);
        });
    }
    notify();
  }, []);

  const updateMember = useCallback((memberId: string, patch: Partial<OrgAgentMember>) => {
    const nextHierarchy = {
      ...globalState.hierarchy,
      lastUpdated: Date.now(),
      departments: globalState.hierarchy.departments.map((department) => ({
        ...department,
        teams: department.teams.map((team) => {
          const isLead = team.teamLeadAgent.id === memberId || team.teamLeadAgent.canonicalAgentId === memberId;
          const isHr =
            team.hrCoordinatorAgent &&
            (team.hrCoordinatorAgent.id === memberId || team.hrCoordinatorAgent.canonicalAgentId === memberId);
          const hasMember = team.specialistMembers.some((m) => m.id === memberId || m.canonicalAgentId === memberId);
          if (!isLead && !isHr && !hasMember) return team;
          return {
            ...team,
            teamLeadAgent: isLead ? { ...team.teamLeadAgent, ...patch, id: team.teamLeadAgent.id } : team.teamLeadAgent,
            hrCoordinatorAgent:
              isHr && team.hrCoordinatorAgent
                ? { ...team.hrCoordinatorAgent, ...patch, id: team.hrCoordinatorAgent.id }
                : team.hrCoordinatorAgent,
            specialistMembers: team.specialistMembers.map((member) =>
              member.id === memberId || member.canonicalAgentId === memberId
                ? { ...member, ...patch, id: member.id }
                : member
            ),
          };
        }),
      })),
    };
    const nextMembers = globalState.members.map((m) =>
      m.id === memberId || m.canonicalAgentId === memberId ? { ...m, ...patch, id: m.id } : m
    );
    globalState = { ...globalState, hierarchy: nextHierarchy, members: nextMembers };
    saveStored(STORAGE_KEYS.HIERARCHY, nextHierarchy);
    saveStored(STORAGE_KEYS.MEMBERS, nextMembers);
    if (patch.name) {
      void memberHandbook
        .rename({
          memberKey: `org:${memberId}`,
          newMemberName: patch.name,
        })
        .catch((err) => {
          console.warn('[useOrgStore] Failed to rename handbook for org member:', memberId, err);
        });
    }
    notify();
  }, []);

  const addOrgConversation = useCallback((conv: OrgConversation) => {
    const activeScope = globalState.activeScope;
    const conversation: OrgConversation = {
      ...conv,
      mode: conv.mode ?? activeScope,
      ...(conv.createdAt !== undefined ? { createdAt: conv.createdAt } : {}),
      ...(conv.updatedAt !== undefined ? { updatedAt: conv.updatedAt } : {}),
    };
    const nextConversations = [
      conversation,
      ...globalState.conversations.filter(
        (c) => c.id !== conversation.id && (c.messages.length > 0 || c.id === globalState.selectedConversationId)
      ),
    ];
    conversationsByScope[activeScope] = nextConversations;
    globalState = { ...globalState, conversations: nextConversations };
    saveScopedConversations(nextConversations);
    notify();
  }, []);

  const upsertOrgProject = useCallback(async (project: OrgProject) => {
    return enqueueOrgMutation(async () => {
      const activeScope = globalState.activeScope;
      const previousProject = globalState.projects.find((item) => item.id === project.id);
      const now = Date.now();
      let finalProj: OrgProject = {
        ...project,
        mode: project.mode ?? activeScope,
        createdAt: project.createdAt ?? previousProject?.createdAt ?? now,
        updatedAt: now,
      };
      let masterRoot = globalState.hierarchy.rootCeo.workspacePath;
      if (!masterRoot) {
        try {
          masterRoot = (await ipcBridge.org.getMasterRoot()) || undefined;
        } catch {
          masterRoot = undefined;
        }
      }
      const dept = globalState.hierarchy.departments.find((d) => d.id === project.departmentId);
      const parentRoot = dept?.workspacePath || masterRoot;

      const requestedPaths = project.workspacePaths?.length
        ? project.workspacePaths
        : project.context?.workspacePaths?.length
          ? project.context.workspacePaths
          : project.workspacePath || project.path
            ? [project.workspacePath || project.path || '']
            : [];
      if (requestedPaths.length > 0) {
        if (!parentRoot) {
          finalProj = {
            ...finalProj,
            workspacePath: undefined,
            workspacePaths: [],
            path: undefined,
            status: 'dormant',
          };
        } else {
          const validPaths: string[] = [];
          for (const folderPath of requestedPaths) {
            const check = await validateOrgFolder(folderPath, parentRoot, 'project');
            if (!check.valid || !check.resolvedPath) {
              finalProj = {
                ...finalProj,
                workspacePath: undefined,
                workspacePaths: [],
                path: undefined,
                status: 'dormant',
              };
              validPaths.length = 0;
              break;
            }
            validPaths.push(check.resolvedPath);
          }
          if (validPaths.length > 0) {
            finalProj = {
              ...finalProj,
              workspacePath: validPaths[0],
              workspacePaths: validPaths,
              path: validPaths[0],
              context: { ...project.context, workspacePaths: validPaths },
            };
          }
        }
      }
      const next = applyProjectMutation(globalState.hierarchy, globalState.projects, normalizeOrgProject(finalProj));
      const pathsChanged =
        previousProject !== undefined &&
        JSON.stringify(
          previousProject.workspacePaths ?? (previousProject.workspacePath ? [previousProject.workspacePath] : [])
        ) !== JSON.stringify(finalProj.workspacePaths ?? (finalProj.workspacePath ? [finalProj.workspacePath] : []));
      const nextConversations = pathsChanged
        ? globalState.conversations.map((conversation) =>
            conversation.projectId === project.id ? { ...conversation, backendConversationId: undefined } : conversation
          )
        : globalState.conversations;
      projectsByScope[activeScope] = next.projects;
      globalState = { ...globalState, ...next, conversations: nextConversations };
      persistHierarchyAndProjects(next, activeScope);
      if (pathsChanged) saveScopedConversations(nextConversations);
      notify();
    });
  }, []);

  const addOrgProject = useCallback(
    async (project: OrgProject) => {
      return upsertOrgProject(project);
    },
    [upsertOrgProject]
  );

  const deleteOrgProject = useCallback((projectId: string) => {
    const activeScope = globalState.activeScope;
    const next = applyProjectRemoval(globalState.hierarchy, globalState.projects, projectId);
    const nextConversations = globalState.conversations.filter((conversation) => conversation.projectId !== projectId);
    const nextSelection = nextConversations.some(
      (conversation) => conversation.id === globalState.selectedConversationId
    )
      ? globalState.selectedConversationId
      : (nextConversations[0]?.id ?? null);
    projectsByScope[activeScope] = next.projects;
    conversationsByScope[activeScope] = nextConversations;
    globalState = {
      ...globalState,
      ...next,
      conversations: nextConversations,
      selectedConversationId: nextSelection,
      selectedProjectId: globalState.selectedProjectId === projectId ? null : globalState.selectedProjectId,
    };
    persistHierarchyAndProjects(next, activeScope);
    saveScopedConversations(nextConversations);
    saveStored(STORAGE_KEYS.SELECTED_CONVERSATION, nextSelection);
    notify();
  }, []);

  const upsertMember = useCallback((member: OrgAgentMember) => {
    const currentMembers = globalState.members || [];
    const exists = currentMembers.some((m) => m.id === member.id);
    const nextMembers = exists
      ? currentMembers.map((m) => (m.id === member.id ? member : m))
      : [...currentMembers, member];
    globalState = { ...globalState, members: nextMembers };
    saveStored(STORAGE_KEYS.MEMBERS, nextMembers);
    void ipcBridge.org.saveMembers(nextMembers).catch(() => {});
    notify();
  }, []);

  const deleteMember = useCallback((memberId: string) => {
    const currentMembers = globalState.members || [];
    const nextMembers = currentMembers.filter((m) => m.id !== memberId);
    const nextProjects = globalState.projects.map((p) => {
      if (!p.memberIds?.includes(memberId) && !p.memberSources?.[memberId]) return p;
      return removeProjectMemberSource(p, memberId, 'direct');
    });
    globalState = { ...globalState, members: nextMembers, projects: nextProjects };
    saveStored(STORAGE_KEYS.MEMBERS, nextMembers);
    persistHierarchyAndProjects({ hierarchy: globalState.hierarchy, projects: nextProjects }, globalState.activeScope);
    void ipcBridge.org.saveMembers(nextMembers).catch(() => {});
    void memberHandbook.delete({ memberKey: `org:${memberId}`, archive: true }).catch((err) => {
      console.warn('[useOrgStore] Failed to archive handbook for deleted member:', memberId, err);
    });
    notify();
  }, []);

  const reorderDepartments = useCallback((startIndex: number, endIndex: number) => {
    const list = [...globalState.hierarchy.departments];
    if (
      startIndex < 0 ||
      startIndex >= list.length ||
      endIndex < 0 ||
      endIndex >= list.length ||
      startIndex === endIndex
    )
      return;
    const [moved] = list.splice(startIndex, 1);
    list.splice(endIndex, 0, moved);
    const nextHierarchy = { ...globalState.hierarchy, departments: list, lastUpdated: Date.now() };
    globalState = { ...globalState, hierarchy: nextHierarchy };
    persistHierarchyAndProjects({ hierarchy: nextHierarchy, projects: globalState.projects }, globalState.activeScope);
    notify();
  }, []);

  const reorderProjects = useCallback((sourceProjectId: string, targetProjectId: string) => {
    if (sourceProjectId === targetProjectId) return;
    const activeScope = globalState.activeScope;
    const currentProjects = [...globalState.projects];
    const sourceIdx = currentProjects.findIndex((p) => p.id === sourceProjectId);
    const targetIdx = currentProjects.findIndex((p) => p.id === targetProjectId);
    if (sourceIdx < 0 || targetIdx < 0) return;

    const [moved] = currentProjects.splice(sourceIdx, 1);
    const targetProject = currentProjects.find((p) => p.id === targetProjectId);
    if (targetProject && moved.departmentId !== targetProject.departmentId) {
      moved.departmentId = targetProject.departmentId;
    }
    const insertIdx = currentProjects.findIndex((p) => p.id === targetProjectId);
    currentProjects.splice(insertIdx >= 0 ? insertIdx : targetIdx, 0, moved);

    const nextHierarchy = syncHierarchyProjectReferences(globalState.hierarchy, currentProjects);
    projectsByScope[activeScope] = currentProjects;
    globalState = { ...globalState, hierarchy: nextHierarchy, projects: currentProjects };
    persistHierarchyAndProjects({ hierarchy: nextHierarchy, projects: currentProjects }, activeScope);
    notify();
  }, []);

  const assignMemberToProject = useCallback((projectId: string, memberId: string) => {
    const proj = globalState.projects.find((p) => p.id === projectId);
    if (!proj) return;
    const nextProj = addProjectMemberSource(proj, memberId, 'direct');
    if (nextProj === proj) return;
    const nextProjects = globalState.projects.map((p) => (p.id === projectId ? nextProj : p));
    globalState = { ...globalState, projects: nextProjects };
    persistHierarchyAndProjects({ hierarchy: globalState.hierarchy, projects: nextProjects }, globalState.activeScope);
    notify();
  }, []);

  const removeMemberFromProject = useCallback((projectId: string, memberId: string) => {
    const proj = globalState.projects.find((p) => p.id === projectId);
    if (!proj) return;
    const nextProj = removeProjectMemberSource(proj, memberId, 'direct');
    const nextProjects = globalState.projects.map((p) => (p.id === projectId ? nextProj : p));
    globalState = { ...globalState, projects: nextProjects };
    persistHierarchyAndProjects({ hierarchy: globalState.hierarchy, projects: nextProjects }, globalState.activeScope);
    notify();
  }, []);

  const removeMembersFromDepartmentProjects = useCallback((departmentId: string, memberIds: string[]) => {
    const memberIdSet = new Set(memberIds);
    let changed = false;
    const nextProjects = globalState.projects.map((project) => {
      if (project.departmentId !== departmentId) return project;
      const currentMemberIds = project.memberIds || [];
      if (!currentMemberIds.some((id) => memberIdSet.has(id))) return project;
      changed = true;
      return {
        ...project,
        memberIds: currentMemberIds.filter((id) => !memberIdSet.has(id)),
        updatedAt: Date.now(),
      };
    });
    if (!changed) return;
    globalState = { ...globalState, projects: nextProjects };
    persistHierarchyAndProjects({ hierarchy: globalState.hierarchy, projects: nextProjects }, globalState.activeScope);
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

  const runOrgCronJob = useCallback(
    async (jobId: string) => {
      const job = globalState.cronJobs.find((c) => c.id === jobId);
      if (!job) return;

      const dept = globalState.hierarchy.departments.find((d) => d.id === job.departmentId);
      const affectedIds = new Set<string>();

      // CEO
      affectedIds.add(globalState.hierarchy.rootCeo.id);
      affectedIds.add(globalState.hierarchy.rootCeo.ceoAgent.id);

      // Department & Head
      if (dept) {
        affectedIds.add(dept.id);
        affectedIds.add(dept.departmentCeoAgent.id);

        // Primary team and lead
        if (dept.teams.length > 0) {
          const primaryTeam = dept.teams[0];
          affectedIds.add(primaryTeam.id);
          affectedIds.add(primaryTeam.teamLeadAgent.id);
          if (primaryTeam.specialistMembers.length > 0) {
            affectedIds.add(primaryTeam.specialistMembers[0].id);
          }
        }
      }

      // Transition to 'working' and touch activity
      affectedIds.forEach((id) => {
        updateNodeStatus(id, 'working');
        touchNodeActivity(id);
      });

      try {
        await ipcBridge.cron.runNow.invoke({ job_id: jobId });
      } catch (err) {
        console.warn('[useOrgStore] runOrgCronJob invoke notice:', err);
      }

      // Transition to recently_finished, which auto-fades to idle after 2000ms
      affectedIds.forEach((id) => {
        updateNodeStatus(id, 'recently_finished');
      });
    },
    [updateNodeStatus]
  );

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
      globalState.activeScope,
      t,
      globalState.members
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

    const resolvedConv: OrgConversation = {
      ...result.conversation,
      mode: result.conversation.mode ?? globalState.activeScope,
      ...(result.conversation.createdAt !== undefined ? { createdAt: result.conversation.createdAt } : {}),
      ...(result.conversation.updatedAt !== undefined ? { updatedAt: result.conversation.updatedAt } : {}),
    };

    const existingIdx = globalState.conversations.findIndex((c) => c.id === resolvedConv.id);
    let nextConversations: OrgConversation[];
    if (existingIdx >= 0) {
      nextConversations = [...globalState.conversations];
      nextConversations[existingIdx] = {
        ...nextConversations[existingIdx],
        ...resolvedConv,
        messages: nextConversations[existingIdx].messages,
      };
      // move to front
      const [item] = nextConversations.splice(existingIdx, 1);
      nextConversations.unshift(item);
    } else {
      nextConversations = [resolvedConv, ...globalState.conversations];
    }

    const nextState: Partial<OrgStoreState> = {
      hierarchy: nextHierarchy,
      projects: nextProjects,
      conversations: nextConversations,
      selectedConversationId: resolvedConv.id,
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
      nextState.selectedDepartmentId = result.departmentId || globalState.selectedDepartmentId;
      nextState.selectedTeamId = result.teamId || null;
      if (result.projectId) {
        nextState.selectedProjectId = result.projectId;
      }
      nextState.focusedNodeId = target.id;
    } else {
      nextState.selectedDepartmentId = null;
      nextState.selectedTeamId = null;
      nextState.selectedProjectId = null;
      nextState.focusedNodeId = 'root-ceo';
    }

    projectsByScope[globalState.activeScope] = nextProjects;
    conversationsByScope[globalState.activeScope] = nextConversations;
    lastActiveConversationByScope[globalState.activeScope] = resolvedConv.id;

    globalState = { ...globalState, ...(nextState as OrgStoreState) };
    saveStored(STORAGE_KEYS.SELECTED_CONVERSATION, resolvedConv.id);
    persistHierarchyAndProjects({ hierarchy: nextHierarchy, projects: nextProjects }, globalState.activeScope);
    saveScopedConversations(nextConversations);
    notify();
    return { ok: true };
  }, []);

  const recordApprovedLineup = useCallback((lineup: unknown, proposalId?: string, projectId?: string): string => {
    const id = `lineup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const record: ApprovedLineupRecord = {
      id,
      proposalId,
      projectId,
      lineup,
      approvedAt: Date.now(),
    };
    const nextRecords = [record, ...(globalState.approvedLineups || [])].slice(0, 50);
    globalState = {
      ...globalState,
      approvedLineups: nextRecords,
    };
    saveStored(STORAGE_KEYS.APPROVED_LINEUPS, nextRecords);
    notify();
    return id;
  }, []);

  const setAutoApprovePermissions = useCallback((mode: boolean | AutoApprovePermissionsMode) => {
    const finalMode: AutoApprovePermissionsMode = typeof mode === 'boolean' ? (mode ? 'all' : 'off') : mode;
    globalState = {
      ...globalState,
      autoApprovePermissions: finalMode,
    };
    saveStored(STORAGE_KEYS.AUTO_APPROVE_PERMISSIONS, finalMode);
    notify();
  }, []);

  const setActiveFilter = useCallback((filter: 'all' | 'active' | 'dormant' | 'shared') => {
    if (globalState.activeFilter === filter) return;
    globalState = { ...globalState, activeFilter: filter };
    notify();
  }, []);

  return {
    ...state,
    setActiveFilter,
    recordApprovedLineup,
    setAutoApprovePermissions,
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
    removeOrgTeam,
    archiveDepartment,
    updateDepartment,
    addSubTeam,
    updateTeamNode,
    addTeamMember: handleAddTeamMember,
    removeTeamMember: handleRemoveTeamMember,
    updateTeamMember,
    updateMember,
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
    removeMembersFromDepartmentProjects,
    addOrgCronJob,
    removeOrgCronJob,
    toggleCronJob,
    runOrgCronJob,
    touchNodeActivity,
    runSimulation,
    setOrgViewMode,
    setSelectedConversationId,
    openChat,
    clearOpenChatError,
    reorderDepartments,
    reorderProjects,
  };
}

export function getOrgStoreSnapshot(): OrgStoreState {
  return globalState;
}

export function setOrgStoreSnapshot(next: Partial<OrgStoreState>): void {
  globalState = { ...globalState, ...next };
  notify();
}

export function recordApprovedLineupInStore(lineup: unknown, proposalId?: string, projectId?: string): string {
  const id = `lineup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const record: ApprovedLineupRecord = {
    id,
    proposalId,
    projectId,
    lineup,
    approvedAt: Date.now(),
  };
  const nextRecords = [record, ...(globalState.approvedLineups || [])].slice(0, 50);
  globalState = {
    ...globalState,
    approvedLineups: nextRecords,
  };
  saveStored(STORAGE_KEYS.APPROVED_LINEUPS, nextRecords);
  notify();
  return id;
}

export function updateApprovedLineupInStore(recordId: string, patch: Partial<ApprovedLineupRecord>): void {
  const existingRecords = globalState.approvedLineups || [];
  const nextRecords = existingRecords.map((r) => (r.id === recordId ? { ...r, ...patch } : r));
  globalState = {
    ...globalState,
    approvedLineups: nextRecords,
  };
  saveStored(STORAGE_KEYS.APPROVED_LINEUPS, nextRecords);
  notify();
}

export function setAutoApprovePermissionsInStore(mode: boolean | AutoApprovePermissionsMode): void {
  const finalMode: AutoApprovePermissionsMode = typeof mode === 'boolean' ? (mode ? 'all' : 'off') : mode;
  globalState = {
    ...globalState,
    autoApprovePermissions: finalMode,
  };
  saveStored(STORAGE_KEYS.AUTO_APPROVE_PERMISSIONS, finalMode);
  notify();
}

export function resetOrgStoreForTesting(): void {
  hydrationPromise = null;
  globalState = createInitialState();
  listeners.clear();
}
