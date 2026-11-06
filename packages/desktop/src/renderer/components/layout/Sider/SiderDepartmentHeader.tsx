/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tooltip } from '@arco-design/web-react';
import { Down, Right, Edit, LinkOne, FolderPlus, Plus, MoreOne } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
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
  onEdit: (e: React.MouseEvent) => void;
  onSetFolder: (e: React.MouseEvent) => void;
  onAddProject: (e: React.MouseEvent) => void;
  onAddTeam: (e: React.MouseEvent) => void;
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
        'group flex items-center justify-between px-8px py-5px rounded-6px cursor-pointer transition-colors text-12px',
        isSelected ? 'bg-primary/10 text-t-primary border border-primary/20' : 'hover:bg-fill-3 text-t-primary'
      )}
    >
      <div className='flex items-center gap-6px min-w-0'>
        {teamsCount > 0 && (
          <span
            className={classNames(
              'size-16px flex items-center justify-center shrink-0 transition-transform',
              isExpanded ? 'rotate-90' : ''
            )}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            role='button'
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggleExpand();
              }
            }}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? t('team.organization.collapse', { defaultValue: 'Collapse' })
                : t('team.organization.expand', { defaultValue: 'Expand' })
            }
          >
            {isExpanded ? <Down size={10} theme='outline' /> : <Right size={10} theme='outline' />}
          </span>
        )}
        <span className='size-4px rounded-full shrink-0 opacity-60' style={{ backgroundColor: theme.borderColor }} />
        <span className='font-semibold truncate' title={department.name}>
          {department.name}
        </span>
        <span className='text-10px text-t-tertiary font-mono'>
          {teamsCount} teams · {projectsCount} projects
        </span>
      </div>
      <div className='flex items-center gap-2px shrink-0'>
        <Tooltip
          {...siderTooltipProps}
          content={t('team.organization.teamsTab', { defaultValue: 'Teams' })}
          position='top'
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSubTab('teams');
            }}
            className={classNames(
              'px-5px py-1px text-9px transition-colors shrink-0 rounded-l-6px',
              subTab === 'teams' ? 'bg-fill-3 text-t-primary' : 'text-t-tertiary hover:bg-fill-2 hover:text-t-primary'
            )}
            aria-pressed={subTab === 'teams'}
          >
            {t('team.organization.teamsTab', { defaultValue: 'Teams' })}
          </button>
        </Tooltip>
        <Tooltip
          {...siderTooltipProps}
          content={t('team.organization.projectsTab', { defaultValue: 'Projects' })}
          position='top'
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSubTab('projects');
            }}
            className={classNames(
              'px-5px py-1px text-9px transition-colors shrink-0 rounded-r-6px',
              subTab === 'projects'
                ? 'bg-fill-3 text-t-primary'
                : 'text-t-tertiary hover:bg-fill-2 hover:text-t-primary'
            )}
            aria-pressed={subTab === 'projects'}
          >
            {t('team.organization.projectsTab', { defaultValue: 'Projects' })}
          </button>
        </Tooltip>
        <Tooltip
          {...siderTooltipProps}
          content={t('team.organization.editDepartment', { defaultValue: 'Edit Department' })}
          position='top'
        >
          <button
            type='button'
            className='size-18px rounded flex items-center justify-center text-t-tertiary hover:text-t-primary hover:bg-fill-3 opacity-0 group-hover:opacity-100 transition-opacity ml-2px'
            onClick={onEdit}
            aria-label={t('team.organization.editDepartment', { defaultValue: 'Edit Department' })}
          >
            <Edit size={11} theme='outline' />
          </button>
        </Tooltip>
        <Tooltip
          {...siderTooltipProps}
          content={t('team.organization.setFolder', { defaultValue: 'Set Folder' })}
          position='top'
        >
          <button
            type='button'
            className='size-18px rounded flex items-center justify-center text-t-tertiary hover:text-amber-400 hover:bg-amber-500/20 opacity-0 group-hover:opacity-100 transition-opacity'
            onClick={onSetFolder}
            aria-label={t('team.organization.setFolder', { defaultValue: 'Set Folder' })}
          >
            <LinkOne size={11} theme='outline' />
          </button>
        </Tooltip>
        <Tooltip
          {...siderTooltipProps}
          content={t('team.organization.addProject', { defaultValue: 'Add Project' })}
          position='top'
        >
          <button
            type='button'
            className='size-18px rounded flex items-center justify-center text-t-tertiary hover:text-t-primary hover:bg-fill-3 opacity-0 group-hover:opacity-100 transition-opacity'
            onClick={onAddProject}
            aria-label={t('team.organization.addProject', { defaultValue: 'Add Project' })}
          >
            <FolderPlus size={11} theme='outline' />
          </button>
        </Tooltip>
        <Tooltip
          {...siderTooltipProps}
          content={t('team.organization.addTeam', { defaultValue: 'Add Sub-Team' })}
          position='top'
        >
          <button
            type='button'
            className='size-18px rounded flex items-center justify-center text-t-tertiary hover:text-t-primary hover:bg-fill-3 opacity-0 group-hover:opacity-100 transition-opacity'
            onClick={onAddTeam}
            aria-label={t('team.organization.addTeam', { defaultValue: 'Add Sub-Team' })}
          >
            <Plus size={11} theme='outline' />
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

export default React.memo(SiderDepartmentHeader);
