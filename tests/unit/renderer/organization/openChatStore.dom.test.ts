/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { OrgConversation, OrgHierarchy, OrgProject } from '@/types/organization';

vi.mock('@/common', () => ({
  ipcBridge: {
    org: {
      saveData: vi.fn(async () => undefined),
      loadData: vi.fn(async () => null),
      getMembers: vi.fn(async () => []),
    },
  },
}));

vi.mock('@/renderer/services/i18n', () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) || key,
  },
}));

const STORAGE_KEYS = {
  HIERARCHY: 'aionui:org-hierarchy',
  PROJECTS: 'aionui:org-projects',
  CONVERSATIONS: 'aionui:org-conversations',
  CRON_JOBS: 'aionui:org-cron-jobs',
  VERSION: 'aionui:org-storage-version',
};

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

const makeProject = (): OrgProject => ({
  id: 'proj-1',
  name: 'Project One',
  departmentId: 'dept-1',
  teamIds: ['team-1'],
  status: 'active',
  workspacePath: '/proj-one',
  path: '/proj-one',
});

const readStoredConversations = (): OrgConversation[] => {
  const raw = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
  return raw ? (JSON.parse(raw) as OrgConversation[]) : [];
};

async function mountStore() {
  const { useOrgStore } = await import('@/renderer/pages/organization/store/useOrgStore');
  return renderHook(() => useOrgStore());
}

describe('useOrgStore.openChat', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.VERSION, '6');
    localStorage.setItem(STORAGE_KEYS.HIERARCHY, JSON.stringify(makeHierarchy()));
    localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([makeProject()]));
    localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify([]));
  });

  it('creates and selects the department conversation, switches to chat mode, and persists via existing keys', async () => {
    const { result } = await mountStore();

    let outcome: { ok: boolean; error?: string } | undefined;
    act(() => {
      outcome = result.current.openChat({ type: 'department_head', id: 'dept-1' });
    });

    expect(outcome).toEqual({ ok: true });
    expect(result.current.orgViewMode).toBe('chat');
    expect(result.current.openChatError).toBeNull();
    expect(result.current.selectedConversationId).toBeTruthy();

    const stored = readStoredConversations();
    const created = stored.find((c) => c.id === result.current.selectedConversationId);
    expect(created?.departmentId).toBe('dept-1');
    expect(created?.targetRole).toBe('department_head');

    expect(localStorage.getItem(STORAGE_KEYS.HIERARCHY)).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEYS.PROJECTS)).toBeTruthy();
  });

  it('selects the existing conversation instead of creating a duplicate', async () => {
    const { result } = await mountStore();

    act(() => {
      result.current.openChat({ type: 'department_head', id: 'dept-1' });
    });
    const firstId = result.current.selectedConversationId;

    act(() => {
      result.current.openChat({ type: 'department_head', id: 'dept-1' });
    });

    expect(result.current.selectedConversationId).toBe(firstId);
    expect(readStoredConversations()).toHaveLength(1);
  });

  it('returns { ok: false, error } for an unresolvable target and sets openChatError', async () => {
    const { result } = await mountStore();

    let outcome: { ok: boolean; error?: string } | undefined;
    act(() => {
      outcome = result.current.openChat({ type: 'member', id: 'agent-missing' });
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toBeTruthy();
    expect(result.current.openChatError).toBe(outcome?.error);
    expect(result.current.selectedConversationId).toBeNull();
    expect(result.current.orgViewMode).toBe('chat');
  });
});
