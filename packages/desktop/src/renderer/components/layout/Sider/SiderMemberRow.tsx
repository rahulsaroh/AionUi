/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Robot } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { OrgAgentMember } from '@/types/organization';

interface SiderMemberRowProps {
  member: OrgAgentMember;
  isSelected: boolean;
  onOpenChat: () => void;
}

export const SiderMemberRow: React.FC<SiderMemberRowProps> = ({ member, isSelected, onOpenChat }) => {
  const { t } = useTranslation();

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onOpenChat();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onOpenChat();
        }
      }}
      aria-label={t('team.organization.openMemberChat', {
        defaultValue: 'Open chat with {{name}}',
        name: member.name,
      })}
      title={member.title || member.role}
      className={classNames(
        'flex items-center justify-between px-6px py-3px rounded cursor-pointer transition-colors text-12px select-none',
        isSelected
          ? 'bg-[rgba(var(--primary-6),0.10)] text-t-primary border border-[rgba(var(--primary-6),0.20)]'
          : 'hover:bg-fill-2 text-t-secondary hover:text-t-primary'
      )}
    >
      <div className='flex items-center gap-5px truncate min-w-0'>
        <Robot size={12} theme='outline' className='text-primary shrink-0' />
        <span className='truncate text-12px' title={member.name}>
          {member.name}
        </span>
      </div>
      <span className='text-10px text-t-tertiary truncate shrink-0 ml-4px'>{member.title || member.role}</span>
    </div>
  );
};

export default React.memo(SiderMemberRow);
