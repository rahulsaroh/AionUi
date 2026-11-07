/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { MessageOne, Robot } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { OrgConversation } from '@/types/organization';

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
      {conversation.summary && <span className='text-10px text-t-secondary truncate'>{conversation.summary}</span>}
      {badge && <span className='text-9px text-t-tertiary shrink-0'>{badge}</span>}
    </div>
  );
};

export default React.memo(SiderChatRow);
