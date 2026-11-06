/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import { useNavigate, useLocation } from 'react-router-dom';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { useOrgStore } from '@/renderer/pages/organization/store/useOrgStore';
import { Briefcase, NetworkTree } from '@icon-park/react';

interface SiderModeToggleProps {
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onSessionClick?: () => void;
}

export const SiderModeToggle: React.FC<SiderModeToggleProps> = ({ collapsed, siderTooltipProps, onSessionClick }) => {
  const { activeScope, setActiveScope } = useOrgStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSelectScope = (scope: 'workplace' | 'organization') => {
    if (activeScope === scope) return;
    setActiveScope(scope);
    onSessionClick?.();

    if (scope === 'organization') {
      void navigate('/organization');
    } else {
      if (location.pathname === '/organization') {
        void navigate('/guid');
      }
    }
  };

  const tabs = [
    { id: 'workplace', label: 'Workplace', icon: Briefcase },
    { id: 'organization', label: 'Organization', icon: NetworkTree },
  ] as const;

  if (collapsed) {
    return (
      <div className='flex flex-col gap-2px w-full px-4px mb-6px'>
        {tabs.map((tab) => (
          <Tooltip key={tab.id} {...siderTooltipProps} content={tab.label} position='right'>
            <button
              type='button'
              className={classNames(
                'w-full h-32px flex items-center justify-center rounded-8px cursor-pointer border-none transition-all',
                activeScope === tab.id
                  ? 'bg-[var(--color-bg-2)] text-primary shadow-sm font-bold ring-1 ring-primary/30'
                  : 'bg-transparent text-t-secondary hover:bg-fill-2 hover:text-t-primary'
              )}
              onClick={() => handleSelectScope(tab.id)}
            >
              <tab.icon theme='outline' size={16} fill='currentColor' className='block leading-none shrink-0' />
            </button>
          </Tooltip>
        ))}
      </div>
    );
  }

  return (
    <div className='mx-8px mb-8px p-2px rounded-10px bg-fill-2 border border-[var(--color-border-2)] flex items-center select-none shadow-sm'>
      {tabs.map((tab) => (
        <Tooltip key={tab.id} {...siderTooltipProps} content={tab.label} position='top'>
          <button
            type='button'
            onClick={() => handleSelectScope(tab.id)}
            className={classNames(
              'flex-1 flex items-center justify-center gap-6px py-5px px-6px rounded-8px text-12px font-medium cursor-pointer border-none transition-all',
              activeScope === tab.id
                ? 'bg-[var(--color-bg-2)] text-primary shadow-sm font-semibold'
                : 'bg-transparent text-t-secondary hover:text-t-primary hover:bg-fill-3'
            )}
          >
            <tab.icon theme='outline' size={14} fill='currentColor' className='shrink-0' />
            <span className='truncate text-11px'>{tab.label}</span>
          </button>
        </Tooltip>
      ))}
    </div>
  );
};

export default React.memo(SiderModeToggle);
