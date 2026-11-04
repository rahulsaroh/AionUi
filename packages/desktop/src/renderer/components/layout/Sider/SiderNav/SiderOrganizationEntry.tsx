/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, Badge } from '@arco-design/web-react';
import { NetworkTree } from '@icon-park/react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { isMacOS } from '@renderer/utils/platform';

interface SiderOrganizationEntryProps {
  isMobile: boolean;
  isActive: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onClick: () => void;
  badgeCount?: number;
}

export const SiderOrganizationEntry: React.FC<SiderOrganizationEntryProps> = ({
  isMobile,
  isActive,
  collapsed,
  siderTooltipProps,
  onClick,
  badgeCount = 0,
}) => {
  const { t } = useTranslation();
  const isMac = isMacOS();
  const shortcutHint = isMac ? '⌘4' : 'Ctrl+4';
  const label = t('team.organization.tab', { defaultValue: 'Organization' });
  const tooltipContent = `${label} (${shortcutHint})`;

  if (collapsed) {
    return (
      <Tooltip {...siderTooltipProps} content={tooltipContent} position='right'>
        <div
          data-testid='sider-nav-organization'
          className={classNames(
            'w-full h-34px flex items-center justify-center cursor-pointer transition-colors rd-8px text-t-primary relative',
            isActive ? 'bg-fill-3 text-primary font-semibold' : 'hover:bg-fill-3 active:bg-fill-4'
          )}
          onClick={onClick}
        >
          <NetworkTree
            theme='outline'
            size='20'
            fill='currentColor'
            className='block leading-none shrink-0'
            style={{ lineHeight: 0 }}
          />
          {badgeCount > 0 && (
            <span className='size-6px rounded-full bg-cyan-400 animate-pulse absolute top-1 right-2' />
          )}
        </div>
      </Tooltip>
    );
  }

  return (
    <Tooltip {...siderTooltipProps} content={tooltipContent} position='right'>
      <div
        data-testid='sider-nav-organization'
        className={classNames(
          'box-border group h-34px w-full flex items-center justify-between gap-8px ps-10px pe-8px rd-0.5rem cursor-pointer shrink-0 transition-all text-t-primary',
          isMobile && 'sider-action-btn-mobile',
          isActive ? 'bg-fill-3 text-primary font-semibold' : 'hover:bg-fill-3 active:bg-fill-4'
        )}
        onClick={onClick}
      >
        <div className='flex items-center gap-8px min-w-0'>
          <span className='size-22px flex items-center justify-center shrink-0'>
            <NetworkTree
              theme='outline'
              size='16'
              fill='currentColor'
              className='block leading-none'
              style={{ lineHeight: 0 }}
            />
          </span>
          <span className='collapsed-hidden text-14px font-[500] leading-24px truncate'>
            {label}
          </span>
        </div>
        <div className='flex items-center gap-4px shrink-0 collapsed-hidden'>
          {badgeCount > 0 && (
            <Badge count={badgeCount} maxCount={99} />
          )}
          <span className='text-10px font-mono text-t-tertiary px-4px py-1px rounded bg-fill-2 border border-[var(--color-border-2)]'>
            {shortcutHint}
          </span>
        </div>
      </div>
    </Tooltip>
  );
};

export default SiderOrganizationEntry;
