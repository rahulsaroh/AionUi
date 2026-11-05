/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Tag, Tooltip, Button } from '@arco-design/web-react';
import {
  Peoples,
  AlarmClock,
  FolderClose,
  Down,
  Right,
  Workbench,
  Play,
  Plus,
} from '@icon-park/react';
import type { OrgDepartmentNode, OrgNodeStatus } from '@/types/organization';
import { getOrgNodeStyle, ORG_THEME_PALETTE, computeLifecycleStatus } from '../utils/orgTheme';
import { useOrgStore } from '../store/useOrgStore';

export interface DepartmentNodeData {
  department: OrgDepartmentNode;
  isCollapsed?: boolean;
  orientation?: 'TB' | 'LR';
  onToggleCollapse?: (deptId: string) => void;
  onAddSubTeam?: (deptId: string) => void;
  onRunTask?: (dept: OrgDepartmentNode) => void;
  onSelectNode?: (nodeId: string, nodeType: 'department') => void;
}

export const DepartmentNode: React.FC<{ data: DepartmentNodeData; selected?: boolean }> = ({
  data,
  selected = false,
}) => {
  const {
    department,
    isCollapsed = false,
    orientation = 'TB',
    onToggleCollapse,
    onAddSubTeam,
    onRunTask,
    onSelectNode,
  } = data;

  const { nodeStatuses } = useOrgStore();

  const currentStatus: OrgNodeStatus = nodeStatuses[department.id] || department.status || 'idle';
  const effectiveStatus = computeLifecycleStatus(department.lastActiveAt, currentStatus);
  const theme = ORG_THEME_PALETTE[effectiveStatus];
  const nodeStyle = getOrgNodeStyle(effectiveStatus);

  const targetHandlePos = orientation === 'LR' ? Position.Left : Position.Top;
  const sourceHandlePos = orientation === 'LR' ? Position.Right : Position.Bottom;

  const hasChildren = department.teams.length > 0;

  return (
    <div
      onClick={() => onSelectNode?.(department.id, 'department')}
      style={nodeStyle}
      className={`group/dept relative w-330px rounded-14px cursor-pointer text-t-primary shadow-lg flex flex-col overflow-hidden transition-all duration-300 ${
        selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--color-bg-1)]' : ''
      }`}
    >
      <Handle
        type='target'
        position={targetHandlePos}
        className='!bg-primary !w-10px !h-10px !border-2 !border-[var(--color-bg-2)] hover:!scale-125 transition-transform'
      />

      {/* Header */}
      <div className='p-12px pb-8px bg-fill-1 border-b border-[var(--color-border-2)] flex items-center justify-between'>
        <div className='flex items-center gap-8px min-w-0'>
          <span className='size-28px rounded-8px bg-primary/10 text-primary flex items-center justify-center shrink-0'>
            <Peoples size={16} theme='outline' fill='currentColor' />
          </span>
          <div className='flex flex-col min-w-0'>
            <span className='font-bold text-14px truncate' title={department.name}>
              {department.name}
            </span>
            <span className='text-10px text-t-tertiary truncate font-mono'>Division HQ</span>
          </div>
        </div>

        <Tag
          size='small'
          style={{
            borderColor: theme.borderColor,
            color: theme.textColor,
            backgroundColor: theme.backgroundColor,
          }}
          className='font-semibold text-10px px-5px py-0.5px rounded-full'
        >
          {theme.badgeText}
        </Tag>
      </div>

      {/* Department CEO Leader Badge */}
      <div className='p-10px flex flex-col gap-8px bg-[var(--color-bg-2)]'>
        <div className='flex items-center justify-between px-8px py-5px rounded-8px bg-purple-500/10 border border-purple-500/20 text-11px'>
          <div className='flex items-center gap-6px truncate'>
            <Workbench size={14} theme='outline' className='text-purple-400 shrink-0' />
            <div className='flex flex-col truncate'>
              <span className='text-purple-300 font-semibold truncate'>
                {department.departmentCeoAgent.name}
              </span>
              <span className='text-purple-400/80 text-9px'>
                {department.departmentCeoAgent.title || 'Department Head / CEO'}
              </span>
            </div>
          </div>
          <span className='text-9px font-mono text-purple-300 px-4px py-1px rounded bg-purple-500/20 shrink-0'>
            Tier 2
          </span>
        </div>

        {/* Linked Org Projects Pills */}
        {department.linkedProjects.length > 0 && (
          <div className='flex flex-col gap-3px'>
            <span className='text-9px font-semibold uppercase tracking-wider text-t-tertiary'>
              Linked Projects ({department.linkedProjects.length})
            </span>
            <div className='flex items-center gap-4px flex-wrap max-h-48px overflow-y-auto'>
              {department.linkedProjects.map((p) => (
                <div
                  key={p.id}
                  className='flex items-center gap-4px px-6px py-2px rounded bg-fill-2 text-9px text-t-secondary font-mono border border-[var(--color-border-2)]'
                >
                  <FolderClose size={10} theme='outline' className='text-amber-400' />
                  <span className='truncate max-w-100px'>{p.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cron Schedule Badge */}
        {department.cronSchedule && (
          <div className='flex items-center justify-between px-8px py-3px rounded bg-cyan-500/10 border border-cyan-500/20 text-10px text-cyan-300'>
            <div className='flex items-center gap-5px truncate'>
              <AlarmClock size={12} theme='outline' className='text-cyan-400 shrink-0' />
              <span className='font-mono text-9px truncate'>{department.cronSchedule.schedule}</span>
            </div>
            <span className='text-9px truncate text-cyan-400/80 max-w-120px' title={department.cronSchedule.taskDirective}>
              Active Cron
            </span>
          </div>
        )}
      </div>

      {/* Footer Micro Status Bar */}
      <div className='px-10px py-5px bg-fill-1 border-t border-[var(--color-border-2)] text-10px font-mono text-t-secondary flex items-center justify-between'>
        <span className='truncate text-9px'>
          {hasChildren ? `${department.teams.length} Specialized Teams` : 'Standalone Department'}
        </span>
        {hasChildren && (
          <Button
            size='mini'
            className='!px-5px !h-20px !text-10px'
            icon={isCollapsed ? <Right size={10} theme='outline' /> : <Down size={10} theme='outline' />}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse?.(department.id);
            }}
          >
            {isCollapsed ? 'Expand' : 'Collapse'}
          </Button>
        )}
      </div>

      {/* Hover Quick Actions */}
      <div className='absolute top-2 right-2 opacity-0 group-hover/dept:opacity-100 transition-opacity flex items-center gap-4px bg-[var(--color-bg-1)]/95 backdrop-blur-sm p-3px rounded-6px shadow-md border border-[var(--color-border-2)] z-10'>
        <Tooltip content='Dispatch Directive' position='top'>
          <Button
            size='mini'
            type='primary'
            className='!px-5px !h-22px'
            icon={<Play size={11} theme='outline' />}
            onClick={(e) => {
              e.stopPropagation();
              onRunTask?.(department);
            }}
          />
        </Tooltip>
        <Tooltip content='Add Sub-Team' position='top'>
          <Button
            size='mini'
            className='!px-5px !h-22px'
            icon={<Plus size={11} theme='outline' />}
            onClick={(e) => {
              e.stopPropagation();
              onAddSubTeam?.(department.id);
            }}
          />
        </Tooltip>
      </div>

      <Handle
        type='source'
        position={sourceHandlePos}
        className='!bg-primary !w-10px !h-10px !border-2 !border-[var(--color-bg-2)] hover:!scale-125 transition-transform'
      />
    </div>
  );
};

export default React.memo(DepartmentNode);
