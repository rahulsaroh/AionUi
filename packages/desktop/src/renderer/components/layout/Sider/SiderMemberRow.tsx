/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Plus, Robot, Down, Right, Edit } from '@icon-park/react';
import { Button, Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { OrgAgentMember } from '@/types/organization';

interface SiderMemberRowProps {
  member: OrgAgentMember;
  isSelected: boolean;
  hasChats?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onSelectMember?: () => void;
  onEditMember?: () => void;
  onNewChat: () => void;
}

export const SiderMemberRow: React.FC<SiderMemberRowProps> = ({
  member,
  isSelected,
  hasChats = false,
  isCollapsed = false,
  onToggleCollapse,
  onSelectMember,
  onEditMember,
  onNewChat,
}) => {
  const { t } = useTranslation();
  const displayName = member.name === 'Aion CLI' ? 'Shiraj CLI' : member.name;

  return (
    <div
      title={member.title || member.role}
      onClick={(e) => {
        e.stopPropagation();
        if (onToggleCollapse && hasChats) {
          onToggleCollapse();
        } else if (onSelectMember) {
          onSelectMember();
        }
      }}
      className={classNames(
        'group flex items-center justify-between px-6px py-3px rounded text-12px select-none cursor-pointer hover:bg-fill-2 transition-colors',
        isSelected
          ? 'bg-[rgba(var(--primary-6),0.10)] text-t-primary border border-[rgba(var(--primary-6),0.20)]'
          : 'text-t-secondary'
      )}
    >
      <div className='flex items-center gap-5px truncate min-w-0 mr-4px'>
        {onToggleCollapse && (
          <span
            role='button'
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onToggleCollapse();
              }
            }}
            className={classNames(
              'size-14px flex items-center justify-center rounded hover:bg-fill-3 shrink-0 cursor-pointer',
              hasChats ? 'text-t-tertiary hover:text-t-primary' : 'text-t-tertiary/40 hover:text-t-tertiary'
            )}
            title={
              isCollapsed
                ? t('common.expand', { defaultValue: 'Expand chats' })
                : t('common.collapse', { defaultValue: 'Collapse chats' })
            }
          >
            {isCollapsed ? <Right size={10} /> : <Down size={10} />}
          </span>
        )}
        <Robot size={12} theme='outline' className='text-primary shrink-0' />
        <span className='truncate text-12px font-medium' title={displayName}>
          {displayName}
        </span>
      </div>
      <div className='flex items-center gap-4px shrink-0'>
        <span className='text-10px text-t-tertiary truncate max-w-100px'>{member.title || member.role}</span>
        {onEditMember && (
          <Tooltip content={t('team.organization.editTeammate', { defaultValue: 'Edit teammate & knowledge' })}>
            <Button
              type='text'
              size='mini'
              icon={<Edit size={11} theme='outline' />}
              aria-label={t('team.organization.editTeammate', { defaultValue: 'Edit teammate' })}
              className='!size-18px !p-0 rounded flex items-center justify-center text-t-tertiary hover:text-primary hover:bg-fill-3 opacity-0 group-hover:opacity-100 transition-opacity'
              onClick={(event) => {
                event.stopPropagation();
                onEditMember();
              }}
            />
          </Tooltip>
        )}
        <Tooltip
          content={t('team.organization.newMemberChat', {
            defaultValue: 'New chat with {{name}}',
            name: member.name,
          })}
        >
          <Button
            type='text'
            size='mini'
            icon={<Plus size={12} theme='outline' />}
            aria-label={t('team.organization.newMemberChat', {
              defaultValue: 'New chat with {{name}}',
              name: member.name,
            })}
            className='!size-18px !p-0 rounded flex items-center justify-center text-t-tertiary hover:text-primary hover:bg-fill-3 opacity-80 group-hover:opacity-100 transition-opacity'
            onClick={(event) => {
              event.stopPropagation();
              onNewChat();
            }}
          />
        </Tooltip>
      </div>
    </div>
  );
};

export default React.memo(SiderMemberRow);
