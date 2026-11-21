/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Button, Tag, Tooltip } from '@arco-design/web-react';
import { Down, Right, Workbench } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { OrgTeamNode, OrgNodeStatus } from '@/types/organization';
import { ORG_THEME_PALETTE, computeLifecycleStatus, TIER_NEON_THEMES } from '../utils/orgTheme';
import { useOrgStore } from '../store/useOrgStore';
import AgentMemberPill from './AgentMemberPill';

export interface TeamNodeData {
  team: OrgTeamNode;
  departmentName?: string;
  orientation?: 'TB' | 'LR';
  sharedCountsMap?: Record<string, number>;
  isDescendantWorking?: boolean;
  isDimmed?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: (teamId: string) => void;
  onSelectNode?: (nodeId: string, nodeType: 'team') => void;
  onSelectMember?: (memberId: string) => void;
}

const formatAgentName = (name: string): string => (/^aion\s*cli$/i.test(name) ? 'Shiraj CLI' : name);

export const TeamNode: React.FC<{ data: TeamNodeData; selected?: boolean }> = ({ data, selected = false }) => {
  const { t } = useTranslation();
  const {
    team,
    departmentName = '',
    orientation = 'TB',
    sharedCountsMap = {},
    isDescendantWorking,
    isCollapsed = false,
    onToggleCollapse,
    onSelectNode,
    onSelectMember,
  } = data;
  const { nodeStatuses, setHoveredCanonicalAgentId, setSelectedCanonicalAgentId } = useOrgStore();

  const currentStatus: OrgNodeStatus = nodeStatuses[team.id] || team.status || 'idle';
  const effectiveStatus = computeLifecycleStatus(team.lastActiveAt, currentStatus);
  const theme = ORG_THEME_PALETTE[effectiveStatus];
  const isWorking = effectiveStatus === 'working' || isDescendantWorking;

  const greenBorder = TIER_NEON_THEMES.team.border;
  const greenGlow = isWorking
    ? '0 0 20px rgba(16, 185, 129, 0.65), 0 0 3px #10B981'
    : '0 0 14px rgba(16, 185, 129, 0.35)';

  const targetHandlePos = orientation === 'LR' ? Position.Left : Position.Top;
  const sourceHandlePos = orientation === 'LR' ? Position.Right : Position.Bottom;

  const allMembers = team.specialistMembers || [];

  return (
    <div
      onClick={() => onSelectNode?.(team.id, 'team')}
      style={{
        borderColor: greenBorder,
        boxShadow: selected ? `0 0 0 2px ${greenBorder}, ${greenGlow}` : greenGlow,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
      }}
      className={`group/team relative w-280px rounded-12px cursor-pointer text-slate-100 backdrop-blur-md border border-solid flex flex-col overflow-hidden transition-all duration-300 ${
        isWorking ? 'working-pulse' : ''
      }`}
    >
      <Handle
        type='target'
        position={targetHandlePos}
        className='!w-8px !h-8px !border-2 !border-slate-900 hover:!scale-125 transition-transform'
        style={{ backgroundColor: greenBorder }}
      />

      {/* Header: Team name + Green neon badge */}
      <div className='px-10px py-8px border-b border-emerald-500/20 bg-gradient-to-r from-emerald-950/30 via-slate-900/30 to-emerald-950/20 flex items-center justify-between'>
        <div className='flex items-center gap-6px min-w-0'>
          <span className='size-20px rounded-6px bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0 border border-emerald-500/30'>
            <Workbench size={12} theme='outline' fill='currentColor' />
          </span>
          <span className='font-bold text-12px text-slate-100 truncate' title={team.name}>
            {team.name}
          </span>
        </div>

        <Tag
          size='small'
          style={{
            borderColor: greenBorder,
            color: '#6EE7B7',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
          }}
          className='text-9px font-semibold px-4px py-0 rounded font-mono shrink-0'
        >
          {t('team.organization.team', { defaultValue: 'TEAM' })}
        </Tag>
      </div>

      {/* Body: Team Lead + Members Avatar Row */}
      <div className='p-8px flex flex-col gap-6px'>
        {/* Team Lead Indicator */}
        <div className='flex items-center justify-between px-6px py-3px rounded bg-slate-800/40 border border-slate-700/50 text-10px'>
          <div
            className='flex items-center gap-4px truncate min-w-0 hover:text-emerald-300 transition-colors'
            onClick={(e) => {
              e.stopPropagation();
              onSelectMember?.(team.teamLeadAgent.id);
            }}
          >
            <span className='text-emerald-400 font-mono text-9px'>LEAD:</span>
            <span className='font-medium text-slate-200 truncate'>{formatAgentName(team.teamLeadAgent.name)}</span>
          </div>
          {team.hrCoordinatorAgent && (
            <span
              className='text-slate-400 text-8px font-mono shrink-0 hover:text-blue-300 transition-colors cursor-pointer'
              onClick={(e) => {
                e.stopPropagation();
                onSelectMember?.(team.hrCoordinatorAgent!.id);
              }}
              title={team.hrCoordinatorAgent.name}
            >
              {`HR: ${team.hrCoordinatorAgent.name.split(' ')[0]}`}
            </span>
          )}
        </div>

        {allMembers.length > 0 && onToggleCollapse && (
          <div className='flex justify-end'>
            <Tooltip content={isCollapsed ? 'Show team members' : 'Hide team members'}>
              <Button
                size='mini'
                type='text'
                icon={isCollapsed ? <Right size={12} /> : <Down size={12} />}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleCollapse(team.id);
                }}
                className='!p-2px !text-slate-400 hover:!text-slate-200'
              />
            </Tooltip>
          </div>
        )}

        {/* Members Roster List */}
        {!isCollapsed && (
          <div className='flex flex-col gap-4px pt-2px'>
            {allMembers.length === 0 ? (
              <span className='text-9px text-slate-500 italic px-2px'>No specialists assigned</span>
            ) : (
              allMembers.map((spec) => (
                <div
                  key={spec.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedCanonicalAgentId(spec.canonicalAgentId);
                    onSelectMember?.(spec.id);
                  }}
                  className='flex items-center justify-between px-6px py-3px rounded bg-slate-800/40 border border-slate-700/40 text-10px hover:border-emerald-500/50 hover:bg-slate-800/80 transition-colors cursor-pointer group/spec'
                  title={`${spec.name} (${spec.title || spec.role})`}
                >
                  <div className='flex items-center gap-5px truncate min-w-0 mr-4px'>
                    <span className='size-6px rounded-full bg-emerald-400 shrink-0 shadow-[0_0_6px_#10B981]' />
                    <span className='font-medium text-slate-200 truncate group-hover/spec:text-emerald-300'>
                      {formatAgentName(spec.name)}
                    </span>
                  </div>
                  <Tag
                    size='small'
                    className='text-8px font-mono shrink-0 px-4px py-0 rounded bg-slate-900/80 text-emerald-300 border border-emerald-500/30'
                  >
                    {spec.title || spec.role}
                  </Tag>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <Handle
        type='source'
        position={sourceHandlePos}
        className='!w-8px !h-8px !border-2 !border-slate-900 hover:!scale-125 transition-transform'
        style={{ backgroundColor: greenBorder }}
      />
      {/* Additional target handle at bottom for tether connections from shared members */}
      <Handle
        type='target'
        position={Position.Bottom}
        id='bottom-target'
        className='!w-6px !h-6px !opacity-0 !pointer-events-none'
      />
    </div>
  );
};

export function areTeamPropsEqual(
  prev: { data: TeamNodeData; selected?: boolean },
  next: { data: TeamNodeData; selected?: boolean }
): boolean {
  if (prev.selected !== next.selected) return false;
  const p = prev.data;
  const n = next.data;
  if (p.isDimmed !== n.isDimmed) return false;
  if (p.isDescendantWorking !== n.isDescendantWorking) return false;
  if (p.isCollapsed !== n.isCollapsed) return false;
  if (p.orientation !== n.orientation) return false;
  if (p.departmentName !== n.departmentName) return false;
  if (p.sharedCountsMap !== n.sharedCountsMap) return false;
  if (p.team !== n.team) return false;
  if (p.team.name !== n.team.name) return false;
  if ((p.team as { avatar?: string }).avatar !== (n.team as { avatar?: string }).avatar) return false;
  if ((p.team as { color?: string }).color !== (n.team as { color?: string }).color) return false;
  if (p.team.status !== n.team.status) return false;
  if (p.team.specialistMembers !== n.team.specialistMembers) return false;
  if (p.team.specialistMembers.length !== n.team.specialistMembers.length) return false;
  if (p.team.teamLeadAgent !== n.team.teamLeadAgent) return false;
  if (p.team.teamLeadAgent.icon !== n.team.teamLeadAgent.icon) return false;
  if ((p.team.teamLeadAgent as { avatar?: string }).avatar !== (n.team.teamLeadAgent as { avatar?: string }).avatar)
    return false;
  return true;
}

export default React.memo(TeamNode, areTeamPropsEqual);
