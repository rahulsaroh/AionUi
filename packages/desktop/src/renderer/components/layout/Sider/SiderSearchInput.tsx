/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Input, Tooltip } from '@arco-design/web-react';
import { Search } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

interface SiderSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  siderTooltipProps: SiderTooltipProps;
}

export const SiderSearchInput: React.FC<SiderSearchInputProps> = ({
  value,
  onChange,
  placeholder,
  siderTooltipProps,
}) => {
  const { t } = useTranslation();

  return (
    <Tooltip
      {...siderTooltipProps}
      content={t('team.organization.searchPlaceholder', { defaultValue: 'Search departments, teams, projects...' })}
      position='top'
    >
      <Input
        allowClear
        className='w-full h-28px text-12px rounded-6px'
        placeholder={
          placeholder ??
          t('team.organization.searchPlaceholder', { defaultValue: 'Search departments, teams, projects...' })
        }
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement> | string) =>
          onChange(typeof e === 'string' ? e : e.target.value)
        }
        prefix={
          <Search
            size={13}
            theme='outline'
            fill='currentColor'
            className='text-t-tertiary shrink-0'
            style={{ lineHeight: 0 }}
          />
        }
      />
    </Tooltip>
  );
};

export default React.memo(SiderSearchInput);
