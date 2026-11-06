/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Button, Input, Tag, Tooltip, Message, Spin } from '@arco-design/web-react';
import {
  Send,
  NetworkTree,
  Robot,
  User,
  FolderClose,
  Peoples,
  Time,
  Plus,
  Loading,
  Clear,
  MessageOne,
} from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useOrgStore } from '../store/useOrgStore';
import { OrgDelegationEngine } from '../utils/orgDelegationEngine';
import type { OrgConversation, OrgConversationMessage } from '@/types/organization';

export const OrgChatView: React.FC = () => {
  const { t } = useTranslation();
  const {
    hierarchy,
    conversations,
    selectedConversationId,
    setSelectedConversationId,
    setOrgViewMode,
    addOrgConversation,
    addDepartment,
    addSubTeam,
    updateNodeStatus,
  } = useOrgStore();

  const [inputPrompt, setInputPrompt] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [liveStepText, setLiveStepText] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Active conversation: selected from sidebar or the latest Root CEO conversation
  const activeConversation = useMemo<OrgConversation | undefined>(() => {
    if (selectedConversationId) {
      return conversations.find((c) => c.id === selectedConversationId);
    }
    // Default to the newest ceo_directive conversation if available
    return conversations.find((c) => c.type === 'ceo_directive');
  }, [conversations, selectedConversationId]);

  const messages = useMemo<OrgConversationMessage[]>(() => {
    return activeConversation?.messages ?? [];
  }, [activeConversation]);

  // Auto-scroll to bottom when messages update or during execution
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, liveStepText, isExecuting]);

  const handleSendMessage = useCallback(async () => {
    if (!inputPrompt.trim() || isExecuting) return;
    const prompt = inputPrompt.trim();
    setInputPrompt('');
    setIsExecuting(true);
    setLiveStepText('Evaluating directive at Global Executive HQ...');
    updateNodeStatus('root-ceo', 'working');

    const userMessage: OrgConversationMessage = {
      id: `msg-${Date.now()}-u`,
      sender: 'Executive User',
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };

    const targetConvId = activeConversation?.id ?? `conv-ceo-${Date.now()}`;
    const initialConvTitle = activeConversation?.title ?? `Directive: ${prompt.slice(0, 36)}...`;

    // Optimistically update conversation with user message
    const existingMessages = activeConversation?.messages ?? [];
    const interimConversation: OrgConversation = {
      id: targetConvId,
      title: initialConvTitle,
      type: 'ceo_directive',
      sourceNodeId: 'root-ceo',
      targetNodeId: 'root-ceo',
      timestamp: Date.now(),
      summary: prompt,
      messages: [...existingMessages, userMessage],
    };
    addOrgConversation(interimConversation);
    setSelectedConversationId(targetConvId);

    try {
      const engine = new OrgDelegationEngine(
        hierarchy,
        (step) => setLiveStepText(`${step.fromName} -> ${step.toName}: ${step.message}`),
        undefined,
        updateNodeStatus
      );

      const result = await engine.executeDirective(prompt, undefined, undefined, undefined, true);

      // Auto-instantiate any departments requested
      if (result.createdDepartments && result.createdDepartments.length > 0) {
        for (const dept of result.createdDepartments) {
          addDepartment(dept);
        }
      }

      // Auto-instantiate any teams requested
      if (result.createdTeams && result.createdTeams.length > 0) {
        for (const { departmentId, team } of result.createdTeams) {
          addSubTeam(departmentId, team);
        }
      }

      const ceoMessage: OrgConversationMessage = {
        id: `msg-${Date.now()}-c`,
        sender: hierarchy.rootCeo.ceoAgent.name,
        role: 'ceo',
        content: result.finalSynthesis,
        timestamp: Date.now(),
      };

      const finalConversation: OrgConversation = {
        ...interimConversation,
        summary: result.finalSynthesis,
        targetNodeId: result.involvedDepartmentIds[0] || 'root-ceo',
        messages: [...existingMessages, userMessage, ceoMessage],
      };
      addOrgConversation(finalConversation);
      Message.success('Executive directive processed by Root CEO');
    } catch (err) {
      const errorMsg: OrgConversationMessage = {
        id: `msg-${Date.now()}-err`,
        sender: hierarchy.rootCeo.ceoAgent.name,
        role: 'system',
        content: `Halted: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      };
      addOrgConversation({
        ...interimConversation,
        messages: [...existingMessages, userMessage, errorMsg],
      });
      Message.error('Failed to complete directive execution');
    } finally {
      setIsExecuting(false);
      setLiveStepText(null);
      updateNodeStatus('root-ceo', 'recently_finished');
      setTimeout(() => updateNodeStatus('root-ceo', 'idle'), 3000);
    }
  }, [
    inputPrompt,
    isExecuting,
    activeConversation,
    hierarchy,
    addDepartment,
    addSubTeam,
    addOrgConversation,
    setSelectedConversationId,
    updateNodeStatus,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleQuickPrompt = (text: string) => {
    setInputPrompt(text);
  };

  const handleNewConversation = () => {
    setSelectedConversationId(null);
    setInputPrompt('');
  };

  return (
    <div className='flex flex-col h-full w-full bg-[var(--color-bg-1)] overflow-hidden select-text'>
      {/* Header */}
      <div className='h-54px px-20px border-b border-[var(--color-border-2)] bg-[var(--color-bg-2)] flex items-center justify-between shrink-0 select-none'>
        <div className='flex items-center gap-12px min-w-0'>
          <span className='size-34px rounded-10px bg-amber-500/15 text-amber-300 flex items-center justify-center text-18px shadow-sm shrink-0'>
            👑
          </span>
          <div className='flex flex-col min-w-0'>
            <div className='flex items-center gap-8px'>
              <span className='font-bold text-14px text-t-primary truncate'>{hierarchy.rootCeo.ceoAgent.name}</span>
              <Tag size='small' color='gold' className='text-10px font-medium px-6px py-0.5px rounded-full'>
                Root Executive HQ
              </Tag>
              {isExecuting ? (
                <span className='flex items-center gap-4px text-10px font-mono text-emerald-400'>
                  <span className='size-6px rounded-full bg-emerald-400 animate-ping' />
                  <span>Executing...</span>
                </span>
              ) : (
                <span className='flex items-center gap-4px text-10px font-mono text-t-tertiary'>
                  <span className='size-6px rounded-full bg-emerald-500' />
                  <span>Ready</span>
                </span>
              )}
            </div>
            {hierarchy.rootCeo.workspacePath ? (
              <div className='flex items-center gap-4px text-10px font-mono text-t-tertiary truncate'>
                <FolderClose size={11} theme='outline' className='text-amber-400 shrink-0' />
                <span className='truncate'>{hierarchy.rootCeo.workspacePath}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className='flex items-center gap-8px shrink-0'>
          <Button
            size='small'
            type='secondary'
            icon={<Plus size={13} theme='outline' />}
            onClick={handleNewConversation}
            className='!rounded-8px !text-12px'
          >
            New Directive
          </Button>

          <Button
            size='small'
            type='primary'
            icon={<NetworkTree size={14} theme='outline' />}
            onClick={() => setOrgViewMode('canvas')}
            className='!rounded-8px !text-12px'
          >
            🗺️ 2D Canvas
          </Button>
        </div>
      </div>

      {/* Message timeline */}
      <div ref={scrollRef} className='flex-1 overflow-y-auto p-24px flex flex-col gap-18px min-h-0'>
        {messages.length === 0 ? (
          <div className='my-auto flex flex-col items-center justify-center max-w-560px mx-auto text-center gap-16px select-none py-32px'>
            <span className='size-64px rounded-20px bg-gradient-to-tr from-amber-500/20 via-primary/15 to-emerald-500/20 flex items-center justify-center text-32px shadow-md border border-amber-500/30'>
              👑
            </span>
            <div className='flex flex-col gap-6px'>
              <h2 className='text-18px font-bold text-t-primary m-0'>Global Executive Command</h2>
              <p className='text-13px text-t-secondary m-0 leading-relaxed'>
                You are directly conversing with the <strong>Root Organization CEO</strong>. Issue top-level mandates,
                direct organizational structuring (such as creating departments and teams), or plan upcoming projects.
              </p>
            </div>

            <div className='flex flex-col gap-8px w-full mt-8px'>
              <span className='text-11px font-mono text-t-tertiary uppercase tracking-wider'>Suggested Directives</span>
              <div className='flex flex-col gap-6px'>
                {[
                  'Create department Engineering',
                  'Create department Growth Marketing',
                  'Create team Mobile in department Engineering',
                  'Formulate a strategic plan for our product launch',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type='button'
                    onClick={() => handleQuickPrompt(suggestion)}
                    className='w-full px-14px py-8px rounded-10px bg-fill-2 hover:bg-fill-3 border border-[var(--color-border-2)] text-left text-12px text-t-primary hover:border-primary/40 transition-all cursor-pointer flex items-center justify-between group'
                  >
                    <span>{suggestion}</span>
                    <span className='text-primary opacity-0 group-hover:opacity-100 text-11px font-mono transition-opacity'>
                      Use ›
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={classNames(
                  'flex gap-12px max-w-800px w-full',
                  isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'
                )}
              >
                {/* Avatar */}
                <div
                  className={classNames(
                    'size-32px rounded-full flex items-center justify-center text-14px shrink-0 mt-2px shadow-sm',
                    isUser
                      ? 'bg-primary/20 text-primary border border-primary/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  )}
                >
                  {isUser ? <User size={16} theme='outline' /> : '👑'}
                </div>

                {/* Bubble */}
                <div
                  className={classNames(
                    'flex flex-col gap-4px min-w-0 max-w-[85%]',
                    isUser ? 'items-end' : 'items-start'
                  )}
                >
                  <div className='flex items-center gap-6px text-11px font-mono text-t-tertiary select-none px-2px'>
                    <span className='font-semibold text-t-secondary'>{msg.sender}</span>
                    <span>•</span>
                    <span>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div
                    className={classNames(
                      'p-14px rounded-14px text-13px leading-relaxed border shadow-sm select-text whitespace-pre-wrap break-words',
                      isUser
                        ? 'bg-primary/10 border-primary/25 text-t-primary rounded-tr-2px'
                        : 'bg-[var(--color-bg-2)] border-[var(--color-border-2)] text-t-primary rounded-tl-2px'
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Live execution indicator */}
        {isExecuting && (
          <div className='flex gap-12px max-w-800px w-full mr-auto'>
            <div className='size-32px rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center justify-center text-14px shrink-0 mt-2px shadow-sm'>
              👑
            </div>
            <div className='flex flex-col gap-4px max-w-[85%]'>
              <span className='text-11px font-mono text-t-tertiary px-2px'>
                {hierarchy.rootCeo.ceoAgent.name} (Delegating...)
              </span>
              <div className='p-12px rounded-14px bg-[var(--color-bg-2)] border border-primary/30 text-t-primary rounded-tl-2px flex items-center gap-10px shadow-sm text-12px font-mono'>
                <Spin dot size={12} />
                <span className='text-primary truncate'>{liveStepText || 'Processing executive directive...'}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Send Box */}
      <div className='p-16px border-t border-[var(--color-border-2)] bg-[var(--color-bg-2)] shrink-0 select-none'>
        <div className='max-w-860px mx-auto flex flex-col gap-8px'>
          <div className='relative rounded-12px border border-[var(--color-border-2)] focus-within:border-primary bg-[var(--color-bg-1)] shadow-sm transition-colors overflow-hidden'>
            <Input.TextArea
              rows={3}
              value={inputPrompt}
              onChange={setInputPrompt}
              onKeyDown={handleKeyDown}
              disabled={isExecuting}
              placeholder="Direct Root CEO (e.g. 'Create department Engineering', 'Plan mobile app launch')..."
              className='!border-none !bg-transparent !p-12px !text-13px resize-none'
              autoFocus
            />

            <div className='flex items-center justify-between px-12px py-6px border-t border-[var(--color-border-2)]/40 bg-[var(--color-bg-2)]/50'>
              <span className='text-10px font-mono text-t-tertiary'>
                Press <kbd className='px-4px py-1px rounded bg-fill-2 text-t-secondary'>Enter</kbd> to send,{' '}
                <kbd className='px-4px py-1px rounded bg-fill-2 text-t-secondary'>Shift+Enter</kbd> for new line
              </span>

              <Button
                type='primary'
                size='small'
                icon={<Send size={13} theme='outline' />}
                loading={isExecuting}
                disabled={!inputPrompt.trim() || isExecuting}
                onClick={() => void handleSendMessage()}
                className='!rounded-8px !px-14px !h-28px !font-medium'
              >
                Send
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(OrgChatView);
