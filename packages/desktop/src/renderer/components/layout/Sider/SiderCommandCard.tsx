/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button } from '@arco-design/web-react';
import { Crown, Plus } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import styles from './Sider.module.css';

interface SiderCommandCardProps {
  onNewChat: () => void;
  onOpenChat?: () => void;
  shortcut?: string;
  selected?: boolean;
}

export const SiderCommandCard: React.FC<SiderCommandCardProps> = ({
  onNewChat,
  onOpenChat,
  shortcut,
  selected = false,
}) => {
  const { t } = useTranslation();
  return (
    <div
      onClick={onOpenChat || onNewChat}
      className={classNames(
        '!w-full !h-34px !px-10px !py-0 flex items-center justify-start gap-8px text-left border-none cursor-pointer select-none',
        styles.commandCard,
        selected && styles.commandCardSelected
      )}
    >
      <Crown
        size={16}
        theme='outline'
        fill='currentColor'
        className='shrink-0'
        style={{ color: '#D97706', lineHeight: 0 }}
      />
      <span className='font-medium text-13px text-t-primary truncate leading-none'>
        {t('team.organization.talkToRootCeo', { defaultValue: 'Talk to Root CEO' })}
      </span>
      {Boolean(shortcut?.trim()) && (
        <span className='text-10px font-medium px-4px py-0.5px rounded bg-fill-2 text-t-secondary border border-[var(--color-border-2)] leading-tight shrink-0'>
          {shortcut}
        </span>
      )}
      <Button
        type='text'
        size='mini'
        icon={<Plus size={14} />}
        aria-label={t('team.organization.newMemberChat', { defaultValue: 'New chat with {{name}}', name: 'Root CEO' })}
        className='ms-auto'
        onClick={(e) => {
          e.stopPropagation();
          onNewChat();
        }}
      />
    </div>
  );
};

export default React.memo(SiderCommandCard);
