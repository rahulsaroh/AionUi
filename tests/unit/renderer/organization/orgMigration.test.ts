/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { OrgConversation, OrgDepartmentNode, OrgHierarchy, OrgProject, OrgTeamNode } from '@/types/organization';
import {
  migrateOrgStorageV2,
  ORG_STORAGE_VERSION,
  reconcileConversationsWithProjects,
} from '@/renderer/pages/organization/utils/orgMigration';

const now = 1_700_000_000_000;

function makeConversation(id: string, sourceNodeId: string, targetNodeId: string): OrgConversation {
  return {
    id,
    title: `Chat ${id}`,
    type: 'team_execution',
    sourceNodeId,
    targetNodeId,
    timestamp: now,
    messages: [{ id: `${id}-m`, sender: 'User', role: 'user', content: 'hello', timestamp: now }],
  };
}

function makeTeam(departmentId: string, id: string, name: string, path: string, linkedProjectId?: string): OrgTeamNode {
  return {
    id,
    departmentId,
    name,
    linkedProjectId,
    linkedProjectName: linkedProjectId ? name : undefined,
    teamLeadAgent: {
      id: `lead-${id}`,
      canonicalAgentId: `canonical-lead-${id}`,
      name: 'Lead',
      title: 'Team Lead',
      role: 'team_lead',
      assignedTeamIds: [id],
      lastActiveAt: now,
      status: 'idle',
    },
    hrCoordinatorAgent: {
      id: `hr-${id}`,
      canonicalAgentId: `canonical-hr-${id}`,
      name: 'HR',
      title: 'HR',
      role: 'hr_coordinator',
      assignedTeamIds: [id],
      lastActiveAt: now,
      status: 'idle',
    },
    specialistMembers: [],
    lastActiveAt: now,
    status: 'idle',
    workspacePath: path,
  };
}

function makeDepartment(id: string, name: string, path: string, teams: OrgTeamNode[]): OrgDepartmentNode {
  return {
    id,
    name,
    parentDepartmentId: 'root-ceo',
    departmentCeoAgent: {
      id: `agent-head-${id}`,
      canonicalAgentId: `canonical-head-${id}`,
      name: `${name} Head`,
      title: 'Department CEO',
      role: 'department_head',
      assignedTeamIds: [],
      lastActiveAt: now,
      status: 'idle',
    },
    teams,
    linkedProjects: [],
    lastActiveAt: now,
    status: 'idle',
    workspacePath: path,
  };
}

function makeHierarchy(): OrgHierarchy {
  const teams = [
    makeTeam('dept-apps', 'team-gym', 'Gym Mentor App Team', '~/Apps/Gym', 'proj-gym'),
    makeTeam('dept-apps', 'team-aionui', 'AionUi Core Team', '~/Apps/AionUi'),
    makeTeam('dept-yt', 'team-tech-news', 'Weekly Tech News Team', '~/YT/TechNews'),
  ];
  return {
    rootCeo: {
      id: 'root-ceo',
      name: 'Root',
      parentId: null,
      ceoAgent: {
        id: 'agent-root-ceo',
        canonicalAgentId: 'canonical-root-ceo',
        name: 'Root CEO',
        title: 'CEO',
        role: 'ceo',
        assignedTeamIds: [],
        lastActiveAt: now,
        status: 'idle',
        workspacePath: '~/',
      },
      lastActiveAt: now,
      status: 'idle',
    },
    departments: [
      makeDepartment('dept-apps', 'App Builder', '~/Apps', teams.slice(0, 2)),
      makeDepartment('dept-yt', 'YouTube', '~/YT', teams.slice(2)),
    ],
    lastUpdated: now,
  };
}

function makeProjects(): OrgProject[] {
  return [
    {
      id: 'proj-gym',
      name: 'Gym Mentor App',
      departmentId: 'dept-apps',
      teamId: 'team-gym',
      workspacePath: '~/Apps/Gym',
      description: 'Gym app',
      status: 'active',
    } as OrgProject,
    {
      id: 'proj-yt',
      name: 'Weekly Tech News Channel',
      departmentId: 'dept-yt',
      teamIds: ['team-tech-news'],
      goal: 'Weekly news',
      workspacePath: '~/YT/TechNews',
      status: 'active',
    },
  ];
}

function makeConversations(): OrgConversation[] {
  return [
    makeConversation('conv-1', 'team-gym', 'dept-apps'),
    makeConversation('conv-2', 'dept-apps', 'team-aionui'),
    makeConversation('conv-3', 'team-tech-news', 'team-tech-news'),
    makeConversation('conv-ceo', 'root-ceo', 'dept-apps'),
  ];
}

describe('migrateOrgStorageV2', () => {
  it('creates a default PM agent per department', () => {
    const { hierarchy } = migrateOrgStorageV2(makeHierarchy(), [], [], 1);
    expect(hierarchy.departments).toHaveLength(2);
    for (const department of hierarchy.departments) {
      expect(department.pmAgentId).toBeDefined();
      expect(department.pmAgent).toBeDefined();
      expect(department.pmAgent!.id).toBe(department.pmAgentId);
      expect(department.pmAgent!.role).toBe('project_manager');
      expect(department.pmAgent!.workspacePath).toBe(department.workspacePath);
    }
  });

  it('moves each team chats into a project named after the team', () => {
    const { projects, conversations } = migrateOrgStorageV2(makeHierarchy(), makeProjects(), makeConversations(), 1);

    const gymProject = projects.find((p) => p.id === 'proj-gym');
    expect(gymProject).toBeDefined();
    expect(gymProject!.name).toBe('Gym Mentor App');
    expect(gymProject!.departmentId).toBe('dept-apps');
    expect(gymProject!.teamIds).toEqual(['team-gym']);
    expect(gymProject!.workspacePath).toBe('~/Apps/Gym');
    expect(gymProject!.goal).toBeUndefined();
    expect(gymProject!.status).toBe('active');

    const aionuiProject = projects.find((p) => p.name === 'AionUi Core Team');
    expect(aionuiProject).toBeDefined();
    expect(aionuiProject!.teamIds).toEqual(['team-aionui']);
    expect(aionuiProject!.departmentId).toBe('dept-apps');

    const ytProject = projects.find((p) => p.name === 'Weekly Tech News Team');
    expect(ytProject).toBeDefined();
    expect(ytProject!.departmentId).toBe('dept-yt');

    expect(conversations.find((c) => c.id === 'conv-1')?.projectId).toBe('proj-gym');
    expect(conversations.find((c) => c.id === 'conv-1')?.teamId).toBe('team-gym');
    expect(conversations.find((c) => c.id === 'conv-2')?.projectId).toBe(aionuiProject?.id);
    expect(conversations.find((c) => c.id === 'conv-2')?.teamId).toBe('team-aionui');
    expect(conversations.find((c) => c.id === 'conv-3')?.projectId).toBe(ytProject?.id);
    expect(conversations.find((c) => c.id === 'conv-3')?.teamId).toBe('team-tech-news');
  });

  it('leaves Root CEO directives unattached to any project', () => {
    const { conversations } = migrateOrgStorageV2(makeHierarchy(), [], makeConversations(), 1);
    expect(conversations.find((c) => c.id === 'conv-ceo')?.projectId).toBeUndefined();
  });

  it('does not duplicate team projects when run again', () => {
    const first = migrateOrgStorageV2(makeHierarchy(), makeProjects(), makeConversations(), 1);
    expect(first.migrated).toBe(true);

    const second = migrateOrgStorageV2(first.hierarchy, first.projects, first.conversations, ORG_STORAGE_VERSION);
    expect(second.migrated).toBe(false);
    expect(second.projects).toHaveLength(first.projects.length);
    const gymCount = second.projects.filter((p) => p.id === 'proj-gym').length;
    expect(gymCount).toBe(1);
    const newProjects = second.projects.filter(
      (p) => p.name === 'AionUi Core Team' || p.name === 'Weekly Tech News Team'
    );
    expect(newProjects.length).toBe(2);
  });

  it('normalizes legacy single teamId into teamIds array', () => {
    const { projects } = migrateOrgStorageV2(makeHierarchy(), makeProjects(), [], 1);
    const legacy = projects.find((p) => p.id === 'proj-gym');
    expect(legacy?.teamIds).toEqual(['team-gym']);
    expect((legacy as unknown as { teamId?: string }).teamId).toBeUndefined();
  });

  it('preserves all departments, teams and chats (no data loss)', () => {
    const { hierarchy, projects, conversations } = migrateOrgStorageV2(
      makeHierarchy(),
      makeProjects(),
      makeConversations(),
      1
    );
    expect(hierarchy.departments.map((d) => d.id)).toEqual(['dept-apps', 'dept-yt']);
    expect(hierarchy.departments.flatMap((d) => d.teams.map((t) => t.id))).toEqual([
      'team-gym',
      'team-aionui',
      'team-tech-news',
    ]);
    expect(projects.length).toBeGreaterThanOrEqual(makeProjects().length);
    expect(conversations.map((c) => c.id)).toEqual(['conv-1', 'conv-2', 'conv-3', 'conv-ceo']);
  });

  it('is a no-op when storage is already at v2', () => {
    const hierarchy = makeHierarchy();
    const projects = makeProjects();
    const conversations = makeConversations();
    const result = migrateOrgStorageV2(hierarchy, projects, conversations, ORG_STORAGE_VERSION);
    expect(result.migrated).toBe(false);
    expect(result.hierarchy).toBe(hierarchy);
    expect(result.projects).toBe(projects);
    expect(result.conversations).toBe(conversations);
  });
});

describe('reconcileConversationsWithProjects', () => {
  it('creates a General project per department when missing', () => {
    const { projects } = reconcileConversationsWithProjects(makeHierarchy(), makeProjects(), makeConversations());
    const appsGeneral = projects.find((p) => p.departmentId === 'dept-apps' && p.name === 'General');
    const ytGeneral = projects.find((p) => p.departmentId === 'dept-yt' && p.name === 'General');
    expect(appsGeneral).toBeDefined();
    expect(ytGeneral).toBeDefined();
    expect(appsGeneral!.id).toBe('proj-general-dept-apps');
    expect(ytGeneral!.id).toBe('proj-general-dept-yt');
  });

  it('assigns conversation to team project via sourceNodeId', () => {
    const { conversations } = reconcileConversationsWithProjects(makeHierarchy(), makeProjects(), makeConversations());
    const conv1 = conversations.find((c) => c.id === 'conv-1');
    expect(conv1?.projectId).toBe('proj-gym');
    expect(conv1?.teamId).toBe('team-gym');
  });

  it('assigns conversation to team project via targetNodeId', () => {
    const { conversations } = reconcileConversationsWithProjects(makeHierarchy(), makeProjects(), makeConversations());
    const conv3 = conversations.find((c) => c.id === 'conv-3');
    expect(conv3?.projectId).toBe('proj-yt');
    expect(conv3?.teamId).toBe('team-tech-news');
  });

  it('falls back to General project when team has no project', () => {
    const { conversations, projects } = reconcileConversationsWithProjects(
      makeHierarchy(),
      makeProjects(),
      makeConversations()
    );
    const conv2 = conversations.find((c) => c.id === 'conv-2');
    const general = projects.find((p) => p.departmentId === 'dept-apps' && p.name === 'General');
    expect(conv2?.projectId).toBe(general?.id);
    expect(conv2?.teamId).toBe('team-aionui');
    // Team should be linked to General project
    expect(general?.teamIds).toContain('team-aionui');
  });

  it('keeps Root CEO conversations without projectId', () => {
    const { conversations } = reconcileConversationsWithProjects(makeHierarchy(), makeProjects(), makeConversations());
    const convCeo = conversations.find((c) => c.id === 'conv-ceo');
    expect(convCeo?.projectId).toBeUndefined();
  });

  it('returns migrated count', () => {
    const { migratedCount } = reconcileConversationsWithProjects(makeHierarchy(), makeProjects(), makeConversations());
    // conv-1, conv-2, conv-3 get projectId; conv-ceo does not
    expect(migratedCount).toBe(3);
  });

  it('does not re-migrate conversations that already have projectId', () => {
    const conversations: OrgConversation[] = [
      {
        ...makeConversation('conv-existing', 'team-gym', 'dept-apps'),
        projectId: 'proj-gym',
        teamId: 'team-gym',
      },
    ];
    const { conversations: next, migratedCount } = reconcileConversationsWithProjects(
      makeHierarchy(),
      makeProjects(),
      conversations
    );
    expect(migratedCount).toBe(0);
    expect(next[0].projectId).toBe('proj-gym');
  });

  it('is idempotent: second run migrates nothing', () => {
    const hierarchy = makeHierarchy();
    const first = reconcileConversationsWithProjects(hierarchy, makeProjects(), makeConversations());
    expect(first.migratedCount).toBeGreaterThan(0);
    const second = reconcileConversationsWithProjects(hierarchy, first.projects, first.conversations);
    expect(second.migratedCount).toBe(0);
  });
});
