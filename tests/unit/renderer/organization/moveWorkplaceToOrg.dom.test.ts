/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import type { TTeam } from '@/common/types/team/teamTypes';
import type { OrgHierarchy } from '@/types/organization';
import { fromBackendTeam } from '@/common/adapter/teamMapper';

const {
  updateTeamMock,
  teamCreateMock,
  assistantsListMock,
  transferWorkspaceFilesMock,
  getMasterRootMock,
  assertWithinScopeMock,
  saveProjectsMock,
  saveDataMock,
  getConversationMessagesMock,
  conversationUpdateMock,
  handbookCreateMock,
  emitterEmitMock,
} = vi.hoisted(() => ({
  updateTeamMock: vi.fn(async () => undefined),
  teamCreateMock: vi.fn(async () => ({ id: 'org-backend-team-1' })),
  assistantsListMock: vi.fn(async () => [
    { id: 'ast-claude', name: 'Claude Lead', enabled: true, team_selectable: true },
  ]),
  transferWorkspaceFilesMock: vi.fn(async () => ({ success: true, movedCount: 3 })),
  getMasterRootMock: vi.fn(async () => '/company/hq'),
  assertWithinScopeMock: vi.fn(async (targetPath: string, allowedRoot: string) => {
    const normTarget = targetPath.replace(/\\/g, '/').toLowerCase();
    const normRoot = allowedRoot.replace(/\\/g, '/').toLowerCase();
    const allowed = normTarget === normRoot || normTarget.startsWith(`${normRoot}/`);
    return {
      allowed,
      reason: allowed ? undefined : `Folder "${targetPath}" is outside "${allowedRoot}"`,
      resolved: targetPath,
    };
  }),
  saveProjectsMock: vi.fn(async () => true),
  saveDataMock: vi.fn(async () => true),
  getConversationMessagesMock: vi.fn(async () => ({ items: [] })),
  conversationUpdateMock: vi.fn(async () => true),
  handbookCreateMock: vi.fn(async () => undefined),
  emitterEmitMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      updateTeam: { invoke: updateTeamMock },
      create: { invoke: teamCreateMock },
    },
    assistants: {
      list: { invoke: assistantsListMock },
    },
    fs: {
      transferWorkspaceFiles: { invoke: transferWorkspaceFilesMock },
    },
    org: {
      getMasterRoot: getMasterRootMock,
      assertWithinScope: assertWithinScopeMock,
      saveProjects: saveProjectsMock,
      saveData: saveDataMock,
      loadData: vi.fn(async () => null),
      getProjects: vi.fn(async () => []),
      getMembers: vi.fn(async () => []),
    },
    database: {
      getConversationMessages: { invoke: getConversationMessagesMock },
    },
    conversation: {
      update: { invoke: conversationUpdateMock },
    },
  },
}));

vi.mock('@/common/adapter/ipcBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/common/adapter/ipcBridge')>();
  return {
    ...actual,
    memberHandbook: {
      ...actual.memberHandbook,
      create: handbookCreateMock,
    },
  };
});

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: emitterEmitMock,
  },
}));

vi.mock('@/renderer/services/i18n', () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) || key,
  },
}));

import {
  getOrgStoreSnapshot,
  getOrganizationBackendTeamIds,
  resetOrgStoreForTesting,
  setOrgStoreSnapshot,
} from '@/renderer/pages/organization/store/useOrgStore';
import {
  moveWorkplaceProjectToOrg,
  moveWorkplaceTeamToOrg,
} from '@/renderer/pages/organization/store/moveWorkplaceToOrg';

function createBaseHierarchy(masterRoot: string | null = '/company/hq'): OrgHierarchy {
  return {
    rootCeo: {
      id: 'root-ceo',
      name: 'HQ',
      parentId: null,
      workspacePath: masterRoot,
      status: 'idle',
      lastActiveAt: 1000,
      ceoAgent: {
        id: 'agent-ceo',
        canonicalAgentId: 'c-ceo',
        name: 'CEO',
        role: 'ceo',
        assignedTeamIds: [],
        lastActiveAt: 1000,
        status: 'idle',
      },
    },
    departments: [
      {
        id: 'dept-eng',
        name: 'Engineering',
        parentDepartmentId: 'root-ceo',
        workspacePath: masterRoot ? `${masterRoot}/departments/engineering` : null,
        status: 'idle',
        lastActiveAt: 1000,
        linkedProjects: [],
        teams: [],
        departmentCeoAgent: {
          id: 'agent-head-eng',
          canonicalAgentId: 'c-head-eng',
          name: 'Eng Head',
          role: 'department_head',
          assignedTeamIds: [],
          lastActiveAt: 1000,
          status: 'idle',
        },
      },
    ],
    lastUpdated: 1000,
  };
}

function makeWorkplaceTeam(overrides: Partial<TTeam> = {}): TTeam {
  return {
    id: 'wp-team-1',
    user_id: 'user-1',
    name: 'Awesome App Team',
    workspace: '/workplace/awesome-app',
    workspace_mode: 'shared',
    leader_assistant_id: 'slot-lead',
    description: 'Perfected fullstack app team',
    created_at: 1000,
    updated_at: 2000,
    assistants: [
      {
        slot_id: 'slot-lead',
        conversation_id: 'conv-lead',
        role: 'leader',
        assistant_backend: 'claude',
        assistant_name: 'Architect',
        assistant_id: 'ast-arch',
        model: 'claude-3-7-sonnet',
        status: 'idle',
        context_reset: { supported: true, availability: 'ready' },
      },
      {
        slot_id: 'slot-qa',
        conversation_id: 'conv-qa',
        role: 'teammate',
        assistant_backend: 'aionrs',
        assistant_name: 'QA Reviewer',
        assistant_id: 'ast-qa',
        model: 'gpt-4o',
        status: 'idle',
        context_reset: { supported: true, availability: 'ready' },
        learnedSkills: [{ id: 'sk-1', title: 'e2e-testing', description: 'Runs tests', extractedAt: 100 }],
      },
    ],
    ...overrides,
  };
}

describe('moveWorkplaceToOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetOrgStoreForTesting();
    setOrgStoreSnapshot({
      activeScope: 'workplace',
      hierarchy: createBaseHierarchy('/company/hq'),
      projects: [],
      members: [],
      conversations: [],
    });
  });

  describe('moveWorkplaceTeamToOrg', () => {
    it('moves a Workplace team into an existing department with linked project and files', async () => {
      const team = makeWorkplaceTeam();
      const result = await moveWorkplaceTeamToOrg({
        team,
        departmentId: 'dept-eng',
        targetWorkspace: '/company/hq/departments/engineering/awesome-app-team',
        fileTransferMode: 'copy',
        createLinkedProject: true,
      });

      expect(result.departmentId).toBe('dept-eng');
      expect(result.movedTeamIds).toEqual(['wp-team-1']);
      expect(result.status).toBe('active');
      expect(transferWorkspaceFilesMock).toHaveBeenCalledWith({
        sourcePath: '/workplace/awesome-app',
        targetPath: '/company/hq/departments/engineering/awesome-app-team',
        operation: 'copy',
      });
      expect(updateTeamMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'wp-team-1',
          workspace: '/company/hq/departments/engineering/awesome-app-team',
          parent_id: null,
          mode: 'organization',
        })
      );

      const snapshot = getOrgStoreSnapshot();
      expect(snapshot.activeScope).toBe('workplace');
      const dept = snapshot.hierarchy.departments.find((d) => d.id === 'dept-eng')!;
      expect(dept.teams).toHaveLength(1);
      expect(dept.teams[0].backendTeamId).toBe('wp-team-1');
      expect(dept.teams[0].teamLeadAgent.name).toBe('Architect');
      expect(dept.teams[0].specialistMembers[0].skills).toEqual(['e2e-testing']);
      expect(getOrganizationBackendTeamIds().has('wp-team-1')).toBe(true);
    });

    it('creates a new department and moves descendant sub-teams together', async () => {
      const rootTeam = makeWorkplaceTeam();
      const subTeam = makeWorkplaceTeam({
        id: 'wp-subteam-1',
        name: 'Mobile Subteam',
        parentId: 'wp-team-1',
        workspace: '/workplace/awesome-app/mobile',
      });

      const result = await moveWorkplaceTeamToOrg({
        team: rootTeam,
        subTeams: [subTeam],
        newDepartmentName: 'Product Studio',
        targetWorkspace: '/company/hq/departments/product-studio/awesome-app-team',
        fileTransferMode: 'move',
      });

      expect(result.movedTeamIds).toEqual(['wp-team-1', 'wp-subteam-1']);
      const snapshot = getOrgStoreSnapshot();
      const createdDept = snapshot.hierarchy.departments.find((d) => d.name === 'Product Studio');
      expect(createdDept).toBeDefined();
      expect(createdDept?.teams.map((t) => t.backendTeamId)).toEqual(['wp-team-1', 'wp-subteam-1']);
    });

    it('rejects target workspace outside the department root without mutating state', async () => {
      const team = makeWorkplaceTeam();
      await expect(
        moveWorkplaceTeamToOrg({
          team,
          departmentId: 'dept-eng',
          targetWorkspace: '/outside/evil-folder',
        })
      ).rejects.toThrow(/outside/i);

      expect(updateTeamMock).not.toHaveBeenCalled();
      expect(getOrgStoreSnapshot().hierarchy.departments[0].teams).toHaveLength(0);
    });

    it('throws when department does not exist', async () => {
      await expect(
        moveWorkplaceTeamToOrg({
          team: makeWorkplaceTeam(),
          departmentId: 'dept-missing',
        })
      ).rejects.toThrow(/department was not found/i);
    });
  });

  describe('moveWorkplaceProjectToOrg', () => {
    it('moves a Workplace project and its conversation history into an Organization department', async () => {
      getConversationMessagesMock.mockResolvedValueOnce({
        items: [
          {
            id: 'm1',
            conversation_id: 'conv-1',
            type: 'text',
            position: 'right',
            content: { content: 'Build the billing module' },
            created_at: 1001,
          },
          {
            id: 'm2',
            conversation_id: 'conv-1',
            type: 'text',
            position: 'left',
            content: { content: 'Done! All tests pass.' },
            created_at: 1002,
          },
        ],
      } as never);

      const conversations = [
        {
          id: 'conv-1',
          name: 'Billing Sprint',
          type: 'acp',
          created_at: 1000,
          modified_at: 2000,
          extra: { workspace: '/workplace/billing-app', custom_workspace: true },
        } as unknown as TChatConversation,
      ];

      const result = await moveWorkplaceProjectToOrg({
        projectName: 'Billing App',
        sourceWorkspace: '/workplace/billing-app',
        conversations,
        departmentId: 'dept-eng',
        targetWorkspace: '/company/hq/departments/engineering/billing-app',
        fileTransferMode: 'copy',
        removeFromWorkplace: true,
      });

      expect(result.departmentId).toBe('dept-eng');
      expect(result.movedConversationIds).toEqual(['conv-1']);
      expect(transferWorkspaceFilesMock).toHaveBeenCalledWith({
        sourcePath: '/workplace/billing-app',
        targetPath: '/company/hq/departments/engineering/billing-app',
        operation: 'copy',
      });
      expect(conversationUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'conv-1',
          merge_extra: true,
          updates: expect.objectContaining({
            extra: expect.objectContaining({
              mode: 'organization',
              workspace: '/company/hq/departments/engineering/billing-app',
            }),
          }),
        })
      );
      expect(emitterEmitMock).toHaveBeenCalledWith('chat.history.refresh');

      const storedOrgs = JSON.parse(localStorage.getItem('aionui:org-projects') || '[]');
      expect(storedOrgs).toHaveLength(1);
      expect(storedOrgs[0].backendTeamId).toBe('org-backend-team-1');

      const storedConvs = JSON.parse(localStorage.getItem('aionui:org-conversations') || '[]');
      expect(storedConvs).toHaveLength(1);
      expect(storedConvs[0].messages).toHaveLength(2);
      expect(storedConvs[0].projectId).toBe(result.orgProjectId);
    });

    it('keeps Workplace copy intact and still succeeds if backend team creation fails', async () => {
      teamCreateMock.mockRejectedValueOnce(new Error('backend offline'));
      const conversations = [
        {
          id: 'conv-2',
          name: 'Copy Thread',
          type: 'aionrs',
          created_at: 1000,
          modified_at: 2000,
          extra: { workspace: '/workplace/copy-app', custom_workspace: true },
        } as unknown as TChatConversation,
      ];

      const result = await moveWorkplaceProjectToOrg({
        projectName: 'Copy App',
        sourceWorkspace: '/workplace/copy-app',
        conversations,
        departmentId: 'dept-eng',
        targetWorkspace: '/company/hq/departments/engineering/copy-app',
        removeFromWorkplace: false,
      });

      expect(result.movedConversationIds).toEqual([]);
      expect(conversationUpdateMock).not.toHaveBeenCalled();
      expect(emitterEmitMock).not.toHaveBeenCalled();
    });

    it('throws when projectName is empty', async () => {
      await expect(
        moveWorkplaceProjectToOrg({
          projectName: '   ',
          sourceWorkspace: '/workplace/x',
          conversations: [],
          departmentId: 'dept-eng',
        })
      ).rejects.toThrow(/cannot be empty/i);
    });
  });

  describe('fromBackendTeam mode mapping', () => {
    it('preserves mode from top-level or custom_metadata and ignores invalid values', () => {
      expect(fromBackendTeam({ id: 't1', mode: 'organization', assistants: [] }).mode).toBe('organization');
      expect(
        fromBackendTeam({
          id: 't2',
          custom_metadata: JSON.stringify({ mode: 'workplace' }),
          assistants: [],
        }).mode
      ).toBe('workplace');
      expect(fromBackendTeam({ id: 't3', mode: 'invalid', assistants: [] }).mode).toBeUndefined();
    });
  });
});
