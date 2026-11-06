/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Crown } from '@icon-park/react';
import classNames from 'classnames';

interface SiderCommandCardProps {
  onClick: () => void;
  shortcut?: string;
  selected?: boolean;
}

export const SiderCommandCard: React.FC<SiderCommandCardProps> = ({ onClick, shortcut, selected = false }) => {
  return (
    <button
      type='button'
      onClick={onClick}
      className={classNames(
        'w-full h-34px flex items-center gap-8px px-10px rounded-8px cursor-pointer border-none transition-all',
        'bg-primary/8 text-t-primary hover:bg-primary/14',
        selected && 'bg-primary/14 border-l-2 border-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-base)]'
      )}
    >
      <Crown size={16} theme='outline' fill='currentColor' className='shrink-0 text-amber-500' />
      <span className='font-medium text-13px truncate'>Talk to Root CEO</span>
      {shortcut && (
        <span className='ms-auto text-10px font-medium px-3px py-0.5px rounded bg-fill-2 text-t-tertiary border border-[var(--color-border-2)]'>
          {shortcut}
        </span>
      )}
    </button>
  );
};

export default React.memo(SiderCommandCard);
