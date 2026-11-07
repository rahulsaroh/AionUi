/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import { FolderClose, Edit, Plus } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import type { OrgProject } from '@/types/organization';

interface SiderProjectRowProps {
  project: OrgProject;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: (e?: React.MouseEvent | Event) => void;
  onNewChat: (e?: React.MouseEvent | Event) => void;
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
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={classNames(
        'group flex items-center justify-between px-8px py-4px rounded-6px cursor-pointer transition-colors text-12px text-t-primary select-none',
        isSelected ? 'bg-[rgba(var(--primary-6),0.10)] border border-[rgba(var(--primary-6),0.20)]' : 'hover:bg-fill-2'
      )}
    >
      <div className='flex items-center gap-6px truncate min-w-0'>
        <FolderClose size={13} theme='outline' className='text-amber-500 shrink-0' />
        <span className='truncate font-medium text-12px' title={project.name}>
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
          <Button
            type='text'
            size='mini'
            className='!size-16px !p-0 rounded flex items-center justify-center text-t-tertiary hover:text-t-primary hover:bg-fill-3 opacity-0 group-hover:opacity-100 transition-opacity border-none'
            onClick={(e) => onEdit(e)}
            aria-label={t('team.organization.editProject', { defaultValue: 'Edit Project' })}
          >
            <Edit size={10} theme='outline' />
          </Button>
        </Tooltip>
        <Tooltip
          {...siderTooltipProps}
          content={t('team.organization.newChat', { defaultValue: 'New chat' })}
          position='top'
        >
          <Button
            type='text'
            size='mini'
            className='!size-18px !p-0 rounded flex items-center justify-center text-t-tertiary hover:text-t-primary hover:bg-fill-3 transition-opacity border-none'
            onClick={(e) => onNewChat(e)}
            aria-label={t('team.organization.newChat', { defaultValue: 'New chat' })}
          >
            <Plus size={11} theme='outline' />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
};

export default React.memo(SiderProjectRow);
