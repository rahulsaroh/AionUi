/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { usePreviewLauncher } from '@/renderer/hooks/file/usePreviewLauncher';
import { emitter } from '@/renderer/utils/emitter';
import { Button, Card, Message, Progress, Spin, Tag, Tooltip } from '@arco-design/web-react';
import { CheckOne, Down, FileText, Plan, Right, Terminal } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useAntigravityWorkspace, {
  type AntigravityCommand,
  type AntigravityFileStat,
} from '../hooks/useAntigravityWorkspace';

export type AntigravityWorkspaceCardProps = {
  conversation?: TChatConversation;
  conversationId?: string;
  className?: string;
};

const QUICK_COMMANDS = ['/plan', '/goal', '/grill-me', '/boost'] as const;

export const AntigravityWorkspaceCard: React.FC<AntigravityWorkspaceCardProps> = ({
  conversation,
  conversationId,
  className,
}) => {
  const { t } = useTranslation();
  const resolvedConversationId = conversation?.id ?? conversationId;
  const data = useAntigravityWorkspace(resolvedConversationId);
  const { launchPreview } = usePreviewLauncher();
  const [messageApi, messageContext] = Message.useMessage();

  const [expandedCommandIds, setExpandedCommandIds] = useState<Set<string>>(new Set());
  const [stoppingTerminalId, setStoppingTerminalId] = useState<string | null>(null);

  const toggleCommandExpanded = useCallback((cmdId: string) => {
    setExpandedCommandIds((prev) => {
      const next = new Set(prev);
      if (next.has(cmdId)) {
        next.delete(cmdId);
      } else {
        next.add(cmdId);
      }
      return next;
    });
  }, []);

  const handleQuickCommandClick = useCallback(
    (cmd: string) => {
      emitter.emit('sendbox.fill', `${cmd} `);
      messageApi.info(
        t('conversation.antigravityWorkspace.quickActions', { defaultValue: 'Quick Action' }) + `: ${cmd}`
      );
    },
    [messageApi, t]
  );

  const handleStopTerminal = useCallback(
    async (terminalId: string) => {
      if (!resolvedConversationId) return;
      setStoppingTerminalId(terminalId);
      try {
        await ipcBridge.conversation.killTerminal.invoke({
          conversation_id: resolvedConversationId,
          terminal_id: terminalId,
        });
      } catch (error) {
        console.error('[AntigravityWorkspaceCard] failed to kill terminal:', error);
      } finally {
        setStoppingTerminalId(null);
      }
    },
    [resolvedConversationId]
  );

  const handleViewDiff = useCallback(
    (file: AntigravityFileStat) => {
      void launchPreview({
        file_name: file.fileName,
        title: file.fileName,
        contentType: 'diff',
        editable: false,
        language: 'diff',
        diffContent: file.diff,
      });
    },
    [launchPreview]
  );

  const totalInsertions = useMemo(() => data.fileChanges.reduce((sum, f) => sum + f.insertions, 0), [data.fileChanges]);
  const totalDeletions = useMemo(() => data.fileChanges.reduce((sum, f) => sum + f.deletions, 0), [data.fileChanges]);

  const renderStatusBadge = () => {
    switch (data.agentStatus) {
      case 'executing':
        return (
          <Tag color='arcoblue' size='small' icon={<Spin size={10} className='mr-4px' />}>
            {t('conversation.antigravityWorkspace.statusExecuting', { defaultValue: 'Executing' })}
          </Tag>
        );
      case 'planning':
        return (
          <Tag color='gold' size='small' icon={<Spin size={10} className='mr-4px' />}>
            {t('conversation.antigravityWorkspace.statusPlanning', { defaultValue: 'Planning' })}
          </Tag>
        );
      case 'idle':
      default:
        return (
          <Tag color='gray' size='small'>
            {t('conversation.antigravityWorkspace.statusIdle', { defaultValue: 'Idle' })}
          </Tag>
        );
    }
  };

  const renderCommandStatusTag = (cmd: AntigravityCommand) => {
    switch (cmd.status) {
      case 'running':
        return (
          <Tag color='arcoblue' size='small'>
            {t('conversation.antigravityWorkspace.commandRunning', { defaultValue: 'Running' })}
          </Tag>
        );
      case 'completed':
        return (
          <Tag color='green' size='small'>
            {t('conversation.antigravityWorkspace.commandCompleted', { defaultValue: 'Completed' })}
          </Tag>
        );
      case 'error':
        return (
          <Tag color='red' size='small'>
            {t('conversation.antigravityWorkspace.commandError', { defaultValue: 'Failed' })}
            {cmd.exitCode != null ? ` (${cmd.exitCode})` : ''}
          </Tag>
        );
      case 'pending':
      default:
        return (
          <Tag color='gray' size='small'>
            {t('conversation.antigravityWorkspace.commandPending', { defaultValue: 'Pending' })}
          </Tag>
        );
    }
  };

  return (
    <div
      className={`h-full flex flex-col min-h-0 bg-[var(--color-bg-1)] overflow-y-auto p-12px gap-12px ${className || ''}`}
      data-testid='antigravity-workspace-card'
    >
      {messageContext}
      {/* Header & Status */}
      <div className='flex items-center justify-between pb-8px border-b border-[var(--color-border-2)]'>
        <div className='flex items-center gap-6px'>
          <Plan theme='outline' size={16} className='text-primary' />
          <span className='font-semibold text-13px text-t-primary'>
            {t('conversation.antigravityWorkspace.title', { defaultValue: 'Execution & Tasks' })}
          </span>
        </div>
        <div>{renderStatusBadge()}</div>
      </div>

      {/* Quick Action Chips */}
      <div className='flex flex-col gap-4px'>
        <div className='text-11px text-t-secondary font-medium'>
          {t('conversation.antigravityWorkspace.quickActions', { defaultValue: 'Quick Actions' })}
        </div>
        <div className='flex flex-wrap gap-4px'>
          {QUICK_COMMANDS.map((cmd) => (
            <Tag
              key={cmd}
              size='small'
              className='cursor-pointer hover:bg-[var(--color-fill-3)] transition-colors select-none font-mono text-11px'
              onClick={() => handleQuickCommandClick(cmd)}
            >
              {cmd}
            </Tag>
          ))}
        </div>
      </div>

      {/* Task Window / Checklist */}
      <Card size='small' bordered className='rounded-6px bg-[var(--color-bg-2)]'>
        <div className='flex items-center justify-between mb-6px'>
          <span className='font-medium text-12px text-t-primary'>
            {t('conversation.antigravityWorkspace.tasksTitle', { defaultValue: 'Tasks' })}
          </span>
          <span className='text-11px text-t-secondary'>
            {t('conversation.antigravityWorkspace.tasksProgress', {
              completed: data.progress.completed,
              total: data.progress.total,
              defaultValue: `${data.progress.completed} of ${data.progress.total} completed`,
            })}
          </span>
        </div>

        {data.hasActiveTasks ? (
          <>
            <Progress
              percent={data.progress.percentage}
              size='small'
              status={data.progress.percentage === 100 ? 'success' : 'normal'}
              className='mb-8px'
            />
            <div className='flex flex-col gap-6px max-h-200px overflow-y-auto overscroll-contain pr-4px'>
              {data.tasks.map((task) => (
                <div key={task.id} className='flex items-start gap-8px text-12px select-text'>
                  {task.status === 'completed' ? (
                    <CheckOne size={15} theme='filled' className='text-success shrink-0 mt-2px' />
                  ) : task.status === 'in_progress' ? (
                    <Spin size={12} className='shrink-0 mt-3px text-primary' />
                  ) : (
                    <div className='size-12px rd-full b-1.5px b-solid border-3 shrink-0 mt-3px' />
                  )}
                  <span
                    className={
                      task.status === 'completed'
                        ? 'line-through text-t-secondary'
                        : task.status === 'in_progress'
                          ? 'font-medium text-t-primary'
                          : 'text-t-primary'
                    }
                  >
                    {task.title}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className='text-11px text-t-secondary text-center py-8px'>
            {t('conversation.antigravityWorkspace.noTasksDesc', {
              defaultValue: 'Tasks planned by the agent will appear here. Use /plan to structure your task.',
            })}
          </div>
        )}
      </Card>

      {/* Running Commands Panel */}
      <Card size='small' bordered className='rounded-6px bg-[var(--color-bg-2)]'>
        <div className='flex items-center justify-between mb-6px'>
          <div className='flex items-center gap-4px'>
            <Terminal theme='outline' size={14} className='text-t-secondary' />
            <span className='font-medium text-12px text-t-primary'>
              {t('conversation.antigravityWorkspace.commandsTitle', { defaultValue: 'Running Commands' })} (
              {data.commands.length})
            </span>
          </div>
        </div>

        {data.hasActiveCommands ? (
          <div className='flex flex-col gap-6px max-h-240px overflow-y-auto overscroll-contain pr-4px'>
            {data.commands.map((cmd) => {
              const isExpanded = expandedCommandIds.has(cmd.id);
              const hasOutput = Boolean(cmd.output);

              return (
                <div
                  key={cmd.id}
                  className='flex flex-col p-6px bg-[var(--color-bg-1)] rounded border border-[var(--color-border-2)]'
                >
                  <div className='flex items-center justify-between gap-6px min-w-0'>
                    <div
                      className='flex items-center gap-4px min-w-0 flex-1 cursor-pointer select-none'
                      onClick={() => hasOutput && toggleCommandExpanded(cmd.id)}
                    >
                      {hasOutput ? (
                        isExpanded ? (
                          <Down size={12} className='shrink-0 text-t-secondary' />
                        ) : (
                          <Right size={12} className='shrink-0 text-t-secondary' />
                        )
                      ) : null}
                      <Tooltip content={cmd.command}>
                        <code dir='ltr' className='text-11px font-mono text-t-primary truncate flex-1 block'>
                          $ {cmd.command}
                        </code>
                      </Tooltip>
                    </div>

                    <div className='flex items-center gap-4px shrink-0'>
                      {renderCommandStatusTag(cmd)}
                      {cmd.terminalId && cmd.status === 'running' && (
                        <Button
                          size='mini'
                          status='danger'
                          loading={stoppingTerminalId === cmd.terminalId}
                          onClick={() => handleStopTerminal(cmd.terminalId!)}
                        >
                          {t('conversation.antigravityWorkspace.commandStop', { defaultValue: 'Stop' })}
                        </Button>
                      )}
                    </div>
                  </div>

                  {isExpanded && cmd.output && (
                    <pre
                      dir='ltr'
                      className='mt-6px p-6px bg-[var(--color-bg-3)] rounded text-10px font-mono overflow-x-auto overflow-y-auto max-h-140px whitespace-pre-wrap m-0 text-t-primary'
                    >
                      {cmd.output}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className='text-11px text-t-secondary text-center py-8px'>
            {t('conversation.antigravityWorkspace.noCommands', { defaultValue: 'No commands executed' })}
          </div>
        )}
      </Card>

      {/* File Changes Panel */}
      <Card size='small' bordered className='rounded-6px bg-[var(--color-bg-2)]'>
        <div className='flex items-center justify-between mb-6px'>
          <div className='flex items-center gap-4px'>
            <FileText theme='outline' size={14} className='text-t-secondary' />
            <span className='font-medium text-12px text-t-primary'>
              {t('conversation.antigravityWorkspace.filesTitle', { defaultValue: 'File Changes' })} (
              {data.fileChanges.length})
            </span>
          </div>

          {data.hasFileChanges && (
            <div className='flex items-center gap-4px font-mono text-11px'>
              <span className='text-success font-medium'>+{totalInsertions}</span>
              <span className='text-danger font-medium'>-{totalDeletions}</span>
            </div>
          )}
        </div>

        {data.hasFileChanges ? (
          <div className='flex flex-col gap-4px max-h-200px overflow-y-auto overscroll-contain pr-4px'>
            {data.fileChanges.map((file) => (
              <div
                key={file.fullPath}
                className='flex items-center justify-between gap-6px p-6px bg-[var(--color-bg-1)] rounded border border-[var(--color-border-2)] hover:border-primary transition-colors cursor-pointer'
                onClick={() => handleViewDiff(file)}
              >
                <div className='min-w-0 flex-1'>
                  <div className='text-12px font-medium text-t-primary truncate'>{file.fileName}</div>
                  <div className='text-10px text-t-secondary truncate'>{file.fullPath}</div>
                </div>

                <div className='flex items-center gap-6px shrink-0 font-mono text-11px'>
                  <span className='text-success'>+{file.insertions}</span>
                  <span className='text-danger'>-{file.deletions}</span>
                  <Button size='mini' type='text' className='!px-4px !h-20px text-10px'>
                    {t('conversation.antigravityWorkspace.viewDiff', { defaultValue: 'Diff' })}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className='text-11px text-t-secondary text-center py-8px'>
            {t('conversation.antigravityWorkspace.noFiles', { defaultValue: 'No file changes recorded' })}
          </div>
        )}
      </Card>
    </div>
  );
};

export default AntigravityWorkspaceCard;
