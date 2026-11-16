/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Tag, Tooltip } from '@arco-design/web-react';
import { FolderClose, LinkOne, Edit } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { OrgProject, OrgNodeStatus, OrgDepartmentNode, OrgTeamNode } from '@/types/organization';
import { ORG_THEME_PALETTE, computeLifecycleStatus, TIER_NEON_THEMES } from '../utils/orgTheme';
import { useOrgStore } from '../store/useOrgStore';
import { ipcBridge } from '@/common';

export interface ProjectNodeData {
  project: OrgProject;
  team?: OrgTeamNode;
  department: OrgDepartmentNode;
  orientation?: 'TB' | 'LR';
  isDescendantWorking?: boolean;
  isDimmed?: boolean;
  onSelectNode?: (nodeId: string, type: 'project') => void;
  onEditProject?: () => void;
  onSetFolder?: () => void;
}

export const ProjectNode: React.FC<{ data: ProjectNodeData; selected?: boolean }> = ({ data, selected = false }) => {
  const { t } = useTranslation();
  const { project, orientation = 'TB', isDescendantWorking, onSelectNode, onEditProject, onSetFolder } = data;
  const { nodeStatuses } = useOrgStore();

  const currentStatus: OrgNodeStatus = nodeStatuses[project.id] || (project.status === 'active' ? 'idle' : 'idle');
  const effectiveStatus = computeLifecycleStatus(null, currentStatus);
  const theme = ORG_THEME_PALETTE[effectiveStatus];
  const isWorking = effectiveStatus === 'working' || isDescendantWorking;

  const purpleBorder = TIER_NEON_THEMES.project.border;
  const purpleGlow = isWorking
    ? '0 0 20px rgba(168, 85, 247, 0.65), 0 0 3px #A855F7'
    : '0 0 14px rgba(168, 85, 247, 0.35)';

  const targetHandlePos = orientation === 'LR' ? Position.Left : Position.Top;
  const sourceHandlePos = orientation === 'LR' ? Position.Right : Position.Bottom;

  const workspaceLabel = project.workspacePath || project.path || 'unbound';
  const scopeText = project.description?.slice(0, 30) || 'Deliverable Focus';

  return (
    <div
      onClick={() => onSelectNode?.(project.id, 'project')}
      style={{
        borderColor: purpleBorder,
        boxShadow: selected ? `0 0 0 2px ${purpleBorder}, ${purpleGlow}` : purpleGlow,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
      }}
      className={`group/project relative w-280px rounded-12px cursor-pointer text-slate-100 backdrop-blur-md border border-solid flex flex-col overflow-hidden transition-all duration-300 ${
        isWorking ? 'working-pulse' : ''
      }`}
    >
      <Handle
        type='target'
        position={targetHandlePos}
        className='!w-8px !h-8px !border-2 !border-slate-900 hover:!scale-125 transition-transform'
        style={{ backgroundColor: purpleBorder }}
      />

      {/* Header: Project Name + Scope */}
      <div className='px-10px py-8px border-b border-purple-500/20 bg-gradient-to-r from-purple-950/30 via-slate-900/30 to-purple-950/20 flex items-center justify-between'>
        <div className='flex items-center gap-6px min-w-0'>
          <span className='size-22px rounded-6px bg-purple-500/20 text-purple-300 flex items-center justify-center shrink-0 text-12px border border-purple-500/30'>
            <FolderClose size={12} theme='outline' fill='currentColor' />
          </span>
          <div className='flex flex-col min-w-0'>
            <div className='flex items-center gap-4px min-w-0'>
              <span className='font-bold text-12px text-slate-100 truncate' title={project.name}>
                {project.name}
              </span>
              <span className='text-10px text-purple-300 font-mono shrink-0 truncate max-w-100px'>({scopeText})</span>
            </div>
          </div>
        </div>

        <Tag
          size='small'
          style={{
            borderColor: purpleBorder,
            color: '#D8B4FE',
            backgroundColor: 'rgba(168, 85, 247, 0.15)',
          }}
          className='text-9px font-semibold px-4px py-0 rounded font-mono shrink-0'
        >
          {t('team.organization.project', { defaultValue: 'PROJECT' })}
        </Tag>
      </div>

      {/* Body: Linked Department + Workspace Folder */}
      <div className='p-8px flex flex-col gap-6px'>
        {/* Workspace directory chip */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            if (project.workspacePath) {
              void ipcBridge.shell?.openFolderWith?.invoke?.({ folder_path: project.workspacePath, tool: 'explorer' });
            } else {
              onSetFolder?.();
            }
          }}
          className='flex items-center justify-between px-6px py-3px rounded bg-slate-800/40 border border-slate-700/50 text-9px text-slate-300 font-mono hover:border-purple-500/40 transition-colors'
          title={workspaceLabel}
        >
          <div className='flex items-center gap-4px truncate min-w-0'>
            <LinkOne size={10} className='text-purple-400 shrink-0' />
            <span className='truncate'>{workspaceLabel}</span>
          </div>
          <span className='text-purple-300 opacity-60 hover:opacity-100 shrink-0 text-8px'>
            {project.workspacePath ? 'open' : 'bind'}
          </span>
        </div>

        {/* Footer info: team count */}
        <div className='flex items-center justify-between text-9px text-slate-400 px-2px font-mono'>
          <span>{project.teamIds?.length || 0} Assigned Teams</span>
          {onEditProject && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onEditProject();
              }}
              className='text-purple-400 hover:text-purple-300 flex items-center gap-2px cursor-pointer'
            >
              <Edit size={10} /> Edit
            </span>
          )}
        </div>
      </div>

      <Handle
        type='source'
        position={sourceHandlePos}
        className='!w-8px !h-8px !border-2 !border-slate-900 hover:!scale-125 transition-transform'
        style={{ backgroundColor: purpleBorder }}
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

export function areProjectPropsEqual(
  prev: { data: ProjectNodeData; selected?: boolean },
  next: { data: ProjectNodeData; selected?: boolean }
): boolean {
  if (prev.selected !== next.selected) return false;
  const p = prev.data;
  const n = next.data;
  if (p.isDimmed !== n.isDimmed) return false;
  if (p.isDescendantWorking !== n.isDescendantWorking) return false;
  if (p.orientation !== n.orientation) return false;
  if (p.project !== n.project) return false;
  if (p.project.name !== n.project.name) return false;
  if (p.project.status !== n.project.status) return false;
  if (p.project.teamIds !== n.project.teamIds) return false;
  if (p.project.memberIds !== n.project.memberIds) return false;
  if (p.department !== n.department) return false;
  return true;
}

export default React.memo(ProjectNode, areProjectPropsEqual);
