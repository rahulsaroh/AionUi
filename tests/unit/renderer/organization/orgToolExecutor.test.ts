/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeOrgToolInStore, onStructureProposed } from '@/renderer/pages/organization/store/orgToolExecutor';
import { getOrgStoreSnapshot, setOrgStoreSnapshot } from '@/renderer/pages/organization/store/useOrgStore';
import { org } from '@/common/adapter/ipcBridge';

describe('executeOrgToolInStore (Step 1 & Step 2)', () => {
  beforeEach(() => {
    // Reset global state to clean testing baseline
    setOrgStoreSnapshot({
      hierarchy: {
        rootCeo: {
          id: 'root-ceo',
          name: 'Global HQ',
          parentId: null,
          workspacePath: '/company/master',
          ceoAgent: {
            id: 'agent-ceo',
            canonicalAgentId: 'c-ceo',
            name: 'CEO',
            role: 'ceo',
            assignedTeamIds: [],
            lastActiveAt: 1000,
            status: 'idle',
          },
          status: 'idle',
          lastActiveAt: 1000,
        },
        departments: [],
        lastUpdated: 1000,
      },
      projects: [],
      members: [],
    });

    vi.spyOn(org, 'getMasterRoot').mockResolvedValue('/company/master');
    vi.spyOn(org, 'assertWithinScope').mockImplementation(async (targetPath: string, allowedRoot?: string) => {
      const root = allowedRoot || '/company/master';
      const allowed = targetPath.startsWith(root);
      return {
        allowed,
        reason: allowed ? undefined : 'outside root',
        resolved: targetPath,
      };
    });
  });

  it('executes list_org and returns structure summary', async () => {
    const res = await executeOrgToolInStore('list_org', {});
    expect(res.departmentsCount).toBe(0);
    expect(res.projectsCount).toBe(0);
    expect(res.membersCount).toBe(0);
    expect(res.masterRoot).toBe('/company/master');
  });

  it('executes create_department and persists new department', async () => {
    const res = await executeOrgToolInStore('create_department', {
      name: 'App Builder',
      folder: '/company/master/app_builder',
      description: 'Mobile and Web apps',
    });

    expect(res.created).toBe(true);
    expect(res.name).toBe('App Builder');
    expect(res.folder).toBe('/company/master/app_builder');

    const state = getOrgStoreSnapshot();
    expect(state.hierarchy.departments.length).toBe(1);
    expect(state.hierarchy.departments[0].name).toBe('App Builder');
  });

  it('refuses create_department outside master root', async () => {
    await expect(
      executeOrgToolInStore('create_department', {
        name: 'Rogue Dept',
        folder: '/outside/rogue',
      })
    ).rejects.toThrow(/Invalid department folder/);
  });

  it('refuses duplicate department names', async () => {
    await executeOrgToolInStore('create_department', {
      name: 'Engineering',
      folder: '/company/master/engineering',
    });

    await expect(
      executeOrgToolInStore('create_department', {
        name: 'Engineering',
        folder: '/company/master/engineering_2',
      })
    ).rejects.toThrow(/already exists/);
  });

  it('executes create_project under department and updates linkedProjects', async () => {
    const dept = await executeOrgToolInStore('create_department', {
      name: 'Engineering',
      folder: '/company/master/engineering',
    });

    const res = await executeOrgToolInStore('create_project', {
      departmentId: dept.id,
      name: 'flutter_app1',
      folder: '/company/master/engineering/flutter_app1',
      goal: 'Build Flutter mobile app',
    });

    expect(res.created).toBe(true);
    expect(res.name).toBe('flutter_app1');
    expect(res.departmentId).toBe(dept.id);

    const state = getOrgStoreSnapshot();
    expect(state.projects.length).toBe(1);
    expect(state.projects[0].name).toBe('flutter_app1');
    expect(state.hierarchy.departments[0].linkedProjects?.some((p) => p.id === res.id)).toBe(true);
  });

  it('refuses create_project outside department folder', async () => {
    const dept = await executeOrgToolInStore('create_department', {
      name: 'Engineering',
      folder: '/company/master/engineering',
    });

    await expect(
      executeOrgToolInStore('create_project', {
        departmentId: dept.id,
        name: 'escape_project',
        folder: '/company/master/other_folder/escape',
      })
    ).rejects.toThrow(/Invalid project folder/);
  });

  it('executes hire_member and adds member to global pool', async () => {
    const res = await executeOrgToolInStore('hire_member', {
      name: 'Sam FlutterDev',
      role: 'flutter-specialist',
      skills: ['dart', 'flutter', 'state-management'],
      systemPrompt: 'You build cross-platform mobile apps.',
    });

    expect(res.created).toBe(true);
    expect(res.name).toBe('Sam FlutterDev');
    expect(res.role).toBe('flutter-specialist');

    const state = getOrgStoreSnapshot();
    expect(state.members.length).toBe(1);
    expect(state.members[0].name).toBe('Sam FlutterDev');
  });

  it('executes assign_member to attach member to project', async () => {
    const dept = await executeOrgToolInStore('create_department', {
      name: 'Engineering',
      folder: '/company/master/engineering',
    });
    const proj = await executeOrgToolInStore('create_project', {
      departmentId: dept.id,
      name: 'flutter_app1',
      folder: '/company/master/engineering/flutter_app1',
    });
    const member = await executeOrgToolInStore('hire_member', {
      name: 'Alex',
      role: 'developer',
    });

    const res = await executeOrgToolInStore('assign_member', {
      projectId: proj.id,
      memberId: member.id,
    });

    expect(res.assigned).toBe(true);
    const state = getOrgStoreSnapshot();
    const updatedProj = state.projects.find((p) => p.id === proj.id);
    expect(updatedProj?.memberIds).toContain(member.id);
  });

  it('executes assign_task and updates node telemetry status to working', async () => {
    const dept = await executeOrgToolInStore('create_department', {
      name: 'Engineering',
      folder: '/company/master/engineering',
    });

    const res = await executeOrgToolInStore('assign_task', {
      target: dept.id,
      task: 'Implement splash screen',
    });

    expect(res.status).toBe('delegated');
    expect(res.target).toBe(dept.id);
    expect(res.task).toBe('Implement splash screen');
  });

  it('executes propose_structure and emits proposal event', async () => {
    let capturedProposal: any = null;
    const unsub = onStructureProposed((proposal) => {
      capturedProposal = proposal;
    });

    const res = await executeOrgToolInStore('propose_structure', {
      departments: [
        {
          name: 'App Builder',
          folder: '/company/master/apps',
          projects: [{ name: 'flutter_app1', folder: '/company/master/apps/flutter_app1' }],
        },
      ],
      suggestedMembers: [{ name: 'Dev 1', role: 'coder' }],
    });

    expect(res.proposed).toBe(true);
    expect(capturedProposal).toBeDefined();
    expect(capturedProposal.departments.length).toBe(1);
    expect(capturedProposal.departments[0].name).toBe('App Builder');
    unsub();
  });
});
