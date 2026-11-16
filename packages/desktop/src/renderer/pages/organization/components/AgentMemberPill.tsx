/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tag, Tooltip } from '@arco-design/web-react';
import { Handle, Position } from '@xyflow/react';
import { LinkOne } from '@icon-park/react';
import type { OrgAgentMember, OrgNodeStatus } from '@/types/organization';
import { ORG_THEME_PALETTE, computeLifecycleStatus, getMemberAccentColor } from '../utils/orgTheme';
import { useOrgStore } from '../store/useOrgStore';
import { useOrgTelemetryStore } from '../store/useOrgTelemetryStore';
import { RobotAvatar } from './RobotAvatar';

export interface AgentMemberPillProps {
  member: OrgAgentMember;
  currentDepartmentName?: string;
  departmentsServed?: string[];
  sharedCount?: number;
  variant?: 'chip' | 'card';
  isHighlighted?: boolean;
  onHover?: (canonicalId: string | null) => void;
  onClick?: (canonicalId: string) => void;
}

export const AgentMemberPill: React.FC<AgentMemberPillProps> = ({
  member,
  currentDepartmentName,
  departmentsServed = [],
  sharedCount = 1,
  variant = 'chip',
  isHighlighted: externalHighlighted,
  onHover,
  onClick,
}) => {
  const { nodeStatuses, hoveredCanonicalAgentId, selectedCanonicalAgentId, isSimulating, simulationMessage } =
    useOrgStore();
  const { activityTicker } = useOrgTelemetryStore();

  const isShared = sharedCount > 1 || departmentsServed.length > 1;
  const isHighlighted =
    externalHighlighted ||
    (hoveredCanonicalAgentId && hoveredCanonicalAgentId === member.canonicalAgentId) ||
    (selectedCanonicalAgentId && selectedCanonicalAgentId === member.canonicalAgentId);

  // Check live status
  const currentStatus: OrgNodeStatus =
    nodeStatuses[member.id] || nodeStatuses[member.canonicalAgentId] || member.status || 'idle';
  const effectiveStatus = computeLifecycleStatus(member.lastActiveAt, currentStatus);
  const theme = ORG_THEME_PALETTE[effectiveStatus];

  const isWorking = effectiveStatus === 'working';
  const isError = effectiveStatus === 'error';
  const isQueued = effectiveStatus === 'queued_next';
  const isFinished = effectiveStatus === 'recently_finished';
  const isDormant = effectiveStatus === 'dormant';

  const memberAccent = getMemberAccentColor(member.canonicalAgentId || member.id);

  // If busy in another department
  const isBusyElsewhere =
    Boolean(member.busyInDepartmentName) &&
    currentDepartmentName &&
    member.busyInDepartmentName !== currentDepartmentName;

  const currentActivity = activityTicker[member.id] || activityTicker[member.canonicalAgentId];
  const activeDirective =
    currentActivity?.message || (isSimulating ? simulationMessage : null) || 'Executing autonomous specialist turn';

  const tooltipContent = (
    <div className='flex flex-col gap-4px text-11px max-w-240px'>
      <div className='flex items-center gap-6px'>
        <span className='font-bold text-slate-100 text-12px'>{member.name}</span>
        <Tag size='small' className='text-9px px-4px py-0 rounded font-mono font-semibold'>
          {member.role || 'Specialist'}
        </Tag>
      </div>
      <span className='text-slate-400 text-10px'>{member.title || 'Team Specialist'}</span>

      {/* Live Active Task / Directive when working */}
      {isWorking && (
        <div className='p-6px rounded bg-emerald-950/50 border border-emerald-500/30 text-emerald-300 text-10px flex flex-col gap-2px my-2px'>
          <div className='flex items-center gap-4px text-9px font-mono text-emerald-400 font-semibold uppercase'>
            <span className='size-5px rounded-full bg-emerald-400 animate-ping' />
            <span>Active Directive</span>
          </div>
          <span className='text-emerald-100 line-clamp-2 leading-tight font-sans'>{activeDirective}</span>
        </div>
      )}

      {departmentsServed.length > 0 && (
        <div className='text-indigo-300 font-mono text-10px flex items-center gap-4px flex-wrap'>
          <span>Served:</span>
          {departmentsServed.map((d) => (
            <span key={d} className='px-4px py-0.5 rounded bg-indigo-500/20 text-indigo-200 text-9px'>
              {d}
            </span>
          ))}
        </div>
      )}
      {isShared && (
        <span className='text-indigo-400 font-mono text-10px'>
          🔗 Shared across {sharedCount || departmentsServed.length} teams/departments
        </span>
      )}
      {isBusyElsewhere && (
        <span className='text-emerald-400 font-semibold text-10px'>
          Busy working in [{member.busyInDepartmentName}]
        </span>
      )}
      <div className='flex items-center gap-4px text-10px text-slate-400 mt-2px'>
        <span
          className='size-6px rounded-full'
          style={{
            backgroundColor: isWorking
              ? memberAccent
              : isError
                ? '#EF4444'
                : isQueued
                  ? '#F59E0B'
                  : isFinished
                    ? '#10B981'
                    : theme.borderColor,
          }}
        />
        <span className='capitalize font-medium text-slate-300'>Status: {isWorking ? 'Working' : theme.label}</span>
      </div>
    </div>
  );

  // Card Variant: Used in bottom strip for shared members
  if (variant === 'card') {
    let glowClass = '';
    if (isWorking) glowClass = 'org-glow-working';
    else if (isError) glowClass = 'org-glow-error';
    else if (isQueued) glowClass = 'org-glow-queued';
    else if (isFinished) glowClass = 'org-glow-finished';

    return (
      <Tooltip content={tooltipContent} position='top' triggerProps={{ mouseEnterDelay: 200, mouseLeaveDelay: 100 }}>
        <div
          onMouseEnter={() => onHover?.(member.canonicalAgentId)}
          onMouseLeave={() => onHover?.(null)}
          onClick={(e) => {
            e.stopPropagation();
            onClick?.(member.canonicalAgentId);
          }}
          style={{
            borderColor: isError ? '#EF4444' : isWorking || isHighlighted ? memberAccent : `${memberAccent}88`,
            boxShadow: isWorking
              ? `0 0 22px ${memberAccent}, inset 0 0 8px ${memberAccent}33`
              : isHighlighted
                ? `0 0 20px ${memberAccent}88, inset 0 0 12px ${memberAccent}22`
                : `0 0 10px ${memberAccent}33`,
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            opacity: isDormant ? 0.55 : 1,
            ['--glow-color' as any]: memberAccent,
            ['--avatar-glow' as any]: memberAccent,
          }}
          className={`relative w-220px p-10px rounded-12px cursor-pointer select-none backdrop-blur-md border border-solid transition-all duration-300 flex flex-col gap-6px ${
            isHighlighted ? 'scale-105 z-20' : 'hover:scale-102'
          } ${glowClass}`}
        >
          {/* Top handle for upward tether edges */}
          <Handle
            type='source'
            position={Position.Top}
            id={`shared-${member.canonicalAgentId}-top`}
            className='!bg-indigo-400 !w-8px !h-8px !border-2 !border-[var(--color-bg-2)] hover:!scale-125 transition-transform'
          />

          <div className='flex items-center gap-8px min-w-0'>
            <div
              className={`relative rounded-full p-2px transition-all duration-300 ${
                isWorking ? 'org-glow-avatar-working' : ''
              }`}
              style={{
                border: `1.5px solid ${isError ? '#EF4444' : memberAccent}`,
                boxShadow: isWorking ? `0 0 12px ${memberAccent}` : undefined,
                ['--avatar-glow' as any]: memberAccent,
              }}
            >
              <RobotAvatar
                name={member.name}
                icon={member.icon}
                size={28}
                accentColor={isError ? '#EF4444' : memberAccent}
                isWorking={isWorking}
              />
            </div>

            <div className='flex flex-col min-w-0 flex-1'>
              <div className='flex items-center gap-4px min-w-0'>
                <span className='text-12px font-bold text-slate-100 truncate' title={member.name}>
                  {member.name}
                </span>
                {isWorking && (
                  <span className='org-typing-dots'>
                    <span className='org-typing-dot' style={{ backgroundColor: memberAccent }} />
                    <span className='org-typing-dot' style={{ backgroundColor: memberAccent }} />
                    <span className='org-typing-dot' style={{ backgroundColor: memberAccent }} />
                  </span>
                )}
              </div>
              <span className='text-10px text-slate-400 truncate'>{member.title || member.role}</span>
            </div>

            <Tag
              size='small'
              style={{
                borderColor: `${memberAccent}88`,
                color: memberAccent,
                backgroundColor: `${memberAccent}18`,
              }}
              className='text-9px font-semibold px-4px py-0 rounded shrink-0 font-mono'
            >
              Shared
            </Tag>
          </div>

          {/* Departments served badges */}
          <div className='flex items-center gap-4px flex-wrap mt-2px'>
            {departmentsServed.slice(0, 3).map((dept) => (
              <span
                key={dept}
                style={{
                  borderColor: `${memberAccent}44`,
                  color: memberAccent,
                  backgroundColor: `${memberAccent}12`,
                }}
                className='text-9px px-5px py-1px rounded-full border border-solid font-mono truncate max-w-90px'
              >
                {dept}
              </span>
            ))}
            {departmentsServed.length > 3 && (
              <span className='text-9px text-slate-400 font-mono'>+{departmentsServed.length - 3}</span>
            )}
          </div>
        </div>
      </Tooltip>
    );
  }

  // Chip Variant: Used in TeamNode cards
  let chipGlowClass = '';
  if (isWorking) chipGlowClass = 'org-glow-avatar-working';
  else if (isError) chipGlowClass = 'org-glow-error';
  else if (isQueued) chipGlowClass = 'org-glow-queued';
  else if (isFinished) chipGlowClass = 'org-glow-finished';

  return (
    <Tooltip content={tooltipContent} position='top' triggerProps={{ mouseEnterDelay: 200, mouseLeaveDelay: 100 }}>
      <div
        onMouseEnter={() => {
          if (isShared) onHover?.(member.canonicalAgentId);
        }}
        onMouseLeave={() => {
          if (isShared) onHover?.(null);
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(member.canonicalAgentId);
        }}
        style={{
          borderColor: isError
            ? '#EF4444'
            : isWorking || isHighlighted
              ? memberAccent
              : isShared
                ? `${memberAccent}88`
                : theme.borderColor,
          backgroundColor: isHighlighted || isWorking ? `${memberAccent}22` : 'rgba(15, 23, 42, 0.65)',
          boxShadow: isWorking ? `0 0 14px ${memberAccent}` : isHighlighted ? `0 0 12px ${memberAccent}66` : undefined,
          opacity: isDormant ? 0.55 : theme.opacity,
          transition: 'all 0.25s ease',
          ['--avatar-glow' as any]: memberAccent,
          ['--glow-color' as any]: memberAccent,
        }}
        className={`group relative flex items-center gap-4px p-2px pr-6px rounded-full select-none cursor-pointer border border-solid backdrop-blur-sm ${
          isHighlighted ? 'scale-108 z-10' : 'hover:scale-105'
        } ${chipGlowClass}`}
      >
        {/* Avatar with animated accent ring when working */}
        <div
          className={`relative rounded-full transition-all duration-300 ${isWorking ? 'org-glow-avatar-working' : ''}`}
          style={{
            border: isShared || isWorking ? `1.5px solid ${isError ? '#EF4444' : memberAccent}` : undefined,
            ['--avatar-glow' as any]: memberAccent,
          }}
        >
          <RobotAvatar
            name={member.name}
            icon={member.icon}
            size={20}
            accentColor={isError ? '#EF4444' : memberAccent}
            isWorking={isWorking}
          />
        </div>

        {/* Member Name */}
        <span
          className='max-w-72px truncate text-10px font-medium'
          style={{ color: isHighlighted || isWorking ? '#FFFFFF' : theme.textColor }}
        >
          {member.name.split(' ')[0]}
        </span>

        {/* Shared Link Icon */}
        {isShared && (
          <span style={{ color: memberAccent }} className='flex items-center text-8px' title='Works in multiple areas'>
            <LinkOne size={9} theme='outline' />
          </span>
        )}

        {/* Animated Typing Dots Indicator */}
        {isWorking && (
          <span className='org-typing-dots ml-1px'>
            <span className='org-typing-dot' style={{ backgroundColor: memberAccent }} />
            <span className='org-typing-dot' style={{ backgroundColor: memberAccent }} />
            <span className='org-typing-dot' style={{ backgroundColor: memberAccent }} />
          </span>
        )}
      </div>
    </Tooltip>
  );
};

export default React.memo(AgentMemberPill);
