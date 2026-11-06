/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Tag, Tooltip } from '@arco-design/web-react';
import { Workbench, FolderClose, User } from '@icon-park/react';
import type { OrgTeamNode, OrgNodeStatus } from '@/types/organization';
import { getOrgNodeStyle, ORG_THEME_PALETTE, computeLifecycleStatus } from '../utils/orgTheme';
import { useOrgStore } from '../store/useOrgStore';
import AgentMemberPill from './AgentMemberPill';

export interface TeamNodeData {
  team: OrgTeamNode;
  departmentName?: string;
  orientation?: 'TB' | 'LR';
  sharedCountsMap?: Record<string, number>;
  onSelectNode?: (nodeId: string, nodeType: 'team') => void;
}

export const TeamNode: React.FC<{ data: TeamNodeData; selected?: boolean }> = ({ data, selected = false }) => {
  const { team, departmentName = '', orientation = 'TB', sharedCountsMap = {}, onSelectNode } = data;
  const { nodeStatuses, setHoveredCanonicalAgentId, setSelectedCanonicalAgentId } = useOrgStore();

  const currentStatus: OrgNodeStatus = nodeStatuses[team.id] || team.status || 'idle';
  const effectiveStatus = computeLifecycleStatus(team.lastActiveAt, currentStatus);
  const theme = ORG_THEME_PALETTE[effectiveStatus];
  const nodeStyle = getOrgNodeStyle(effectiveStatus);

  const targetHandlePos = orientation === 'LR' ? Position.Left : Position.Top;
  const sourceHandlePos = orientation === 'LR' ? Position.Right : Position.Bottom;

  return (
    <div
      onClick={() => onSelectNode?.(team.id, 'team')}
      style={nodeStyle}
      className={`group/team relative w-290px rounded-12px cursor-pointer text-t-primary shadow-md flex flex-col overflow-hidden transition-all duration-300 ${
        selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--color-bg-1)]' : ''
      }`}
    >
      <Handle
        type='target'
        position={targetHandlePos}
        className='!bg-primary !w-9px !h-9px !border-2 !border-[var(--color-bg-2)] hover:!scale-125 transition-transform'
      />

      {/* Header */}
      <div className='px-10px py-7px bg-fill-1 border-b border-[var(--color-border-2)] flex items-center justify-between'>
        <div className='flex items-center gap-6px min-w-0'>
          <span className='size-20px rounded-6px bg-primary/10 text-primary flex items-center justify-center shrink-0'>
            <User size={12} theme='outline' fill='currentColor' />
          </span>
          <span className='font-semibold text-12px truncate' title={team.name}>
            {team.name}
          </span>
        </div>

        <Tag
          size='small'
          style={{
            borderColor: theme.borderColor,
            color: theme.textColor,
            backgroundColor: theme.backgroundColor,
          }}
          className='text-9px font-medium px-4px py-0.5px rounded-full'
        >
          {theme.badgeText}
        </Tag>
      </div>

      {/* Body: Team Manager / HR + Linked Project + Specialists */}
      <div className='p-10px flex flex-col gap-8px bg-[var(--color-bg-2)]'>
        {/* Team Manager & HR pill */}
        <div className='flex items-center justify-between px-8px py-4px rounded-6px bg-blue-500/10 border border-blue-500/20 text-10px'>
          <div className='flex items-center gap-5px truncate min-w-0'>
            <Workbench size={12} theme='outline' className='text-blue-400 shrink-0' />
            <span className='text-blue-300 font-semibold truncate'>{team.teamLeadAgent.name}</span>
          </div>
          <span className='text-blue-400/80 text-9px font-mono shrink-0'>
            HR: {team.hrCoordinatorAgent.name.split(' ')[0]}
          </span>
        </div>

        {/* Linked Project Badge */}
        {team.linkedProjectName && (
          <div className='flex items-center gap-4px px-6px py-2px rounded bg-fill-2 text-9px text-t-secondary font-mono w-fit'>
            <FolderClose size={11} theme='outline' className='text-amber-400 shrink-0' />
            <span className='truncate'>{team.linkedProjectName}</span>
          </div>
        )}

        {/* Specialists Roster */}
        <div className='flex flex-col gap-4px'>
          <span className='text-9px uppercase tracking-wider text-t-tertiary font-semibold'>
            Specialist Members ({team.specialistMembers.length})
          </span>
          <div className='flex items-center gap-4px flex-wrap max-h-72px overflow-y-auto pr-2px'>
            {team.specialistMembers.length === 0 ? (
              <span className='text-10px text-t-tertiary italic'>No specialists</span>
            ) : (
              team.specialistMembers.map((spec) => (
                <AgentMemberPill
                  key={spec.id}
                  member={spec}
                  currentDepartmentName={departmentName}
                  sharedCount={sharedCountsMap[spec.canonicalAgentId] || 1}
                  onHover={(id) => setHoveredCanonicalAgentId(id)}
                  onClick={(id) => setSelectedCanonicalAgentId(id)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <Handle
        type='source'
        position={sourceHandlePos}
        className='!bg-primary !w-9px !h-9px !border-2 !border-[var(--color-bg-2)] hover:!scale-125 transition-transform'
      />
    </div>
  );
};

export default React.memo(TeamNode);
