/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  executeOrgToolInStore,
  onStructureProposed,
  handleUserAnswerAsk,
} from '@/renderer/pages/organization/store/orgToolExecutor';
import {
  getOrgStoreSnapshot,
  setOrgStoreSnapshot,
  recordApprovedLineupInStore,
} from '@/renderer/pages/organization/store/useOrgStore';
import { org } from '@/common/adapter/ipcBridge';
import { ipcBridge } from '@/common';

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

    vi.spyOn(ipcBridge.assistants.list, 'invoke').mockResolvedValue([
      {
        id: 'ast-default',
        name: 'Lead Assistant',
        enabled: true,
        team_selectable: true,
        agent: { type: 'claude', source: 'builtin' },
      } as any,
    ]);
    vi.spyOn(ipcBridge.team.create, 'invoke').mockImplementation(async (payload: any) => ({
      id: `team-${payload.name || 'test'}`,
      name: payload.name,
      workspace: payload.workspace,
    }));
    vi.spyOn(ipcBridge.team.sendMessage, 'invoke').mockResolvedValue({
      enqueue_status: 'accepted',
      message_id: 'msg-accepted',
    } as any);

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

  describe('assign_task recruiting and approved_lineup validation', () => {
    it('appends approval lines when valid approved_lineup_id is passed', async () => {
      const dept = await executeOrgToolInStore('create_department', {
        name: 'Engineering',
        folder: '/company/master/engineering',
      });
      const proj = await executeOrgToolInStore('create_project', {
        departmentId: dept.id,
        name: 'Project Alpha',
        folder: '/company/master/engineering/alpha',
      });

      const lineupId = recordApprovedLineupInStore([
        { name: 'Dev 1', assistant: 'claude-code' },
        { name: 'Tester', assistant: 'qa-bot' },
      ]);

      const res = await executeOrgToolInStore('assign_task', {
        project_id: proj.id,
        task: 'Build the feature',
        approved_lineup_id: lineupId,
      });

      expect(res.success).toBe(true);
      expect(res.task).toContain('Build the feature');
      expect(res.task).toContain('User approved: add Dev 1 using claude-code');
      expect(res.task).toContain('User approved: add Tester using qa-bot');

      // Verify project binding and usedAt
      const state = getOrgStoreSnapshot();
      const record = state.approvedLineups?.find((r) => r.id === lineupId);
      expect(record?.projectId).toBe(proj.id);
      expect(record?.usedAt).toBeDefined();
    });

    it('returns error and does not dispatch when lineup id is unknown or invented by model', async () => {
      const dept = await executeOrgToolInStore('create_department', {
        name: 'Engineering',
        folder: '/company/master/engineering',
      });
      const proj = await executeOrgToolInStore('create_project', {
        departmentId: dept.id,
        name: 'Project Beta',
        folder: '/company/master/engineering/beta',
      });

      const res = await executeOrgToolInStore('assign_task', {
        project_id: proj.id,
        task: 'Build the feature',
        approved_lineup_id: 'invented-id-by-model',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('approved_lineup not recognized: ask the user to approve the lineup again');
      expect(res.dispatched).toBe(false);
    });

    it('returns error when approved lineup is expired (>24h)', async () => {
      const dept = await executeOrgToolInStore('create_department', {
        name: 'Engineering',
        folder: '/company/master/engineering',
      });
      const proj = await executeOrgToolInStore('create_project', {
        departmentId: dept.id,
        name: 'Project Gamma',
        folder: '/company/master/engineering/gamma',
      });

      const lineupId = recordApprovedLineupInStore([{ name: 'Dev 2', assistant: 'claude' }]);
      // Modify record to be 25 hours old
      const state = getOrgStoreSnapshot();
      setOrgStoreSnapshot({
        ...state,
        approvedLineups: (state.approvedLineups || []).map((r) =>
          r.id === lineupId ? { ...r, approvedAt: Date.now() - 25 * 60 * 60 * 1000 } : r
        ),
      });

      const res = await executeOrgToolInStore('assign_task', {
        project_id: proj.id,
        task: 'Build the feature',
        approved_lineup_id: lineupId,
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('approved_lineup not recognized: ask the user to approve the lineup again');
      expect(res.dispatched).toBe(false);
    });

    it('returns error when lineup was bound to another project (project mismatch)', async () => {
      const dept = await executeOrgToolInStore('create_department', {
        name: 'Engineering',
        folder: '/company/master/engineering',
      });
      const proj1 = await executeOrgToolInStore('create_project', {
        departmentId: dept.id,
        name: 'Project 1',
        folder: '/company/master/engineering/p1',
      });
      const proj2 = await executeOrgToolInStore('create_project', {
        departmentId: dept.id,
        name: 'Project 2',
        folder: '/company/master/engineering/p2',
      });

      const lineupId = recordApprovedLineupInStore([{ name: 'Dev 1', assistant: 'claude' }], undefined, proj1.id);

      // Attempt using it on proj2
      const res = await executeOrgToolInStore('assign_task', {
        project_id: proj2.id,
        task: 'Build for p2',
        approved_lineup_id: lineupId,
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('approved_lineup not recognized: ask the user to approve the lineup again');
      expect(res.dispatched).toBe(false);
    });

    it('matches by id regardless of key order differences or object shapes', async () => {
      const dept = await executeOrgToolInStore('create_department', {
        name: 'Engineering',
        folder: '/company/master/engineering',
      });
      const proj = await executeOrgToolInStore('create_project', {
        departmentId: dept.id,
        name: 'Project Delta',
        folder: '/company/master/engineering/delta',
      });

      // Record with keys: assistant, name
      const lineupId = recordApprovedLineupInStore([{ assistant: 'claude-code', name: 'Dev 1' }]);

      // Call assign_task using ID
      const res = await executeOrgToolInStore('assign_task', {
        project_id: proj.id,
        task: 'Do work',
        approved_lineup_id: lineupId,
      });

      expect(res.success).toBe(true);
      expect(res.task).toContain('User approved: add Dev 1 using claude-code');
    });

    it('ask_user approval path produces a usable lineup id and works with assign_task', async () => {
      const dept = await executeOrgToolInStore('create_department', {
        name: 'Engineering',
        folder: '/company/master/engineering',
      });
      const proj = await executeOrgToolInStore('create_project', {
        departmentId: dept.id,
        name: 'Project Epsilon',
        folder: '/company/master/engineering/epsilon',
      });

      // CEO asked user about recruiting
      const askResult = await executeOrgToolInStore('ask_user', {
        question: 'Should I recruit Alice as coder for Project Epsilon?',
        suggestedMembers: [{ name: 'Alice', assistant: 'coder-bot' }],
        project_id: proj.id,
      });

      expect(askResult.asked).toBe(true);

      // User says yes
      const { answer, approvedLineupId } = handleUserAnswerAsk(askResult, 'Yes, please add her');
      expect(approvedLineupId).toBeDefined();
      expect(answer).toContain(`approved_lineup_id=${approvedLineupId}`);

      // CEO uses the approvedLineupId in assign_task
      const res = await executeOrgToolInStore('assign_task', {
        project_id: proj.id,
        task: 'Welcome Alice and start work',
        approved_lineup_id: approvedLineupId,
      });

      expect(res.success).toBe(true);
      expect(res.task).toContain('User approved: add Alice using coder-bot');
    });

    it('tightened approval detection handles affirmative answers and caveat words correctly', () => {
      const askPayload = {
        question: 'Should I recruit these agents?',
        suggestedMembers: [{ name: 'Designer', assistant: 'designer-bot' }],
      };

      // "yes" approves
      const resYes = handleUserAnswerAsk(askPayload, 'yes');
      expect(resYes.approvedLineupId).toBeDefined();
      expect(resYes.answer).toContain('yes approved_lineup_id=');

      // "yes, but skip the designer" does not approve
      const resYesBut = handleUserAnswerAsk(askPayload, 'yes, but skip the designer');
      expect(resYesBut.approvedLineupId).toBeUndefined();
      expect(resYesBut.answer).toBe('yes, but skip the designer');

      // "addition" does not approve
      const resAddition = handleUserAnswerAsk(askPayload, 'addition');
      expect(resAddition.approvedLineupId).toBeUndefined();
      expect(resAddition.answer).toBe('addition');

      // "ok" approves
      const resOk = handleUserAnswerAsk(askPayload, 'ok');
      expect(resOk.approvedLineupId).toBeDefined();
      expect(resOk.answer).toContain('ok approved_lineup_id=');

      // Additional caveat checks: except, not, don't, without, skip, instead, only
      expect(handleUserAnswerAsk(askPayload, 'ok, except for the designer').approvedLineupId).toBeUndefined();
      expect(handleUserAnswerAsk(askPayload, 'sure, not the first one').approvedLineupId).toBeUndefined();
      expect(handleUserAnswerAsk(askPayload, "yeah, don't add the designer").approvedLineupId).toBeUndefined();
      expect(handleUserAnswerAsk(askPayload, 'proceed without the designer').approvedLineupId).toBeUndefined();
      expect(handleUserAnswerAsk(askPayload, 'go ahead, instead pick someone else').approvedLineupId).toBeUndefined();
      expect(handleUserAnswerAsk(askPayload, 'approve only the tester').approvedLineupId).toBeUndefined();
    });
  });
});
