/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { OrgDelegationEngine } from './orgDelegationEngine';
import { runCeoTurn, type CeoEvent } from './ceoExecutionService';
import { knowledgeRepo } from '@/common/adapter/ipcBridge';
import type { OrgAgentMember, OrgConversation, OrgHierarchy, OrgProject } from '@/types/organization';

export type OrgChatTargetType = 'ceo' | 'department_head' | 'project_head' | 'member';

export type OrgChatTarget = {
  type: OrgChatTargetType;
  id: string;
  projectId?: string;
};

export type AgentTurnEventType = 'text-delta' | 'step' | 'created-entities' | 'error' | 'done';

export interface AgentTurnEvent {
  type: AgentTurnEventType;
  data: {
    text?: string;
    step?: { fromName: string; toName: string; message: string };
    createdEntities?: CeoEvent['data']['createdEntities'];
    error?: string;
    finalSynthesis?: string;
    backendConversationId?: string;
  };
}

export interface RunAgentTurnOptions {
  hierarchy: OrgHierarchy;
  projects: OrgProject[];
  threadId: string;
  target: OrgChatTarget;
  userText: string;
  agent: OrgAgentMember;
  workspacePath: string;
  systemContext: string;
  conversation?: OrgConversation | null;
  isCeo?: boolean;
  onNodeStatusUpdate?: (nodeId: string, status: string) => void;
  signal?: AbortSignal;
}

export interface RunAgentTurnResult {
  events: AsyncIterable<AgentTurnEvent>;
  cancel: () => Promise<void>;
}

export function runAgentTurn(options: RunAgentTurnOptions): RunAgentTurnResult {
  const {
    hierarchy,
    projects,
    threadId,
    target,
    userText,
    agent,
    workspacePath,
    systemContext,
    conversation,
    isCeo,
    onNodeStatusUpdate,
    signal,
  } = options;

  if (isCeo || target.type === 'ceo') {
    const ceo = runCeoTurn(threadId, userText, {
      hierarchy,
      projects,
      userPrompt: userText,
      useRealExecution: true,
      onNodeStatusUpdate,
      signal,
      conversationId: conversation?.backendConversationId,
    });
    return {
      events: (async function* () {
        for await (const ev of ceo.events) {
          yield ev as AgentTurnEvent;
        }
      })(),
      cancel: ceo.cancel,
    };
  }

  let cancelled = false;
  const cancel = async () => {
    cancelled = true;
  };

  const events = (async function* () {
    onNodeStatusUpdate?.(agent.id, 'working');
    try {
      const engine = new OrgDelegationEngine(hierarchy, undefined, undefined, onNodeStatusUpdate, { projects });

      let knowledgeBlock = '';
      try {
        const memberKey = `org:${agent.id}`;
        const assign = await knowledgeRepo.getAssignment(memberKey);
        if (assign && assign.repoIds.length > 0) {
          const inst = await knowledgeRepo.buildInstructions({
            memberKey,
            conversationId: conversation?.backendConversationId,
            memberName: agent.name,
            repoIds: assign.repoIds,
            whenToUseHint: assign.whenToUseHint,
          });
          if (inst?.instructions) {
            knowledgeBlock = inst.instructions;
          }
        }
      } catch (err) {
        console.warn('[agentTurn] Failed to load agent knowledge:', err);
      }

      const composedPrompt = knowledgeBlock
        ? `${knowledgeBlock}\n\n${systemContext}\n\n---\nUser: ${userText}`
        : `${systemContext}\n\n---\nUser: ${userText}`;
      const response = await engine.executeDirectMessage(
        agent,
        composedPrompt,
        workspacePath || agent.workspacePath || hierarchy.rootCeo.workspacePath || '',
        true,
        agent.systemPrompt || undefined,
        conversation?.backendConversationId
      );

      if (cancelled) return;

      if (response) {
        yield { type: 'text-delta', data: { text: response } } as AgentTurnEvent;
      }
      yield {
        type: 'done',
        data: {
          finalSynthesis: response || '',
          backendConversationId: engine.lastBackendConversationId,
        },
      } as AgentTurnEvent;
    } catch (err) {
      if (cancelled) return;
      yield {
        type: 'error',
        data: { error: err instanceof Error ? err.message : String(err) },
      } as AgentTurnEvent;
    } finally {
      onNodeStatusUpdate?.(agent.id, 'recently_finished');
    }
  })();

  return { events, cancel };
}

export function buildAgentSystemContext(opts: {
  agent: OrgAgentMember;
  projectName?: string;
  projectGoal?: string;
  workspacePath?: string;
  departmentName?: string;
  roleLabel?: string;
}): string {
  const parts: string[] = [];
  parts.push('[Org Agent Context]');
  parts.push(`Role: ${opts.roleLabel || opts.agent.role || 'Agent'} (${opts.agent.name})`);
  if (opts.departmentName) parts.push(`Department: ${opts.departmentName}`);
  if (opts.projectName) parts.push(`Project: ${opts.projectName}`);
  if (opts.projectGoal) parts.push(`Goal: ${opts.projectGoal}`);
  if (opts.workspacePath) parts.push(`Workspace: ${opts.workspacePath}`);
  return parts.join('\n');
}
