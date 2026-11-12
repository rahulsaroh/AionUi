/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { OrgDelegationEngine } from './orgDelegationEngine';
import { ipcBridge } from '@/common';
import type {
  OrgHierarchy,
  OrgProject,
  OrgDepartmentNode,
  OrgTeamNode,
  OrgAgentMember,
  OrgCreatedEntityRef,
  OrgNodeStatus,
} from '@/types/organization';

export type CeoEventType = 'text-delta' | 'step' | 'created-entities' | 'approval-request' | 'error' | 'done';

export interface CeoEvent {
  type: CeoEventType;
  data: {
    text?: string;
    step?: {
      fromName: string;
      toName: string;
      message: string;
    };
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

  const cancel = async () => {
    for (const [conversationId, turnId] of activeConversations) {
      try {
        await ipcBridge.conversation.stop.invoke({ conversation_id: conversationId, turn_id: turnId });
      } catch (err) {
        console.warn('[runCeoTurn] Failed to cancel conversation:', conversationId, err);
      }
    }
    activeConversations.clear();
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

  const events = (async function* (): AsyncGenerator<CeoEvent> {
    const engine = new OrgDelegationEngine(
      hierarchy,
      (log) => {
        // Step events are emitted via the generator
      },
      (streamText) => {
        // Text streaming is handled via yield
      },
      onNodeStatusUpdate,
      { simulationMode: !useRealExecution, projects }
    );

    let finalResult: Awaited<ReturnType<typeof engine.executeDirective>> | null = null;

    try {
      onNodeStatusUpdate?.('root-ceo', 'working');

      // Start the directive execution
      finalResult = await engine.executeDirective(
        userText,
        targetDeptId,
        targetTeamId,
        targetProjectId,
        useRealExecution,
        fallbackPath
      );

      // Collect conversation IDs from the engine if available
      // Note: The engine stores lastBackendConversationId but we need turn IDs
      // For now, we track what we can. The engine would need modification to expose turn IDs.

      // Yield step events from logs
      for (const log of finalResult.logs) {
        yield {
          type: 'step',
          data: {
            step: {
              fromName: log.fromName,
              toName: log.toName,
              message: log.message,
            },
          },
        };
      }

      // Yield created entities if any
      if (
        finalResult.createdDepartments?.length ||
        finalResult.createdTeams?.length ||
        finalResult.createdProjects?.length ||
        finalResult.createdMembers?.length
      ) {
        yield {
          type: 'created-entities',
          data: {
            createdEntities: {
              departments: finalResult.createdDepartments,
              teams: finalResult.createdTeams,
              projects: finalResult.createdProjects,
              members: finalResult.createdMembers,
            },
          },
        };
      }

      // Yield final synthesis as text-delta (streaming simulation)
      if (finalResult.finalSynthesis) {
        yield {
          type: 'text-delta',
          data: { text: finalResult.finalSynthesis },
        };
      }

      yield {
        type: 'done',
        data: {
          finalSynthesis: finalResult.finalSynthesis,
          involvedDepartmentIds: finalResult.involvedDepartmentIds,
          involvedTeamIds: finalResult.involvedTeamIds,
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      yield {
        type: 'error',
        data: { error: errorMessage },
      };
    } finally {
      onNodeStatusUpdate?.('root-ceo', 'recently_finished');
    }
  })();

  return { events, cancel };
}

export function useCeoExecution() {
  const runTurn = async function* (options: RunCeoTurnOptions): AsyncIterable<CeoEvent> {
    const { events } = runCeoTurn('', options.userPrompt, options);
    yield* events;
  };

  return { runTurn };
}

export default useCeoExecution;
