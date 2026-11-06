/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import classNames from 'classnames';
import type { ReactNode } from 'react';

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
  const showBadge = badge || (badgeCount !== undefined && badgeCount > 0);

  return (
    <button
      type='button'
      onClick={onClick}
      className={classNames(
        'w-full h-32px flex items-center gap-8px px-10px rounded-8px cursor-pointer border-none transition-all',
        selected
          ? 'bg-primary/10 text-t-primary border-l-2 border-primary'
          : 'bg-transparent text-t-primary hover:bg-fill-2'
      )}
    >
      <span className='size-22px flex items-center justify-center shrink-0 line-height-0 text-t-primary'>{icon}</span>
      <span className='text-12px font-medium truncate'>{label}</span>
      {showBadge && (
        <span
          className={classNames(
            'ms-auto text-10px font-medium px-3px py-0.5px rounded shrink-0 bg-fill-2 text-t-tertiary border border-[var(--color-border-2)]',
            badgeClassName
          )}
        >
          {badge ?? badgeCount}
        </span>
      )}
    </button>
  );
};

export default React.memo(SiderNavRow);
