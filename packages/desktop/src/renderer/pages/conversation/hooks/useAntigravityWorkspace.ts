/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IMessageAcpTerminalOutput,
  IMessageAcpToolCall,
  IMessagePlan,
  IMessageToolCall,
  IMessageToolGroup,
  TMessage,
} from '@/common/chat/chatLib';
import { getMemoryCachedMessages, useMessageList } from '@/renderer/pages/conversation/Messages/hooks';
import { selectLatestPlan } from '@/renderer/pages/conversation/PlanBar/useLatestPlan';
import { useConversationRuntimeView } from '@/renderer/pages/conversation/runtime/useConversationRuntimeView';
import { parseDiff } from '@/renderer/utils/file/diffUtils';
import { emitter } from '@/renderer/utils/emitter';
import { createTwoFilesPatch } from 'diff';
import { useCallback, useEffect, useMemo, useState } from 'react';

export type AntigravityTaskStatus = 'pending' | 'in_progress' | 'completed';

export type AntigravityTask = {
  id: string;
  title: string;
  status: AntigravityTaskStatus;
};

export type AntigravityCommandStatus = 'pending' | 'running' | 'completed' | 'error';

export type AntigravityCommand = {
  id: string;
  command: string;
  status: AntigravityCommandStatus;
  exitCode?: number | null;
  output?: string;
  terminalId?: string;
  timestamp?: number;
};

export type AntigravityFileStat = {
  fileName: string;
  fullPath: string;
  insertions: number;
  deletions: number;
  diff: string;
};

export type AntigravityAgentStatus = 'idle' | 'planning' | 'executing';

export type AntigravityWorkspaceData = {
  agentStatus: AntigravityAgentStatus;
  tasks: AntigravityTask[];
  commands: AntigravityCommand[];
  fileChanges: AntigravityFileStat[];
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
  hasActiveTasks: boolean;
  hasActiveCommands: boolean;
  hasFileChanges: boolean;
};

const MARKDOWN_TASK_RE = /^(?:[-*]|\d+\.)\s+\[([ xX\-/])\]\s+(.+)$/gm;

const parseMarkdownTasks = (text: string, isProcessing: boolean): AntigravityTask[] => {
  const tasks: AntigravityTask[] = [];
  let match: RegExpExecArray | null;
  let index = 0;
  MARKDOWN_TASK_RE.lastIndex = 0;

  while ((match = MARKDOWN_TASK_RE.exec(text)) !== null) {
    const rawBox = match[1].toLowerCase();
    const title = match[2].trim();
    if (!title) continue;

    let status: AntigravityTaskStatus = 'pending';
    if (rawBox === 'x') {
      status = 'completed';
    } else if (rawBox === '-' || rawBox === '/') {
      status = 'in_progress';
    } else {
      status = 'pending';
    }

    tasks.push({
      id: `md-task-${index++}`,
      title,
      status,
    });
  }

  // If currently processing and no task is marked in progress, the first pending task is actively running
  if (isProcessing && tasks.length > 0 && !tasks.some((t) => t.status === 'in_progress')) {
    const firstPending = tasks.find((t) => t.status === 'pending');
    if (firstPending) {
      firstPending.status = 'in_progress';
    }
  }

  return tasks;
};

const extractTasksFromMessages = (messages: TMessage[], isProcessing: boolean): AntigravityTask[] => {
  // 1. Explicit IMessagePlan snapshot
  const plan: IMessagePlan | undefined = selectLatestPlan(messages);
  if (plan?.content?.entries?.length) {
    return plan.content.entries.map((entry, index) => ({
      id: `plan-task-${index}`,
      title: entry.content,
      status: entry.status,
    }));
  }

  // 2. Scan assistant messages (from latest backwards) for markdown checkboxes
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === 'text' && msg.position === 'left' && typeof msg.content?.content === 'string') {
      const parsed = parseMarkdownTasks(msg.content.content, isProcessing);
      if (parsed.length > 0) {
        return parsed;
      }
    }
  }

  return [];
};

const extractCommandsFromMessages = (messages: TMessage[]): AntigravityCommand[] => {
  const commands: AntigravityCommand[] = [];
  const seenIds = new Set<string>();

  for (const msg of messages) {
    if (msg.hidden) continue;

    // A. acp_terminal_output: live or finished client-hosted terminal
    if (msg.type === 'acp_terminal_output') {
      const terminalMsg = msg as IMessageAcpTerminalOutput;
      const content = terminalMsg.content;
      if (!content?.command) continue;

      const exit = content.exit_status;
      const isRunning = !exit;
      const isError = Boolean(exit && (exit.signaled || (exit.exit_code != null && exit.exit_code !== 0)));
      const status: AntigravityCommandStatus = isRunning ? 'running' : isError ? 'error' : 'completed';

      const cmdId = content.terminal_id || terminalMsg.id;
      seenIds.add(cmdId);

      commands.push({
        id: cmdId,
        command: content.command,
        status,
        exitCode: exit?.exit_code,
        output: content.output,
        terminalId: content.terminal_id,
        timestamp: terminalMsg.created_at,
      });
      continue;
    }

    // B. acp_tool_call with kind === 'execute'
    if (msg.type === 'acp_tool_call') {
      const acpToolMsg = msg as IMessageAcpToolCall;
      const update = acpToolMsg.content?.update;
      if (!update) continue;

      const isExecuteKind =
        update.kind === 'execute' ||
        update.title?.toLowerCase().includes('command') ||
        update.title?.toLowerCase().includes('terminal');

      const rawInput = update.rawInput ?? (update as { raw_input?: Record<string, unknown> }).raw_input;
      const commandStr =
        (typeof rawInput?.command === 'string' && rawInput.command) ||
        (typeof rawInput?.cmd === 'string' && rawInput.cmd) ||
        (isExecuteKind ? update.title : '');

      if (!commandStr) continue;

      const cmdId = update.tool_call_id || acpToolMsg.id;
      if (seenIds.has(cmdId)) continue;
      seenIds.add(cmdId);

      let status: AntigravityCommandStatus = 'pending';
      if (update.status === 'completed') status = 'completed';
      else if (update.status === 'failed') status = 'error';
      else if (update.status === 'in_progress') status = 'running';

      let outputSnippet: string | undefined;
      if (Array.isArray(update.content) && update.content.length > 0) {
        outputSnippet = update.content
          .map((item) => {
            if (typeof item === 'object' && item !== null && item.type === 'content' && item.content?.text) {
              return item.content.text;
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
      }

      const rawOutput = update.rawOutput ?? (update as { raw_output?: Record<string, unknown> }).raw_output;
      const exitCode = typeof rawOutput?.exit_code === 'number' ? rawOutput.exit_code : null;

      commands.push({
        id: cmdId,
        command: commandStr,
        status,
        exitCode,
        output: outputSnippet,
        timestamp: acpToolMsg.created_at,
      });
      continue;
    }

    // C. tool_group
    if (msg.type === 'tool_group') {
      const toolGroupMsg = msg as IMessageToolGroup;
      if (!Array.isArray(toolGroupMsg.content)) continue;

      for (const item of toolGroupMsg.content) {
        const isExec =
          item.confirmationDetails?.type === 'exec' ||
          item.name?.toLowerCase().includes('execute') ||
          item.name?.toLowerCase().includes('bash');

        if (!isExec) continue;

        const execDetails = item.confirmationDetails?.type === 'exec' ? item.confirmationDetails : undefined;
        const cmdStr = execDetails?.command || item.description || item.name;
        if (!cmdStr) continue;

        const cmdId = item.call_id || toolGroupMsg.id;
        if (seenIds.has(cmdId)) continue;
        seenIds.add(cmdId);

        let status: AntigravityCommandStatus = 'running';
        if (item.status === 'Success') status = 'completed';
        else if (item.status === 'Error' || item.status === 'Canceled') status = 'error';
        else if (item.status === 'Pending') status = 'pending';

        const outputStr =
          typeof item.result_display === 'string'
            ? item.result_display
            : item.result_display && 'file_diff' in item.result_display
              ? item.result_display.file_diff
              : undefined;

        commands.push({
          id: cmdId,
          command: cmdStr,
          status,
          output: outputStr,
          timestamp: toolGroupMsg.created_at,
        });
      }
      continue;
    }

    // D. tool_call
    if (msg.type === 'tool_call') {
      const toolMsg = msg as IMessageToolCall;
      const { call_id, name, status, input, output, args, description } = toolMsg.content || {};
      const isExec =
        name?.toLowerCase().includes('execute') ||
        name?.toLowerCase().includes('command') ||
        name?.toLowerCase().includes('terminal');

      if (!isExec && !args?.command && !input?.command) continue;

      const cmdStr =
        (typeof args?.command === 'string' && args.command) ||
        (typeof input?.command === 'string' && input.command) ||
        description ||
        name;

      if (!cmdStr) continue;

      const cmdId = call_id || toolMsg.id;
      if (seenIds.has(cmdId)) continue;
      seenIds.add(cmdId);

      let cmdStatus: AntigravityCommandStatus = 'pending';
      if (status === 'completed') cmdStatus = 'completed';
      else if (status === 'error' || (status as string) === 'canceled') cmdStatus = 'error';
      else if (status === 'running') cmdStatus = 'running';

      commands.push({
        id: cmdId,
        command: cmdStr,
        status: cmdStatus,
        output,
        timestamp: toolMsg.created_at,
      });
    }
  }

  return commands;
};

const extractFileChangesFromMessages = (messages: TMessage[]): AntigravityFileStat[] => {
  const fileMap = new Map<string, AntigravityFileStat>();

  for (const msg of messages) {
    if (msg.hidden) continue;

    // 1. acp_tool_call diffs
    if (msg.type === 'acp_tool_call') {
      const acpToolMsg = msg as IMessageAcpToolCall;
      const diffContent = acpToolMsg.content?.update?.content;
      if (!Array.isArray(diffContent)) continue;

      for (const item of diffContent) {
        if (item.type !== 'diff' || !item.path) continue;
        const fullPath = item.path;
        const fileName = fullPath.split(/[/\\]/).pop() || fullPath;
        const oldText = item.old_text || '';
        const newText = item.new_text || '';

        try {
          const patch = createTwoFilesPatch(fileName, fileName, oldText, newText, '', '', { context: 3 });
          const info = parseDiff(patch, fullPath);

          const existing = fileMap.get(fullPath);
          if (existing) {
            existing.insertions += info.insertions;
            existing.deletions += info.deletions;
            existing.diff = patch;
          } else {
            fileMap.set(fullPath, {
              fileName: info.file_name,
              fullPath,
              insertions: info.insertions,
              deletions: info.deletions,
              diff: patch,
            });
          }
        } catch {
          // ignore patch generation error
        }
      }
      continue;
    }

    // 2. tool_group WriteFile diffs
    if (msg.type === 'tool_group') {
      const toolGroupMsg = msg as IMessageToolGroup;
      if (!Array.isArray(toolGroupMsg.content)) continue;

      for (const item of toolGroupMsg.content) {
        const isWrite = item.name === 'WriteFile' || item.confirmationDetails?.type === 'edit';
        const resultDisplay = item.result_display;
        if (!isWrite || !resultDisplay || typeof resultDisplay !== 'object' || !('file_diff' in resultDisplay)) {
          continue;
        }

        const fileDiff = resultDisplay.file_diff;
        const fileName = resultDisplay.file_name || 'unknown';
        if (!fileDiff) continue;

        try {
          const info = parseDiff(fileDiff, fileName);
          const fullPath = info.fullPath || fileName;
          const existing = fileMap.get(fullPath);
          if (existing) {
            existing.insertions += info.insertions;
            existing.deletions += info.deletions;
            existing.diff = fileDiff;
          } else {
            fileMap.set(fullPath, {
              fileName: info.file_name,
              fullPath,
              insertions: info.insertions,
              deletions: info.deletions,
              diff: fileDiff,
            });
          }
        } catch {
          // ignore diff parse error
        }
      }
    }
  }

  return Array.from(fileMap.values());
};

export const useAntigravityWorkspace = (conversationId?: string): AntigravityWorkspaceData => {
  const contextMessages = useMessageList();
  const [syncedMessages, setSyncedMessages] = useState<TMessage[]>(() => {
    if (contextMessages.length > 0) return contextMessages;
    if (conversationId) {
      return getMemoryCachedMessages(conversationId) ?? [];
    }
    return [];
  });

  const { isProcessing } = useConversationRuntimeView(conversationId ?? '');

  // Keep synced with message updates from context or emitter
  useEffect(() => {
    if (contextMessages.length > 0) {
      setSyncedMessages(contextMessages);
      return undefined;
    }

    if (!conversationId) return undefined;

    const cached = getMemoryCachedMessages(conversationId);
    if (cached && cached.length > 0) {
      setSyncedMessages(cached);
    }

    const handleMessagesUpdated = (data: { conversationId: string; messages: TMessage[] }) => {
      if (data.conversationId === conversationId) {
        setSyncedMessages(data.messages);
      }
    };

    emitter.on('conversation.messages.updated', handleMessagesUpdated);
    return () => {
      emitter.off('conversation.messages.updated', handleMessagesUpdated);
    };
  }, [conversationId, contextMessages]);

  const activeMessages = contextMessages.length > 0 ? contextMessages : syncedMessages;

  const tasks = useMemo(() => extractTasksFromMessages(activeMessages, isProcessing), [activeMessages, isProcessing]);

  const commands = useMemo(() => extractCommandsFromMessages(activeMessages), [activeMessages]);

  const fileChanges = useMemo(() => extractFileChangesFromMessages(activeMessages), [activeMessages]);

  const progress = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, total, percentage };
  }, [tasks]);

  const agentStatus: AntigravityAgentStatus = useMemo(() => {
    if (!isProcessing) return 'idle';
    const hasRunningCommand = commands.some((c) => c.status === 'running');
    const hasInProgressTask = tasks.some((t) => t.status === 'in_progress');
    if (hasRunningCommand || hasInProgressTask) return 'executing';
    return 'planning';
  }, [isProcessing, commands, tasks]);

  return {
    agentStatus,
    tasks,
    commands,
    fileChanges,
    progress,
    hasActiveTasks: tasks.length > 0,
    hasActiveCommands: commands.length > 0,
    hasFileChanges: fileChanges.length > 0,
  };
};

export default useAntigravityWorkspace;
