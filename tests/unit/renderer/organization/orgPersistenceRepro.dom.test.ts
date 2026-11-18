/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { OrgDepartmentNode, OrgProject, OrgConversation } from '@/types/organization';

let mockSqliteData: Record<string, string> = {};
let mockSqliteProjects: OrgProject[] = [];

vi.mock('@/common', () => ({
  ipcBridge: {
    org: {
      saveData: vi.fn(async (key: string, value: string) => {
        mockSqliteData[key] = value;
        return true;
      }),
      loadData: vi.fn(async (key: string) => mockSqliteData[key] || null),
      getProjects: vi.fn(async (params?: { mode?: string }) => {
        if (!params?.mode) return mockSqliteProjects;
        return mockSqliteProjects.filter((p) => (p.mode || 'organization') === params.mode);
      }),
      saveProjects: vi.fn(async (params: { projects: OrgProject[]; mode?: string }) => {
        mockSqliteProjects = params.projects;
        return true;
      }),
      getMasterRoot: vi.fn(async () => '/master/root'),
      assertWithinScope: vi.fn(async (target: string) => ({ allowed: true, resolved: target })),
      getMembers: vi.fn(async () => []),
      saveMembers: vi.fn(async () => true),
    },
    team: {
      create: {
        invoke: vi.fn(async () => ({ id: 'backend-team-1' })),
      },
    },
  },
}));

vi.mock('@/renderer/services/i18n', () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) || key,
  },
}));

const STORAGE_KEYS = {
  SCOPE: 'aionui:active-scope',
  HIERARCHY: 'aionui:org-hierarchy',
  PROJECTS: 'aionui:org-projects',
  CONVERSATIONS: 'aionui:org-conversations',
  VERSION: 'aionui:org-storage-version',
};

describe('Org Persistence Repro & Settings Round-Trip', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    mockSqliteData = {};
    mockSqliteProjects = [];
    localStorage.setItem(STORAGE_KEYS.VERSION, '6');
    localStorage.setItem(STORAGE_KEYS.SCOPE, 'organization');
  });

  it('preserves department, project, and chat across unmount/remount (Settings round trip)', async () => {
    const { useOrgStore } = await import('@/renderer/pages/organization/store/useOrgStore');

    // 1. Mount first consumer (e.g. Sider/Titlebar on /organization)
    const hook1 = renderHook(() => useOrgStore());

    // Set master root on rootCeo
    act(() => {
      hook1.result.current.updateRootCeo({ workspacePath: '/master/root' });
    });

    // Create a department
    const dept: OrgDepartmentNode = {
      id: 'dept-eng',
      name: 'Engineering',
      parentDepartmentId: 'root-ceo',
      workspacePath: '/master/root/eng',
      departmentCeoAgent: {
        id: 'agent-head-eng',
        canonicalAgentId: 'canon-head-eng',
        name: 'Eng Head',
        role: 'department_head',
        status: 'idle',
      },
      teams: [],
      linkedProjects: [],
      status: 'active',
    };

    await act(async () => {
      await hook1.result.current.addDepartment(dept);
    });

    // Create a project in that department
    const proj: OrgProject = {
      id: 'proj-alpha',
      name: 'Project Alpha',
      departmentId: 'dept-eng',
      teamIds: [],
      status: 'active',
      workspacePath: '/master/root/eng/alpha',
      workspacePaths: ['/master/root/eng/alpha'],
    };

    await act(async () => {
      await hook1.result.current.addOrgProject(proj);
    });

    // Open chat in the project
    act(() => {
      const res = hook1.result.current.openChat({ type: 'project_head', id: 'proj-alpha' });
      expect(res.ok).toBe(true);
    });

    expect(hook1.result.current.hierarchy.departments.some((d) => d.id === 'dept-eng')).toBe(true);
    expect(hook1.result.current.projects.some((p) => p.id === 'proj-alpha')).toBe(true);
    expect(hook1.result.current.conversations.length).toBeGreaterThan(0);

    const savedConvCount = hook1.result.current.conversations.length;
    const initialProjectTeamIds = hook1.result.current.projects.find((p) => p.id === 'proj-alpha')?.teamIds;

    // 2. Simulate Settings visit: unmount hook1
    hook1.unmount();

    // 3. Variant: simulate backend SQLite returning empty or stale data on sync
    mockSqliteProjects = [];
    mockSqliteData[STORAGE_KEYS.PROJECTS] = JSON.stringify([]);
    mockSqliteData[STORAGE_KEYS.CONVERSATIONS] = JSON.stringify([]);

    // 4. Return from Settings: mount hook2
    const hook2 = renderHook(() => useOrgStore());

    // Wait for any microtasks / sync effects
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // ASSERT: nothing is lost!
    expect(hook2.result.current.hierarchy.departments.some((d) => d.id === 'dept-eng')).toBe(true);
    expect(hook2.result.current.projects.some((p) => p.id === 'proj-alpha')).toBe(true);
    expect(hook2.result.current.conversations.length).toBe(savedConvCount);
  });

  it('preserves data across scope switch (organization -> workplace -> organization)', async () => {
    const { useOrgStore } = await import('@/renderer/pages/organization/store/useOrgStore');

    const hook = renderHook(() => useOrgStore());

    act(() => {
      hook.result.current.updateRootCeo({ workspacePath: '/master/root' });
    });

    const dept: OrgDepartmentNode = {
      id: 'dept-design',
      name: 'Design',
      parentDepartmentId: 'root-ceo',
      workspacePath: '/master/root/design',
      departmentCeoAgent: {
        id: 'agent-head-design',
        canonicalAgentId: 'canon-head-design',
        name: 'Design Head',
        role: 'department_head',
        status: 'idle',
      },
      teams: [],
      linkedProjects: [],
      status: 'active',
    };

    await act(async () => {
      await hook.result.current.addDepartment(dept);
    });

    const proj: OrgProject = {
      id: 'proj-beta',
      name: 'Project Beta',
      departmentId: 'dept-design',
      teamIds: [],
      status: 'active',
      workspacePath: '/master/root/design/beta',
      workspacePaths: ['/master/root/design/beta'],
    };

    await act(async () => {
      await hook.result.current.addOrgProject(proj);
    });

    act(() => {
      hook.result.current.openChat({ type: 'project_head', id: 'proj-beta' });
    });

    expect(hook.result.current.projects.some((p) => p.id === 'proj-beta')).toBe(true);
    expect(hook.result.current.conversations.length).toBeGreaterThan(0);

    // Switch to workplace
    act(() => {
      hook.result.current.setActiveScope('workplace');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(hook.result.current.activeScope).toBe('workplace');

    // Switch back to organization
    act(() => {
      hook.result.current.setActiveScope('organization');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(hook.result.current.activeScope).toBe('organization');
    expect(hook.result.current.hierarchy.departments.some((d) => d.id === 'dept-design')).toBe(true);
    expect(hook.result.current.projects.some((p) => p.id === 'proj-beta')).toBe(true);
    expect(hook.result.current.conversations.length).toBeGreaterThan(0);
  });
});
