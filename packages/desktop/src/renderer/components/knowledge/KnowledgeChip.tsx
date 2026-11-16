/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tag, Tooltip } from '@arco-design/web-react';
import { BookOne, Refresh, Attention, CheckOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useMemberKnowledge } from './useMemberKnowledge';

export type KnowledgeChipProps = {
  memberKey: string;
  memberName?: string;
  onClick?: () => void;
  className?: string;
  showWhenEmpty?: boolean;
};

export const KnowledgeChip: React.FC<KnowledgeChipProps> = ({
  memberKey,
  memberName,
  onClick,
  className = '',
  showWhenEmpty = false,
}) => {
  const { t } = useTranslation();
  const { assignedRepos, status, loading } = useMemberKnowledge(memberKey);

  if (assignedRepos.length === 0) {
    if (!showWhenEmpty) return null;
    return (
      <Tag
        size='small'
        className={`cursor-pointer select-none text-11px hover:opacity-85 ${className}`}
        icon={<BookOne theme='outline' size='12' />}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
      >
        {t('team.knowledgeRepos.chipLabel', { defaultValue: 'Knowledge' })}
      </Tag>
    );
  }

  const repoNames = assignedRepos.map((r) => r.name).join(', ');
  const statusLabel =
    status === 'updating'
      ? t('team.knowledgeRepos.status.syncing', { defaultValue: 'Updating...' })
      : status === 'needs_attention'
        ? t('team.knowledgeRepos.status.needsAttention', { defaultValue: 'Needs attention' })
        : t('team.knowledgeRepos.status.idle', { defaultValue: 'Up to date' });

  const statusColor = status === 'updating' ? 'arcoblue' : status === 'needs_attention' ? 'orange' : 'green';

  const statusIcon =
    status === 'updating' ? (
      <Refresh theme='outline' size='12' className='animate-spin' />
    ) : status === 'needs_attention' ? (
      <Attention theme='outline' size='12' />
    ) : (
      <CheckOne theme='outline' size='12' />
    );

  const tooltipText = `${memberName || memberKey} — Knowledge: ${repoNames} (${statusLabel})`;

  return (
    <Tooltip content={tooltipText} position='top'>
      <Tag
        color={statusColor}
        size='small'
        className={`cursor-pointer select-none text-11px flex items-center gap-4px hover:opacity-85 transition-opacity ${className}`}
        icon={statusIcon}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
      >
        <span className='font-medium'>{t('team.knowledgeRepos.chipLabel', { defaultValue: 'Knowledge' })}:</span>
        <span className='max-w-90px truncate'>{repoNames}</span>
      </Tag>
    </Tooltip>
  );
};
