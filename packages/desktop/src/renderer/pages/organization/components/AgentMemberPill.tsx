/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Avatar, Tooltip } from '@arco-design/web-react';
import { Robot, LinkOne } from '@icon-park/react';
import type { OrgAgentMember, OrgNodeStatus } from '@/types/organization';
import { ORG_THEME_PALETTE, computeLifecycleStatus } from '../utils/orgTheme';
import { useOrgStore } from '../store/useOrgStore';

interface AgentMemberPillProps {
  member: OrgAgentMember;
  currentDepartmentName?: string;
  sharedCount?: number;
  onHover?: (canonicalId: string | null) => void;
  onClick?: (canonicalId: string) => void;
}

export const AgentMemberPill: React.FC<AgentMemberPillProps> = ({
  member,
  currentDepartmentName,
  sharedCount = 1,
  onHover,
  onClick,
}) => {
  const { nodeStatuses, hoveredCanonicalAgentId, selectedCanonicalAgentId } = useOrgStore();

  const isShared = sharedCount > 1;
  const isHighlighted =
    (hoveredCanonicalAgentId && hoveredCanonicalAgentId === member.canonicalAgentId) ||
    (selectedCanonicalAgentId && selectedCanonicalAgentId === member.canonicalAgentId);

  // Check live status
  const currentStatus: OrgNodeStatus = nodeStatuses[member.id] || member.status || 'idle';
  const effectiveStatus = computeLifecycleStatus(member.lastActiveAt, currentStatus);
  const theme = ORG_THEME_PALETTE[effectiveStatus];

  // If busy in another department
  const isBusyElsewhere =
    Boolean(member.busyInDepartmentName) &&
    currentDepartmentName &&
    member.busyInDepartmentName !== currentDepartmentName;

  const tooltipContent = (
    <div className='flex flex-col gap-2px text-11px'>
      <span className='font-bold text-t-primary'>{member.name}</span>
      <span className='text-t-secondary'>{member.title || member.role}</span>
      {isShared && <span className='text-indigo-400 font-mono'>🔗 Shared across {sharedCount} departments/teams</span>}
      {isBusyElsewhere && (
        <span className='text-emerald-400 font-semibold'>Busy working in [{member.busyInDepartmentName}]</span>
      )}
      <span className='text-t-tertiary text-10px capitalize'>Status: {theme.label}</span>
    </div>
  );

  return (
    <Tooltip content={tooltipContent} position='top'>
      <div
        onMouseEnter={() => {
          if (isShared) onHover?.(member.canonicalAgentId);
        }}
        onMouseLeave={() => {
          if (isShared) onHover?.(null);
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (isShared) onClick?.(member.canonicalAgentId);
        }}
        style={{
          borderColor: isHighlighted ? '#818CF8' : theme.borderColor,
          backgroundColor: isHighlighted ? 'rgba(99, 102, 241, 0.18)' : theme.backgroundColor,
          boxShadow: isHighlighted
            ? '0 0 12px rgba(129, 140, 248, 0.4)'
            : theme.boxShadow !== 'none'
              ? theme.boxShadow
              : undefined,
          opacity: theme.opacity,
          transition: 'all 0.3s ease',
        }}
        className={`group relative flex items-center gap-5px px-7px py-2px rounded-full text-10px select-none cursor-pointer border border-solid ${
          isHighlighted ? 'scale-105 z-10' : ''
        }`}
      >
        {/* Avatar with subtle dual-ring border for shared members */}
        <div
          className={`relative rounded-full flex items-center justify-center shrink-0 ${
            isShared ? 'ring-2 ring-indigo-500/50 ring-offset-1 ring-offset-[var(--color-bg-2)]' : ''
          }`}
        >
          <Avatar size={16} shape='circle' className='bg-slate-700 text-white'>
            {member.icon ? (
              <img src={member.icon} alt={member.name} className='size-full object-cover' />
            ) : (
              <Robot size={10} theme='outline' fill='currentColor' />
            )}
          </Avatar>
        </div>

        {/* Member Name */}
        <span
          className='max-w-90px truncate font-medium'
          style={{ color: isHighlighted ? '#E0E7FF' : theme.textColor }}
        >
          {isBusyElsewhere ? `Busy in [${member.busyInDepartmentName}]` : member.name}
        </span>

        {/* Shared (N) Badge */}
        {isShared && (
          <span className='flex items-center gap-2px px-3px py-0.5px rounded-full bg-indigo-500/20 text-indigo-300 text-9px font-mono shrink-0'>
            <LinkOne size={9} theme='outline' />
            <span>{sharedCount}</span>
          </span>
        )}

        {/* Busy / Active Status Ring indicator */}
        {(effectiveStatus === 'working' || isBusyElsewhere) && (
          <span className='size-5px rounded-full bg-emerald-400 animate-pulse shrink-0' />
        )}
      </div>
    </Tooltip>
  );
};

export default React.memo(AgentMemberPill);
