/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Tag, Tooltip, Button } from '@arco-design/web-react';
import { Play, Peoples, Send, FolderClose } from '@icon-park/react';
import type { RootCEO, OrgNodeStatus } from '@/types/organization';
import { getOrgNodeStyle, ORG_THEME_PALETTE, computeLifecycleStatus } from '../utils/orgTheme';
import { useOrgStore } from '../store/useOrgStore';

export interface RootCeoNodeData {
  rootCeo: RootCEO;
  orientation?: 'TB' | 'LR';
  onDispatchToCeo?: (rootCeo: RootCEO) => void;
  onSelectNode?: (nodeId: string, nodeType: 'ceo') => void;
  onSetFolder?: (nodeId: string) => void;
}

export const RootCeoNode: React.FC<{ data: RootCeoNodeData; selected?: boolean }> = ({ data, selected = false }) => {
  const { rootCeo, orientation = 'TB', onDispatchToCeo, onSelectNode, onSetFolder } = data;
  const { nodeStatuses, isSimulating } = useOrgStore();

  const currentStatus = nodeStatuses[rootCeo.id] || rootCeo.status || 'idle';
  const effectiveStatus = computeLifecycleStatus(rootCeo.lastActiveAt, currentStatus);
  const theme = ORG_THEME_PALETTE[effectiveStatus];
  const nodeStyle = getOrgNodeStyle(effectiveStatus);

  const sourceHandlePos = orientation === 'LR' ? Position.Right : Position.Bottom;

  return (
    <div
      onClick={() => onSelectNode?.(rootCeo.id, 'ceo')}
      style={nodeStyle}
      className={`group/ceo relative w-360px rounded-16px cursor-pointer text-t-primary shadow-xl flex flex-col overflow-hidden transition-all duration-300 ${
        selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--color-bg-1)]' : ''
      }`}
    >
      {/* Top Banner Ribbon */}
      <div className='px-16px py-10px bg-gradient-to-r from-amber-500/20 via-primary/15 to-emerald-500/20 border-b border-[var(--color-border-2)] flex items-center justify-between'>
        <div className='flex items-center gap-8px'>
          <span className='size-32px rounded-10px bg-amber-500/20 text-amber-400 flex items-center justify-center text-18px shadow-sm'>
            👑
          </span>
          <div className='flex flex-col'>
            <span className='font-bold text-15px leading-tight tracking-wide text-amber-200'>Root Executive HQ</span>
            <span className='text-11px text-t-tertiary font-mono'>Chief Executive Command</span>
          </div>
        </div>

        <Tag
          size='small'
          style={{
            borderColor: theme.borderColor,
            color: theme.textColor,
            backgroundColor: theme.backgroundColor,
          }}
          className='font-semibold text-10px px-6px py-1px rounded-full'
        >
          {theme.badgeText}
        </Tag>
      </div>

      {/* Main Body */}
      <div className='p-14px flex flex-col gap-10px bg-[var(--color-bg-2)]'>
        {/* CEO Agent Box */}
        <div className='p-10px rounded-10px bg-fill-2 border border-[var(--color-border-2)] flex items-center justify-between'>
          <div className='flex items-center gap-10px min-w-0'>
            <span className='size-34px rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-14px shrink-0'>
              CEO
            </span>
            <div className='flex flex-col min-w-0'>
              <span className='text-13px font-semibold text-t-primary truncate'>{rootCeo.ceoAgent.name}</span>
              <span className='text-11px text-t-secondary truncate'>
                {rootCeo.ceoAgent.title || 'Aion CLI Executive Orchestrator'}
              </span>
            </div>
          </div>
          <span className='text-10px font-mono px-6px py-2px rounded bg-primary/10 text-primary border border-primary/20 shrink-0'>
            Aion CLI
          </span>
        </div>

        {/* Chief of Staff / HR */}
        {rootCeo.chiefOfStaffAgent && (
          <div className='px-10px py-6px rounded-8px bg-fill-1 border border-[var(--color-border-2)] flex items-center justify-between text-11px'>
            <div className='flex items-center gap-6px text-t-secondary'>
              <Peoples size={14} theme='outline' className='text-primary shrink-0' />
              <span className='font-medium'>{rootCeo.chiefOfStaffAgent.name}</span>
            </div>
            <span className='text-10px text-t-tertiary'>{rootCeo.chiefOfStaffAgent.title}</span>
          </div>
        )}

        {/* Master Workspace Root indicator */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            onSetFolder?.(rootCeo.id);
          }}
          className='px-10px py-6px rounded-8px bg-fill-1 border border-[var(--color-border-2)] flex items-center justify-between text-11px hover:border-primary/50 cursor-pointer transition-colors group'
          title='Click to configure master organization workspace folder'
        >
          <div className='flex items-center gap-6px min-w-0'>
            <FolderClose
              size={14}
              theme='outline'
              className={rootCeo.workspacePath ? 'text-amber-400 shrink-0' : 'text-t-tertiary shrink-0'}
            />
            <span className='font-mono text-10px truncate text-t-secondary group-hover:text-t-primary'>
              {rootCeo.workspacePath ? `Master: ${rootCeo.workspacePath}` : 'Set Master Folder (Required)'}
            </span>
          </div>
          <span className='text-10px text-primary font-mono shrink-0 ml-4px opacity-0 group-hover:opacity-100 transition-opacity'>
            Edit ›
          </span>
        </div>

        {/* Action Button: Dispatch Task to CEO */}
        <Button
          type='primary'
          size='small'
          icon={<Send size={13} theme='outline' />}
          className='!h-32px !rounded-8px !font-medium !text-12px !w-full'
          onClick={(e) => {
            e.stopPropagation();
            onDispatchToCeo?.(rootCeo);
          }}
        >
          Dispatch Task to CEO
        </Button>
      </div>

      {/* Global Status Ticker */}
      <div className='px-12px py-6px bg-fill-1 border-t border-[var(--color-border-2)] text-10px font-mono text-t-secondary flex items-center justify-between'>
        <div className='flex items-center gap-6px truncate'>
          <span className='size-7px rounded-full shrink-0' style={{ backgroundColor: theme.borderColor }} />
          <span className='truncate'>
            {isSimulating ? 'Autonomous delegation in flight' : 'Ready for executive directives'}
          </span>
        </div>
        <span className='text-t-tertiary text-9px shrink-0'>
          {rootCeo.lastActiveAt
            ? new Date(rootCeo.lastActiveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'idle'}
        </span>
      </div>

      {/* React Flow Source Handle */}
      <Handle
        type='source'
        position={sourceHandlePos}
        className='!bg-primary !w-12px !h-12px !border-2 !border-[var(--color-bg-2)] hover:!scale-125 transition-transform'
      />
    </div>
  );
};

export default React.memo(RootCeoNode);
