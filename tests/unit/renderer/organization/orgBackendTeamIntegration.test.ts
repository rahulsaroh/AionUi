/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeOrgToolInStore } from '@/renderer/pages/organization/store/orgToolExecutor';
import {
  getOrgStoreSnapshot,
  setOrgStoreSnapshot,
  recordApprovedLineupInStore,
} from '@/renderer/pages/organization/store/useOrgStore';
import { createProjectBackendTeam, pickLeadAssistant } from '@/renderer/pages/organization/store/orgBackendTeam';
import { normalizeOrgProject } from '@/renderer/pages/organization/utils/orgCoherence';
import { migrateOrgStorageV2 } from '@/renderer/pages/organization/utils/orgMigration';
import { ipcBridge } from '@/common';
import type { OrgProject, OrgHierarchy } from '@/types/organization';

describe('Organization Backend Teams Integration (Real AionCore Team Engine)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        departments: [
          {
            id: 'dept-eng',
            name: 'Engineering',
            parentDepartmentId: 'root-ceo',
            workspacePath: '/company/master/engineering',
            status: 'idle',
            lastActiveAt: 1000,
            departmentCeoAgent: {
              id: 'agent-head-eng',
              canonicalAgentId: 'c-head-eng',
              name: 'Eng Head',
              role: 'department_head',
              assignedTeamIds: [],
              lastActiveAt: 1000,
              status: 'idle',
            },
            teams: [],
            linkedProjects: [],
          },
        ],
        lastUpdated: 1000,
      },
      projects: [],
      members: [],
    });

    vi.spyOn(ipcBridge.org, 'getMasterRoot').mockResolvedValue('/company/master');
    vi.spyOn(ipcBridge.org, 'assertWithinScope').mockImplementation(
      async (targetPath: string, allowedRoot?: string) => {
        const root = allowedRoot || '/company/master';
        const allowed = targetPath.startsWith(root);
        return {
          allowed,
          reason: allowed ? undefined : 'outside root',
          resolved: targetPath,
        };
      }
    );
  });

  describe('1. create_project -> team.create mapping', () => {
    it('calls ipcBridge.team.create with workspace, lead assistant, and saves backendTeamId', async () => {
      vi.spyOn(ipcBridge.assistants.list, 'invoke').mockResolvedValue([
        {
          id: 'ast-claude',
          name: 'Claude Lead',
          enabled: true,
          team_selectable: true,
          agent: { type: 'claude', source: 'builtin' },
        } as any,
      ]);

      const createSpy = vi.spyOn(ipcBridge.team.create, 'invoke').mockResolvedValue({
        id: 'team-backend-101',
        name: 'flutter_mobile',
        workspace: '/company/master/engineering/flutter_mobile',
      } as any);

      const res = await executeOrgToolInStore('create_project', {
        departmentId: 'dept-eng',
        name: 'flutter_mobile',
        folder: '/company/master/engineering/flutter_mobile',
        goal: 'Build Flutter mobile app',
      });

      expect(res.created).toBe(true);
      expect(res.backendTeamId).toBe('team-backend-101');
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'flutter_mobile',
          workspace: '/company/master/engineering/flutter_mobile',
          workspace_mode: 'shared',
          agents: [
            expect.objectContaining({
              role: 'leader',
              assistant_id: 'ast-claude',
              assistant_name: 'Claude Lead',
            }),
          ],
        })
      );

      const snapshot = getOrgStoreSnapshot();
      expect(snapshot.projects).toHaveLength(1);
      expect(snapshot.projects[0].backendTeamId).toBe('team-backend-101');
      expect(snapshot.projects[0].workspacePath).toBe('/company/master/engineering/flutter_mobile');
    });

    it('fails visibly if team.create returns an error or rejects', async () => {
      vi.spyOn(ipcBridge.assistants.list, 'invoke').mockResolvedValue([
        {
          id: 'ast-1',
          name: 'Lead',
          enabled: true,
          team_selectable: true,
        } as any,
      ]);

      vi.spyOn(ipcBridge.team.create, 'invoke').mockResolvedValue({
        __bridgeError: true,
        message: 'Disk permission denied on backend',
      } as any);

      await expect(
        createProjectBackendTeam({
          name: 'bad_proj',
          workspacePath: '/company/master/engineering/bad_proj',
          masterRoot: '/company/master',
        })
      ).rejects.toThrow(/Disk permission denied on backend/);
    });

    it('throws "AionCore backend is not reachable" on network error in pickLeadAssistant', async () => {
      vi.spyOn(ipcBridge.assistants.list, 'invoke').mockRejectedValue(
        new Error('connect ECONNREFUSED 127.0.0.1:13400')
      );

      await expect(pickLeadAssistant()).rejects.toThrow('AionCore backend is not reachable');
    });

    it('throws "AionCore backend is not reachable" on network error in createProjectBackendTeam', async () => {
      vi.spyOn(ipcBridge.assistants.list, 'invoke').mockResolvedValue([
        {
          id: 'ast-1',
          name: 'Lead',
          enabled: true,
          team_selectable: true,
        } as any,
      ]);

      vi.spyOn(ipcBridge.team.create, 'invoke').mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:13400'));

      await expect(
        createProjectBackendTeam({
          name: 'offline_proj',
          workspacePath: '/company/master/engineering/offline_proj',
          masterRoot: '/company/master',
        })
      ).rejects.toThrow('AionCore backend is not reachable');
    });

    it('passes logged-in userId to team.create', async () => {
      vi.spyOn(ipcBridge.assistants.list, 'invoke').mockResolvedValue([
        {
          id: 'ast-1',
          name: 'Lead',
          enabled: true,
          team_selectable: true,
        } as any,
      ]);

      const createSpy = vi.spyOn(ipcBridge.team.create, 'invoke').mockResolvedValue({
        id: 'team-backend-user-123',
      } as any);

      await createProjectBackendTeam({
        name: 'user_proj',
        workspacePath: '/company/master/engineering/user_proj',
        masterRoot: '/company/master',
        userId: 'user-custom-42',
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-custom-42',
        })
      );
    });
  });

  describe('2. assign_task -> sendMessage with approved_lineup', () => {
    beforeEach(() => {
      // Seed a project with an active backend team
      setOrgStoreSnapshot({
        ...getOrgStoreSnapshot(),
        projects: [
          {
            id: 'proj-mobile',
            name: 'Mobile App',
            departmentId: 'dept-eng',
            teamIds: [],
            status: 'active',
            workspacePath: '/company/master/engineering/mobile',
            path: '/company/master/engineering/mobile',
            backendTeamId: 'team-backend-mobile',
          },
        ],
      });
    });

    it('forwards assign_task to ipcBridge.team.sendMessage', async () => {
      const sendSpy = vi.spyOn(ipcBridge.team.sendMessage, 'invoke').mockResolvedValue({
        enqueue_status: 'accepted',
        message_id: 'msg-1',
      } as any);

      const res = await executeOrgToolInStore('assign_task', {
        target: 'proj-mobile',
        task: 'Implement offline sync mode',
      });

      expect(res.success).toBe(true);
      expect(res.backendTeamId).toBe('team-backend-mobile');
      expect(sendSpy).toHaveBeenCalledWith({
        team_id: 'team-backend-mobile',
        input: 'Implement offline sync mode',
      });
    });

    it('appends user-approval lines when approved_lineup is passed and matches approved lineup', async () => {
      const lineupData = [{ name: 'Alex Coder', assistant: 'claude-code' }, 'add Senior QA using gemini-cli'];
      recordApprovedLineupInStore(lineupData);

      const sendSpy = vi.spyOn(ipcBridge.team.sendMessage, 'invoke').mockResolvedValue({
        enqueue_status: 'accepted',
        message_id: 'msg-2',
      } as any);

      const res = await executeOrgToolInStore('assign_task', {
        project_id: 'proj-mobile',
        text: 'Scaffold authentication flow',
        approved_lineup: lineupData,
      });

      expect(res.success).toBe(true);
      expect(sendSpy).toHaveBeenCalledWith({
        team_id: 'team-backend-mobile',
        input: expect.stringContaining('User approved: add Alex Coder using claude-code'),
      });
      expect(sendSpy).toHaveBeenCalledWith({
        team_id: 'team-backend-mobile',
        input: expect.stringContaining('User approved: add Senior QA using gemini-cli'),
      });
    });

    it('rejects invented approved_lineup when not recorded in store', async () => {
      const sendSpy = vi.spyOn(ipcBridge.team.sendMessage, 'invoke').mockResolvedValue({
        enqueue_status: 'accepted',
        message_id: 'msg-invented',
      } as any);

      const res = await executeOrgToolInStore('assign_task', {
        project_id: 'proj-mobile',
        text: 'Scaffold authentication flow',
        approved_lineup: [{ name: 'Hallucinated Specialist', assistant: 'claude-3-opus' }],
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('approved_lineup not recognized: ask the user to approve the lineup again');
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('returns error when target project has no backendTeamId and does not mark delegating', async () => {
      setOrgStoreSnapshot({
        ...getOrgStoreSnapshot(),
        projects: [
          {
            id: 'proj-no-team',
            name: 'No Team Project',
            departmentId: 'dept-eng',
            teamIds: [],
            status: 'active',
            workspacePath: '/company/master/engineering/no_team',
            backendTeamId: undefined,
          },
        ],
      });

      const res = await executeOrgToolInStore('assign_task', {
        project_id: 'proj-no-team',
        text: 'Run unit tests',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Project has no backend team configured');
      expect(res.dispatched).toBe(false);
      const snapshot = getOrgStoreSnapshot();
      expect(snapshot.nodeStatuses['proj-no-team']).not.toBe('delegating');
    });

    it('returns error when team.sendMessage fails and does not mark delegating', async () => {
      vi.spyOn(ipcBridge.team.sendMessage, 'invoke').mockRejectedValue(
        new Error('connect ECONNREFUSED 127.0.0.1:13400')
      );

      const res = await executeOrgToolInStore('assign_task', {
        project_id: 'proj-mobile',
        text: 'Run deployment',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('ECONNREFUSED');
      expect(res.dispatched).toBe(false);
      const snapshot = getOrgStoreSnapshot();
      expect(snapshot.nodeStatuses['proj-mobile']).not.toBe('delegating');
    });
  });

  describe('3. get_project_status and list_project_tasks', () => {
    beforeEach(() => {
      setOrgStoreSnapshot({
        ...getOrgStoreSnapshot(),
        projects: [
          {
            id: 'proj-analytics',
            name: 'Analytics Dashboard',
            departmentId: 'dept-eng',
            teamIds: [],
            status: 'active',
            backendTeamId: 'team-backend-analytics',
          },
        ],
      });
    });

    it('get_project_status reads runState and mailbox and returns a summary', async () => {
      vi.spyOn(ipcBridge.team.getRunState, 'invoke').mockResolvedValue({
        active_run: { status: 'running' } as any,
        slot_work: [{ slot_id: 'lead', role: 'lead', state: 'running' }] as any,
      });

      vi.spyOn(ipcBridge.team.listMailbox, 'invoke').mockResolvedValue([
        {
          id: 'mb-1',
          team_id: 'team-backend-analytics',
          from_agent_id: 'lead',
          to_agent_id: 'teammate-1',
          msg_type: 'task',
          content: 'Audit query latency',
          read: false,
          created_at: 1000,
          files: [],
        },
      ]);

      const res = await executeOrgToolInStore('get_project_status', {
        project_id: 'proj-analytics',
      });

      expect(res.runStatus).toBe('running');
      expect(res.backendTeamId).toBe('team-backend-analytics');
      expect(res.activeSlots).toHaveLength(1);
      expect(res.recentMessages).toHaveLength(1);
      expect(res.summary).toContain('Run status is "running"');
    });

    it('list_project_tasks reads tasks and returns task status breakdown', async () => {
      vi.spyOn(ipcBridge.team.listTasks, 'invoke').mockResolvedValue([
        { id: 'task-1', subject: 'Fix schema', status: 'completed', blocked_by: [] } as any,
        { id: 'task-2', subject: 'Run migration', status: 'in_progress', blocked_by: [] } as any,
        { id: 'task-3', subject: 'Verify indices', status: 'blocked', blocked_by: ['task-2'] } as any,
      ]);

      const res = await executeOrgToolInStore('list_project_tasks', {
        project_id: 'proj-analytics',
      });

      expect(res.backendTeamId).toBe('team-backend-analytics');
      expect(res.tasks).toHaveLength(3);
      expect(res.summary).toContain('1 completed, 1 in progress, 1 blocked');
    });
  });

  describe('4. Data model and Migration preserving backendTeamId', () => {
    it('normalizeOrgProject preserves backendTeamId', () => {
      const proj: OrgProject = {
        id: 'proj-1',
        name: 'Alpha',
        departmentId: 'dept-eng',
        teamIds: ['team-1'],
        status: 'active',
        backendTeamId: 'backend-team-99',
      };

      const normalized = normalizeOrgProject(proj);
      expect(normalized.backendTeamId).toBe('backend-team-99');
    });

    it('migrateOrgStorageV2 preserves backendTeamId across migration runs', () => {
      const hierarchy: OrgHierarchy = {
        rootCeo: {
          id: 'root-ceo',
          name: 'CEO',
          parentId: null,
          ceoAgent: {} as any,
          status: 'idle',
          lastActiveAt: null,
        },
        departments: [],
        lastUpdated: 1000,
      };

      const projects: OrgProject[] = [
        {
          id: 'proj-migrated',
          name: 'Migrated Project',
          departmentId: 'dept-1',
          teamIds: [],
          status: 'active',
          backendTeamId: 'team-existing-123',
        },
      ];

      const result = migrateOrgStorageV2(hierarchy, projects, [], 1);
      expect(result.projects[0].backendTeamId).toBe('team-existing-123');
    });
  });
});
