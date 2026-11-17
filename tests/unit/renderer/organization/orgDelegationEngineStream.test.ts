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
    vi.spyOn(ipcBridge.mode.listProviders, 'invoke').mockResolvedValue([
      { id: 'test-prov', enabled: true, models: ['test-model'] } as any,
    ]);
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

  it('auto-resolves permission when autoApprovePermissions is true', async () => {
    const autoEngine = new OrgDelegationEngine(hierarchy, undefined, undefined, undefined, {
      simulationMode: false,
      autoApprovePermissions: true,
    });
    const confirmSpy = vi
      .spyOn(ipcBridge.conversation.confirmation.confirm, 'invoke')
      .mockResolvedValue(undefined as any);
    const streamUpdates: string[] = [];

    const stepPromise = autoEngine.runOrgAgentStep({
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

  it('emits permission request and waits for user click when autoApprovePermissions is false (default)', async () => {
    const manualEngine = new OrgDelegationEngine(hierarchy, undefined, undefined, undefined, {
      simulationMode: false,
      autoApprovePermissions: false,
    });
    const confirmSpy = vi
      .spyOn(ipcBridge.conversation.confirmation.confirm, 'invoke')
      .mockResolvedValue(undefined as any);
    const streamUpdates: string[] = [];

    let capturedRequest: import('@/renderer/pages/organization/utils/orgDelegationEngine').OrgPermissionRequest | null =
      null;
    const unsub = (await import('@/renderer/pages/organization/utils/orgDelegationEngine')).onOrgPermissionRequested(
      (req) => {
        capturedRequest = req;
      }
    );

    const stepPromise = manualEngine.runOrgAgentStep({
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
      msg_id: 'msg-perm-manual-1',
      type: 'acp_permission',
      data: {
        tool_call: {
          tool_call_id: 'tc-perm-99',
          title: 'Delete old artifacts',
        },
        options: [{ option_id: 'allow_once', kind: 'allow_once', name: 'Allow Once' }],
      },
    });

    // Permission is NOT auto-confirmed immediately
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(capturedRequest).toBeDefined();
    expect(capturedRequest!.callId).toBe('tc-perm-99');
    expect(capturedRequest!.description).toBe('Delete old artifacts');

    // Simulate user clicking allow_once in UI
    await capturedRequest!.respond('allow_once');

    expect(confirmSpy).toHaveBeenCalledWith({
      conversation_id: 'conv-123',
      call_id: 'tc-perm-99',
      msg_id: 'msg-perm-manual-1',
      data: { option_id: 'allow_once' },
      always_allow: false,
    });

    streamHandler!({
      conversation_id: 'conv-123',
      type: 'content',
      data: 'Artifacts cleared.',
    });
    streamHandler!({
      conversation_id: 'conv-123',
      type: 'finish',
      status: 'finish',
    });

    const result = await stepPromise;
    expect(result).toContain('Artifacts cleared.');
    unsub();
  });

  it('read_only auto-approve mode approves scan_folder but asks for create_department and shell', async () => {
    const readOnlyEngine = new OrgDelegationEngine(hierarchy, undefined, undefined, undefined, {
      simulationMode: false,
      autoApprovePermissions: 'read_only',
    });
    const confirmSpy = vi
      .spyOn(ipcBridge.conversation.confirmation.confirm, 'invoke')
      .mockResolvedValue(undefined as any);
    const streamUpdates: string[] = [];

    let capturedRequest: import('@/renderer/pages/organization/utils/orgDelegationEngine').OrgPermissionRequest | null =
      null;
    const unsub = (await import('@/renderer/pages/organization/utils/orgDelegationEngine')).onOrgPermissionRequested(
      (req) => {
        capturedRequest = req;
      }
    );

    const stepPromise = readOnlyEngine.runOrgAgentStep({
      agent: testAgent,
      systemPrompt: 'You are an agent',
      userDirective: 'scan and create',
      workspacePath: '',
      onStreamUpdate: (t) => streamUpdates.push(t),
    });

    for (let i = 0; i < 50 && !streamHandler; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(streamHandler).toBeDefined();

    // 1. scan_folder -> auto-approved
    streamHandler!({
      conversation_id: 'conv-123',
      msg_id: 'msg-scan-1',
      type: 'acp_permission',
      data: {
        tool_call: {
          tool_call_id: 'tc-scan',
          name: 'scan_folder',
          title: 'scan_folder /src',
        },
        options: [{ option_id: 'allow_once', kind: 'allow_once', name: 'Allow Once' }],
      },
    });

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        call_id: 'tc-scan',
        conversation_id: 'conv-123',
      })
    );
    expect(capturedRequest).toBeNull();

    // 2. create_department -> requires confirmation (asks user)
    confirmSpy.mockClear();
    streamHandler!({
      conversation_id: 'conv-123',
      msg_id: 'msg-create-1',
      type: 'acp_permission',
      data: {
        tool_call: {
          tool_call_id: 'tc-create',
          name: 'create_department',
          title: 'Create Engineering Department',
        },
        options: [{ option_id: 'allow_once', kind: 'allow_once', name: 'Allow Once' }],
      },
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.callId).toBe('tc-create');
    expect(capturedRequest!.agentName).toBe(testAgent.name);
    expect(capturedRequest!.toolName).toBe('create_department');

    // Respond to unblock
    await capturedRequest!.respond('allow_once');
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        call_id: 'tc-create',
      })
    );

    // 3. shell tool -> requires confirmation even in read_only mode
    capturedRequest = null;
    confirmSpy.mockClear();
    streamHandler!({
      conversation_id: 'conv-123',
      msg_id: 'msg-shell-1',
      type: 'acp_permission',
      data: {
        tool_call: {
          tool_call_id: 'tc-shell',
          name: 'bash',
          title: 'Run bash echo',
        },
        options: [{ option_id: 'allow_once', kind: 'allow_once', name: 'Allow Once' }],
      },
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.callId).toBe('tc-shell');

    await capturedRequest!.respond('allow_once');

    streamHandler!({
      conversation_id: 'conv-123',
      type: 'finish',
      status: 'finish',
    });

    await stepPromise;
    unsub();
  });

  it('reads live store value without restarting engine when option is omitted', async () => {
    const { setAutoApprovePermissionsInStore } = await import('@/renderer/pages/organization/store/useOrgStore');
    setAutoApprovePermissionsInStore('all');

    const liveEngine = new OrgDelegationEngine(hierarchy, undefined, undefined, undefined, {
      simulationMode: false,
    });
    const confirmSpy = vi
      .spyOn(ipcBridge.conversation.confirmation.confirm, 'invoke')
      .mockResolvedValue(undefined as any);

    let capturedRequest: import('@/renderer/pages/organization/utils/orgDelegationEngine').OrgPermissionRequest | null =
      null;
    const unsub = (await import('@/renderer/pages/organization/utils/orgDelegationEngine')).onOrgPermissionRequested(
      (req) => {
        capturedRequest = req;
      }
    );

    const stepPromise = liveEngine.runOrgAgentStep({
      agent: testAgent,
      systemPrompt: 'You are an agent',
      userDirective: 'live test',
      workspacePath: '',
    });

    for (let i = 0; i < 50 && !streamHandler; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }

    streamHandler!({
      conversation_id: 'conv-123',
      msg_id: 'msg-live-1',
      type: 'acp_permission',
      data: {
        tool_call: {
          tool_call_id: 'tc-live-tool',
          name: 'create_team',
          title: 'Create Team',
        },
        options: [{ option_id: 'allow_once', kind: 'allow_once', name: 'Allow Once' }],
      },
    });

    // Auto-confirmed due to live store = 'all'
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        call_id: 'tc-live-tool',
      })
    );
    expect(capturedRequest).toBeNull();

    streamHandler!({
      conversation_id: 'conv-123',
      type: 'finish',
      status: 'finish',
    });

    await stepPromise;
    setAutoApprovePermissionsInStore('off');
    unsub();
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

  describe('Part B: Model Selection & Handling', () => {
    it('returns an error and performs no substitution when an explicit chosen model is unavailable', async () => {
      vi.spyOn(ipcBridge.mode.listProviders, 'invoke').mockResolvedValue([
        { id: 'openai', enabled: true, models: ['gpt-4o'] } as any,
      ]);

      const agentWithUnavailableModel: OrgAgentMember = {
        ...testAgent,
        model: {
          providerId: 'anthropic',
          modelId: 'claude-3-7-sonnet',
        },
      };

      const streamUpdates: string[] = [];
      const result = await engine.runOrgAgentStep({
        agent: agentWithUnavailableModel,
        systemPrompt: 'You are an agent',
        userDirective: 'do something',
        workspacePath: '',
        onStreamUpdate: (t) => streamUpdates.push(t),
      });

      expect(result).toContain('[Error: Model "claude-3-7-sonnet" (provider: "anthropic") is unavailable');
      expect(ipcBridge.conversation.create.invoke).not.toHaveBeenCalled();
      expect(ipcBridge.conversation.sendMessage.invoke).not.toHaveBeenCalled();
    });

    it('falls back to available provider model and outputs notice naming model used when agent has no model set', async () => {
      vi.spyOn(ipcBridge.mode.listProviders, 'invoke').mockResolvedValue([
        { id: 'ollama', enabled: true, models: ['llama-3'] } as any,
      ]);

      const agentWithoutModel: OrgAgentMember = {
        ...testAgent,
        model: undefined,
      };

      const streamUpdates: string[] = [];
      const stepPromise = engine.runOrgAgentStep({
        agent: agentWithoutModel,
        systemPrompt: 'You are an agent',
        userDirective: 'do something',
        workspacePath: '',
        onStreamUpdate: (t) => streamUpdates.push(t),
      });

      for (let i = 0; i < 50 && !streamHandler; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(streamHandler).toBeDefined();

      streamHandler!({
        conversation_id: 'conv-123',
        type: 'text',
        data: 'Done with task.',
      });
      streamHandler!({
        conversation_id: 'conv-123',
        type: 'finish',
        status: 'finish',
      });

      const result = await stepPromise;
      expect(result).toContain('Done with task.');
      expect(streamUpdates.some((u) => u.includes('Using llama-3'))).toBe(true);
    });

    it('reroutes ACP CLI agent to API assistant when the model belongs to a foreign provider not valid for the CLI', async () => {
      // CLI is claude-acp, only supports claude models
      vi.spyOn(ipcBridge.assistants.list, 'invoke').mockResolvedValue([
        {
          id: 'claude-cli-assistant',
          enabled: true,
          agent: { type: 'acp', acp_backend: 'claude' },
          models: ['claude-3-5-sonnet'],
        } as any,
        {
          id: 'bare:632f31d2',
          enabled: true,
          agent: { type: 'aionrs' },
          models: ['gpt-4o'],
        } as any,
      ]);

      vi.spyOn(ipcBridge.mode.listProviders, 'invoke').mockResolvedValue([
        { id: 'openai', enabled: true, models: ['gpt-4o'] } as any,
      ]);

      const acpAgentWithGpt4o: OrgAgentMember = {
        ...testAgent,
        canonicalAgentId: 'claude-cli-assistant',
        assistant_backend: 'acp',
        model: {
          providerId: 'openai',
          modelId: 'gpt-4o',
        },
      };

      let createdPayload: any = null;
      vi.spyOn(ipcBridge.conversation.create, 'invoke').mockImplementation(async (payload: any) => {
        createdPayload = payload;
        return { id: 'conv-rerouted' } as any;
      });

      const stepPromise = engine.runOrgAgentStep({
        agent: acpAgentWithGpt4o,
        systemPrompt: 'You are an agent',
        userDirective: 'run something',
        workspacePath: '',
      });

      for (let i = 0; i < 50 && !streamHandler; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(streamHandler).toBeDefined();

      streamHandler!({
        conversation_id: 'conv-rerouted',
        type: 'text',
        data: 'Rerouted reply.',
      });
      streamHandler!({
        conversation_id: 'conv-rerouted',
        type: 'finish',
        status: 'finish',
      });

      await stepPromise;

      // Because gpt-4o is foreign to claude-cli-assistant, it must switch to API assistant (bare:632f31d2)
      expect(createdPayload).toBeDefined();
      expect(createdPayload.assistant.id).toBe('bare:632f31d2');
      expect(createdPayload.model).toEqual({ id: 'openai', use_model: 'gpt-4o' });
      expect(createdPayload.extra.current_model_id).toBeUndefined();
    });
  });
});
