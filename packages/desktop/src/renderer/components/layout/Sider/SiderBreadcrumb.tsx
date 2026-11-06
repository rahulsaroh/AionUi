/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tooltip } from '@arco-design/web-react';
import { Close, Right as ChevronRight } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

interface BreadcrumbPart {
  label: string;
  id: string | null;
  type: 'dept' | 'team' | 'project';
}

interface SiderBreadcrumbProps {
  parts: BreadcrumbPart[];
  onSelect: (part: BreadcrumbPart) => void;
  onClear: () => void;
  siderTooltipProps: SiderTooltipProps;
}

export const SiderBreadcrumb: React.FC<SiderBreadcrumbProps> = ({ parts, onSelect, onClear, siderTooltipProps }) => {
  const { t } = useTranslation();

  if (parts.length === 0) return null;

  return (
    <div
      className='px-12px py-4px bg-fill-2 border-b border-[var(--color-border-2)] flex items-center justify-between min-h-28px'
      role='navigation'
      aria-label={t('team.organization.breadcrumbAria', { defaultValue: 'Organization drill-down' })}
    >
      <div className='flex items-center gap-3px overflow-hidden flex-1 min-w-0'>
        <Tooltip
          {...siderTooltipProps}
          content={t('team.organization.allDepartments', { defaultValue: 'All Departments' })}
          position='bottom'
        >
          <button
            type='button'
            className='p-2px text-t-tertiary hover:text-t-primary transition-colors rounded-3px shrink-0'
            onClick={() => onSelect({ label: '', id: null, type: 'dept' })}
            aria-label={t('team.organization.allDepartments', { defaultValue: 'All Departments' })}
          >
            <span className='text-11px font-medium text-t-secondary'>
              {t('team.organization.allDepartmentsShort', { defaultValue: 'All' })}
            </span>
          </button>
        </Tooltip>
        {parts.map((part, idx) => (
          <span key={part.id ?? idx} className='flex items-center gap-3px shrink-0'>
            <ChevronRight size={10} theme='outline' className='text-t-tertiary shrink-0 opacity-60' />
            <button
              type='button'
              className={classNames(
                'p-2px truncate hover:bg-fill-2 hover:text-primary transition-colors rounded-3px breadcrumb-btn',
                idx === parts.length - 1 ? 'font-medium text-t-primary' : 'text-t-secondary'
              )}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(part);
              }}
              title={part.label}
            >
              <span className='text-11px truncate max-w-[140px]'>{part.label}</span>
            </button>
          </span>
        ))}
      </div>
      <Tooltip
        {...siderTooltipProps}
        content={t('team.organization.clearFilter', { defaultValue: 'Clear filter' })}
        position='top'
      >
        <button
          type='button'
          className='p-1px text-t-tertiary hover:text-t-danger transition-colors shrink-0'
          onClick={onClear}
          aria-label={t('team.organization.clearFilter', { defaultValue: 'Clear filter' })}
        >
          <Close size={12} theme='outline' />
        </button>
      </Tooltip>
    </div>
  );
};

export default React.memo(SiderBreadcrumb);
