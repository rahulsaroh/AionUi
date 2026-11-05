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

interface ScopeSegmentedToggleProps {
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onSessionClick?: () => void;
}

export const ScopeSegmentedToggle: React.FC<ScopeSegmentedToggleProps> = ({
  collapsed,
  siderTooltipProps,
  onSessionClick,
}) => {
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

  if (collapsed) {
    return (
      <div className='flex flex-col gap-2px w-full px-4px mb-6px'>
        <Tooltip {...siderTooltipProps} content='Workplace Mode (Personal & Projects)' position='right'>
          <button
            type='button'
            className={classNames(
              'w-full h-32px flex items-center justify-center rounded-8px cursor-pointer border-none transition-all',
              activeScope === 'workplace'
                ? 'bg-[var(--color-bg-2)] text-primary shadow-sm font-bold ring-1 ring-primary/30'
                : 'bg-transparent text-t-secondary hover:bg-fill-2 hover:text-t-primary'
            )}
            onClick={() => handleSelectScope('workplace')}
          >
            <span className='text-14px leading-none'>💼</span>
          </button>
        </Tooltip>

        <Tooltip {...siderTooltipProps} content='Organization Mode (Corporate Org-Chart & HQ)' position='right'>
          <button
            type='button'
            className={classNames(
              'w-full h-32px flex items-center justify-center rounded-8px cursor-pointer border-none transition-all',
              activeScope === 'organization'
                ? 'bg-[var(--color-bg-2)] text-primary shadow-sm font-bold ring-1 ring-primary/30'
                : 'bg-transparent text-t-secondary hover:bg-fill-2 hover:text-t-primary'
            )}
            onClick={() => handleSelectScope('organization')}
          >
            <span className='text-14px leading-none'>🏢</span>
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className='mx-8px mb-8px p-2px rounded-10px bg-fill-2 border border-[var(--color-border-2)] flex items-center select-none shadow-sm'>
      <button
        type='button'
        onClick={() => handleSelectScope('workplace')}
        className={classNames(
          'flex-1 flex items-center justify-center gap-6px py-5px px-6px rounded-8px text-12px font-medium cursor-pointer border-none transition-all',
          activeScope === 'workplace'
            ? 'bg-[var(--color-bg-2)] text-primary shadow-sm font-semibold'
            : 'bg-transparent text-t-secondary hover:text-t-primary hover:bg-fill-3'
        )}
      >
        <span className='text-13px leading-none'>💼</span>
        <span>Workplace</span>
      </button>

      <button
        type='button'
        onClick={() => handleSelectScope('organization')}
        className={classNames(
          'flex-1 flex items-center justify-center gap-6px py-5px px-6px rounded-8px text-12px font-medium cursor-pointer border-none transition-all',
          activeScope === 'organization'
            ? 'bg-[var(--color-bg-2)] text-primary shadow-sm font-semibold'
            : 'bg-transparent text-t-secondary hover:text-t-primary hover:bg-fill-3'
        )}
      >
        <span className='text-13px leading-none'>🏢</span>
        <span>Organization</span>
      </button>
    </div>
  );
};

export default React.memo(ScopeSegmentedToggle);
