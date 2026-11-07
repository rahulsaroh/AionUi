/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import classNames from 'classnames';
import { Button, Tooltip } from '@arco-design/web-react';
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
      className='h-28px p-2px rounded-6px bg-fill-2 border border-[var(--color-border-2)] flex items-stretch gap-1px w-full select-none'
      role='group'
      aria-label={t('team.organization.filterAria', { defaultValue: 'Filter departments, teams, projects' })}
    >
      {options.map((opt) => {
        const isSelected = activeFilter === opt.key;
        return (
          <Tooltip key={opt.key} {...siderTooltipProps} content={`${opt.label} (${opt.count})`} position='top'>
            <Button
              type='text'
              size='mini'
              onClick={() => onChange(opt.key)}
              className={classNames(
                '!flex-1 !h-full !px-2px !py-0 flex items-center justify-center gap-3px rounded-4px text-12px border-none transition-all leading-none',
                isSelected
                  ? '!bg-[var(--color-bg-2)] !text-primary shadow-xs !font-medium'
                  : '!bg-transparent !text-t-secondary hover:!text-t-primary hover:!bg-fill-3'
              )}
              aria-pressed={isSelected}
            >
              <span className='capitalize text-12px leading-none truncate'>{opt.label}</span>
              {opt.count > 0 && (
                <span
                  className={classNames(
                    'text-10px leading-none font-normal px-3px py-0.5px rounded-full shrink-0',
                    isSelected ? 'bg-fill-2 text-primary' : 'bg-fill-2 text-t-tertiary'
                  )}
                >
                  {opt.count}
                </span>
              )}
            </Button>
          </Tooltip>
        );
      })}
    </div>
  );
};

export default React.memo(SiderFilterSegment);
