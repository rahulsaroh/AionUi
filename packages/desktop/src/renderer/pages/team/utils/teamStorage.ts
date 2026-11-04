/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** All per-team localStorage key prefixes (each stored as `${prefix}${team_id}`). */
export const TEAM_STORAGE_PREFIXES = [
  'team-view-mode-',
  'team-member-colors-',
  'team-active-slot-',
  'team-assistant-order-',
  'team-pending-permissions-',
  'team-activity-controls-',
  'team-memory-',
  'team-agent-memory-',
  'team-watchdog-interval-',
] as const;

/**
 * Removes per-team localStorage entries whose team id is not in
 * `existingTeamIds`. Covers both frontend deletion and backend/MCP deletion
 * (WS `team.removed`) paths, and cleans up historically-leaked keys.
 */
export function pruneOrphanTeamStorage(existingTeamIds: string[]): void {
  const alive = new Set(existingTeamIds);
  const toRemove: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const prefix = TEAM_STORAGE_PREFIXES.find((p) => key.startsWith(p));
      if (!prefix) continue;
      const teamId = key.slice(prefix.length);
      if (!alive.has(teamId)) toRemove.push(key);
    }
  } catch {
    return; // storage unavailable
  }
  for (const key of toRemove) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

import type { TTeam } from '@/common/types/team/teamTypes';

export type TeamTreeNode = {
  team: TTeam;
  children: TeamTreeNode[];
  level: number;
};

/**
 * Normalizes a list of teams into a self-referencing hierarchy.
 * Ensures every team has parentId (null if root or missing) and dynamically resolves subTeamIds.
 */
export function normalizeTeamsHierarchy(teams: TTeam[]): TTeam[] {
  const teamIdSet = new Set(teams.map((t) => t.id));

  // First pass: normalize parentId to null if invalid or missing
  const normalized = teams.map((t) => {
    const rawParentId = t.parentId ?? null;
    const validParentId = rawParentId && teamIdSet.has(rawParentId) && rawParentId !== t.id ? rawParentId : null;
    return {
      ...t,
      parentId: validParentId,
    };
  });

  // Second pass: compute subTeamIds from parent references
  const childrenMap = new Map<string, string[]>();
  for (const t of normalized) {
    if (t.parentId) {
      const list = childrenMap.get(t.parentId) ?? [];
      list.push(t.id);
      childrenMap.set(t.parentId, list);
    }
  }

  return normalized.map((t) => {
    const directChildren = childrenMap.get(t.id) ?? [];
    const combined = Array.from(new Set([...(t.subTeamIds ?? []), ...directChildren])).filter((id) =>
      teamIdSet.has(id)
    );
    return {
      ...t,
      subTeamIds: combined,
    };
  });
}

/**
 * Cycle detection guardrail: returns true if setting `newParentId` for `teamId` would create a cycle.
 */
export function wouldCreateCycle(teams: TTeam[], teamId: string, newParentId: string | null | undefined): boolean {
  if (!newParentId || !teamId) return false;
  if (newParentId === teamId) return true;

  const parentMap = new Map<string, string | null>();
  for (const t of teams) {
    parentMap.set(t.id, t.parentId ?? null);
  }

  let curr: string | null = newParentId;
  const visited = new Set<string>();

  while (curr) {
    if (curr === teamId) return true;
    if (visited.has(curr)) return true; // cycle detected
    visited.add(curr);
    curr = parentMap.get(curr) ?? null;
  }

  return false;
}

/**
 * Recursively resolves all descendant team IDs for a given team.
 */
export function getDescendantTeamIds(teams: TTeam[], teamId: string): string[] {
  const childrenMap = new Map<string, string[]>();
  for (const t of teams) {
    if (t.parentId) {
      const list = childrenMap.get(t.parentId) ?? [];
      list.push(t.id);
      childrenMap.set(t.parentId, list);
    }
  }

  const result: string[] = [];
  const queue = [...(childrenMap.get(teamId) ?? [])];
  const visited = new Set<string>(queue);

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    const children = childrenMap.get(current) ?? [];
    for (const child of children) {
      if (!visited.has(child)) {
        visited.add(child);
        queue.push(child);
      }
    }
  }

  return result;
}

/**
 * Automatic workspace path scoping.
 * If child workspace is not explicitly provided, generates child path scoped inside parent workspace.
 */
export function resolveChildWorkspace(
  parentWorkspace: string | undefined | null,
  childName: string,
  explicitWorkspace?: string | null
): string {
  if (explicitWorkspace && explicitWorkspace.trim().length > 0) {
    return explicitWorkspace.trim();
  }
  if (!parentWorkspace || !parentWorkspace.trim()) {
    return '';
  }

  const cleanParent = parentWorkspace.trim().replace(/[/\\]+$/, '');
  const cleanName = childName
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_');

  if (!cleanName) return cleanParent;

  const isWindows = cleanParent.includes('\\') && !cleanParent.includes('/');
  const separator = isWindows ? '\\' : '/';
  return `${cleanParent}${separator}${cleanName}`;
}

/**
 * Cascading delete: deletes the target team and all of its recursive descendant teams.
 */
export async function deleteTeamCascade(
  teams: TTeam[],
  teamId: string,
  deleteTeamFn: (id: string) => Promise<void>
): Promise<string[]> {
  const descendants = getDescendantTeamIds(teams, teamId);
  const toDelete = [teamId, ...descendants];

  for (const id of toDelete) {
    await deleteTeamFn(id);
  }

  return toDelete;
}

/**
 * Builds an N-ary tree from flat teams list for recursive rendering.
 */
export function buildTeamTree(teams: TTeam[]): TeamTreeNode[] {
  const normalized = normalizeTeamsHierarchy(teams);
  const nodeMap = new Map<string, TeamTreeNode>();

  for (const t of normalized) {
    nodeMap.set(t.id, {
      team: t,
      children: [],
      level: 0,
    });
  }

  const roots: TeamTreeNode[] = [];

  for (const t of normalized) {
    const node = nodeMap.get(t.id)!;
    if (t.parentId && nodeMap.has(t.parentId)) {
      const parentNode = nodeMap.get(t.parentId)!;
      parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Set levels recursively
  function assignLevels(nodes: TeamTreeNode[], currentLevel: number): void {
    for (const n of nodes) {
      n.level = currentLevel;
      assignLevels(n.children, currentLevel + 1);
    }
  }

  assignLevels(roots, 0);
  return roots;
}
