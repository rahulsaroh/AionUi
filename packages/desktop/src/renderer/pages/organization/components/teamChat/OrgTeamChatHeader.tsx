/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect } from 'react';
import { Button, Tag, Tooltip, Dropdown, Menu } from '@arco-design/web-react';
import {
  Workbench,
  FolderClose,
  AllApplication,
  Square,
  Plus,
  Robot,
  Peoples,
  NetworkTree,
  Edit,
  Down,
  Left,
  Right,
} from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { dispatchWorkspaceToggleEvent } from '@/renderer/utils/workspace/workspaceEvents';
import type { OrgTeamNode, OrgAgentMember } from '@/types/organization';
import type { OrgTeamChatViewMode } from './types';

export function isRoleDuplicate(displayName: string, roleLabel: string): boolean {
  if (!roleLabel || roleLabel === 'SPEC') return true;
  const normName = displayName
    .trim()
    .toLowerCase()
    .replace(/[\s\-_/()]+/g, ' ');
  const normRole = roleLabel
    .trim()
    .toLowerCase()
    .replace(/[\s\-_/()]+/g, ' ');
  if (!normName || !normRole) return false;
  if (normName === normRole) return true;
  if (normRole.includes(normName) || normName.includes(normRole)) return true;
  return false;
}

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
  onEditMember?: (member: OrgAgentMember) => void;
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
  onEditMember,
}) => {
  const { t } = useTranslation();
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTabRef.current) {
      activeTabRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeMemberId]);

  const handleScroll = (direction: 'left' | 'right') => {
    if (!tabsContainerRef.current) return;
    const scrollAmount = 200;
    tabsContainerRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  const allTeammatesMenu = (
    <Menu className='!max-h-360px overflow-y-auto !min-w-240px'>
      <div className='px-12px py-6px text-11px font-semibold text-t-tertiary border-b border-[var(--color-border-2)] flex items-center justify-between'>
        <span>{t('team.organization.teamRoster', { defaultValue: 'Team Roster' })}</span>
        <span className='font-mono text-10px'>{members.length}</span>
      </div>
      {members.map((member) => {
        const isActive = member.id === activeMemberId;
        const isLeader = member.id === team.teamLeadAgent.id;
        const isHr = member.id === team.hrCoordinatorAgent?.id;
        const roleLabel = isLeader ? 'LEAD' : isHr ? 'HR' : member.title || member.role || 'SPEC';
        const displayName = /^aion\s*cli$/i.test(member.name) ? 'Shiraj CLI' : member.name;
        const isDuplicateRole = !isLeader && !isHr && isRoleDuplicate(displayName, roleLabel);

        return (
          <Menu.Item
            key={member.id}
            onClick={() => onSelectMember(member.id)}
            className={classNames('!flex items-center justify-between !py-6px !px-10px', {
              '!bg-[var(--color-fill-3)] font-medium': isActive,
            })}
          >
            <div className='flex items-center gap-8px min-w-0 flex-1 mr-8px'>
              <span
                className={classNames('size-20px rounded-full flex items-center justify-center text-10px shrink-0', {
                  'bg-amber-500/20 text-amber-300': isLeader,
                  'bg-blue-500/20 text-blue-300': isHr,
                  'bg-emerald-500/20 text-emerald-300': !isLeader && !isHr,
                })}
              >
                {isLeader ? '👑' : isHr ? <Peoples size={12} theme='outline' /> : <Robot size={12} theme='outline' />}
              </span>
              <div className='flex flex-col min-w-0'>
                <span className='text-12px text-t-primary truncate' title={displayName}>
                  {displayName}
                </span>
                {!isDuplicateRole && (
                  <span className='text-9px font-mono text-t-tertiary truncate uppercase'>{roleLabel}</span>
                )}
              </div>
            </div>
            {onEditMember && (
              <Tooltip content={t('team.organization.editTeammate', { defaultValue: 'Edit teammate' })}>
                <Button
                  type='text'
                  size='mini'
                  icon={<Edit size={12} theme='outline' />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditMember(member);
                  }}
                  className='!px-4px !h-22px text-t-tertiary hover:text-primary shrink-0'
                />
              </Tooltip>
            )}
          </Menu.Item>
        );
      })}
    </Menu>
  );

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

      {/* Center: All Teammates Dropdown + Member Tabs */}
      <div className='flex items-center gap-4px min-w-0 flex-1 overflow-hidden px-2px'>
        {/* All Teammates Dropdown Button */}
        <Dropdown droplist={allTeammatesMenu} trigger={['click']} position='bottom'>
          <Button
            size='small'
            type='secondary'
            className='!rounded-8px !text-12px !h-28px flex items-center gap-4px shrink-0 text-t-secondary hover:text-t-primary !px-8px'
          >
            <Peoples size={13} theme='outline' />
            <span className='hidden sm:inline'>
              {t('team.organization.allTeammates', { defaultValue: 'All Teammates' })}
            </span>
            <span className='text-10px font-mono font-semibold px-4px py-0.5 rounded bg-[var(--color-fill-3)] text-t-secondary'>
              {members.length}
            </span>
            <Down size={11} theme='outline' />
          </Button>
        </Dropdown>

        {/* Scroll Left Button */}
        <Button
          type='text'
          size='mini'
          shape='circle'
          icon={<Left size={12} theme='outline' />}
          onClick={() => handleScroll('left')}
          className='!w-20px !h-20px !min-w-20px text-t-tertiary hover:text-t-primary shrink-0'
          aria-label='Scroll tabs left'
        />

        {/* Member Tabs Container */}
        <div
          ref={tabsContainerRef}
          className='flex items-center gap-6px overflow-x-auto [scrollbar-width:none] py-2px px-2px min-w-0 flex-1 justify-start scroll-smooth'
        >
          {members.map((member) => {
            const isActive = member.id === activeMemberId;
            const isLeader = member.id === team.teamLeadAgent.id;
            const isHr = member.id === team.hrCoordinatorAgent?.id;
            const roleLabel = isLeader ? 'LEAD' : isHr ? 'HR' : member.title || member.role || 'SPEC';
            const displayName = /^aion\s*cli$/i.test(member.name) ? 'Shiraj CLI' : member.name;
            const isDuplicateRole = !isLeader && !isHr && isRoleDuplicate(displayName, roleLabel);

            return (
              <div
                key={member.id}
                ref={isActive ? activeTabRef : undefined}
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
                  'flex items-center gap-6px px-8px py-4px rounded-8px text-12px font-medium transition-all duration-150 cursor-pointer shrink-0 border select-none group',
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
                <span className='truncate max-w-140px'>{displayName}</span>
                {!isDuplicateRole && (
                  <span
                    className={classNames(
                      'text-9px font-mono font-semibold px-4px py-0.5px rounded uppercase tracking-wider shrink-0',
                      {
                        'bg-amber-500/15 text-amber-300': isLeader,
                        'bg-blue-500/15 text-blue-300': isHr,
                        'bg-emerald-500/15 text-emerald-300': !isLeader && !isHr,
                      }
                    )}
                  >
                    {roleLabel}
                  </span>
                )}
                {onEditMember && (
                  <Tooltip content={t('team.organization.editTeammate', { defaultValue: 'Edit teammate' })}>
                    <span
                      role='button'
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditMember(member);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          onEditMember(member);
                        }
                      }}
                      className='p-2px rounded hover:bg-[var(--color-fill-3)] text-t-tertiary hover:text-primary transition-colors cursor-pointer shrink-0 ml-1px opacity-60 hover:opacity-100'
                      aria-label={t('team.organization.editTeammate', { defaultValue: 'Edit teammate' })}
                    >
                      <Edit size={11} theme='outline' />
                    </span>
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>

        {/* Scroll Right Button */}
        <Button
          type='text'
          size='mini'
          shape='circle'
          icon={<Right size={12} theme='outline' />}
          onClick={() => handleScroll('right')}
          className='!w-20px !h-20px !min-w-20px text-t-tertiary hover:text-t-primary shrink-0'
          aria-label='Scroll tabs right'
        />
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
