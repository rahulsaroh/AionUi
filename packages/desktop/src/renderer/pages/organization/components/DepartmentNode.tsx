/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Tag, Tooltip, Spin, Button } from '@arco-design/web-react';
import {
  Peoples,
  Play,
  Plus,
  MessageOne,
  Down,
  Right,
  AlarmClock,
  CheckOne,
  CloseOne,
  LoadingOne,
  Workbench,
} from '@icon-park/react';
import type { TTeam, TeamAssistant } from '@/common/types/team/teamTypes';
import { useOrgTelemetryStore } from '../store/useOrgTelemetryStore';
import AgentMemberPill from './AgentMemberPill';

export type DepartmentNodeData = {
  team: TTeam;
  level: number;
  isRoot: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
  orientation?: 'TB' | 'LR';
  onToggleCollapse?: (teamId: string) => void;
  onAddSubTeam?: (teamId: string) => void;
  onOpenChat?: (teamId: string) => void;
  onRunTask?: (team: TTeam) => void;
  onSelectNode?: (team: TTeam) => void;
};

export const DepartmentNode: React.FC<{ data: DepartmentNodeData; selected?: boolean }> = ({
  data,
  selected = false,
}) => {
  const {
    team,
    level,
    isRoot,
    hasChildren,
    isCollapsed,
    orientation = 'TB',
    onToggleCollapse,
    onAddSubTeam,
    onOpenChat,
    onRunTask,
    onSelectNode,
  } = data;

  const { getNodeStatus, getActivity } = useOrgTelemetryStore();
  const status = getNodeStatus(team.id);
  const activity = getActivity(team.id);

  const assistants = team.assistants || [];
  const leader = assistants.find((a: TeamAssistant) => a.role === 'leader') || assistants[0];
  const specialists = assistants.filter((a: TeamAssistant) => a.slot_id !== leader?.slot_id);

  const depthLabel = isRoot ? 'HQ' : level === 1 ? 'Division' : 'Sub-Team';
  const depthColor = isRoot ? 'gold' : level === 1 ? 'arcoblue' : 'gray';

  // Live status visuals
  const getStatusVisuals = () => {
    switch (status) {
      case 'thinking':
        return {
          glow: 'ring-2 ring-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.35)] border-cyan-500',
          dot: 'bg-cyan-400 animate-pulse',
          icon: <LoadingOne theme='outline' size={14} className='animate-spin text-cyan-400' />,
          text: 'Executing',
        };
      case 'delegating':
        return {
          glow: 'ring-2 ring-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.35)] border-amber-500',
          dot: 'bg-amber-400 animate-pulse',
          icon: <LoadingOne theme='outline' size={14} className='animate-spin text-amber-400' />,
          text: 'Delegating',
        };
      case 'completed':
        return {
          glow: 'ring-2 ring-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.35)] border-emerald-500',
          dot: 'bg-emerald-400',
          icon: <CheckOne theme='outline' size={14} className='text-emerald-400' />,
          text: 'Completed',
        };
      case 'error':
        return {
          glow: 'ring-2 ring-red-500 shadow-[0_0_15px_rgba(239,68,68,0.35)] border-red-500',
          dot: 'bg-red-400 animate-pulse',
          icon: <CloseOne theme='outline' size={14} className='text-red-400' />,
          text: 'Error / Blocked',
        };
      default:
        return {
          glow: selected ? 'ring-2 ring-primary border-primary shadow-lg' : 'border-[var(--color-border-2)] hover:border-primary/60',
          dot: 'bg-slate-400',
          icon: null,
          text: 'Idle',
        };
    }
  };

  const visuals = getStatusVisuals();

  const targetHandlePos = orientation === 'LR' ? Position.Left : Position.Top;
  const sourceHandlePos = orientation === 'LR' ? Position.Right : Position.Bottom;

  return (
    <div
      onClick={() => onSelectNode?.(team)}
      className={`group/card relative w-320px rounded-12px bg-[var(--color-bg-2)] border border-solid transition-all duration-200 cursor-pointer text-t-primary shadow-md flex flex-col overflow-hidden ${visuals.glow}`}
    >
      {/* React Flow Handles */}
      <Handle
        type='target'
        position={targetHandlePos}
        className='!bg-primary !w-10px !h-10px !border-2 !border-[var(--color-bg-2)] hover:!scale-125 transition-transform'
      />

      {/* Header */}
      <div className='p-12px pb-8px border-b border-[var(--color-border-2)] bg-fill-1 flex items-center justify-between'>
        <div className='flex items-center gap-8px min-w-0'>
          <span className='size-28px rounded-8px bg-primary/10 text-primary flex items-center justify-center shrink-0'>
            <Peoples size={16} theme='outline' fill='currentColor' />
          </span>
          <div className='flex flex-col min-w-0'>
            <div className='flex items-center gap-6px'>
              <span className='font-semibold text-14px truncate' title={team.name}>
                {team.name}
              </span>
              <Tag size='small' color={depthColor} className='text-10px font-medium leading-none px-4px py-1px'>
                {depthLabel}
              </Tag>
            </div>
            {team.departmentRole && (
              <span className='text-11px text-t-tertiary truncate'>{team.departmentRole}</span>
            )}
          </div>
        </div>

        {/* Status Dot / Indicator */}
        <Tooltip content={`Status: ${visuals.text}`} position='top'>
          <div className='flex items-center gap-4px shrink-0'>
            {visuals.icon}
            <span className={`size-8px rounded-full ${visuals.dot}`} />
          </div>
        </Tooltip>
      </div>

      {/* Body Section */}
      <div className='p-12px flex flex-col gap-10px flex-1'>
        {/* Leader Badge */}
        {leader && (
          <div className='flex items-center justify-between px-8px py-4px rounded-6px bg-blue-500/10 border border-solid border-blue-500/20 text-11px'>
            <div className='flex items-center gap-6px truncate'>
              <Workbench size={14} theme='outline' className='text-blue-400 shrink-0' />
              <span className='text-blue-300 font-semibold truncate'>Lead: {leader.assistant_name}</span>
            </div>
            <span className='text-10px text-blue-400/80 shrink-0 font-mono'>Aion CLI</span>
          </div>
        )}

        {/* Specialists Roster */}
        <div className='flex flex-col gap-4px'>
          <div className='text-10px uppercase tracking-wider text-t-tertiary font-semibold flex justify-between'>
            <span>Specialists ({specialists.length})</span>
            {team.description && (
              <span className='lowercase font-normal truncate max-w-140px text-right' title={team.description}>
                {team.description}
              </span>
            )}
          </div>
          <div className='flex items-center gap-6px flex-wrap max-h-56px overflow-y-auto pr-2px'>
            {specialists.length === 0 ? (
              <span className='text-11px text-t-tertiary italic'>No specialists assigned</span>
            ) : (
              specialists.map((spec: TeamAssistant) => (
                <AgentMemberPill key={spec.slot_id} assistant={spec} isActive={status === 'thinking'} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Live Status Micro-Readout Bar */}
      <div className='px-10px py-6px bg-fill-2 border-t border-[var(--color-border-2)] text-10px font-mono text-t-secondary flex items-center justify-between gap-6px'>
        <div className='flex items-center gap-4px truncate min-w-0'>
          <span className='text-cyan-400 font-bold'>&gt;</span>
          <span className='truncate' title={activity?.message || 'Ready for autonomous dispatch'}>
            {activity?.message || 'Ready for autonomous dispatch'}
          </span>
        </div>
        <span className='text-t-tertiary shrink-0 text-9px'>
          {activity?.timestamp ? new Date(activity.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'idle'}
        </span>
      </div>

      {/* Quick Action Toolbar (revealed on hover) */}
      <div className='absolute top-2 right-2 opacity-0 group-hover/card:opacity-100 transition-opacity flex items-center gap-4px bg-[var(--color-bg-1)]/95 backdrop-blur-sm p-4px rounded-8px shadow-lg border border-solid border-[var(--color-border-2)] z-10'>
        <Tooltip content='Run Directive' position='top'>
          <Button
            size='mini'
            type='primary'
            className='!px-6px !h-24px'
            icon={<Play size={12} theme='outline' />}
            onClick={(e) => {
              e.stopPropagation();
              onRunTask?.(team);
            }}
          />
        </Tooltip>
        <Tooltip content='Add Sub-Team' position='top'>
          <Button
            size='mini'
            className='!px-6px !h-24px'
            icon={<Plus size={12} theme='outline' />}
            onClick={(e) => {
              e.stopPropagation();
              onAddSubTeam?.(team.id);
            }}
          />
        </Tooltip>
        <Tooltip content='Open Team Chat' position='top'>
          <Button
            size='mini'
            className='!px-6px !h-24px'
            icon={<MessageOne size={12} theme='outline' />}
            onClick={(e) => {
              e.stopPropagation();
              onOpenChat?.(team.id);
            }}
          />
        </Tooltip>
        {hasChildren && (
          <Tooltip content={isCollapsed ? 'Expand Branch' : 'Collapse Branch'} position='top'>
            <Button
              size='mini'
              className='!px-6px !h-24px'
              icon={isCollapsed ? <Right size={12} theme='outline' /> : <Down size={12} theme='outline' />}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse?.(team.id);
              }}
            />
          </Tooltip>
        )}
      </div>

      {/* Source Handle */}
      <Handle
        type='source'
        position={sourceHandlePos}
        className='!bg-primary !w-10px !h-10px !border-2 !border-[var(--color-bg-2)] hover:!scale-125 transition-transform'
      />
    </div>
  );
};

export default React.memo(DepartmentNode);
