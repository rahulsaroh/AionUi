/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgHierarchy, OrgProject, OrgAgentMember } from '@/types/organization';
import { executeOrgToolInStore } from '@/renderer/pages/organization/store/orgToolExecutor';
import { setOrgStoreSnapshot } from '@/renderer/pages/organization/store/useOrgStore';

vi.mock('@/common', () => ({
  ipcBridge: {
    org: {
      saveData: vi.fn(async () => undefined),
      loadData: vi.fn(async () => null),
      getMembers: vi.fn(async () => []),
      getProjects: vi.fn(async () => []),
      saveMembers: vi.fn(async () => true),
      saveProjects: vi.fn(async () => true),
      getMasterRoot: vi.fn(async () => '/root'),
      assertWithinScope: vi.fn(async (p: string) => ({ allowed: true, resolved: p })),
    },
    conversation: {
      update: { invoke: vi.fn(async () => true) },
    },
  },
}));

vi.mock('@/renderer/services/i18n', () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) || key,
  },
}));

describe('orgMemberDeletionTools (executeOrgToolInStore)', () => {
  const member1: OrgAgentMember = {
    id: 'm-1',
    canonicalAgentId: 'm-1',
    name: 'Specialist One',
    role: 'Engineer',
    assignedTeamIds: ['team-1'],
    lastActiveAt: 1000,
    status: 'idle',
  };

  const member2: OrgAgentMember = {
    id: 'm-2',
    canonicalAgentId: 'm-2',
    name: 'Specialist Two',
    role: 'Designer',
    assignedTeamIds: ['team-1'],
    lastActiveAt: 1000,
    status: 'idle',
  };

  const hierarchy: OrgHierarchy = {
    rootCeo: {
      id: 'root-ceo',
      title: 'Global Executive HQ',
      workspacePath: '/root',
      ceoAgent: {
        id: 'agent-ceo',
        canonicalAgentId: 'canonical-ceo',
        name: 'Chief Executive Officer',
        role: 'ceo',
        assignedTeamIds: [],
        lastActiveAt: 1000,
        status: 'idle',
      },
      lastActiveAt: 1000,
      status: 'idle',
    },
    departments: [
      {
        id: 'dept-1',
        name: 'Engineering',
        workspacePath: '/root/eng',
        description: 'Engineering department',
        teams: [
          {
            id: 'team-1',
            departmentId: 'dept-1',
            name: 'Core Team',
            lastActiveAt: 1000,
            status: 'idle',
            teamLeadAgent: {
              id: 'lead-1',
              canonicalAgentId: 'lead-1',
              name: 'Team Lead',
              role: 'team_lead',
              assignedTeamIds: ['team-1'],
              lastActiveAt: 1000,
              status: 'idle',
            },
            specialistMembers: [{ ...member1 }, { ...member2 }],
          },
        ],
        lastActiveAt: 1000,
        status: 'idle',
      },
    ],
    lastUpdated: 1000,
  };

  const projects: OrgProject[] = [
    {
      id: 'proj-1',
      name: 'Alpha App',
      departmentId: 'dept-1',
      workspacePath: '/root/eng/alpha',
      goal: 'Build Alpha',
      memberIds: ['m-1', 'm-2'],
      teamIds: ['team-1'],
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'proj-2',
      name: 'Beta App',
      departmentId: 'dept-1',
      workspacePath: '/root/eng/beta',
      goal: 'Build Beta',
      memberIds: ['m-2'],
      teamIds: ['team-1'],
      createdAt: 1000,
      updatedAt: 1000,
    },
  ];

  beforeEach(() => {
    setOrgStoreSnapshot({
      hierarchy: JSON.parse(JSON.stringify(hierarchy)),
      projects: JSON.parse(JSON.stringify(projects)),
      members: [{ ...member1 }, { ...member2 }],
    });
  });

  it('list_org returns all members including specialist members in teams', async () => {
    const res = await executeOrgToolInStore('list_org', {});
    expect(res).toBeDefined();
    expect(res.membersCount).toBe(2);
    expect(res.members.some((m: { id: string }) => m.id === 'm-1')).toBe(true);
    expect(res.members.some((m: { id: string }) => m.id === 'm-2')).toBe(true);
    expect(res.departments[0].teams[0].specialistMembers).toHaveLength(2);
  });

  it('remove_member unassigns member from a specific project', async () => {
    const res = await executeOrgToolInStore('remove_member', { memberId: 'm-1', projectId: 'proj-1' });
    expect(res.success).toBe(true);
    expect(res.removed).toBe(true);

    const list = await executeOrgToolInStore('list_org', {});
    const proj1 = list.projects.find((p: { id: string }) => p.id === 'proj-1');
    expect(proj1.memberIds).toEqual(['m-2']);
  });

  it('delete_member permanently removes member from store, projects, and teams', async () => {
    const res = await executeOrgToolInStore('delete_member', { memberId: 'm-2' });
    expect(res.success).toBe(true);
    expect(res.deleted).toBe(true);

    const list = await executeOrgToolInStore('list_org', {});
    expect(list.members.some((m: { id: string }) => m.id === 'm-2')).toBe(false);

    const proj1 = list.projects.find((p: { id: string }) => p.id === 'proj-1');
    const proj2 = list.projects.find((p: { id: string }) => p.id === 'proj-2');
    expect(proj1.memberIds).not.toContain('m-2');
    expect(proj2.memberIds).not.toContain('m-2');

    const team = list.departments[0].teams[0];
    expect(team.specialistMembers.some((m: { id: string }) => m.id === 'm-2')).toBe(false);
  });

  it('remove_members_from_department_projects removes specified members from all projects in department', async () => {
    const res = await executeOrgToolInStore('remove_members_from_department_projects', {
      departmentId: 'dept-1',
      memberIds: ['m-1', 'm-2'],
    });
    expect(res.success).toBe(true);
    expect(res.removedCount).toBe(2);

    const list = await executeOrgToolInStore('list_org', {});
    const proj1 = list.projects.find((p: { id: string }) => p.id === 'proj-1');
    const proj2 = list.projects.find((p: { id: string }) => p.id === 'proj-2');
    expect(proj1.memberIds).toEqual([]);
    expect(proj2.memberIds).toEqual([]);
  });
});
