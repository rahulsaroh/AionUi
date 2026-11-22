/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Input, Button, Tag, Tooltip, Spin } from '@arco-design/web-react';
import { Send, Square, AllApplication, Robot, Peoples, User, Loading, Edit, BookOne, Copy } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { OrgModelSelector } from '../OrgModelSelector';
import { isRoleDuplicate } from './OrgTeamChatHeader';
import type {
  OrgTeamNode,
  OrgAgentMember,
  OrgConversation,
  OrgAgentModelConfig,
  OrgCreatedEntityRef,
} from '@/types/organization';

export interface OrgTeamChatSlotProps {
  member: OrgAgentMember;
  team: OrgTeamNode;
  departmentName?: string;
  conversation?: OrgConversation;
  isLeader: boolean;
  isHr: boolean;
  isFullscreen: boolean;
  isExecuting: boolean;
  liveStepText?: string | null;
  streamingContent?: string;
  onToggleFullscreen: () => void;
  onSendMessage: (text: string) => Promise<void>;
  onSelectModel: (model: OrgAgentModelConfig) => void;
  onSelectCreatedEntity?: (ref: OrgCreatedEntityRef) => void;
  onEditTeammate?: (member: OrgAgentMember) => void;
  onOpenKnowledge?: (member: OrgAgentMember) => void;
}

export const OrgTeamChatSlot: React.FC<OrgTeamChatSlotProps> = ({
  member,
  team: _team,
  conversation,
  isLeader,
  isHr,
  isFullscreen,
  isExecuting,
  liveStepText,
  streamingContent,
  onToggleFullscreen,
  onSendMessage,
  onSelectModel,
  onSelectCreatedEntity,
  onEditTeammate,
  onOpenKnowledge,
}) => {
  const { t } = useTranslation();
  const [inputText, setInputText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = conversation?.messages || [];

  const copyToClipboard = async (text: string, id: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // ignore copy failure
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, streamingContent, liveStepText]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isExecuting) return;
    setInputText('');
    await onSendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const roleLabel = isLeader ? 'LEAD' : isHr ? 'HR' : member.title || member.role || 'SPEC';
  const memberDisplayName = /^aion\s*cli$/i.test(member.name) ? 'Shiraj CLI' : member.name;
  const isDuplicateRole = !isLeader && !isHr && isRoleDuplicate(memberDisplayName, roleLabel);

  const memberColorClass = isLeader
    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    : isHr
      ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';

  const roleTagClass = isLeader
    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    : isHr
      ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';

  return (
    <div className='flex flex-col h-full w-full bg-[var(--color-bg-1)] min-w-0 select-text overflow-hidden'>
      {/* Column Header */}
      <div className='h-46px px-12px border-b border-[var(--color-border-2)] bg-[var(--color-bg-2)] flex items-center justify-between shrink-0 select-none gap-8px'>
        <div className='flex items-center gap-8px min-w-0'>
          <span
            className={classNames(
              'size-24px rounded-6px flex items-center justify-center text-12px shrink-0 border',
              memberColorClass
            )}
          >
            {isLeader ? '👑' : isHr ? <Peoples size={13} theme='outline' /> : <Robot size={13} theme='outline' />}
          </span>
          <div className='flex items-center gap-6px min-w-0'>
            <span className='font-semibold text-12px text-t-primary truncate' title={memberDisplayName}>
              {memberDisplayName}
            </span>
            {!isDuplicateRole && (
              <Tag
                size='small'
                className={classNames(
                  'text-9px font-mono font-semibold px-4px py-0 rounded border shrink-0',
                  roleTagClass
                )}
              >
                {roleLabel}
              </Tag>
            )}
            {onEditTeammate && (
              <Tooltip content={t('team.organization.editTeammate', { defaultValue: 'Edit teammate' })}>
                <Button
                  type='text'
                  size='mini'
                  icon={<Edit size={12} theme='outline' />}
                  onClick={() => onEditTeammate(member)}
                  aria-label='Edit teammate'
                  className='!px-2px !h-20px text-t-tertiary hover:text-primary shrink-0'
                />
              </Tooltip>
            )}
          </div>
        </div>

        <div className='flex items-center gap-6px shrink-0'>
          <OrgModelSelector currentModel={member.model} onSelectModel={onSelectModel} disabled={isExecuting} />

          {onOpenKnowledge && (
            <Tooltip content={t('team.knowledgeRepos.chipLabel', { defaultValue: 'Knowledge & Documents' })}>
              <Button
                type='text'
                size='mini'
                icon={<BookOne size={13} theme='outline' />}
                onClick={() => onOpenKnowledge(member)}
                aria-label='Knowledge & Documents'
                className='!px-4px !h-24px text-t-secondary hover:text-primary'
              />
            </Tooltip>
          )}

          {onEditTeammate && (
            <Tooltip content={t('team.organization.editTeammate', { defaultValue: 'Edit teammate & knowledge' })}>
              <Button
                type='text'
                size='mini'
                icon={<Edit size={13} theme='outline' />}
                onClick={() => onEditTeammate(member)}
                aria-label='Edit teammate'
                className='!px-4px !h-24px text-t-secondary hover:text-primary'
              />
            </Tooltip>
          )}

          {/* Running / Idle dot */}
          <span
            className={classNames('size-6px rounded-full shrink-0', {
              'bg-emerald-400 animate-pulse': isExecuting,
              'bg-emerald-500': !isExecuting,
            })}
            title={isExecuting ? 'Running...' : 'Idle'}
          />

          {/* Fullscreen toggle button */}
          <Tooltip
            content={
              isFullscreen
                ? t('team.view.parallel', { defaultValue: 'Exit full screen' })
                : t('team.view.single', { defaultValue: 'Full screen' })
            }
            position='bottom'
          >
            <Button
              type='text'
              size='mini'
              onClick={onToggleFullscreen}
              aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
              className='!px-4px !h-24px text-t-secondary hover:text-t-primary'
            >
              {isFullscreen ? <AllApplication size={14} theme='outline' /> : <Square size={14} theme='outline' />}
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className='flex-1 p-14px overflow-y-auto space-y-12px min-w-0 [scrollbar-width:thin]'>
        {messages.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full text-center px-16px text-t-tertiary select-none my-auto py-32px'>
            <div
              className={classNames(
                'size-40px rounded-12px flex items-center justify-center text-20px mb-12px border shadow-sm',
                memberColorClass
              )}
            >
              {isLeader ? '👑' : isHr ? <Peoples size={20} theme='outline' /> : <Robot size={20} theme='outline' />}
            </div>
            <h4 className='text-13px font-bold text-t-primary mb-4px'>{memberDisplayName}</h4>
            <div className='relative group max-w-260px'>
              <p className='text-11px leading-normal mb-14px'>
                {isLeader
                  ? t('team.organization.leadPromptDesc', {
                      defaultValue: 'Direct team lead to coordinate work, assign tasks, or report progress.',
                    })
                  : isHr
                    ? t('team.organization.hrPromptDesc', {
                        defaultValue: 'Ask HR to recruit specialists, manage staff, or allocate personnel.',
                      })
                    : t('team.organization.specPromptDesc', {
                        defaultValue: 'Ask this specialist to execute domain tasks for the team.',
                      })}
              </p>
              <Button
                type='text'
                size='mini'
                icon={<Copy size={11} theme='outline' />}
                onClick={() =>
                  void copyToClipboard(
                    isLeader
                      ? t('team.organization.leadPromptDesc', {
                          defaultValue: 'Direct team lead to coordinate work, assign tasks, or report progress.',
                        })
                      : isHr
                        ? t('team.organization.hrPromptDesc', {
                            defaultValue: 'Ask HR to recruit specialists, manage staff, or allocate personnel.',
                          })
                        : t('team.organization.specPromptDesc', {
                            defaultValue: 'Ask this specialist to execute domain tasks for the team.',
                          }),
                    'empty-prompt'
                  )
                }
                aria-label='Copy prompt suggestion'
                className='!px-2px !h-16px text-t-tertiary hover:text-primary absolute -top-2px -right-2px opacity-0 group-hover:opacity-100 transition-opacity'
              />
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={classNames('flex gap-8px w-full', isUser ? 'ml-auto flex-row-reverse' : 'mr-auto')}
              >
                <div
                  className={classNames(
                    'size-26px rounded-full flex items-center justify-center text-12px shrink-0 mt-1px shadow-xs',
                    isUser ? 'bg-message-user text-primary border border-primary/20' : memberColorClass
                  )}
                >
                  {isUser ? (
                    <User size={13} theme='outline' />
                  ) : isLeader ? (
                    '👑'
                  ) : isHr ? (
                    <Peoples size={13} theme='outline' />
                  ) : (
                    <Robot size={13} theme='outline' />
                  )}
                </div>

                <div
                  className={classNames(
                    'flex flex-col gap-3px min-w-0 max-w-[85%]',
                    isUser ? 'items-end' : 'items-start'
                  )}
                >
                  <div className='flex items-center gap-4px text-10px font-mono text-t-tertiary px-2px select-none'>
                    <span className='font-semibold text-t-secondary'>{msg.sender}</span>
                    <span>•</span>
                    <span>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <Button
                      type='text'
                      size='mini'
                      icon={<Copy size={11} theme='outline' />}
                      onClick={() => void copyToClipboard(msg.content, msg.id)}
                      aria-label='Copy message'
                      className='!px-2px !h-16px text-t-tertiary hover:text-primary ml-auto'
                    />
                    {copiedId === msg.id && <span className='text-9px text-emerald-400 ml-2px'>Copied</span>}
                  </div>

                  <div
                    className={classNames(
                      'p-10px rounded-12px text-12px leading-relaxed border shadow-xs select-text whitespace-pre-wrap break-words',
                      isUser
                        ? 'bg-message-user border-primary/15 text-t-primary rounded-tr-2px'
                        : msg.role === 'system'
                          ? 'bg-orange-500/10 border-orange-500/30 text-t-primary rounded-tl-2px'
                          : 'bg-[var(--color-bg-2)] border-[var(--color-border-2)] text-t-primary rounded-tl-2px'
                    )}
                  >
                    {msg.content}

                    {msg.createdEntities && msg.createdEntities.length > 0 && (
                      <div className='mt-8px flex flex-wrap gap-4px'>
                        {msg.createdEntities.map((ref) => (
                          <Button
                            key={`${ref.type}-${ref.id}`}
                            type='secondary'
                            size='mini'
                            onClick={() => onSelectCreatedEntity?.(ref)}
                            className='!text-11px !h-22px !px-6px !rounded-4px'
                          >
                            <span className='text-9px font-mono uppercase opacity-75 mr-4px'>[{ref.type}]</span>
                            <span className='truncate max-w-160px'>{ref.name}</span>
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Live step indicator & streaming */}
        {isExecuting && (
          <div className='flex gap-8px w-full mr-auto'>
            <div
              className={classNames(
                'size-26px rounded-full flex items-center justify-center text-12px shrink-0 mt-1px shadow-xs',
                memberColorClass
              )}
            >
              {isLeader ? '👑' : isHr ? <Peoples size={13} theme='outline' /> : <Robot size={13} theme='outline' />}
            </div>

            <div className='flex flex-col gap-4px min-w-0 max-w-[85%]'>
              {liveStepText && (
                <div className='inline-flex items-center gap-6px px-8px py-3px rounded-full bg-emerald-500/10 border border-emerald-500/20 text-11px text-emerald-400 font-mono self-start'>
                  <Spin loading size={10} icon={<Loading theme='outline' className='animate-spin' />} />
                  <span className='truncate'>{liveStepText}</span>
                  <Button
                    type='text'
                    size='mini'
                    icon={<Copy size={10} theme='outline' />}
                    onClick={() => void copyToClipboard(liveStepText || '', 'live-step')}
                    aria-label='Copy step'
                    className='!px-2px !h-16px text-emerald-400/70 hover:text-emerald-300 ml-2px'
                  />
                </div>
              )}

              {streamingContent && (
                <div className='p-10px rounded-12px text-12px leading-relaxed border shadow-xs select-text whitespace-pre-wrap break-words bg-[var(--color-bg-2)] border-[var(--color-border-2)] text-t-primary rounded-tl-2px relative group'>
                  {streamingContent}
                  <span className='inline-block w-6px h-12px bg-emerald-400 ml-2px animate-pulse' />
                  <Button
                    type='text'
                    size='mini'
                    icon={<Copy size={11} theme='outline' />}
                    onClick={() => void copyToClipboard(streamingContent, 'streaming')}
                    aria-label='Copy streaming content'
                    className='!px-2px !h-16px text-t-tertiary hover:text-primary absolute top-6px right-6px opacity-0 group-hover:opacity-100 transition-opacity'
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className='p-10px border-t border-[var(--color-border-2)] bg-[var(--color-bg-2)] shrink-0'>
        <div className='flex items-end gap-8px'>
          <Input.TextArea
            value={inputText}
            onChange={setInputText}
            onKeyDown={handleKeyDown}
            placeholder={t('team.organization.slotInputPlaceholder', {
              defaultValue: 'Message {{name}}...',
              name: memberDisplayName,
            })}
            autoSize={{ minRows: 1, maxRows: 4 }}
            className='!bg-[var(--color-bg-1)] !border-[var(--color-border-2)] focus:!border-primary !rounded-8px text-12px'
            disabled={isExecuting}
          />
          <div className='flex flex-col gap-4px shrink-0'>
            <Button
              type='primary'
              size='small'
              icon={<Send size={14} theme='outline' />}
              disabled={!inputText.trim() || isExecuting}
              onClick={() => void handleSend()}
              className='!rounded-8px !h-32px !w-32px flex items-center justify-center shrink-0'
              aria-label={t('team.organization.send', { defaultValue: 'Send' })}
            />
            <Button
              type='text'
              size='mini'
              icon={<Copy size={13} theme='outline' />}
              disabled={!inputText.trim()}
              onClick={() => void copyToClipboard(inputText, 'input')}
              aria-label='Copy input'
              className='!rounded-8px !h-26px !w-32px flex items-center justify-center shrink-0 text-t-secondary hover:text-primary disabled:opacity-50'
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrgTeamChatSlot;
