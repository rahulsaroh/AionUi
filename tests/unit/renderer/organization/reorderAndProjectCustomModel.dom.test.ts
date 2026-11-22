/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { OrgHierarchy, OrgProject } from '@/types/organization';
import { createProjectBackendTeam, pickLeadAssistant } from '@/renderer/pages/organization/store/orgBackendTeam';

vi.mock('@/common', () => ({
  ipcBridge: {
    org: {
      saveData: vi.fn(async () => undefined),
      loadData: vi.fn(async () => null),
      getMembers: vi.fn(async () => []),
      getProjects: vi.fn(async () => []),
      saveProjects: vi.fn(async () => true),
      getMasterRoot: vi.fn(async () => '/root'),
      assertWithinScope: vi.fn(async (p: string) => ({ allowed: true, resolved: p })),
    },
    assistants: {
      list: { invoke: vi.fn(async () => []) },
      get: { invoke: vi.fn(async () => null) },
    },
    team: {
      create: { invoke: vi.fn(async () => ({ id: 'backend-team-1' })) },
      get: { invoke: vi.fn(async () => null) },
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
    },
  },
  departments: [
    {
      id: 'dept-1',
      name: 'Engineering',
      parentDepartmentId: 'root-ceo',
      workspacePath: '/root/eng',
      status: 'idle',
      lastActiveAt: 1,
      linkedProjects: [],
      departmentCeoAgent: {
        id: 'agent-dept-1',
        canonicalAgentId: 'canon-dept-1',
        name: 'Head 1',
        title: 'Department Head',
        role: 'department_head',
        assignedTeamIds: [],
        status: 'idle',
        lastActiveAt: 1,
      },
      teams: [],
    },
    {
      id: 'dept-2',
      name: 'Design',
      parentDepartmentId: 'root-ceo',
      workspacePath: '/root/design',
      status: 'idle',
      lastActiveAt: 1,
      linkedProjects: [],
      departmentCeoAgent: {
        id: 'agent-dept-2',
        canonicalAgentId: 'canon-dept-2',
        name: 'Head 2',
        title: 'Department Head',
        role: 'department_head',
        assignedTeamIds: [],
        status: 'idle',
        lastActiveAt: 1,
      },
      teams: [],
    },
    {
      id: 'dept-3',
      name: 'Marketing',
      parentDepartmentId: 'root-ceo',
      workspacePath: '/root/marketing',
      status: 'idle',
      lastActiveAt: 1,
      linkedProjects: [],
      departmentCeoAgent: {
        id: 'agent-dept-3',
        canonicalAgentId: 'canon-dept-3',
        name: 'Head 3',
        title: 'Department Head',
        role: 'department_head',
        assignedTeamIds: [],
        status: 'idle',
        lastActiveAt: 1,
      },
      teams: [],
    },
  ],
  lastUpdated: 1,
});

describe('useOrgStore: reorderDepartments, reorderProjects and custom model integration', () => {
  beforeEach(async () => {
    localStorage.clear();
    const { setOrgStoreSnapshot } = await import('@/renderer/pages/organization/store/useOrgStore');
    setOrgStoreSnapshot({
      hierarchy: makeHierarchy(),
      projects: [
        {
          id: 'proj-1',
          name: 'Alpha',
          departmentId: 'dept-1',
          teamIds: [],
          status: 'active',
          model: { providerId: 'custom-provider', modelId: 'custom-llama-3', modelName: 'Custom Llama 3' },
        },
        {
          id: 'proj-2',
          name: 'Beta',
          departmentId: 'dept-1',
          teamIds: [],
          status: 'active',
        },
        {
          id: 'proj-3',
          name: 'Gamma',
          departmentId: 'dept-1',
          teamIds: [],
          status: 'active',
        },
      ],
      conversations: [],
      selectedConversationId: null,
      selectedProjectId: null,
      selectedDepartmentId: null,
    });
  });

  it('reorders departments correctly when dragging up or down', async () => {
    const { useOrgStore } = await import('@/renderer/pages/organization/store/useOrgStore');
    const { result } = renderHook(() => useOrgStore());

    expect(result.current.hierarchy.departments.map((d) => d.id)).toEqual(['dept-1', 'dept-2', 'dept-3']);

    // Move dept-3 to index 0 (drag up)
    act(() => {
      result.current.reorderDepartments(2, 0);
    });

    expect(result.current.hierarchy.departments.map((d) => d.id)).toEqual(['dept-3', 'dept-1', 'dept-2']);

    // Move index 0 to index 2 (drag down)
    act(() => {
      result.current.reorderDepartments(0, 2);
    });

    expect(result.current.hierarchy.departments.map((d) => d.id)).toEqual(['dept-1', 'dept-2', 'dept-3']);
  });

  it('reorders projects correctly by project ids', async () => {
    const { useOrgStore } = await import('@/renderer/pages/organization/store/useOrgStore');
    const { result } = renderHook(() => useOrgStore());

    expect(result.current.projects.map((p) => p.id)).toEqual(['proj-1', 'proj-2', 'proj-3']);

    // Move proj-3 to position of proj-1
    act(() => {
      result.current.reorderProjects('proj-3', 'proj-1');
    });

    expect(result.current.projects.map((p) => p.id)).toEqual(['proj-3', 'proj-1', 'proj-2']);
  });

  it('creates new project chat with project custom model when openChat createNew is called', async () => {
    const { useOrgStore } = await import('@/renderer/pages/organization/store/useOrgStore');
    const { result } = renderHook(() => useOrgStore());

    let res: { ok: boolean; error?: string } = { ok: false };
    act(() => {
      res = result.current.openChat({ type: 'project_head', id: 'proj-1', createNew: true });
    });

    expect(res.ok).toBe(true);
    expect(result.current.selectedConversationId).toBeTruthy();

    const createdConv = result.current.conversations.find((c) => c.id === result.current.selectedConversationId);
    expect(createdConv).toBeDefined();
    expect(createdConv?.projectId).toBe('proj-1');
    expect(createdConv?.targetAgentModel).toEqual({
      providerId: 'custom-provider',
      modelId: 'custom-llama-3',
      modelName: 'Custom Llama 3',
    });
  });

  it('createProjectBackendTeam respects preferredModel and preferredAssistantId', async () => {
    const { ipcBridge } = await import('@/common');
    vi.mocked(ipcBridge.assistants.list.invoke).mockResolvedValue([
      {
        id: 'ast-aionrs',
        name: 'Aion CLI',
        enabled: true,
        team_selectable: true,
        agent: { type: 'aionrs', source: 'builtin' },
      } as any,
      {
        id: 'ast-claude',
        name: 'Claude Cowork',
        enabled: true,
        team_selectable: true,
        agent: { type: 'claude', source: 'builtin' },
      } as any,
    ]);

    const lead = await pickLeadAssistant();
    // With updated pickLeadAssistant, Aion CLI (which supports custom models) is preferred over Claude
    expect(lead.id).toBe('ast-aionrs');

    await createProjectBackendTeam({
      name: 'Custom Project',
      workspacePath: '/root/eng/custom',
      preferredAssistantId: 'ast-aionrs',
      preferredModel: {
        providerId: 'custom-ollama',
        modelId: 'qwen2.5-coder:32b',
        modelName: 'Qwen 2.5 Coder',
      },
    });

    expect(ipcBridge.team.create.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Custom Project',
        workspace: '/root/eng/custom',
        agents: [
          expect.objectContaining({
            role: 'leader',
            assistant_id: 'ast-aionrs',
            model: 'qwen2.5-coder:32b',
          }),
        ],
      })
    );
  });

  it('addDepartment creates department without auto-adding general project or team', async () => {
    const { useOrgStore, setOrgStoreSnapshot } = await import('@/renderer/pages/organization/store/useOrgStore');
    const { createDepartmentShell } = await import('@/renderer/pages/organization/utils/orgCoherence');

    setOrgStoreSnapshot({
      hierarchy: makeHierarchy(),
      projects: [],
      conversations: [],
    });

    const { result } = renderHook(() => useOrgStore());
    await act(async () => {
      await result.current.addDepartment(createDepartmentShell('Legal'));
    });

    const legalDept = result.current.hierarchy.departments.find((d) => d.name === 'Legal');
    expect(legalDept).toBeDefined();
    expect(legalDept!.teams).toEqual([]);

    const generalProject = result.current.projects.find((p) => p.departmentId === legalDept!.id);
    expect(generalProject).toBeUndefined();
  });
});
