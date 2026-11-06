/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import classNames from 'classnames';
import { Tooltip } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

type FilterKey = 'all' | 'active' | 'dormant' | 'shared';

interface FilterOption {
  key: FilterKey;
  label: string;
  count: number;
}

interface SiderFilterSegmentProps {
  activeFilter: FilterKey;
  onChange: (filter: FilterKey) => void;
  options: FilterOption[];
  siderTooltipProps: SiderTooltipProps;
}

export const SiderFilterSegment: React.FC<SiderFilterSegmentProps> = ({
  activeFilter,
  onChange,
  options,
  siderTooltipProps,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className='flex items-center gap-1px w-full'
      role='group'
      aria-label={t('team.organization.filterAria', { defaultValue: 'Filter departments, teams, projects' })}
    >
      {options.map((opt) => (
        <Tooltip key={opt.key} {...siderTooltipProps} content={`${opt.label} (${opt.count})`} position='top'>
          <button
            type='button'
            onClick={() => onChange(opt.key)}
            className={classNames(
              'flex-1 flex items-center justify-center gap-4px h-28px px-6px py-2px rounded-6px text-12px font-medium capitalize cursor-pointer border-none transition-all',
              activeFilter === opt.key
                ? 'bg-[var(--color-bg-2)] text-primary shadow-xs'
                : 'bg-transparent text-t-secondary hover:text-t-primary hover:bg-fill-2'
            )}
            aria-pressed={activeFilter === opt.key}
          >
            {opt.label}
            {opt.count > 0 && (
              <span className='text-10px font-medium px-3px py-0.5px rounded bg-fill-2 text-t-tertiary border border-[var(--color-border-2)]'>
                {opt.count}
              </span>
            )}
          </button>
        </Tooltip>
      ))}
    </div>
  );
};

export default React.memo(SiderFilterSegment);
