/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import { Down, Right, Edit, LinkOne, FolderPlus, Plus, MoreOne } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { getActionTooltipProps } from '@renderer/utils/ui/siderTooltip';
import type { OrgDepartmentNode, OrgNodeStatus } from '@/types/organization';
import { ORG_THEME_PALETTE } from '@/renderer/pages/organization/utils/orgTheme';

interface SiderDepartmentHeaderProps {
  department: OrgDepartmentNode;
  status: OrgNodeStatus;
  isSelected: boolean;
  isExpanded: boolean;
  teamsCount: number;
  projectsCount: number;
  subTab: 'teams' | 'projects';
  onSelect: () => void;
  onToggleExpand: () => void;
  onToggleSubTab: (tab: 'teams' | 'projects') => void;
  onEdit: (e?: React.MouseEvent | Event) => void;
  onSetFolder: (e?: React.MouseEvent | Event) => void;
  onAddProject: (e?: React.MouseEvent | Event) => void;
  onAddTeam: (e?: React.MouseEvent | Event) => void;
  siderTooltipProps: SiderTooltipProps;
}

export const SiderDepartmentHeader: React.FC<SiderDepartmentHeaderProps> = ({
  department,
  status,
  isSelected,
  isExpanded,
  teamsCount,
  projectsCount,
  subTab,
  onSelect,
  onToggleExpand,
  onToggleSubTab,
  onEdit,
  onSetFolder,
  onAddProject,
  onAddTeam,
  siderTooltipProps,
}) => {
  const { t } = useTranslation();
  const theme = ORG_THEME_PALETTE[status];
  const actionTooltipProps = getActionTooltipProps();

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={classNames(
        'group flex items-center justify-between px-8px py-4px rounded-6px cursor-pointer transition-colors text-12px select-none min-h-28px',
        isSelected
          ? 'bg-[rgba(var(--primary-6),0.10)] text-t-primary border border-[rgba(var(--primary-6),0.25)]'
          : 'hover:bg-fill-3 text-t-primary'
      )}
    >
      <div className='flex items-center gap-5px min-w-0 flex-1 mr-4px'>
        {teamsCount > 0 && (
          <span
            className='size-14px flex items-center justify-center shrink-0 cursor-pointer'
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? t('team.organization.collapse', { defaultValue: 'Collapse' })
                : t('team.organization.expand', { defaultValue: 'Expand' })
            }
          >
            <Right
              size={10}
              theme='outline'
              className={classNames('shrink-0 transition-transform duration-200', isExpanded ? 'rotate-90' : '')}
            />
          </span>
        )}
        <span className='size-5px rounded-full shrink-0' style={{ backgroundColor: theme.borderColor }} />
        <span className='font-semibold truncate text-12px text-t-primary' title={department.name}>
          {department.name}
        </span>
        <span className='text-10px text-t-tertiary whitespace-nowrap shrink-0'>
          {teamsCount}t · {projectsCount}p
        </span>
      </div>
      <div className='flex items-center gap-2px shrink-0'>
        <div className='flex items-center bg-fill-2 border border-[var(--color-border-2)] rounded-4px p-1px shrink-0'>
          <Tooltip
            {...siderTooltipProps}
            content={t('team.organization.teamsTab', { defaultValue: 'Teams' })}
            position='top'
          >
            <Button
              type='text'
              size='mini'
              onClick={(e) => {
                e.stopPropagation();
                onToggleSubTab('teams');
              }}
              className={classNames(
                '!px-5px !py-1px !h-18px text-10px transition-colors shrink-0 rounded-3px leading-none border-none',
                subTab === 'teams'
                  ? '!bg-[var(--color-bg-2)] !text-primary shadow-xs !font-medium'
                  : '!text-t-tertiary hover:!text-t-primary'
              )}
              aria-pressed={subTab === 'teams'}
            >
              {t('team.organization.teamsTab', { defaultValue: 'Teams' })}
            </Button>
          </Tooltip>
          <Tooltip
            {...siderTooltipProps}
            content={t('team.organization.projectsTab', { defaultValue: 'Projects' })}
            position='top'
          >
            <Button
              type='text'
              size='mini'
              onClick={(e) => {
                e.stopPropagation();
                onToggleSubTab('projects');
              }}
              className={classNames(
                '!px-5px !py-1px !h-18px text-10px transition-colors shrink-0 rounded-3px leading-none border-none',
                subTab === 'projects'
                  ? '!bg-[var(--color-bg-2)] !text-primary shadow-xs !font-medium'
                  : '!text-t-tertiary hover:!text-t-primary'
              )}
              aria-pressed={subTab === 'projects'}
            >
              {t('team.organization.projectsTab', { defaultValue: 'Projects' })}
            </Button>
          </Tooltip>
        </div>
        <div className='hidden group-hover:flex items-center gap-1px shrink-0'>
          <Tooltip
            {...actionTooltipProps}
            content={t('team.organization.editDepartment', { defaultValue: 'Edit Department' })}
            position='top'
          >
            <Button
              type='text'
              size='mini'
              onClick={(e) => {
                e.stopPropagation();
                onEdit(e);
              }}
              className='!p-2px !h-20px !w-20px flex items-center justify-center text-t-tertiary hover:text-t-primary transition-all shrink-0 border-none'
              aria-label={t('team.organization.editDepartment', { defaultValue: 'Edit Department' })}
            >
              <Edit size={12} theme='outline' />
            </Button>
          </Tooltip>
          <Tooltip
            {...actionTooltipProps}
            content={t('team.organization.setFolder', { defaultValue: 'Set Folder' })}
            position='top'
          >
            <Button
              type='text'
              size='mini'
              onClick={(e) => {
                e.stopPropagation();
                onSetFolder(e);
              }}
              className='!p-2px !h-20px !w-20px flex items-center justify-center text-t-tertiary hover:text-t-primary transition-all shrink-0 border-none'
              aria-label={t('team.organization.setFolder', { defaultValue: 'Set Folder' })}
            >
              <LinkOne size={12} theme='outline' />
            </Button>
          </Tooltip>
          <Tooltip
            {...actionTooltipProps}
            content={t('team.organization.addProject', { defaultValue: 'Add Project' })}
            position='top'
          >
            <Button
              type='text'
              size='mini'
              onClick={(e) => {
                e.stopPropagation();
                onAddProject(e);
              }}
              className='!p-2px !h-20px !w-20px flex items-center justify-center text-t-tertiary hover:text-t-primary transition-all shrink-0 border-none'
              aria-label={t('team.organization.addProject', { defaultValue: 'Add Project' })}
            >
              <FolderPlus size={12} theme='outline' />
            </Button>
          </Tooltip>
          <Tooltip
            {...actionTooltipProps}
            content={t('team.organization.addTeam', { defaultValue: 'Add Team' })}
            position='top'
          >
            <Button
              type='text'
              size='mini'
              onClick={(e) => {
                e.stopPropagation();
                onAddTeam(e);
              }}
              className='!p-2px !h-20px !w-20px flex items-center justify-center text-t-tertiary hover:text-t-primary transition-all shrink-0 border-none'
              aria-label={t('team.organization.addTeam', { defaultValue: 'Add Team' })}
            >
              <Plus size={12} theme='outline' />
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};

export default React.memo(SiderDepartmentHeader);
