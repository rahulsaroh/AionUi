/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
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
      <div className='flex flex-col gap-2px w-full px-4px mb-6px shrink-0'>
        {tabs.map((tab) => (
          <Tooltip key={tab.id} {...siderTooltipProps} content={tab.label} position='right'>
            <Button
              type='text'
              size='small'
              className={classNames(
                '!w-full !h-32px !p-0 flex items-center justify-center rounded-8px border-none transition-all',
                activeScope === tab.id
                  ? '!bg-[var(--color-bg-2)] !text-primary shadow-sm !font-bold'
                  : '!bg-transparent !text-t-secondary hover:!bg-fill-2 hover:!text-t-primary'
              )}
              onClick={() => handleSelectScope(tab.id)}
            >
              <tab.icon theme='outline' size={16} fill='currentColor' className='block leading-none shrink-0' />
            </Button>
          </Tooltip>
        ))}
      </div>
    );
  }

  return (
    <div className='mx-8px mt-4px mb-6px p-2px h-32px rounded-8px bg-fill-2 border border-[var(--color-border-2)] flex items-stretch select-none shrink-0'>
      {tabs.map((tab) => {
        const isActive = activeScope === tab.id;
        return (
          <Tooltip key={tab.id} {...siderTooltipProps} content={tab.label} position='top'>
            <Button
              type='text'
              size='mini'
              onClick={() => handleSelectScope(tab.id)}
              className={classNames(
                '!flex-1 !h-full !px-6px !py-0 flex items-center justify-center gap-6px rounded-6px text-12px border-none transition-all',
                isActive
                  ? '!bg-[var(--color-bg-2)] !text-primary shadow-xs !font-semibold'
                  : '!bg-transparent !text-t-secondary hover:!text-t-primary hover:!bg-fill-3'
              )}
            >
              <tab.icon theme='outline' size={14} fill='currentColor' className='shrink-0' />
              <span className='truncate text-12px'>{tab.label}</span>
            </Button>
          </Tooltip>
        );
      })}
    </div>
  );
};

export default React.memo(SiderModeToggle);
