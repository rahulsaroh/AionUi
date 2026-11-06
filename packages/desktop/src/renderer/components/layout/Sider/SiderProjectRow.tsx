/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tooltip } from '@arco-design/web-react';
import { FolderClose, Edit, Plus } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import type { OrgProject } from '@/types/organization';

interface SiderProjectRowProps {
  project: OrgProject;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: (e: React.MouseEvent) => void;
  onNewChat: (e: React.MouseEvent) => void;
  siderTooltipProps: SiderTooltipProps;
}

const statusColorMap: Record<string, string> = {
  active: 'var(--success)',
  idle: 'var(--warning)',
  dormant: 'var(--text-tertiary)',
};

const statusTooltipMap: Record<string, string> = {
  active: 'Active',
  idle: 'Idle',
  dormant: 'Dormant',
};

export const SiderProjectRow: React.FC<SiderProjectRowProps> = ({
  project,
  isSelected,
  onSelect,
  onEdit,
  onNewChat,
  siderTooltipProps,
}) => {
  const { t } = useTranslation();
  const statusColor = statusColorMap[project.status] ?? 'var(--text-tertiary)';
  const statusTooltip = statusTooltipMap[project.status] ?? project.status;

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={classNames(
        'flex items-center justify-between px-8px py-4px rounded-6px cursor-pointer transition-colors text-12px text-t-primary',
        isSelected ? 'bg-primary/10 border border-primary/20' : 'hover:bg-fill-2'
      )}
    >
      <div className='flex items-center gap-6px truncate min-w-0'>
        <FolderClose size={13} theme='outline' className='text-amber-400 shrink-0' />
        <span className='truncate font-medium' title={project.name}>
          {project.name}
        </span>
      </div>
      <div className='flex items-center gap-3px shrink-0'>
        <Tooltip {...siderTooltipProps} content={statusTooltip} position='top'>
          <span
            className='size-6px rounded-full shrink-0 status-dot'
            style={{ backgroundColor: statusColor }}
            data-tooltip={statusTooltip}
            aria-label={statusTooltip}
          />
        </Tooltip>
        <Tooltip
          {...siderTooltipProps}
          content={t('team.organization.editProject', { defaultValue: 'Edit Project' })}
          position='top'
        >
          <button
            type='button'
            className='size-16px rounded flex items-center justify-center text-t-tertiary hover:text-t-primary hover:bg-fill-3 opacity-0 group-hover:opacity-100 transition-opacity'
            onClick={onEdit}
            aria-label={t('team.organization.editProject', { defaultValue: 'Edit Project' })}
          >
            <Edit size={10} theme='outline' />
          </button>
        </Tooltip>
        <Tooltip
          {...siderTooltipProps}
          content={t('team.organization.newChat', { defaultValue: 'New chat' })}
          position='top'
        >
          <button
            type='button'
            className='size-18px rounded flex items-center justify-center text-t-tertiary hover:text-t-primary hover:bg-fill-3 transition-opacity'
            onClick={onNewChat}
            aria-label={t('team.organization.newChat', { defaultValue: 'New chat' })}
          >
            <Plus size={11} theme='outline' />
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

export default React.memo(SiderProjectRow);
