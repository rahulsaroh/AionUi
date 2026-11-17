/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OrgHierarchy, OrgConversation, OrgConversationMessage } from '@/types/organization';
import { emitAskUser } from '@/renderer/pages/organization/store/orgToolExecutor';
import { getOrgStoreSnapshot, setOrgStoreSnapshot } from '@/renderer/pages/organization/store/useOrgStore';

const { runAgentTurnMock } = vi.hoisted(() => ({ runAgentTurnMock: vi.fn() }));

let storeState: Record<string, unknown>;

vi.mock('@/renderer/services/i18n', () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) || key,
    language: 'en',
    changeLanguage: vi.fn(),
  },
}));

vi.mock('@/renderer/pages/organization/store/useOrgStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/pages/organization/store/useOrgStore')>();
  return {
    ...actual,
    useOrgStore: () => storeState,
  };
});

vi.mock('@/renderer/pages/organization/utils/agentTurn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/pages/organization/utils/agentTurn')>();
  return { ...actual, runAgentTurn: runAgentTurnMock };
});

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useModelProviderList: () => ({
    providers: [{ id: 'p1' }],
    getAvailableModels: () => ['model-ceo'],
    formatModelLabel: (_provider: unknown, model: string) => model,
  }),
}));

vi.mock('@/renderer/pages/organization/components/OrgModelSelector', () => ({
  OrgModelSelector: ({ currentModel }: { currentModel?: { modelName?: string; modelId?: string } }) => (
    <span data-testid='org-model-selector'>{currentModel?.modelName || currentModel?.modelId || 'No model'}</span>
  ),
}));

vi.mock('@/renderer/pages/organization/components/OrgMasterFolderModal', () => ({
  OrgMasterFolderModal: () => null,
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    shell: { openFolderWith: { invoke: vi.fn(async () => undefined) } },
    org: {
      saveData: vi.fn(async () => undefined),
      loadData: vi.fn(async () => null),
      onLiveStep: vi.fn(() => () => {}),
    },
    conversation: { stop: { invoke: vi.fn(async () => undefined) } },
  },
}));

import { OrgChatView } from '@/renderer/pages/organization/components/OrgChatView';

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

const makeCeoConversation = (messages: OrgConversationMessage[] = []): OrgConversation => ({
  id: 'conv-ceo-1',
  title: 'CEO chat',
  type: 'ceo_directive',
  sourceNodeId: 'root-ceo',
  targetNodeId: 'root-ceo',
  timestamp: 1,
  summary: '',
  messages,
});

const renderView = () =>
  render(
    <MemoryRouter>
      <OrgChatView />
    </MemoryRouter>
  );

const sendPrompt = async (text: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
};

describe('OrgChatView Ask User and Proposal Approval Paths', () => {
  beforeEach(() => {
    runAgentTurnMock.mockReset();
    runAgentTurnMock.mockImplementation(() => ({
      events: (async function* () {
        yield { type: 'text-delta', data: { text: 'CEO turn completed' } };
        yield { type: 'done', data: { finalSynthesis: 'CEO turn completed' } };
      })(),
      cancel: vi.fn(),
    }));

    setOrgStoreSnapshot({
      approvedLineups: [],
    });

    storeState = {
      hierarchy: makeHierarchy(),
      projects: [],
      conversations: [makeCeoConversation()],
      selectedConversationId: 'conv-ceo-1',
      setSelectedConversationId: vi.fn(),
      setOrgViewMode: vi.fn(),
      setSelectedDepartment: vi.fn(),
      setSelectedTeam: vi.fn(),
      setSelectedProject: vi.fn(),
      addOrgConversation: vi.fn(),
      updateNodeStatus: vi.fn(),
      addDepartment: vi.fn(),
      addSubTeam: vi.fn(),
      addOrgProject: vi.fn(),
      addTeamMember: vi.fn(),
      activeScope: 'organization',
      approvedLineups: [],
    };
  });

  it('handles affirmative reply to ask_user via chat path and appends approved_lineup_id to prompt', async () => {
    renderView();

    // 1. Simulate CEO tool call asking user to recruit members
    emitAskUser({
      asked: true,
      question: 'Should we recruit Alex as QA Lead and Sam as Architect?',
      members: [
        { name: 'Alex', role: 'QA Lead', assistant_id: 'ast-qa' },
        { name: 'Sam', role: 'Architect', assistant_id: 'ast-arch' },
      ],
      projectId: 'proj-core',
    });

    // 2. User replies affirmatively in the chat box
    await sendPrompt('Yes, approve this recruitment');

    // 3. Verify runAgentTurn received userText containing approved_lineup_id
    await waitFor(() => expect(runAgentTurnMock).toHaveBeenCalledTimes(1));

    const turnOptions = runAgentTurnMock.mock.calls[0][0];
    expect(turnOptions.userText).toContain('Yes, approve this recruitment');
    expect(turnOptions.userText).toMatch(/approved_lineup_id=lineup-[a-zA-Z0-9_-]+/);

    // 4. Verify the lineup record was recorded in store
    const storeSnapshot = getOrgStoreSnapshot();
    expect(storeSnapshot.approvedLineups.length).toBeGreaterThan(0);
    const recordedLineup = storeSnapshot.approvedLineups[0];
    expect(turnOptions.userText).toContain(`approved_lineup_id=${recordedLineup.id}`);
  });

  it('includes proposal approval message with approved_lineup_id in the next prompt to CEO agent', async () => {
    // 1. Set up conversation history where user previously clicked Approve on a proposal
    const lineupId = 'lineup-approved-test-123';
    const convWithApproval = makeCeoConversation([
      {
        id: 'msg-1',
        sender: 'User',
        role: 'user',
        content: 'I need a mobile team',
        timestamp: 100,
      },
      {
        id: 'msg-2',
        sender: 'CEO',
        role: 'assistant',
        content: 'I have proposed the Mobile Department and Team.',
        timestamp: 200,
      },
      {
        id: 'msg-3',
        sender: 'System',
        role: 'system',
        content: `Created:\nApproved and instantiated 2 organizational entities.\nUser approved the proposal. approved_lineup_id=${lineupId}. Use this id in assign_task.`,
        timestamp: 300,
      },
    ]);

    storeState = {
      ...storeState,
      conversations: [convWithApproval],
      selectedConversationId: 'conv-ceo-1',
    };

    renderView();

    // 2. User sends the next message to the CEO
    await sendPrompt('Assign the task to begin building the iOS app');

    // 3. Verify runAgentTurn received conversation containing the approval message
    await waitFor(() => expect(runAgentTurnMock).toHaveBeenCalledTimes(1));

    const turnOptions = runAgentTurnMock.mock.calls[0][0];
    expect(turnOptions.conversation).toBeDefined();

    const messages = turnOptions.conversation?.messages || [];
    const approvalMsg = messages.find(
      (m: OrgConversationMessage) => m.role === 'system' && m.content.includes(`approved_lineup_id=${lineupId}`)
    );
    expect(approvalMsg).toBeDefined();
    expect(approvalMsg?.content).toContain(`approved_lineup_id=${lineupId}`);
  });
});
