/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button } from '@arco-design/web-react';
import { Crown } from '@icon-park/react';
import classNames from 'classnames';
import styles from './Sider.module.css';

interface SiderCommandCardProps {
  onClick: () => void;
  shortcut?: string;
  selected?: boolean;
}

export const SiderCommandCard: React.FC<SiderCommandCardProps> = ({ onClick, shortcut, selected = false }) => {
  return (
    <Button
      type='text'
      onClick={onClick}
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
      <span className='font-medium text-13px text-t-primary truncate leading-none'>Talk to Root CEO</span>
      {Boolean(shortcut?.trim()) && (
        <span className='ms-auto text-10px font-medium px-4px py-0.5px rounded bg-fill-2 text-t-secondary border border-[var(--color-border-2)] leading-tight shrink-0'>
          {shortcut}
        </span>
      )}
    </Button>
  );
};

export default React.memo(SiderCommandCard);
