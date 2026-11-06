/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Down, Right } from '@icon-park/react';

interface SiderSectionLabelProps {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}

export const SiderSectionLabel: React.FC<SiderSectionLabelProps> = ({ label, count, collapsed, onToggle }) => {
  return (
    <div
      className='flex items-center justify-between px-12px h-26px text-t-tertiary hover:text-t-primary cursor-pointer select-none'
      onClick={onToggle}
      role='button'
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      aria-expanded={!collapsed}
    >
      <div className='flex items-center gap-6px'>
        <span className='text-11px font-semibold uppercase tracking-wider'>
          {label} ({count})
        </span>
        {collapsed ? <Right size={11} theme='outline' /> : <Down size={11} theme='outline' />}
      </div>
    </div>
  );
};

export default React.memo(SiderSectionLabel);
