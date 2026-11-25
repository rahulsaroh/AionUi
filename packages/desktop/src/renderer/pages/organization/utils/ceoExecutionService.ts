/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { OrgDelegationEngine } from './orgDelegationEngine';
import { ipcBridge } from '@/common';
import type { ToolMessage } from '@/common/chat/normalizeToolCall';
import { createAsyncEventQueue } from '@/common/utils';
import type {
  OrgHierarchy,
  OrgProject,
  OrgDepartmentNode,
  OrgTeamNode,
  OrgAgentMember,
  OrgCreatedEntityRef,
  OrgNodeStatus,
  OrgConversation,
  OrgConversationMessage,
} from '@/types/organization';

export type CeoEventType =
  | 'text-delta'
  | 'step'
  | 'tool-activity'
  | 'created-entities'
  | 'approval-request'
  | 'error'
  | 'done';

export interface CeoEvent {
  type: CeoEventType;
  data: {
    text?: string;
    step?: {
      fromName: string;
      toName: string;
      message: string;
    };
    toolMessages?: ToolMessage[];
    durationMs?: number;
    createdEntities?: {
      departments?: OrgDepartmentNode[];
      teams?: Array<{ departmentId: string; team: OrgTeamNode }>;
      projects?: OrgProject[];
      members?: Array<{ teamId: string; member: OrgAgentMember }>;
    };
    error?: string;
    finalSynthesis?: string;
    involvedDepartmentIds?: string[];
    involvedTeamIds?: string[];
    backendConversationId?: string;
  };
}

export interface RunCeoTurnOptions {
  hierarchy: OrgHierarchy;
  projects: OrgProject[];
  userPrompt: string;
  targetDeptId?: string;
  targetTeamId?: string;
  targetProjectId?: string;
  fallbackPath?: string;
  useRealExecution?: boolean;
  onNodeStatusUpdate?: (nodeId: string, status: string) => void;
  signal?: AbortSignal;
  conversationId?: string;
  conversation?: OrgConversation | null;
}

export interface RunCeoTurnResult {
  events: AsyncIterable<CeoEvent>;
  cancel: () => Promise<void>;
}

/**
 * Single execution interface for Root CEO turns (Requirement 7):
 * runCeoTurn(threadId, userText, options): { events: AsyncIterable<CeoEvent>, cancel: () => Promise<void> }
 */
export function runCeoTurn(_threadId: string, userText: string, options: RunCeoTurnOptions): RunCeoTurnResult {
  const {
    hierarchy,
    projects,
    targetDeptId,
    targetTeamId,
    targetProjectId,
    fallbackPath,
    useRealExecution = true,
    onNodeStatusUpdate,
    signal,
  } = options;

  // Track active conversation IDs and turn IDs for cancellation
  const activeConversations = new Map<string, string>(); // conversationId -> turnId
  const queue = createAsyncEventQueue<CeoEvent>();
  const startedAt = Date.now();
  let latestToolMessages: ToolMessage[] = [];

  const cancel = async () => {
    for (const [conversationId, turnId] of activeConversations) {
      try {
        await ipcBridge.conversation.stop.invoke({ conversation_id: conversationId, turn_id: turnId });
      } catch (err) {
        console.warn('[runCeoTurn] Failed to cancel conversation:', conversationId, err);
      }
    }
    activeConversations.clear();
    queue.close();
  };

  // Listen for abort signal
  if (signal) {
    signal.addEventListener(
      'abort',
      () => {
        cancel();
      },
      { once: true }
    );
  }

  void (async () => {
    const engine = new OrgDelegationEngine(
      hierarchy,
      (_log) => {
        // Step events are emitted from finalResult.logs
      },
      (_streamText) => {
        // Text streaming is handled via text-delta
      },
      onNodeStatusUpdate,
      {
        simulationMode: !useRealExecution,
        projects,
        onToolActivity: (toolMessages) => {
          latestToolMessages = toolMessages;
          queue.push({ type: 'tool-activity', data: { toolMessages } });
        },
      }
    );

    let finalResult: Awaited<ReturnType<typeof engine.executeDirective>> | null = null;

    try {
      onNodeStatusUpdate?.('root-ceo', 'working');

      let effectiveUserText = userText;
      if (options.conversation?.messages) {
        const msgs = options.conversation.messages;
        const lastAssistantIdx = msgs.findLastIndex((m: OrgConversationMessage) => m.role === 'assistant');
        const recentSystemMsgs = msgs
          .slice(lastAssistantIdx >= 0 ? lastAssistantIdx + 1 : 0)
          .filter(
            (m: OrgConversationMessage) => m.role === 'system' && m.content && !effectiveUserText.includes(m.content)
          );
        if (recentSystemMsgs.length > 0) {
          const prefix = recentSystemMsgs.map((m: OrgConversationMessage) => m.content).join('\n\n');
          effectiveUserText = `${prefix}\n\n${effectiveUserText}`;
        }
      }

      // Start the directive execution
      finalResult = await engine.executeDirective(
        effectiveUserText,
        targetDeptId,
        targetTeamId,
        targetProjectId,
        useRealExecution,
        fallbackPath,
        options.conversationId
      );

      // Push step events from logs
      for (const log of finalResult.logs) {
        queue.push({
          type: 'step',
          data: {
            step: {
              fromName: log.fromName,
              toName: log.toName,
              message: log.message,
            },
          },
        });
      }

      // Push created entities if any
      if (
        finalResult.createdDepartments?.length ||
        finalResult.createdTeams?.length ||
        finalResult.createdProjects?.length ||
        finalResult.createdMembers?.length
      ) {
        queue.push({
          type: 'created-entities',
          data: {
            createdEntities: {
              departments: finalResult.createdDepartments,
              teams: finalResult.createdTeams,
              projects: finalResult.createdProjects,
              members: finalResult.createdMembers,
            },
          },
        });
      }

      // Push final synthesis as text-delta
      if (finalResult.finalSynthesis) {
        queue.push({
          type: 'text-delta',
          data: { text: finalResult.finalSynthesis },
        });
      }

      const finalTools = finalResult.toolMessages?.length ? finalResult.toolMessages : latestToolMessages;
      queue.push({
        type: 'done',
        data: {
          finalSynthesis: finalResult.finalSynthesis,
          involvedDepartmentIds: finalResult.involvedDepartmentIds,
          involvedTeamIds: finalResult.involvedTeamIds,
          backendConversationId: finalResult.backendConversationId || engine.lastBackendConversationId,
          toolMessages: finalTools.length > 0 ? finalTools : undefined,
          durationMs: Date.now() - startedAt,
        },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      queue.push({
        type: 'error',
        data: { error: errorMessage },
      });
    } finally {
      onNodeStatusUpdate?.('root-ceo', 'recently_finished');
      queue.close();
    }
  })();

  return { events: queue.iterate(), cancel };
}

export function useCeoExecution() {
  const runTurn = async function* (options: RunCeoTurnOptions): AsyncIterable<CeoEvent> {
    const { events } = runCeoTurn('', options.userPrompt, options);
    yield* events;
  };

  return { runTurn };
}

export default useCeoExecution;
