/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createInMemoryTestDb } from '../pipeline/testDbHelper';
import type { ISqliteDriver } from '@/process/services/database/drivers/ISqliteDriver';
import { ALL_MIGRATIONS, runMigrations } from '@/process/services/database/migrations';
import { OrgStorageService } from '@/process/services/org/orgStorageService';
import type { OrgStorageBundle, OrgAgentMember, OrgProject, OrgDepartmentNode } from '@/types/organization';

describe('Organization SQLite Persistence & Migration v33', () => {
  let db: ISqliteDriver;

  beforeEach(() => {
    db = createInMemoryTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('runs migration v33 up and creates org_members, org_departments, org_projects, org_state', () => {
    const migration33 = ALL_MIGRATIONS.find((m) => m.version === 33);
    expect(migration33).toBeDefined();

    migration33!.up(db);

    // Verify org_members table exists
    const memberTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='org_members'").get() as
      | { name: string }
      | undefined;
    expect(memberTable?.name).toBe('org_members');

    // Verify org_departments table exists
    const deptTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='org_departments'")
      .get() as { name: string } | undefined;
    expect(deptTable?.name).toBe('org_departments');

    // Verify org_projects table exists
    const projTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='org_projects'").get() as
      | { name: string }
      | undefined;
    expect(projTable?.name).toBe('org_projects');

    // Verify org_state table exists
    const stateTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='org_state'").get() as
      | { name: string }
      | undefined;
    expect(stateTable?.name).toBe('org_state');

    // Verify down migration drops the tables
    migration33!.down(db);
    const memberTableAfter = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='org_members'")
      .get();
    expect(memberTableAfter).toBeFalsy();
  });

  it('saves and retrieves global members with skills and system prompts', async () => {
    const service = new OrgStorageService(db);
    const member: OrgAgentMember = {
      id: 'member-coder-1',
      canonicalAgentId: 'canonical-coder-1',
      name: 'Alice Coder',
      role: 'specialist',
      title: 'Fullstack Engineer',
      skills: ['react', 'typescript', 'sqlite'],
      systemPrompt: 'You are an expert fullstack engineer.',
      assignedTeamIds: [],
      lastActiveAt: 1000,
      status: 'idle',
    };

    const saved = await service.saveMember(member);
    expect(saved).toBe(true);

    const members = await service.getMembers();
    expect(members).toHaveLength(1);
    expect(members[0].id).toBe('member-coder-1');
    expect(members[0].name).toBe('Alice Coder');
    expect(members[0].skills).toEqual(['react', 'typescript', 'sqlite']);
    expect(members[0].systemPrompt).toBe('You are an expert fullstack engineer.');

    // Update member
    await service.saveMember({
      ...member,
      name: 'Alice Senior Coder',
      skills: ['react', 'typescript', 'sqlite', 'bun'],
    });

    const updated = await service.getMembers();
    expect(updated).toHaveLength(1);
    expect(updated[0].name).toBe('Alice Senior Coder');
    expect(updated[0].skills).toContain('bun');

    // Delete member
    await service.deleteMember('member-coder-1');
    const afterDelete = await service.getMembers();
    expect(afterDelete).toHaveLength(0);
  });

  it('saves and retrieves projects with memberIds array', async () => {
    const service = new OrgStorageService(db);
    const project: OrgProject = {
      id: 'proj-gateway',
      name: 'API Gateway',
      departmentId: 'dept-engineering',
      teamIds: [],
      memberIds: ['member-coder-1', 'member-designer-1'],
      workspacePath: '/company/engineering/gateway',
      goal: 'Build the unified API gateway',
      status: 'active',
    };

    const saved = await service.saveProject(project);
    expect(saved).toBe(true);

    const projects = await service.getProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe('proj-gateway');
    expect(projects[0].memberIds).toEqual(['member-coder-1', 'member-designer-1']);
    expect(projects[0].workspacePath).toBe('/company/engineering/gateway');

    await service.deleteProject('proj-gateway');
    const afterDelete = await service.getProjects();
    expect(afterDelete).toHaveLength(0);
  });

  it('saves and retrieves complete org storage bundle transactionally', async () => {
    const service = new OrgStorageService(db);
    const now = Date.now();

    const member1: OrgAgentMember = {
      id: 'm1',
      canonicalAgentId: 'c-m1',
      name: 'Dev One',
      role: 'specialist',
      skills: ['ts'],
      assignedTeamIds: [],
      lastActiveAt: now,
      status: 'idle',
    };
    const member2: OrgAgentMember = {
      id: 'm2',
      canonicalAgentId: 'c-m2',
      name: 'Dev Two',
      role: 'specialist',
      skills: ['python'],
      assignedTeamIds: [],
      lastActiveAt: now,
      status: 'idle',
    };

    const dept: OrgDepartmentNode = {
      id: 'dept-eng',
      name: 'Engineering',
      parentDepartmentId: null,
      workspacePath: '/org/eng',
      departmentCeoAgent: member1,
      teams: [],
      linkedProjects: [],
      lastActiveAt: now,
      status: 'idle',
    };

    const project: OrgProject = {
      id: 'p1',
      name: 'Core API',
      departmentId: 'dept-eng',
      teamIds: [],
      memberIds: ['m1', 'm2'],
      workspacePath: '/org/eng/api',
      status: 'active',
    };

    const bundle: OrgStorageBundle = {
      hierarchy: {
        rootCeo: {
          id: 'root-ceo',
          name: 'Executive Board',
          parentId: null,
          ceoAgent: {
            id: 'agent-ceo',
            canonicalAgentId: 'c-ceo',
            name: 'Root CEO',
            role: 'ceo',
            assignedTeamIds: [],
            lastActiveAt: now,
            status: 'idle',
          },
          status: 'idle',
          lastActiveAt: now,
        },
        departments: [dept],
        lastUpdated: now,
      },
      projects: [project],
      members: [member1, member2],
      cronJobs: [],
      activeScope: 'organization',
    };

    const saved = await service.saveFullBundle(bundle);
    expect(saved).toBe(true);

    const loaded = await service.getFullBundle();
    expect(loaded).not.toBeNull();
    expect(loaded!.hierarchy.rootCeo.name).toBe('Executive Board');
    expect(loaded!.hierarchy.departments).toHaveLength(1);
    expect(loaded!.hierarchy.departments[0].id).toBe('dept-eng');
    expect(loaded!.projects).toHaveLength(1);
    expect(loaded!.projects[0].memberIds).toEqual(['m1', 'm2']);
    expect(loaded!.members).toHaveLength(2);
    expect(loaded!.activeScope).toBe('organization');
  });
});
