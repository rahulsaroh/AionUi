/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { pruneOrphanTeamStorage, TEAM_STORAGE_PREFIXES } from '@/renderer/pages/team/utils/teamStorage';

afterEach(() => localStorage.clear());

describe('pruneOrphanTeamStorage', () => {
  it('removes keys for teams not in the existing set, keeps others', () => {
    localStorage.setItem('team-view-mode-alive', 'board');
    localStorage.setItem('team-activity-controls-alive', '{}');
    localStorage.setItem('team-view-mode-dead', 'single');
    localStorage.setItem('team-member-colors-dead', '{}');
    localStorage.setItem('unrelated-key', 'x');

    pruneOrphanTeamStorage(['alive']);

    expect(localStorage.getItem('team-view-mode-alive')).toBe('board');
    expect(localStorage.getItem('team-activity-controls-alive')).toBe('{}');
    expect(localStorage.getItem('team-view-mode-dead')).toBeNull();
    expect(localStorage.getItem('team-member-colors-dead')).toBeNull();
    expect(localStorage.getItem('unrelated-key')).toBe('x');
  });

  it('covers all known per-team prefixes', () => {
    expect(TEAM_STORAGE_PREFIXES).toContain('team-activity-controls-');
    expect(TEAM_STORAGE_PREFIXES).toContain('team-view-mode-');
    expect(TEAM_STORAGE_PREFIXES).toContain('team-member-colors-');
    expect(TEAM_STORAGE_PREFIXES).toContain('team-active-slot-');
    expect(TEAM_STORAGE_PREFIXES).toContain('team-assistant-order-');
    expect(TEAM_STORAGE_PREFIXES).toContain('team-pending-permissions-');
    expect(TEAM_STORAGE_PREFIXES).toContain('team-memory-');
    expect(TEAM_STORAGE_PREFIXES).toContain('team-agent-memory-');
    expect(TEAM_STORAGE_PREFIXES).toContain('team-watchdog-interval-');
  });
});

import {
  normalizeTeamsHierarchy,
  wouldCreateCycle,
  getDescendantTeamIds,
  resolveChildWorkspace,
  deleteTeamCascade,
  buildTeamTree,
} from '@/renderer/pages/team/utils/teamStorage';
import type { TTeam } from '@/common/types/team/teamTypes';

function makeMockTeam(id: string, name: string, parentId: string | null = null, workspace = '/root'): TTeam {
  return {
    id,
    user_id: 'user1',
    name,
    workspace,
    workspace_mode: 'shared',
    lead_agent_id: null,
    session_mode: null,
    agents_version: '1.0.0',
    created_at: 1000,
    updated_at: 1000,
    members: [],
    parentId,
    subTeamIds: [],
  };
}

describe('team hierarchy utilities', () => {
  it('normalizeTeamsHierarchy normalizes parentId and computes subTeamIds', () => {
    const parent = makeMockTeam('parent', 'Parent Dept');
    const child = makeMockTeam('child', 'Child Team', 'parent');
    const grandchild = makeMockTeam('grandchild', 'Grandchild Specialist', 'child');
    const orphan = makeMockTeam('orphan', 'Orphan Team', 'non-existent');

    const result = normalizeTeamsHierarchy([parent, child, grandchild, orphan]);

    const normParent = result.find((t) => t.id === 'parent')!;
    const normChild = result.find((t) => t.id === 'child')!;
    const normOrphan = result.find((t) => t.id === 'orphan')!;

    expect(normParent.subTeamIds).toEqual(['child']);
    expect(normChild.subTeamIds).toEqual(['grandchild']);
    expect(normOrphan.parentId).toBeNull();
  });

  it('wouldCreateCycle detects direct and indirect cycles', () => {
    const tA = makeMockTeam('A', 'Team A');
    const tB = makeMockTeam('B', 'Team B', 'A');
    const tC = makeMockTeam('C', 'Team C', 'B');
    const teams = [tA, tB, tC];

    // Cannot parent to self
    expect(wouldCreateCycle(teams, 'A', 'A')).toBe(true);

    // Cannot make A a child of C (A -> B -> C -> A would cycle)
    expect(wouldCreateCycle(teams, 'A', 'C')).toBe(true);

    // Cannot make A a child of B
    expect(wouldCreateCycle(teams, 'A', 'B')).toBe(true);

    // Can set parent to null (root)
    expect(wouldCreateCycle(teams, 'B', null)).toBe(false);

    // Can make C child of A directly
    expect(wouldCreateCycle(teams, 'C', 'A')).toBe(false);
  });

  it('getDescendantTeamIds recursively gathers all child and subchild IDs', () => {
    const tA = makeMockTeam('A', 'Team A');
    const tB = makeMockTeam('B', 'Team B', 'A');
    const tC = makeMockTeam('C', 'Team C', 'B');
    const tD = makeMockTeam('D', 'Team D', 'A');
    const teams = [tA, tB, tC, tD];

    const descendantsA = getDescendantTeamIds(teams, 'A');
    expect(descendantsA.sort()).toEqual(['B', 'C', 'D'].sort());

    const descendantsB = getDescendantTeamIds(teams, 'B');
    expect(descendantsB).toEqual(['C']);

    const descendantsC = getDescendantTeamIds(teams, 'C');
    expect(descendantsC).toEqual([]);
  });

  it('resolveChildWorkspace formats scoped child paths', () => {
    expect(resolveChildWorkspace('/projects/company', 'Mobile App')).toBe('/projects/company/Mobile_App');
    expect(resolveChildWorkspace('C:\\projects\\company', 'Mobile App')).toBe('C:\\projects\\company\\Mobile_App');
    expect(resolveChildWorkspace('/projects/company', 'QA', '/custom/qa')).toBe('/custom/qa');
  });

  it('deleteTeamCascade deletes team and all descendants', async () => {
    const tA = makeMockTeam('A', 'Team A');
    const tB = makeMockTeam('B', 'Team B', 'A');
    const tC = makeMockTeam('C', 'Team C', 'B');
    const teams = [tA, tB, tC];

    const deleted: string[] = [];
    const deleteFn = async (id: string) => {
      deleted.push(id);
    };

    const res = await deleteTeamCascade(teams, 'A', deleteFn);
    expect(res.sort()).toEqual(['A', 'B', 'C'].sort());
    expect(deleted.sort()).toEqual(['A', 'B', 'C'].sort());
  });

  it('buildTeamTree produces nested tree with correct levels', () => {
    const tA = makeMockTeam('A', 'Dept A');
    const tB = makeMockTeam('B', 'Div B', 'A');
    const tC = makeMockTeam('C', 'Team C', 'B');
    const tD = makeMockTeam('D', 'Dept D');
    const teams = [tA, tB, tC, tD];

    const tree = buildTeamTree(teams);
    expect(tree).toHaveLength(2); // Roots: A and D

    const rootA = tree.find((n) => n.team.id === 'A')!;
    expect(rootA.level).toBe(0);
    expect(rootA.children).toHaveLength(1);

    const childB = rootA.children[0];
    expect(childB.team.id).toBe('B');
    expect(childB.level).toBe(1);
    expect(childB.children).toHaveLength(1);

    const grandchildC = childB.children[0];
    expect(grandchildC.team.id).toBe('C');
    expect(grandchildC.level).toBe(2);
  });
});
