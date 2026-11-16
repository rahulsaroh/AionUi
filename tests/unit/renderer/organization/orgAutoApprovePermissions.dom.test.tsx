/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OrgConversation, OrgHierarchy, OrgProject } from '@/types/organization';
import {
  emitOrgPermissionRequest,
  type OrgPermissionRequest,
} from '@/renderer/pages/organization/utils/orgDelegationEngine';

let storeState: Record<string, unknown>;

vi.mock('@/renderer/pages/organization/store/useOrgStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/pages/organization/store/useOrgStore')>();
  return {
    ...actual,
    useOrgStore: () => storeState,
  };
});

vi.mock('@/renderer/services/i18n', () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) || key,
    language: 'en',
    changeLanguage: vi.fn(),
  },
}));

vi.mock('@/renderer/pages/organization/utils/agentTurn', () => ({
  runAgentTurn: vi.fn(),
  buildAgentSystemContext: vi.fn(() => ''),
}));

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useModelProviderList: () => ({
    providers: [{ id: 'p1' }],
    getAvailableModels: () => ['model-1'],
    formatModelLabel: (_provider: unknown, model: string) => model,
  }),
}));

vi.mock('@/renderer/pages/organization/components/OrgModelSelector', () => ({
  OrgModelSelector: () => <span data-testid='org-model-selector'>Model</span>,
}));

vi.mock('@/renderer/pages/organization/components/OrgMasterFolderModal', () => ({
  OrgMasterFolderModal: () => null,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    shell: { openFolderWith: { invoke: vi.fn() } },
    org: {
      saveData: vi.fn(async () => undefined),
      loadData: vi.fn(async () => null),
      onLiveStep: vi.fn(() => () => {}),
    },
    conversation: { stop: { invoke: vi.fn() } },
    systemSettings: { languageChanged: { on: vi.fn(() => () => {}) } },
  },
}));

import { OrgChatView } from '@/renderer/pages/organization/components/OrgChatView';
import { setAutoApprovePermissionsInStore, getOrgStoreSnapshot } from '@/renderer/pages/organization/store/useOrgStore';

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
      model: { providerId: 'p1', modelId: 'model-ceo', modelName: 'CEO Model' },
    },
  },
  departments: [],
  lastUpdated: 1,
});

const makeConversation = (): OrgConversation => ({
  id: 'conv-ceo-1',
  title: 'CEO chat',
  type: 'ceo_directive',
  sourceNodeId: 'root-ceo',
  targetNodeId: 'root-ceo',
  timestamp: 1,
  summary: '',
  messages: [{ id: 'm1', sender: 'User', role: 'user', content: 'Hello', timestamp: 1 }],
});

describe('Auto-approve permissions & Queue in OrgChatView', () => {
  beforeEach(() => {
    localStorage.clear();
    storeState = {
      hierarchy: makeHierarchy(),
      projects: [],
      conversations: [makeConversation()],
      selectedConversationId: 'conv-ceo-1',
      setSelectedConversationId: vi.fn(),
      setOrgViewMode: vi.fn(),
      setSelectedDepartment: vi.fn(),
      setSelectedTeam: vi.fn(),
      setSelectedProject: vi.fn(),
      addOrgConversation: vi.fn(),
      addDepartment: vi.fn(),
      addSubTeam: vi.fn(),
      addOrgProject: vi.fn(),
      addTeamMember: vi.fn(),
      updateNodeStatus: vi.fn(),
      updateAgentModel: vi.fn(),
      updateRootCeo: vi.fn(),
      openChatError: null,
      clearOpenChatError: vi.fn(),
      autoApprovePermissions: 'off',
      setAutoApprovePermissions: vi.fn(),
    };
  });

  describe('Toggle persists across reload', () => {
    it('persists mode changes to localStorage via setAutoApprovePermissionsInStore', () => {
      setAutoApprovePermissionsInStore('all');
      expect(JSON.parse(localStorage.getItem('aionui:org-auto-approve-permissions')!)).toBe('all');
      expect(getOrgStoreSnapshot().autoApprovePermissions).toBe('all');

      setAutoApprovePermissionsInStore('read_only');
      expect(JSON.parse(localStorage.getItem('aionui:org-auto-approve-permissions')!)).toBe('read_only');
      expect(getOrgStoreSnapshot().autoApprovePermissions).toBe('read_only');

      setAutoApprovePermissionsInStore('off');
      expect(JSON.parse(localStorage.getItem('aionui:org-auto-approve-permissions')!)).toBe('off');
      expect(getOrgStoreSnapshot().autoApprovePermissions).toBe('off');

      // Boolean backwards compatibility
      setAutoApprovePermissionsInStore(true);
      expect(JSON.parse(localStorage.getItem('aionui:org-auto-approve-permissions')!)).toBe('all');

      setAutoApprovePermissionsInStore(false);
      expect(JSON.parse(localStorage.getItem('aionui:org-auto-approve-permissions')!)).toBe('off');
    });
  });

  describe('Queue handling in OrgChatView', () => {
    it('shows two simultaneous requests in order, never dropping or overwriting', async () => {
      render(
        <MemoryRouter>
          <OrgChatView />
        </MemoryRouter>
      );

      const respondReq1 = vi.fn().mockResolvedValue(undefined);
      const req1: OrgPermissionRequest = {
        id: 'req-1',
        conversationId: 'conv-ceo-1',
        callId: 'call-1',
        msgId: 'msg-1',
        description: 'Create file src/index.ts',
        options: [{ option_id: 'allow_once', name: 'Allow Once', kind: 'allow_once' }],
        agentName: 'Architect Agent',
        toolName: 'create_file',
        respond: respondReq1,
      };

      const respondReq2 = vi.fn().mockResolvedValue(undefined);
      const req2: OrgPermissionRequest = {
        id: 'req-2',
        conversationId: 'conv-ceo-1',
        callId: 'call-2',
        msgId: 'msg-2',
        description: 'Execute build command',
        options: [],
        agentName: 'Dev Agent',
        toolName: 'exec_cmd',
        respond: respondReq2,
      };

      // Emit both requests simultaneously
      act(() => {
        emitOrgPermissionRequest(req1);
        emitOrgPermissionRequest(req2);
      });

      // Verify req1 is displayed first
      await waitFor(() => {
        expect(screen.getByText('Create file src/index.ts')).toBeInTheDocument();
      });
      expect(screen.getByText(/Architect Agent/)).toBeInTheDocument();
      expect(screen.getByText(/create_file/)).toBeInTheDocument();
      expect(screen.getByText('1 of 2')).toBeInTheDocument();

      // req2 should NOT be in the document yet
      expect(screen.queryByText('Execute build command')).not.toBeInTheDocument();

      // Resolve req1 by clicking Allow Once
      const allowBtn = screen.getByRole('button', { name: 'Allow Once' });
      act(() => {
        fireEvent.click(allowBtn);
      });

      await waitFor(() => {
        expect(respondReq1).toHaveBeenCalledWith('allow_once');
      });

      // Now req2 should immediately appear
      await waitFor(() => {
        expect(screen.getByText('Execute build command')).toBeInTheDocument();
      });
      expect(screen.getByText(/Dev Agent/)).toBeInTheDocument();
      expect(screen.getByText(/exec_cmd/)).toBeInTheDocument();

      // Resolve req2 by clicking Deny
      const denyBtn = screen.getByRole('button', { name: 'Deny' });
      act(() => {
        fireEvent.click(denyBtn);
      });

      await waitFor(() => {
        expect(respondReq2).toHaveBeenCalledWith('deny');
      });

      // Queue is now empty, card is gone
      await waitFor(() => {
        expect(screen.queryByText('Execute build command')).not.toBeInTheDocument();
      });
    });

    it('renders setting toggle in header and changes mode when selected', async () => {
      const setAutoApproveMock = vi.fn();
      storeState.setAutoApprovePermissions = setAutoApproveMock;
      storeState.autoApprovePermissions = 'off';

      render(
        <MemoryRouter>
          <OrgChatView />
        </MemoryRouter>
      );

      const settingBtn = screen.getByTitle('Auto-approve agent tool permissions');
      expect(settingBtn).toBeInTheDocument();
      expect(settingBtn).toHaveTextContent('Permissions');

      // Click to open popover
      act(() => {
        fireEvent.click(settingBtn);
      });

      // Popover title should appear
      await waitFor(() => {
        expect(screen.getByText('Auto-approve agent tool permissions')).toBeInTheDocument();
      });
      expect(
        screen.getByText(
          'When on, agent tool requests (including shell commands) are allowed without asking. Folder and shell guards still apply.'
        )
      ).toBeInTheDocument();

      // Click read_only option
      const readOnlyRadio = screen.getByText('Read-only tools only');
      act(() => {
        fireEvent.click(readOnlyRadio);
      });

      expect(setAutoApproveMock).toHaveBeenCalledWith('read_only');
    });
  });
});
