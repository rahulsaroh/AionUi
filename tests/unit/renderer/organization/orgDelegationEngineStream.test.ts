/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgDelegationEngine } from '@/renderer/pages/organization/utils/orgDelegationEngine';
import { createDefaultOrgHierarchy } from '@/renderer/pages/organization/utils/defaultOrgSeed';
import { ipcBridge } from '@/common';
import type { OrgAgentMember } from '@/types/organization';

describe('OrgDelegationEngine responseStream handling', () => {
  let streamHandler: ((msg: unknown) => void) | undefined;
  let hierarchy: ReturnType<typeof createDefaultOrgHierarchy>;
  let engine: OrgDelegationEngine;
  let testAgent: OrgAgentMember;

  beforeEach(() => {
    vi.restoreAllMocks();
    streamHandler = undefined;
    hierarchy = createDefaultOrgHierarchy();
    engine = new OrgDelegationEngine(hierarchy, undefined, undefined, undefined, {
      simulationMode: false,
    });

    testAgent = {
      id: 'agent-1',
      name: 'Test Agent',
      role: 'project_head',
      assignedTeamIds: [],
      lastActiveAt: null,
      status: 'idle',
      model: {
        providerId: 'test-prov',
        modelId: 'test-model',
      },
    };

    vi.spyOn(ipcBridge.assistants.list, 'invoke').mockResolvedValue([]);
    vi.spyOn(ipcBridge.mode.listProviders, 'invoke').mockResolvedValue([]);
    vi.spyOn(ipcBridge.org, 'getSessionMcpServer').mockResolvedValue(null as any);
    vi.spyOn(ipcBridge.conversation.create, 'invoke').mockResolvedValue({ id: 'conv-123' } as any);
    vi.spyOn(ipcBridge.conversation.sendMessage, 'invoke').mockResolvedValue({} as any);
    vi.spyOn(ipcBridge.org, 'onLiveStep').mockReturnValue(() => {});
    vi.spyOn(ipcBridge.conversation.responseStream, 'on').mockImplementation((handler: any) => {
      streamHandler = handler;
      return () => {};
    });
    vi.spyOn(ipcBridge.database.getConversationMessages, 'invoke').mockResolvedValue({ items: [], total: 0 } as any);
  });

  it('ignores tips notice (code CLI_VERSION_NEWER) and does not return it as agent reply', async () => {
    const streamUpdates: string[] = [];
    const stepPromise = engine.runOrgAgentStep({
      agent: testAgent,
      systemPrompt: 'You are an agent',
      userDirective: 'analyze the subfolders',
      workspacePath: '',
      onStreamUpdate: (t) => streamUpdates.push(t),
    });

    const waitForStreamHandler = async () => {
      for (let i = 0; i < 50 && !streamHandler; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
    };

    await waitForStreamHandler();
    expect(streamHandler).toBeDefined();

    // Feed a tips message with CLI_VERSION_NEWER
    streamHandler!({
      conversation_id: 'conv-123',
      type: 'tips',
      data: {
        type: 'warning',
        code: 'CLI_VERSION_NEWER',
        content: 'The installed claude is newer than the version AionUi verified...',
      },
    });

    // Feed finish
    streamHandler!({
      conversation_id: 'conv-123',
      type: 'finish',
      status: 'finish',
    });

    const result = await stepPromise;
    expect(result).not.toContain('The installed claude is newer');
    expect(result).toBe(
      'The agent finished without producing a reply. Check the model/provider settings and the org MCP server.'
    );
    expect(streamUpdates).toHaveLength(0);
  });

  it('returns real content message when received', async () => {
    const streamUpdates: string[] = [];
    const stepPromise = engine.runOrgAgentStep({
      agent: testAgent,
      systemPrompt: 'You are an agent',
      userDirective: 'analyze the subfolders',
      workspacePath: '',
      onStreamUpdate: (t) => streamUpdates.push(t),
    });

    const waitForStreamHandler = async () => {
      for (let i = 0; i < 50 && !streamHandler; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
    };

    await waitForStreamHandler();
    expect(streamHandler).toBeDefined();

    // Feed tips message first (should be ignored)
    streamHandler!({
      conversation_id: 'conv-123',
      type: 'tips',
      data: {
        type: 'info',
        code: 'CLI_VERSION_NEWER',
        content: 'The installed claude is newer...',
      },
    });

    // Feed real content chunk
    streamHandler!({
      conversation_id: 'conv-123',
      type: 'content',
      data: { content: 'Folder analysis complete: 3 subfolders found.' },
    });

    // Feed finish message
    streamHandler!({
      conversation_id: 'conv-123',
      type: 'finish',
      status: 'finish',
    });

    const result = await stepPromise;
    expect(result).toBe('Folder analysis complete: 3 subfolders found.');
    expect(streamUpdates).toEqual(['Folder analysis complete: 3 subfolders found.']);
  });

  it('surfaces inference error and finishes if tips has type error', async () => {
    const stepPromise = engine.runOrgAgentStep({
      agent: testAgent,
      systemPrompt: 'You are an agent',
      userDirective: 'analyze the subfolders',
      workspacePath: '',
      onStreamUpdate: vi.fn(),
    });

    const waitForStreamHandler = async () => {
      for (let i = 0; i < 50 && !streamHandler; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
    };

    await waitForStreamHandler();
    expect(streamHandler).toBeDefined();

    streamHandler!({
      conversation_id: 'conv-123',
      type: 'tips',
      data: {
        type: 'error',
        content: 'Failed to launch Claude CLI process: binary not found',
      },
    });

    const result = await stepPromise;
    expect(result).toContain('[Inference Error: Failed to launch Claude CLI process: binary not found]');
  });

  it('surfaces visible line for permission and attempts auto-resolve', async () => {
    const confirmSpy = vi
      .spyOn(ipcBridge.conversation.confirmation.confirm, 'invoke')
      .mockResolvedValue(undefined as any);
    const streamUpdates: string[] = [];

    const stepPromise = engine.runOrgAgentStep({
      agent: testAgent,
      systemPrompt: 'You are an agent',
      userDirective: 'analyze the subfolders',
      workspacePath: '',
      onStreamUpdate: (t) => streamUpdates.push(t),
    });

    const waitForStreamHandler = async () => {
      for (let i = 0; i < 50 && !streamHandler; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
    };

    await waitForStreamHandler();
    expect(streamHandler).toBeDefined();

    streamHandler!({
      conversation_id: 'conv-123',
      msg_id: 'msg-perm-1',
      type: 'acp_permission',
      data: {
        tool_call: {
          tool_call_id: 'tc-perm-42',
          title: 'Read folder /src',
        },
        options: [{ option_id: 'allow_once', kind: 'allow_once' }],
      },
    });

    expect(confirmSpy).toHaveBeenCalledWith({
      conversation_id: 'conv-123',
      call_id: 'tc-perm-42',
      msg_id: 'msg-perm-1',
      data: { option_id: 'allow_once' },
      always_allow: false,
    });
    expect(streamUpdates.some((s) => s.includes('Agent is waiting for permission/answer: Read folder /src'))).toBe(
      true
    );

    streamHandler!({
      conversation_id: 'conv-123',
      type: 'content',
      data: 'Scanned 10 items.',
    });
    streamHandler!({
      conversation_id: 'conv-123',
      type: 'finish',
      status: 'finish',
    });

    const result = await stepPromise;
    expect(result).toContain('Agent is waiting for permission/answer: Read folder /src');
    expect(result).toContain('Scanned 10 items.');
  });

  it('dedupes consecutive identical notices but never content', async () => {
    const streamUpdates: string[] = [];
    const stepPromise = engine.runOrgAgentStep({
      agent: testAgent,
      systemPrompt: 'You are an agent',
      userDirective: 'test',
      workspacePath: '',
      onStreamUpdate: (t) => streamUpdates.push(t),
    });

    const waitForStreamHandler = async () => {
      for (let i = 0; i < 50 && !streamHandler; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
    };

    await waitForStreamHandler();
    expect(streamHandler).toBeDefined();

    // Two consecutive identical permissions
    streamHandler!({
      conversation_id: 'conv-123',
      type: 'permission',
      data: { call_id: 'c1', title: 'Run ls' },
    });
    streamHandler!({
      conversation_id: 'conv-123',
      type: 'permission',
      data: { call_id: 'c1', title: 'Run ls' },
    });

    const noticeCount = streamUpdates.filter((u) => u.includes('Run ls')).length;
    expect(noticeCount).toBe(1);

    // Two consecutive identical content chunks
    streamHandler!({
      conversation_id: 'conv-123',
      type: 'text',
      data: 'repeat ',
    });
    streamHandler!({
      conversation_id: 'conv-123',
      type: 'text',
      data: 'repeat ',
    });

    streamHandler!({
      conversation_id: 'conv-123',
      type: 'finish',
      status: 'finish',
    });

    const result = await stepPromise;
    expect(result).toContain('repeat repeat ');
  });
});
