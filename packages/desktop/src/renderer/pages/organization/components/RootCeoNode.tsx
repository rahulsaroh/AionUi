/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Tag, Tooltip, Button, Message } from '@arco-design/web-react';
import { Send, FolderClose, Edit, Lightning } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { RootCEO, OrgNodeStatus } from '@/types/organization';
import { ORG_THEME_PALETTE, computeLifecycleStatus, TIER_NEON_THEMES } from '../utils/orgTheme';
import { useOrgStore } from '../store/useOrgStore';
import { OrgModelSelector } from './OrgModelSelector';
import { RobotAvatar } from './RobotAvatar';

export interface RootCeoNodeData {
  rootCeo: RootCEO;
  orientation?: 'TB' | 'LR';
  isDescendantWorking?: boolean;
  onDispatchToCeo?: (rootCeo: RootCEO) => void;
  onSelectNode?: (nodeId: string, nodeType: 'ceo') => void;
  onSelectMember?: (memberId: string) => void;
  onSetFolder?: (nodeId: string) => void;
  onEditCeo?: () => void;
}

export const RootCeoNode: React.FC<{ data: RootCeoNodeData; selected?: boolean }> = ({ data, selected = false }) => {
  const { t } = useTranslation();
  const {
    rootCeo,
    orientation = 'TB',
    isDescendantWorking,
    onDispatchToCeo,
    onSelectNode,
    onSetFolder,
    onEditCeo,
  } = data;
  const { nodeStatuses, isSimulating, updateAgentModel } = useOrgStore();

  const currentStatus: OrgNodeStatus = nodeStatuses[rootCeo.id] || rootCeo.status || 'idle';
  const effectiveStatus = computeLifecycleStatus(rootCeo.lastActiveAt, currentStatus);
  const theme = ORG_THEME_PALETTE[effectiveStatus];
  const isWorking = effectiveStatus === 'working' || isDescendantWorking;
  const sourceHandlePos = orientation === 'LR' ? Position.Right : Position.Bottom;

  const cyanBorder = TIER_NEON_THEMES.ceo.border;
  const cyanGlow = isWorking ? '0 0 24px rgba(6, 182, 212, 0.65), 0 0 4px #06B6D4' : '0 0 16px rgba(6, 182, 212, 0.35)';

  return (
    <div
      onClick={() => onSelectNode?.(rootCeo.id, 'ceo')}
      style={{
        borderColor: cyanBorder,
        boxShadow: selected ? `0 0 0 2px #06B6D4, ${cyanGlow}` : cyanGlow,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
      }}
      className={`group/ceo relative w-360px rounded-16px cursor-pointer text-slate-100 backdrop-blur-md border border-solid flex flex-col overflow-hidden transition-all duration-300 ${
        isWorking ? 'working-pulse' : ''
      }`}
    >
      {/* Top Banner with Robot Avatar, CEO Title, User Name, Tagline */}
      <div className='p-14px pb-10px flex items-center justify-between border-b border-cyan-500/20 bg-gradient-to-r from-cyan-950/40 via-slate-900/40 to-cyan-950/20'>
        <div className='flex items-center gap-12px min-w-0'>
          {/* Cyan Glow Robot Avatar */}
          <div
            className='relative rounded-full p-2px transition-all duration-300'
            style={{
              border: `2px solid ${cyanBorder}`,
              boxShadow: isWorking ? '0 0 14px #06B6D4' : '0 0 8px rgba(6, 182, 212, 0.4)',
            }}
          >
            <RobotAvatar
              name={rootCeo.ceoAgent.name}
              icon={rootCeo.ceoAgent.icon}
              size={36}
              accentColor={cyanBorder}
              isWorking={isWorking}
            />
          </div>

          <div className='flex flex-col min-w-0'>
            <div className='flex items-center gap-6px'>
              <Tag
                size='small'
                style={{
                  borderColor: cyanBorder,
                  color: '#67E8F9',
                  backgroundColor: 'rgba(6, 182, 212, 0.15)',
                }}
                className='font-bold text-10px px-5px py-0 rounded font-mono'
              >
                {t('team.organization.ceoTitle', { defaultValue: 'CEO' })}
              </Tag>
              <span className='font-bold text-14px leading-tight tracking-wide text-slate-100 truncate'>
                {rootCeo.ceoAgent.name || rootCeo.name}
              </span>
            </div>
            <span className='text-11px text-cyan-300/80 font-medium truncate mt-2px'>
              {t('team.organization.ceoTagline', { defaultValue: 'Orchestrates Vision & Growth' })}
            </span>
          </div>
        </div>

        {/* Action icons */}
        <div className='flex items-center gap-4px shrink-0'>
          {onEditCeo && (
            <Tooltip content='Edit Executive HQ'>
              <Button
                size='mini'
                type='text'
                icon={<Edit size={13} className='text-slate-400 hover:text-cyan-300' />}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditCeo();
                }}
              />
            </Tooltip>
          )}
          <Tag
            size='small'
            style={{
              borderColor: theme.borderColor,
              color: theme.textColor,
              backgroundColor: theme.backgroundColor,
            }}
            className='text-9px font-semibold px-5px py-0 rounded-full'
          >
            {theme.badgeText}
          </Tag>
        </div>
      </div>

      {/* Main Body */}
      <div className='p-12px flex flex-col gap-8px'>
        {/* Model & Executive Directive row */}
        <div className='flex items-center justify-between gap-8px px-8px py-4px rounded-8px bg-slate-800/50 border border-slate-700/60 text-11px'>
          <div className='flex items-center gap-6px text-slate-300 truncate'>
            <Lightning size={12} className='text-cyan-400 shrink-0' />
            <span className='truncate text-10px font-mono'>{rootCeo.ceoAgent.title || 'Executive Command'}</span>
          </div>
          <div className='shrink-0' onClick={(e) => e.stopPropagation()}>
            <OrgModelSelector
              currentModel={rootCeo.ceoAgent.model}
              onSelectModel={(model) => {
                updateAgentModel(rootCeo.ceoAgent.id, model);
                Message.success(`Model updated to ${model.modelName || model.modelId} for Root CEO`);
              }}
            />
          </div>
        </div>

        {/* Master Workspace Root indicator */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            onSetFolder?.(rootCeo.id);
          }}
          className='px-8px py-4px rounded-8px bg-slate-800/40 border border-slate-700/50 flex items-center justify-between text-10px hover:border-cyan-500/50 cursor-pointer transition-colors group'
          title='Click to configure master organization workspace folder'
        >
          <div className='flex items-center gap-6px min-w-0'>
            <FolderClose
              size={12}
              className={rootCeo.workspacePath ? 'text-cyan-400 shrink-0' : 'text-slate-500 shrink-0'}
            />
            <span className='font-mono text-10px truncate text-slate-400 group-hover:text-slate-200'>
              {rootCeo.workspacePath ? `Master: ${rootCeo.workspacePath}` : 'Set Master Folder (Required)'}
            </span>
          </div>
          <span className='text-9px text-cyan-400 font-mono shrink-0 ml-4px opacity-0 group-hover:opacity-100 transition-opacity'>
            Edit ›
          </span>
        </div>

        {/* Dispatch Task button */}
        <Button
          type='primary'
          size='small'
          icon={<Send size={12} theme='outline' />}
          className='!h-28px !rounded-8px !font-medium !text-11px !w-full !bg-cyan-600 hover:!bg-cyan-500 !border-none'
          onClick={(e) => {
            e.stopPropagation();
            onDispatchToCeo?.(rootCeo);
          }}
        >
          Dispatch Task to CEO
        </Button>
      </div>

      {/* Ticker / Status Bar */}
      <div className='px-12px py-5px bg-slate-950/60 border-t border-slate-800/80 text-9px font-mono text-slate-400 flex items-center justify-between'>
        <div className='flex items-center gap-6px truncate'>
          <span
            className='size-6px rounded-full shrink-0'
            style={{ backgroundColor: isWorking ? '#06B6D4' : theme.borderColor }}
          />
          <span className='truncate text-slate-300'>
            {isSimulating
              ? 'Autonomous delegation in flight'
              : isWorking
                ? 'Coordinating Organization'
                : 'Ready for directives'}
          </span>
        </div>
        <span className='text-slate-500 shrink-0'>
          {rootCeo.lastActiveAt
            ? new Date(rootCeo.lastActiveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'idle'}
        </span>
      </div>

      {/* React Flow Source Handle */}
      <Handle
        type='source'
        position={sourceHandlePos}
        className='!bg-cyan-400 !w-10px !h-10px !border-2 !border-slate-900 hover:!scale-125 transition-transform'
      />
    </div>
  );
};

function areRootCeoPropsEqual(
  prev: { data: RootCeoNodeData; selected?: boolean },
  next: { data: RootCeoNodeData; selected?: boolean }
): boolean {
  if (prev.selected !== next.selected) return false;
  const p = prev.data;
  const n = next.data;
  if (p.isDescendantWorking !== n.isDescendantWorking) return false;
  if (p.orientation !== n.orientation) return false;
  if (p.rootCeo !== n.rootCeo) return false;
  return true;
}

export default React.memo(RootCeoNode, areRootCeoPropsEqual);
