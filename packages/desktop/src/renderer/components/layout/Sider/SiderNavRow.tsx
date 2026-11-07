/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button } from '@arco-design/web-react';
import classNames from 'classnames';
import type { ReactNode } from 'react';
import styles from './Sider.module.css';

interface SiderNavRowProps {
  icon: ReactNode;
  label: string;
  selected?: boolean;
  badge?: ReactNode;
  badgeCount?: number;
  onClick?: () => void;
  badgeClassName?: string;
}

export const SiderNavRow: React.FC<SiderNavRowProps> = ({
  icon,
  label,
  selected = false,
  badge,
  badgeCount,
  onClick,
  badgeClassName,
}) => {
  const showBadge = Boolean(badge) || (badgeCount !== undefined && badgeCount > 0);

  return (
    <Button
      type='text'
      onClick={onClick}
      className={classNames(
        '!w-full !h-32px !px-10px !py-0 flex items-center justify-start gap-8px text-left border-none cursor-pointer select-none',
        styles.navRow,
        selected && styles.navRowSelected
      )}
    >
      <span className='size-20px flex items-center justify-center shrink-0 line-height-0 text-t-primary'>{icon}</span>
      <span className='text-12px font-medium text-t-primary truncate leading-none'>{label}</span>
      {showBadge && (
        <span
          className={classNames(
            'ms-auto text-11px font-normal px-6px py-0.5px rounded shrink-0 bg-fill-2 text-t-secondary border border-[var(--color-border-2)] leading-tight',
            badgeClassName
          )}
        >
          {badge ?? `${badgeCount} active`}
        </span>
      )}
    </Button>
  );
};

export default React.memo(SiderNavRow);
