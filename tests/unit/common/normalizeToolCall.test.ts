import { describe, expect, it } from 'vitest';
import type { IMessageAcpToolCall, IMessageToolCall, IMessageToolGroup } from '@/common/chat/chatLib';
import { normalizeAcpToolCall, normalizeToolCall, normalizeToolGroup } from '@/common/chat/normalizeToolCall';

describe('normalizeToolCall', () => {
  it('normalizes compact snake_case acp tool calls from history responses', () => {
    const result = normalizeAcpToolCall({
      id: 'message-1',
      conversation_id: 'conversation-1',
      type: 'acp_tool_call',
      content: {
        _compact: {
          truncated: true,
          original_size: 90000,
          preview_chars: 4096,
        },
        update: {
          session_update: 'tool_call',
          tool_call_id: 'tool-1',
          status: 'completed',
          title: 'rg',
          kind: 'search',
          raw_input: { pattern: 'needle', path: '.' },
          content: [{ type: 'content', content: { type: 'text', text: 'preview' } }],
        },
      },
    } as unknown as IMessageAcpToolCall);

    expect(result).toMatchObject({
      key: 'tool-1',
      name: 'rg',
      status: 'completed',
      description: '"needle" in .',
      output: 'preview',
      truncated: true,
      messageId: 'message-1',
      conversationId: 'conversation-1',
      category: 'explore',
      exploreAction: 'searched',
    });
  });

  it('ignores malformed ACP content items in compact history output', () => {
    const result = normalizeAcpToolCall({
      id: 'message-2',
      conversation_id: 'conversation-1',
      type: 'acp_tool_call',
      content: {
        update: {
          session_update: 'tool_call',
          tool_call_id: 'tool-2',
          status: 'completed',
          title: 'Edit file',
          kind: 'edit',
          content: [null, 'invalid', { type: 'diff', path: '/workspace/file.ts', old_text: 'old', new_text: 'new' }],
        },
      },
    } as unknown as IMessageAcpToolCall);

    expect(result?.output).toBe('[diff] /workspace/file.ts');
    expect(result?.category).toBe('edit');
    expect(result?.fileChanges).toEqual([
      expect.objectContaining({
        fileName: 'file.ts',
        fullPath: '/workspace/file.ts',
        action: 'edited',
        insertions: 1,
        deletions: 1,
      }),
    ]);
  });

  it('extracts fileChanges and diff stats from ACP rawInput when diff content is absent', () => {
    const result = normalizeAcpToolCall({
      id: 'message-3',
      conversation_id: 'conversation-1',
      type: 'acp_tool_call',
      content: {
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'tool-3',
          status: 'completed',
          title: 'Edit',
          kind: 'edit',
          rawInput: {
            file_path: 'src/Router.tsx',
            old_string: 'const a = 1;\nconst b = 2;',
            new_string: 'const a = 10;\nconst b = 20;\nconst c = 30;',
          },
        },
      },
    } as unknown as IMessageAcpToolCall);

    expect(result?.category).toBe('edit');
    expect(result?.fileChanges).toEqual([
      expect.objectContaining({
        fileName: 'Router.tsx',
        fullPath: 'src/Router.tsx',
        action: 'edited',
        insertions: 3,
        deletions: 2,
      }),
    ]);
  });

  it('marks newly written ACP files as created with insertion counts', () => {
    const result = normalizeAcpToolCall({
      id: 'message-4',
      conversation_id: 'conversation-1',
      type: 'acp_tool_call',
      content: {
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'tool-4',
          status: 'completed',
          title: 'Write',
          kind: 'edit',
          rawInput: {
            file_path: 'src/navigation.ts',
            content: 'line 1\nline 2\nline 3',
          },
        },
      },
    } as unknown as IMessageAcpToolCall);

    expect(result?.fileChanges).toEqual([
      expect.objectContaining({
        fileName: 'navigation.ts',
        fullPath: 'src/navigation.ts',
        action: 'created',
        insertions: 3,
        deletions: 0,
      }),
    ]);
  });

  it('extracts line ranges for ACP read calls', () => {
    const result = normalizeAcpToolCall({
      id: 'message-5',
      conversation_id: 'conversation-1',
      type: 'acp_tool_call',
      content: {
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'tool-5',
          status: 'completed',
          title: 'Read',
          kind: 'read',
          rawInput: {
            file_path: 'src/ConversationSearchPopover.tsx',
            offset: 251,
            limit: 200,
          },
        },
      },
    } as unknown as IMessageAcpToolCall);

    expect(result?.category).toBe('explore');
    expect(result?.exploreAction).toBe('analyzed');
    expect(result?.filePath).toBe('src/ConversationSearchPopover.tsx');
    expect(result?.lineRange).toBe('#L251-450');
  });

  it('extracts fileChanges from tool_group WriteFile and Edit results', () => {
    const results = normalizeToolGroup({
      id: 'tg-1',
      conversation_id: 'conversation-1',
      type: 'tool_group',
      content: [
        {
          call_id: 'c1',
          name: 'WriteFile',
          description: 'src/newFile.ts',
          render_output_as_markdown: false,
          status: 'Success',
          result_display: {
            file_name: 'src/newFile.ts',
            file_diff: '--- /dev/null\n+++ b/src/newFile.ts\n@@ -0,0 +1,2 @@\n+a\n+b',
          },
        },
      ],
    } as IMessageToolGroup);

    expect(results[0]).toMatchObject({
      category: 'edit',
      fileChanges: [
        expect.objectContaining({
          fileName: 'newFile.ts',
          fullPath: 'src/newFile.ts',
          action: 'created',
          insertions: 2,
          deletions: 0,
        }),
      ],
    });
  });

  it('extracts fileChanges from legacy tool_call replace/Edit calls', () => {
    const result = normalizeToolCall({
      id: 'tc-1',
      conversation_id: 'conversation-1',
      type: 'tool_call',
      content: {
        call_id: 'tc-1',
        name: 'Edit',
        status: 'completed',
        args: {
          file_path: 'src/index.tsx',
          old_string: 'old',
          new_string: 'new 1\nnew 2',
        },
      },
    } as IMessageToolCall);

    expect(result?.category).toBe('edit');
    expect(result?.fileChanges).toEqual([
      expect.objectContaining({
        fileName: 'index.tsx',
        fullPath: 'src/index.tsx',
        action: 'edited',
        insertions: 2,
        deletions: 1,
      }),
    ]);
  });
});
