/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Tag, Tooltip } from '@arco-design/web-react';
import { Workbench, FolderClose, AllApplication, Square, Plus, Robot, Peoples, NetworkTree } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { dispatchWorkspaceToggleEvent } from '@/renderer/utils/workspace/workspaceEvents';
import type { OrgTeamNode, OrgAgentMember } from '@/types/organization';
import type { OrgTeamChatViewMode } from './types';

export interface OrgTeamChatHeaderProps {
  team: OrgTeamNode;
  departmentName?: string;
  members: OrgAgentMember[];
  activeMemberId: string;
  viewMode: OrgTeamChatViewMode;
  onChangeViewMode: (mode: OrgTeamChatViewMode) => void;
  onSelectMember: (memberId: string) => void;
  onOpenFolder?: () => void;
  workspacePath?: string;
  onNewConversation?: () => void;
  onOpenCanvas?: () => void;
}

export const OrgTeamChatHeader: React.FC<OrgTeamChatHeaderProps> = ({
  team,
  departmentName,
  members,
  activeMemberId,
  viewMode,
  onChangeViewMode,
  onSelectMember,
  onOpenFolder,
  workspacePath,
  onNewConversation,
  onOpenCanvas,
}) => {
  const { t } = useTranslation();

  return (
    <div className='h-54px px-16px border-b border-[var(--color-border-2)] bg-[var(--color-bg-2)] flex items-center justify-between shrink-0 select-none gap-12px'>
      {/* Left: Team info & workspace */}
      <div className='flex items-center gap-10px min-w-0 shrink-0'>
        <span className='size-32px rounded-8px bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-16px shadow-sm shrink-0 border border-emerald-500/30'>
          <Workbench size={16} theme='outline' fill='currentColor' />
        </span>
        <div className='flex flex-col min-w-0 gap-1px'>
          <div className='flex items-center gap-6px min-w-0'>
            <span className='font-bold text-13px text-t-primary truncate' title={team.name}>
              {team.name}
            </span>
            {departmentName && (
              <Tag
                size='small'
                className='text-10px font-medium px-4px py-0 rounded bg-fill-2 text-t-secondary shrink-0'
              >
                {departmentName}
              </Tag>
            )}
          </div>
          {workspacePath ? (
            <div
              role='button'
              tabIndex={0}
              onClick={onOpenFolder}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenFolder?.();
                }
              }}
              className='flex items-center gap-4px text-11px font-mono text-t-tertiary hover:text-primary transition-colors cursor-pointer truncate max-w-260px'
              title={workspacePath}
            >
              <FolderClose size={12} theme='outline' />
              <span className='truncate'>{workspacePath}</span>
            </div>
          ) : (
            <span className='text-11px font-mono text-t-tertiary truncate'>
              {t('team.organization.teamMembers', { defaultValue: '{{count}} members', count: members.length })}
            </span>
          )}
        </div>
      </div>

      {/* Center: Member Tabs */}
      <div className='flex items-center gap-6px overflow-x-auto [scrollbar-width:none] py-2px px-4px min-w-0 flex-1 justify-center'>
        {members.map((member) => {
          const isActive = member.id === activeMemberId;
          const isLeader = member.id === team.teamLeadAgent.id;
          const isHr = member.id === team.hrCoordinatorAgent?.id;
          const roleLabel = isLeader ? 'LEAD' : isHr ? 'HR' : member.title || member.role || 'SPEC';
          const displayName = /^aion\s*cli$/i.test(member.name) ? 'Shiraj CLI' : member.name;

          return (
            <div
              key={member.id}
              role='button'
              tabIndex={0}
              onClick={() => onSelectMember(member.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectMember(member.id);
                }
              }}
              className={classNames(
                'flex items-center gap-6px px-8px py-4px rounded-8px text-12px font-medium transition-all duration-150 cursor-pointer shrink-0 border select-none',
                isActive
                  ? 'bg-[var(--color-fill-3)] border-[var(--color-primary)] text-t-primary shadow-xs'
                  : 'bg-transparent border-transparent text-t-secondary hover:bg-[var(--color-fill-2)] hover:text-t-primary'
              )}
            >
              <span
                className={classNames('size-18px rounded-full flex items-center justify-center text-10px shrink-0', {
                  'bg-amber-500/20 text-amber-300': isLeader,
                  'bg-blue-500/20 text-blue-300': isHr,
                  'bg-emerald-500/20 text-emerald-300': !isLeader && !isHr,
                })}
              >
                {isLeader ? '👑' : isHr ? <Peoples size={11} theme='outline' /> : <Robot size={11} theme='outline' />}
              </span>
              <span className='truncate max-w-100px'>{displayName}</span>
              <span
                className={classNames(
                  'text-9px font-mono font-semibold px-4px py-0.5px rounded uppercase tracking-wider',
                  {
                    'bg-amber-500/15 text-amber-300': isLeader,
                    'bg-blue-500/15 text-blue-300': isHr,
                    'bg-emerald-500/15 text-emerald-300': !isLeader && !isHr,
                  }
                )}
              >
                {roleLabel}
              </span>
            </div>
          );
        })}
      </div>

      {/* Right: Actions & View mode toggle */}
      <div className='flex items-center gap-8px shrink-0'>
        {onOpenCanvas && (
          <Tooltip content={t('team.organization.canvas', { defaultValue: 'Organization Canvas' })} position='bottom'>
            <Button
              type='secondary'
              size='small'
              icon={<NetworkTree size={14} theme='outline' />}
              onClick={onOpenCanvas}
              className='!rounded-8px !text-12px'
            >
              <span className='hidden sm:inline'>2D Canvas</span>
            </Button>
          </Tooltip>
        )}

        {onNewConversation && (
          <Tooltip content={t('team.organization.newChat', { defaultValue: 'New Chat' })} position='bottom'>
            <Button
              type='secondary'
              size='small'
              icon={<Plus size={14} theme='outline' />}
              onClick={onNewConversation}
              className='!rounded-8px'
            />
          </Tooltip>
        )}

        <Tooltip
          content={t('conversation.antigravityWorkspace.toggleCard', { defaultValue: 'Toggle Files Sidebar' })}
          position='bottom'
        >
          <Button
            type='secondary'
            size='small'
            icon={<FolderClose size={14} theme='outline' />}
            onClick={() => dispatchWorkspaceToggleEvent()}
            className='!rounded-8px'
            aria-label='Toggle Files Sidebar'
          />
        </Tooltip>

        {/* Parallel / Single segmented toggle (only when multiple members exist) */}
        {members.length > 1 && (
          <div className='flex items-center gap-2px p-2px rounded-8px bg-[var(--color-fill-2)] border border-[var(--color-border-2)]'>
            <Tooltip content={t('team.view.parallel', { defaultValue: 'Parallel (Side by side)' })} position='bottom'>
              <Button
                type={viewMode === 'parallel' ? 'primary' : 'text'}
                size='mini'
                onClick={() => onChangeViewMode('parallel')}
                className={classNames('!rounded-6px !h-26px !px-8px flex items-center gap-4px', {
                  '!bg-[var(--color-primary)] !text-white': viewMode === 'parallel',
                  '!text-t-secondary hover:!text-t-primary': viewMode !== 'parallel',
                })}
              >
                <AllApplication size={14} theme='outline' />
                <span className='text-11px hidden sm:inline'>
                  {t('team.view.parallel', { defaultValue: 'Parallel' })}
                </span>
              </Button>
            </Tooltip>

            <Tooltip content={t('team.view.single', { defaultValue: 'Single (Full screen)' })} position='bottom'>
              <Button
                type={viewMode === 'single' ? 'primary' : 'text'}
                size='mini'
                onClick={() => onChangeViewMode('single')}
                className={classNames('!rounded-6px !h-26px !px-8px flex items-center gap-4px', {
                  '!bg-[var(--color-primary)] !text-white': viewMode === 'single',
                  '!text-t-secondary hover:!text-t-primary': viewMode !== 'single',
                })}
              >
                <Square size={14} theme='outline' />
                <span className='text-11px hidden sm:inline'>{t('team.view.single', { defaultValue: 'Single' })}</span>
              </Button>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrgTeamChatHeader;
