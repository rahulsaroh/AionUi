/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { OrgConversation, OrgHierarchy, OrgProject } from '@/types/organization';
import { resolveOrgChatTarget } from '@/renderer/pages/organization/utils/openOrgChat';

const t = (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) || key;

const makeHierarchy = (): OrgHierarchy => ({
  rootCeo: {
    id: 'root-ceo',
    name: 'Root',
    parentId: null,
    status: 'idle',
    lastActiveAt: 1,
    workspacePath: '/root',
    ceoAgent: {
      id: 'agent-root-ceo',
      canonicalAgentId: 'canonical-root-ceo',
      name: 'CEO',
      title: 'CEO',
      role: 'ceo',
      assignedTeamIds: [],
      status: 'idle',
      lastActiveAt: 1,
      workspacePath: '/root',
    },
  },
  departments: [
    {
      id: 'dept-1',
      name: 'Engineering',
      parentDepartmentId: 'root-ceo',
      workspacePath: '/dept-eng',
      status: 'idle',
      lastActiveAt: 1,
      linkedProjects: [],
      departmentCeoAgent: {
        id: 'agent-dept-head',
        canonicalAgentId: 'canon-dept-head',
        name: 'Dept Head',
        title: 'Department Head',
        role: 'department_head',
        assignedTeamIds: [],
        status: 'idle',
        lastActiveAt: 1,
      },
      pmAgent: {
        id: 'agent-pm',
        canonicalAgentId: 'canon-pm',
        name: 'PM',
        title: 'PM',
        role: 'project_manager',
        assignedTeamIds: [],
        status: 'idle',
        lastActiveAt: 1,
      },
      teams: [
        {
          id: 'team-1',
          departmentId: 'dept-1',
          name: 'Core Team',
          status: 'idle',
          lastActiveAt: 1,
          workspacePath: '/team-core',
          teamLeadAgent: {
            id: 'agent-lead',
            canonicalAgentId: 'canon-lead',
            name: 'Lead',
            title: 'Team Lead',
            role: 'team_lead',
            assignedTeamIds: ['team-1'],
            status: 'idle',
            lastActiveAt: 1,
          },
          specialistMembers: [
            {
              id: 'agent-member',
              canonicalAgentId: 'canon-member',
              name: 'Member',
              title: 'Dev',
              role: 'specialist',
              assignedTeamIds: ['team-1'],
              status: 'idle',
              lastActiveAt: 1,
            },
          ],
        },
      ],
    },
  ],
  lastUpdated: 1,
});

const makeProject = (overrides: Partial<OrgProject> = {}): OrgProject => ({
  id: 'proj-1',
  name: 'Project One',
  departmentId: 'dept-1',
  teamIds: ['team-1'],
  status: 'active',
  workspacePath: '/proj-one',
  path: '/proj-one',
  ...overrides,
});

describe('resolveOrgChatTarget', () => {
  let hierarchy: OrgHierarchy;
  let projects: OrgProject[];
  let conversations: OrgConversation[];

  beforeEach(() => {
    hierarchy = makeHierarchy();
    projects = [makeProject()];
    conversations = [];
  });

  it('creates then reuses CEO thread and keeps different target threads separate', () => {
    const r1 = resolveOrgChatTarget({ type: 'ceo', id: 'root-ceo' }, hierarchy, projects, conversations, t);
    expect('error' in r1).toBe(false);
    if ('error' in r1) throw new Error(r1.error);
    expect(r1.conversation.type).toBe('ceo_directive');
    expect(r1.workspacePath).toBe('/root');

    conversations = [r1.conversation];
    const r2 = resolveOrgChatTarget({ type: 'ceo', id: 'root-ceo' }, hierarchy, projects, conversations, t);
    expect('error' in r2).toBe(false);
    if ('error' in r2) throw new Error(r2.error);
    expect(r2.conversation.id).toBe(r1.conversation.id);

    const dept = resolveOrgChatTarget({ type: 'department_head', id: 'dept-1' }, hierarchy, projects, conversations, t);
    expect('error' in dept).toBe(false);
    if ('error' in dept) throw new Error(dept.error);
    expect(dept.conversation.id).not.toBe(r1.conversation.id);
  });

  it('creates then reuses department head thread and uses department workspace', () => {
    const r1 = resolveOrgChatTarget({ type: 'department_head', id: 'dept-1' }, hierarchy, projects, conversations, t);
    expect('error' in r1).toBe(false);
    if ('error' in r1) throw new Error(r1.error);
    expect(r1.conversation.departmentId).toBe('dept-1');
    expect(r1.conversation.projectId).toBeUndefined();
    expect(r1.workspacePath).toBe('/dept-eng');

    conversations = [r1.conversation];
    const r2 = resolveOrgChatTarget({ type: 'department_head', id: 'dept-1' }, hierarchy, projects, conversations, t);
    expect('error' in r2).toBe(false);
    if ('error' in r2) throw new Error(r2.error);
    expect(r2.conversation.id).toBe(r1.conversation.id);
  });

  it('creates then reuses project head thread and uses project workspace', () => {
    const r1 = resolveOrgChatTarget({ type: 'project_head', id: 'proj-1' }, hierarchy, projects, conversations, t);
    expect('error' in r1).toBe(false);
    if ('error' in r1) throw new Error(r1.error);
    expect(r1.conversation.projectId).toBe('proj-1');
    expect(r1.workspacePath).toBe('/proj-one');

    conversations = [r1.conversation];
    const r2 = resolveOrgChatTarget({ type: 'project_head', id: 'proj-1' }, hierarchy, projects, conversations, t);
    expect('error' in r2).toBe(false);
    if ('error' in r2) throw new Error(r2.error);
    expect(r2.conversation.id).toBe(r1.conversation.id);
  });

  it('creates missing project head/team once across repeated opens', () => {
    projects = [makeProject({ id: 'proj-no-team', teamIds: [] })];
    const r1 = resolveOrgChatTarget(
      { type: 'project_head', id: 'proj-no-team' },
      hierarchy,
      projects,
      conversations,
      t
    );
    expect('error' in r1).toBe(false);
    if ('error' in r1) throw new Error(r1.error);
    expect(r1.mutatedHierarchy).toBeDefined();
    expect(r1.updatedProject?.teamIds?.length).toBe(1);
    const createdTeamId = r1.updatedProject!.teamIds[0];
    const dept = r1.mutatedHierarchy!.departments.find((d) => d.id === 'dept-1')!;
    expect(dept.teams.filter((tm) => tm.id === createdTeamId)).toHaveLength(1);

    const h2 = r1.mutatedHierarchy!;
    const p2 = [r1.updatedProject!];
    const c2 = [r1.conversation];
    const r2 = resolveOrgChatTarget({ type: 'project_head', id: 'proj-no-team' }, h2, p2, c2, t);
    expect('error' in r2).toBe(false);
    if ('error' in r2) throw new Error(r2.error);
    expect(r2.mutatedHierarchy).toBeUndefined();
    expect(r2.updatedProject).toBeUndefined();
    expect(r2.conversation.id).toBe(r1.conversation.id);

    const r3 = resolveOrgChatTarget({ type: 'project_head', id: 'proj-no-team' }, h2, p2, c2, t);
    expect('error' in r3).toBe(false);
    if ('error' in r3) throw new Error(r3.error);
    const dept3 = (r3.mutatedHierarchy || h2).departments.find((d) => d.id === 'dept-1')!;
    const allCreated = dept3.teams.filter((tm) => tm.id === createdTeamId);
    expect(allCreated).toHaveLength(1);
    expect(dept3.teams.length).toBe(dept.teams.length);
  });

  it('creates then reuses member thread; uses project folder when opened from project', () => {
    const r1 = resolveOrgChatTarget(
      { type: 'member', id: 'agent-member', projectId: 'proj-1' },
      hierarchy,
      projects,
      conversations,
      t
    );
    expect('error' in r1).toBe(false);
    if ('error' in r1) throw new Error(r1.error);
    expect(r1.conversation.targetAgentId).toBe('agent-member');
    expect(r1.conversation.projectId).toBe('proj-1');
    expect(r1.workspacePath).toBe('/proj-one');

    conversations = [r1.conversation];
    const r2 = resolveOrgChatTarget(
      { type: 'member', id: 'agent-member', projectId: 'proj-1' },
      hierarchy,
      projects,
      conversations,
      t
    );
    expect('error' in r2).toBe(false);
    if ('error' in r2) throw new Error(r2.error);
    expect(r2.conversation.id).toBe(r1.conversation.id);
  });
});
