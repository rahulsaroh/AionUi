/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { AntigravityWorkspaceCard } from '@/renderer/pages/conversation/components/AntigravityWorkspaceCard';
import useAntigravityWorkspace from '@/renderer/pages/conversation/hooks/useAntigravityWorkspace';
import { emitter } from '@/renderer/utils/emitter';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${Object.values(params).join('/')}` : key),
  }),
}));

const mockMessages: TMessage[] = [];
let mockIsProcessing = false;

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => mockMessages,
  getMemoryCachedMessages: () => mockMessages,
}));

vi.mock('@/renderer/pages/conversation/runtime/useConversationRuntimeView', () => ({
  useConversationRuntimeView: () => ({
    isProcessing: mockIsProcessing,
    activeTurnId: 'turn-1',
    hydrated: true,
  }),
}));

const mockLaunchPreview = vi.fn();
vi.mock('@/renderer/hooks/file/usePreviewLauncher', () => ({
  usePreviewLauncher: () => ({
    launchPreview: mockLaunchPreview,
  }),
}));

const mockKillTerminal = vi.fn().mockResolvedValue({});
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      killTerminal: {
        invoke: (...args: unknown[]) => mockKillTerminal(...args),
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockMessages.length = 0;
  mockIsProcessing = false;
});

describe('useAntigravityWorkspace', () => {
  const HookTester: React.FC<{ onData: (data: ReturnType<typeof useAntigravityWorkspace>) => void }> = ({ onData }) => {
    const data = useAntigravityWorkspace('conv-1');
    React.useEffect(() => {
      onData(data);
    }, [data, onData]);
    return null;
  };

  it('extracts tasks from explicit IMessagePlan', () => {
    let extractedData: ReturnType<typeof useAntigravityWorkspace> | null = null;
    mockMessages.push({
      id: 'plan-msg-1',
      conversation_id: 'conv-1',
      type: 'plan',
      position: 'left',
      created_at: 100,
      content: {
        session_id: 'sess-1',
        entries: [
          { content: 'Design architecture', status: 'completed' },
          { content: 'Write code', status: 'in_progress' },
          { content: 'Run tests', status: 'pending' },
        ],
      },
    } as unknown as TMessage);

    render(
      <HookTester
        onData={(data) => {
          extractedData = data;
        }}
      />
    );

    expect(extractedData).not.toBeNull();
    expect(extractedData!.tasks.length).toBe(3);
    expect(extractedData!.tasks[0].title).toBe('Design architecture');
    expect(extractedData!.tasks[0].status).toBe('completed');
    expect(extractedData!.tasks[1].status).toBe('in_progress');
    expect(extractedData!.tasks[2].status).toBe('pending');
    expect(extractedData!.progress.total).toBe(3);
    expect(extractedData!.progress.completed).toBe(1);
    expect(extractedData!.progress.percentage).toBe(33);
  });

  it('extracts tasks from markdown checkboxes when no explicit plan exists', () => {
    let extractedData: ReturnType<typeof useAntigravityWorkspace> | null = null;
    mockIsProcessing = true;
    mockMessages.push({
      id: 'text-msg-1',
      conversation_id: 'conv-1',
      type: 'text',
      position: 'left',
      created_at: 200,
      content: {
        content: `Here is the plan:
- [x] Step 1: Research codebase
- [ ] Step 2: Implement components
* [ ] Step 3: Write tests`,
      },
    } as unknown as TMessage);

    render(
      <HookTester
        onData={(data) => {
          extractedData = data;
        }}
      />
    );

    expect(extractedData).not.toBeNull();
    expect(extractedData!.tasks.length).toBe(3);
    expect(extractedData!.tasks[0].title).toBe('Step 1: Research codebase');
    expect(extractedData!.tasks[0].status).toBe('completed');
    // First pending task is marked in_progress during processing
    expect(extractedData!.tasks[1].status).toBe('in_progress');
    expect(extractedData!.tasks[2].status).toBe('pending');
  });

  it('extracts running commands from acp_terminal_output and acp_tool_call', () => {
    let extractedData: ReturnType<typeof useAntigravityWorkspace> | null = null;
    mockMessages.push(
      {
        id: 'term-msg-1',
        conversation_id: 'conv-1',
        type: 'acp_terminal_output',
        position: 'left',
        created_at: 300,
        content: {
          terminal_id: 'term-1',
          command: 'bun test',
          output: '20 pass, 0 fail',
          truncated: false,
          exit_status: { exit_code: 0, signaled: false },
        },
      } as unknown as TMessage,
      {
        id: 'acp-tool-1',
        conversation_id: 'conv-1',
        type: 'acp_tool_call',
        position: 'left',
        created_at: 350,
        content: {
          update: {
            sessionUpdate: 'tool_call',
            tool_call_id: 'call-1',
            kind: 'execute',
            title: 'git status',
            status: 'completed',
            rawInput: { command: 'git status' },
            rawOutput: { exit_code: 0 },
            content: [{ type: 'content', content: { type: 'text', text: 'On branch main' } }],
          },
        },
      } as unknown as TMessage
    );

    render(
      <HookTester
        onData={(data) => {
          extractedData = data;
        }}
      />
    );

    expect(extractedData!.commands.length).toBe(2);
    expect(extractedData!.commands[0].command).toBe('bun test');
    expect(extractedData!.commands[0].status).toBe('completed');
    expect(extractedData!.commands[1].command).toBe('git status');
  });

  it('extracts file diffs and stats', () => {
    let extractedData: ReturnType<typeof useAntigravityWorkspace> | null = null;
    mockMessages.push({
      id: 'diff-msg-1',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      position: 'left',
      created_at: 400,
      content: {
        update: {
          sessionUpdate: 'tool_call',
          tool_call_id: 'call-diff-1',
          kind: 'edit',
          title: 'Edit Button.tsx',
          status: 'completed',
          content: [
            {
              type: 'diff',
              path: 'src/components/Button.tsx',
              old_text: 'export const Button = () => <div />;',
              new_text: 'export const Button = () => <span>Click</span>;',
            },
          ],
        },
      },
    } as unknown as TMessage);

    render(
      <HookTester
        onData={(data) => {
          extractedData = data;
        }}
      />
    );

    expect(extractedData!.fileChanges.length).toBe(1);
    expect(extractedData!.fileChanges[0].fileName).toBe('Button.tsx');
    expect(extractedData!.fileChanges[0].insertions).toBeGreaterThan(0);
    expect(extractedData!.fileChanges[0].deletions).toBeGreaterThan(0);
  });
});

describe('AntigravityWorkspaceCard Component', () => {
  const dummyConv: TChatConversation = {
    id: 'conv-test',
    type: 'antigravity',
    name: 'Antigravity Workspace Chat',
    created_at: 1000,
    modified_at: 1000,
  } as TChatConversation;

  it('renders quick action chips and emits sendbox.fill on click', () => {
    const emitSpy = vi.spyOn(emitter, 'emit');
    render(<AntigravityWorkspaceCard conversation={dummyConv} />);

    expect(screen.getByText('/plan')).toBeTruthy();
    expect(screen.getByText('/goal')).toBeTruthy();
    expect(screen.getByText('/grill-me')).toBeTruthy();
    expect(screen.getByText('/boost')).toBeTruthy();

    fireEvent.click(screen.getByText('/plan'));
    expect(emitSpy).toHaveBeenCalledWith('sendbox.fill', '/plan ');
  });

  it('renders task list with progress bar when tasks exist', () => {
    mockMessages.push({
      id: 'plan-1',
      conversation_id: 'conv-test',
      type: 'plan',
      position: 'left',
      created_at: 100,
      content: {
        session_id: 'sess-1',
        entries: [
          { content: 'Verify requirements', status: 'completed' },
          { content: 'Write code', status: 'pending' },
        ],
      },
    } as unknown as TMessage);

    render(<AntigravityWorkspaceCard conversation={dummyConv} />);

    expect(screen.getByText('Verify requirements')).toBeTruthy();
    expect(screen.getByText('Write code')).toBeTruthy();
  });

  it('launches preview when clicking a file diff item', () => {
    mockMessages.push({
      id: 'diff-1',
      conversation_id: 'conv-test',
      type: 'acp_tool_call',
      position: 'left',
      created_at: 100,
      content: {
        update: {
          sessionUpdate: 'tool_call',
          tool_call_id: 'c-1',
          kind: 'edit',
          title: 'Update config.ts',
          status: 'completed',
          content: [
            {
              type: 'diff',
              path: 'src/config.ts',
              old_text: 'export const port = 3000;',
              new_text: 'export const port = 8080;',
            },
          ],
        },
      },
    } as unknown as TMessage);

    render(<AntigravityWorkspaceCard conversation={dummyConv} />);

    expect(screen.getByText('config.ts')).toBeTruthy();
    fireEvent.click(screen.getByText('config.ts'));

    expect(mockLaunchPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        file_name: 'config.ts',
        contentType: 'diff',
      })
    );
  });
});
