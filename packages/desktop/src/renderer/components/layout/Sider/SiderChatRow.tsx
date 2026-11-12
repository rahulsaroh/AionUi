/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { MessageOne, Robot } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { OrgConversation } from '@/types/organization';

/** Engine-status prefixes to strip from preview text (Step 1c). */
const ENGINE_STATUS_PREFIXES = [
  'Executive Directive Completed:',
  'Executive Directive',
  'Directive executed',
  'Halted:',
  'Response received',
];

export function getLastMessagePreview(conversation: OrgConversation): string {
  const msgs = conversation.messages;
  if (msgs.length === 0) return '';
  // Walk back from the end to find the last non-system message
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg.role === 'system') continue;
    const text = msg.content.trim();
    // Skip engine-status text
    if (ENGINE_STATUS_PREFIXES.some((prefix) => text.startsWith(prefix))) continue;
    return text.replace(/\n/g, ' ');
  }
  return '';
}

interface SiderChatRowProps {
  conversation: OrgConversation;
  isSelected: boolean;
  badge?: string;
  relativeTime: string;
  onSelect: () => void;
}

export const SiderChatRow: React.FC<SiderChatRowProps> = ({
  conversation,
  isSelected,
  badge,
  relativeTime,
  onSelect,
}) => {
  const { t } = useTranslation();

  // Step 1c: show last user/assistant message text, never engine status text
  const preview = useMemo(() => getLastMessagePreview(conversation), [conversation]);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={classNames(
        'p-3px rounded-4px cursor-pointer transition-colors flex flex-col gap-1px text-11px border border-transparent select-none',
        isSelected
          ? 'bg-[rgba(var(--primary-6),0.10)] border-[rgba(var(--primary-6),0.25)] text-t-primary'
          : 'hover:bg-fill-2 text-t-secondary hover:text-t-primary hover:border-[var(--color-border-2)]'
      )}
    >
      <div className='flex items-center justify-between gap-4px'>
        <div className='flex items-center gap-6px min-w-0'>
          {conversation.type === 'ceo_directive' ? (
            <Robot size={13} theme='outline' className='text-amber-500 shrink-0' />
          ) : (
            <MessageOne size={13} theme='outline' className='text-t-secondary shrink-0' />
          )}
          <span className='font-medium truncate' title={conversation.title}>
            {conversation.title}
          </span>
        </div>
        <span className='text-9px text-t-tertiary shrink-0'>{relativeTime}</span>
      </div>
      {/* Step 1c: last message preview (plain text, 1 line, no engine status) */}
      {preview && (
        <span className='text-10px text-t-secondary truncate leading-snug' title={preview}>
          {preview}
        </span>
      )}
      {badge && <span className='text-9px text-t-tertiary shrink-0'>{badge}</span>}
    </div>
  );
};

export default React.memo(SiderChatRow);
