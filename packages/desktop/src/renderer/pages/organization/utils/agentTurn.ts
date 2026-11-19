/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { OrgDelegationEngine } from './orgDelegationEngine';
import { runCeoTurn, type CeoEvent } from './ceoExecutionService';
import { buildOrgDirectory, getOrgDirectoryPrompt } from './orgDirectory';
import { knowledgeRepo, memberHandbook } from '@/common/adapter/ipcBridge';
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
  members?: OrgAgentMember[];
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
    members,
    workspacePath,
    systemContext,
    conversation,
    isCeo,
    onNodeStatusUpdate,
    signal,
  } = options;

  const directoryDoc = buildOrgDirectory({ hierarchy, projects, members });
  const directoryBlock = getOrgDirectoryPrompt(directoryDoc, {
    conversationId: conversation?.backendConversationId || conversation?.id,
  });

  if (isCeo || target.type === 'ceo') {
    const msgs = conversation?.messages || [];
    const lastAssistantIdx = msgs.findLastIndex((m) => m.role === 'assistant');
    const recentSystemMsgs = msgs
      .slice(lastAssistantIdx >= 0 ? lastAssistantIdx + 1 : 0)
      .filter((m) => m.role === 'system' && m.content);

    let effectivePrompt = `${directoryBlock}\n\n${userText}`;
    if (recentSystemMsgs.length > 0) {
      const systemContextPrefix = recentSystemMsgs.map((m) => m.content).join('\n\n');
      effectivePrompt = `${directoryBlock}\n\n${systemContextPrefix}\n\n${userText}`;
    }

    const effectiveCeoAgent: OrgAgentMember = {
      ...hierarchy.rootCeo.ceoAgent,
      model: agent.model || hierarchy.rootCeo.ceoAgent.model,
      assistant_backend: agent.assistant_backend || hierarchy.rootCeo.ceoAgent.assistant_backend || 'aionrs',
    };
    const effectiveHierarchy: OrgHierarchy = {
      ...hierarchy,
      rootCeo: {
        ...hierarchy.rootCeo,
        ceoAgent: effectiveCeoAgent,
      },
    };

    const ceo = runCeoTurn(threadId, effectivePrompt, {
      hierarchy: effectiveHierarchy,
      projects,
      userPrompt: effectivePrompt,
      useRealExecution: true,
      onNodeStatusUpdate,
      signal,
      conversationId: conversation?.backendConversationId,
      conversation,
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

      let handbookBlock = '';
      try {
        const memberKey = `org:${agent.id}`;
        const hb = await memberHandbook.getInjectedBlock({
          memberKey,
          conversationId: conversation?.backendConversationId || conversation?.id,
          model: agent.model?.modelId,
        });
        if (hb?.promptBlock) {
          handbookBlock = hb.promptBlock;
        }
      } catch (err) {
        console.warn('[agentTurn] Failed to load agent handbook:', err);
      }

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

      const priorMessages = !conversation?.backendConversationId
        ? (conversation?.messages ?? [])
            .slice(0, -1)
            .filter((message) => message.role === 'user' || message.role === 'assistant')
            .slice(-30)
        : [];
      const conversationHistory = priorMessages
        .map((message) => `${message.role === 'user' ? 'User' : agent.name}: ${message.content}`)
        .join('\n\n')
        .slice(-24_000);
      const promptBlocks = [
        directoryBlock,
        handbookBlock,
        knowledgeBlock,
        systemContext,
        conversationHistory ? `Previous conversation:\n${conversationHistory}` : '',
      ].filter(Boolean);
      const composedPrompt = `${promptBlocks.join('\n\n')}\n\n---\nUser: ${userText}`;
      // For Team Lead agents in direct chat, inject workspace path into the system prompt
      // so the agent knows which path to pass when it calls scan_folder autonomously.
      const resolvedWorkspace = workspacePath || agent.workspacePath || hierarchy.rootCeo.workspacePath || '';
      let resolvedSystemPrompt = agent.systemPrompt || undefined;
      if (agent.role === 'team_lead' && resolvedWorkspace) {
        const basePrompt =
          resolvedSystemPrompt ||
          `You are ${agent.name}, Team Lead. Coordinate and address the user's directive directly.`;
        // Inject workspace path into the prompt if it isn't already there
        if (!basePrompt.includes(resolvedWorkspace)) {
          resolvedSystemPrompt = `${basePrompt}\n\nCurrent workspace folder: "${resolvedWorkspace}"\nWhen calling scan_folder, use this path: scan_folder({ path: "${resolvedWorkspace}" })\nNEVER ask the user to run scan_folder for you — call it yourself.`;
        } else {
          resolvedSystemPrompt = basePrompt;
        }
      }

      const response = await engine.executeDirectMessage(
        agent,
        composedPrompt,
        resolvedWorkspace,
        true,
        resolvedSystemPrompt,
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
  workspacePaths?: string[];
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
  if (opts.workspacePaths && opts.workspacePaths.length > 1) {
    parts.push('Assigned folders available in this session:');
    for (const folderPath of opts.workspacePaths) parts.push(`- ${folderPath}`);
    parts.push('Work across all assigned folders as needed. Keep file operations inside the listed folders.');
  }
  // Remind Team Lead agents of their autonomous tool access
  if (opts.agent.role === 'team_lead' && opts.workspacePath) {
    parts.push('');
    parts.push(
      `TOOL REMINDER: You have full access to scan_folder, hire_member, assign_member, create_team, and list_org.`
    );
    parts.push(`To inspect your workspace, call: scan_folder({ path: "${opts.workspacePath}" })`);
    parts.push(`NEVER ask the user to run scan_folder for you — call it yourself.`);
  }
  return parts.join('\n');
}
