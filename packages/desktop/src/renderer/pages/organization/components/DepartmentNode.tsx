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
  Down,
  Right,
  Plus,
  Edit,
  FolderPlus,
} from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { OrgDepartmentNode, OrgNodeStatus } from '@/types/organization';
import { ORG_THEME_PALETTE, computeLifecycleStatus, getDepartmentAccent } from '../utils/orgTheme';
import { useOrgStore } from '../store/useOrgStore';
import { RobotAvatar } from './RobotAvatar';

export type DepartmentNodeData = {
  department: OrgDepartmentNode;
  deptIndex?: number;
  isCollapsed?: boolean;
  orientation?: 'TB' | 'LR';
  isDescendantWorking?: boolean;
  onToggleCollapse?: (deptId: string) => void;
  onAddSubTeam?: (deptId: string) => void;
  onAddProject?: (deptId: string) => void;
  onEditDepartment?: (deptId: string) => void;
  onRunTask?: (dept: OrgDepartmentNode) => void;
  onSelectNode?: (nodeId: string, nodeType: 'department') => void;
  onSelectProject?: (projectId: string) => void;
  onSelectMember?: (memberId: string) => void;
};

export const DepartmentNode: React.FC<{ data: DepartmentNodeData; selected?: boolean }> = ({
  data,
  selected = false,
}) => {
  const { t } = useTranslation();
  const {
    department,
    deptIndex = 0,
    isCollapsed = false,
    orientation = 'TB',
    isDescendantWorking,
    onToggleCollapse,
    onAddSubTeam,
    onAddProject,
    onEditDepartment,
    onSelectNode,
  } = data;

  const { nodeStatuses, projects } = useOrgStore();

  const currentStatus: OrgNodeStatus = nodeStatuses[department.id] || department.status || 'idle';
  const effectiveStatus = computeLifecycleStatus(department.lastActiveAt, currentStatus);
  const theme = ORG_THEME_PALETTE[effectiveStatus];
  const isWorking = effectiveStatus === 'working' || isDescendantWorking;

  const accent = getDepartmentAccent(deptIndex, department.color);
  const borderGlow = isWorking
    ? `0 0 22px ${accent.glow}, 0 0 4px ${accent.border}`
    : `0 0 14px ${accent.glow}`;

  const targetHandlePos = orientation === 'LR' ? Position.Left : Position.Top;
  const sourceHandlePos = orientation === 'LR' ? Position.Right : Position.Bottom;

  const deptProjects = projects.filter((p) => p.departmentId === department.id);
  const subtitle =
    department.description ||
    department.departmentCeoAgent.title ||
    `${department.teams.length} teams • ${deptProjects.length} projects`;

  return (
    <div
      onClick={() => onSelectNode?.(department.id, 'department')}
      style={{
        borderColor: accent.border,
        boxShadow: selected ? `0 0 0 2px ${accent.border}, ${borderGlow}` : borderGlow,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
      }}
      className={`group/dept relative w-320px rounded-14px cursor-pointer text-slate-100 backdrop-blur-md border border-solid flex flex-col overflow-hidden transition-all duration-300 ${
        isWorking ? 'working-pulse' : ''
      }`}
    >
      <Handle
        type='target'
        position={targetHandlePos}
        className='!w-9px !h-9px !border-2 !border-slate-900 hover:!scale-125 transition-transform'
        style={{ backgroundColor: accent.border }}
      />

      {/* Header: Icon + Name + Subtitle + Accent Color Tag */}
      <div
        style={{
          borderBottom: `1px solid ${accent.border}33`,
          background: `linear-gradient(90deg, ${accent.bg} 0%, rgba(15, 23, 42, 0.4) 100%)`,
        }}
        className='p-12px pb-10px flex items-center justify-between'
      >
        <div className='flex items-center gap-10px min-w-0'>
          {/* Department Icon / Robot Avatar */}
          <div
            className='relative rounded-full p-2px shrink-0 transition-all duration-300'
            style={{
              border: `1.5px solid ${accent.border}`,
              boxShadow: isWorking ? `0 0 10px ${accent.border}` : undefined,
            }}
          >
            <RobotAvatar
              name={department.departmentCeoAgent.name}
              icon={department.icon}
              size={30}
              accentColor={accent.border}
              isWorking={isWorking}
            />
          </div>

          <div className='flex flex-col min-w-0'>
            <div className='flex items-center gap-6px'>
              <Tag
                size='small'
                style={{
                  borderColor: accent.border,
                  color: accent.text,
                  backgroundColor: `${accent.border}1a`,
                }}
                className='font-bold text-9px px-4px py-0 rounded font-mono'
              >
                {t('team.organization.department', { defaultValue: 'DEPT' })}
              </Tag>
              <span className='font-bold text-13px text-slate-100 truncate' title={department.name}>
                {department.name}
              </span>
            </div>
            <span className='text-10px text-slate-400 font-medium truncate mt-1px' title={subtitle}>
              {subtitle}
            </span>
          </div>
        </div>

        {/* Action icons */}
        <div className='flex items-center gap-4px shrink-0'>
          {onEditDepartment && (
            <Tooltip content='Edit Department'>
              <Button
                size='mini'
                type='text'
                icon={<Edit size={12} className='text-slate-400 hover:text-slate-200' />}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditDepartment(department.id);
                }}
              />
            </Tooltip>
          )}

          {department.teams.length > 0 && onToggleCollapse && (
            <Tooltip content={isCollapsed ? 'Expand branch' : 'Collapse branch'}>
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapse(department.id);
                }}
                className='p-2px rounded bg-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer border-none'
              >
                {isCollapsed ? <Right size={12} /> : <Down size={12} />}
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Body: Head Agent + Quick Stats / Actions */}
      <div className='p-10px flex flex-col gap-6px'>
        {/* Department Head */}
        <div className='flex items-center justify-between px-8px py-4px rounded-8px bg-slate-800/40 border border-slate-700/50 text-10px'>
          <div className='flex items-center gap-6px truncate text-slate-300'>
            <Peoples size={12} style={{ color: accent.border }} className='shrink-0' />
            <span className='font-medium truncate'>{department.departmentCeoAgent.name}</span>
          </div>
          <span className='text-slate-400 text-9px font-mono shrink-0'>
            {department.departmentCeoAgent.title || 'Department Head'}
          </span>
        </div>

        {/* Quick add sub-team and project actions */}
        <div className='flex items-center gap-6px mt-2px'>
          <Button
            size='mini'
            type='secondary'
            icon={<Plus size={11} />}
            className='!text-9px !h-24px !rounded-6px flex-1 !bg-slate-800/60 !text-slate-300 !border-slate-700 hover:!border-slate-500'
            onClick={(e) => {
              e.stopPropagation();
              onAddSubTeam?.(department.id);
            }}
          >
            {t('team.organization.addTeam', { defaultValue: 'Add Team' })}
          </Button>

          <Button
            size='mini'
            type='secondary'
            icon={<FolderPlus size={11} />}
            className='!text-9px !h-24px !rounded-6px flex-1 !bg-slate-800/60 !text-slate-300 !border-slate-700 hover:!border-slate-500'
            onClick={(e) => {
              e.stopPropagation();
              onAddProject?.(department.id);
            }}
          >
            {t('team.organization.addProject', { defaultValue: 'Add Project' })}
          </Button>
        </div>
      </div>

      {/* Footer bar */}
      <div className='px-10px py-4px bg-slate-950/60 border-t border-slate-800/80 text-9px font-mono text-slate-400 flex items-center justify-between'>
        <div className='flex items-center gap-5px truncate'>
          <span
            className='size-5px rounded-full shrink-0'
            style={{ backgroundColor: isWorking ? accent.border : theme.borderColor }}
          />
          <span className='truncate text-slate-300'>
            {isWorking ? 'Department Active' : isCollapsed ? 'Branch Collapsed' : 'Ready'}
          </span>
        </div>
        <span className='text-slate-500 text-8px'>
          {department.teams.length} Teams
        </span>
      </div>

      <Handle
        type='source'
        position={sourceHandlePos}
        className='!w-9px !h-9px !border-2 !border-slate-900 hover:!scale-125 transition-transform'
        style={{ backgroundColor: accent.border }}
      />
    </div>
  );
};

export default React.memo(DepartmentNode);
