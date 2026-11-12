/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Dropdown, Menu } from '@arco-design/web-react';
import { Right, MoreOne } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import type { OrgDepartmentNode, OrgNodeStatus } from '@/types/organization';
import { ORG_THEME_PALETTE } from '@/renderer/pages/organization/utils/orgTheme';

export type DepartmentRowAction = 'edit' | 'set-folder' | 'add-project' | 'add-team';

interface SiderDepartmentHeaderProps {
  department: OrgDepartmentNode;
  status: OrgNodeStatus;
  isSelected: boolean;
  isExpanded: boolean;
  teamsCount: number;
  projectsCount: number;
  subTab: 'teams' | 'projects';
  onOpenChat: () => void;
  onToggleExpand: () => void;
  onToggleSubTab: (tab: 'teams' | 'projects') => void;
  onAction: (action: DepartmentRowAction) => void;
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
  onOpenChat,
  onToggleExpand,
  onToggleSubTab,
  onAction,
}) => {
  const { t } = useTranslation();
  const theme = ORG_THEME_PALETTE[status];

  const moreLabel = t('team.organization.moreActions', { defaultValue: 'More actions' });

  const menu = (
    <Menu>
      <Menu.Item key='edit' onClick={() => onAction('edit')}>
        {t('team.organization.editDepartment', { defaultValue: 'Edit Department' })}
      </Menu.Item>
      <Menu.Item key='set-folder' onClick={() => onAction('set-folder')}>
        {t('team.organization.setFolder', { defaultValue: 'Set Folder' })}
      </Menu.Item>
      <Menu.Item key='add-project' onClick={() => onAction('add-project')}>
        {t('team.organization.addProject', { defaultValue: 'Add Project' })}
      </Menu.Item>
      <Menu.Item key='add-team' onClick={() => onAction('add-team')}>
        {t('team.organization.addTeam', { defaultValue: 'Add Sub-Team' })}
      </Menu.Item>
    </Menu>
  );

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onOpenChat();
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
            role='button'
            tabIndex={0}
            className='size-14px flex items-center justify-center shrink-0 cursor-pointer'
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
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
            <Right
              size={10}
              theme='outline'
              className={classNames('shrink-0 transition-transform duration-200', isExpanded ? 'rotate-90' : '')}
            />
          </span>
        )}
        <span className='size-5px rounded-full shrink-0' style={{ backgroundColor: theme.borderColor }} />
        <span
          className='font-semibold truncate text-12px text-t-primary'
          title={department.name}
          aria-label={t('team.organization.openDepartmentChat', {
            defaultValue: 'Open chat with {{name}}',
            name: department.name,
          })}
        >
          {department.name}
        </span>
        <span className='text-10px text-t-tertiary whitespace-nowrap shrink-0'>
          {teamsCount}t · {projectsCount}p
        </span>
      </div>
      <div className='flex items-center gap-2px shrink-0'>
        <div className='flex items-center bg-fill-2 border border-[var(--color-border-2)] rounded-4px p-1px shrink-0'>
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
        </div>
        <div className='hidden group-hover:flex items-center gap-1px shrink-0' onClick={(e) => e.stopPropagation()}>
          <Dropdown trigger='click' position='br' droplist={menu}>
            <Button
              type='text'
              size='mini'
              className='!p-2px !h-20px !w-20px flex items-center justify-center text-t-tertiary hover:text-t-primary transition-all shrink-0 border-none'
              aria-label={moreLabel}
            >
              <MoreOne size={12} theme='outline' />
            </Button>
          </Dropdown>
        </div>
      </div>
    </div>
  );
};

export default React.memo(SiderDepartmentHeader);
