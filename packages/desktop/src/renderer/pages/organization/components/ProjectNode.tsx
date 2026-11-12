/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Tag, Tooltip } from '@arco-design/web-react';
import { FolderClose, LinkOne, Edit, Play } from '@icon-park/react';
import type { OrgProject, OrgNodeStatus, OrgDepartmentNode, OrgTeamNode } from '@/types/organization';
import { getOrgNodeStyle, ORG_THEME_PALETTE, computeLifecycleStatus } from '../utils/orgTheme';
import { useOrgStore } from '../store/useOrgStore';

export interface ProjectNodeData {
  project: OrgProject;
  team?: OrgTeamNode;
  department: OrgDepartmentNode;
  orientation?: 'TB' | 'LR';
  onSelectNode?: (nodeId: string, type: 'project') => void;
  onEditProject?: () => void;
  onSetFolder?: () => void;
}

export const ProjectNode: React.FC<{ data: ProjectNodeData; selected?: boolean }> = ({ data, selected = false }) => {
  const { project, orientation = 'TB', onSelectNode, onEditProject, onSetFolder } = data;
  const { nodeStatuses } = useOrgStore();

  const currentStatus: OrgNodeStatus = nodeStatuses[project.id] || (project.status === 'active' ? 'idle' : 'idle');
  const effectiveStatus = computeLifecycleStatus(null, currentStatus);
  const theme = ORG_THEME_PALETTE[effectiveStatus];
  const nodeStyle = getOrgNodeStyle(effectiveStatus);

  const targetHandlePos = orientation === 'LR' ? Position.Left : Position.Top;
  const sourceHandlePos = orientation === 'LR' ? Position.Right : Position.Bottom;

  const workspaceLabel = project.workspacePath || project.path || 'unbound';

  return (
    <div
      onClick={() => onSelectNode?.(project.id, 'project')}
      style={nodeStyle}
      className={`group/project relative w-260px rounded-12px cursor-pointer text-t-primary shadow-md flex flex-col overflow-hidden transition-all duration-300 ${
        selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--color-bg-1)]' : ''
      }`}
    >
      <Handle
        type='target'
        position={targetHandlePos}
        className='!bg-primary !w-9px !h-9px !border-2 !border-[var(--color-border-2)] hover:!scale-125 transition-transform'
      />

      <div className='px-10px py-7px bg-fill-1 border-b border-[var(--color-border-2)] flex items-center justify-between'>
        <div className='flex items-center gap-6px min-w-0'>
          <span className='size-20px rounded-6px bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 text-12px'>
            <FolderClose size={12} theme='outline' fill='currentColor' />
          </span>
          <span className='font-semibold text-12px truncate' title={project.name}>
            {project.name}
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

      <div className='p-10px flex flex-col gap-8px bg-[var(--color-bg-2)]'>
        <div className='flex items-center justify-between px-8px py-4px rounded-6px bg-amber-500/10 border border-amber-500/20 text-10px'>
          <div className='flex items-center gap-5px truncate min-w-0'>
            <Play size={12} theme='outline' className='text-amber-400 shrink-0' />
            <span className='text-amber-300 font-semibold truncate'>{data.department?.name || 'Department'}</span>
          </div>
          <span className='text-amber-400/80 text-9px font-mono shrink-0'>
            {data.team ? 'Tier 4 • Team Project' : 'Tier 3 • Dept Project'}
          </span>
        </div>

        <div className='flex items-center gap-4px px-6px py-3px rounded bg-fill-2 text-9px text-t-secondary font-mono w-fit'>
          <LinkOne size={10} theme='outline' className='text-amber-400 shrink-0' />
          <span className='truncate max-w-140px' title={workspaceLabel}>
            📁 {workspaceLabel}
          </span>
        </div>

        {project.description && <span className='text-10px text-t-tertiary line-clamp-2'>{project.description}</span>}
      </div>

      <div className='absolute top-2 right-2 opacity-0 group-hover/project:opacity-100 transition-opacity flex items-center gap-4px bg-[var(--color-bg-1)]/95 backdrop-blur-sm p-3px rounded-6px shadow-md border border-[var(--color-border-2)] z-10'>
        <Tooltip content='Open Folder' position='top'>
          <span
            role='button'
            className='size-18px rounded flex items-center justify-center text-t-tertiary hover:text-cyan-400 hover:bg-cyan-500/20 opacity-0 group-hover:opacity-100 transition-opacity'
            onClick={(e) => {
              e.stopPropagation();
              void 0;
            }}
          >
            <LinkOne size={10} theme='outline' />
          </span>
        </Tooltip>
        <Tooltip content='Edit Project' position='top'>
          <span
            role='button'
            className='size-18px rounded flex items-center justify-center text-t-tertiary hover:text-t-primary hover:bg-fill-3 opacity-0 group-hover:opacity-100 transition-opacity'
            onClick={(e) => {
              e.stopPropagation();
              onEditProject?.();
            }}
          >
            <Edit size={10} theme='outline' />
          </span>
        </Tooltip>
        <Tooltip content='Set Folder' position='top'>
          <span
            role='button'
            className='size-18px rounded flex items-center justify-center text-t-tertiary hover:text-amber-400 hover:bg-amber-500/20 opacity-0 group-hover:opacity-100 transition-opacity'
            onClick={(e) => {
              e.stopPropagation();
              onSetFolder?.();
            }}
          >
            <LinkOne size={10} theme='outline' />
          </span>
        </Tooltip>
      </div>

      <Handle
        type='source'
        position={sourceHandlePos}
        className='!bg-primary !w-9px !h-9px !border-2 !border-[var(--color-border-2)] hover:!scale-125 transition-transform'
      />
    </div>
  );
};

export default React.memo(ProjectNode);
