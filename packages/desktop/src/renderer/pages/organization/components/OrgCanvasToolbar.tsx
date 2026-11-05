/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import {
  FullScreen,
  Plus,
  NetworkTree,
  Lightning,
  Refresh,
  Upload,
} from '@icon-park/react';
import { useOrgStore } from '../store/useOrgStore';

interface OrgCanvasToolbarProps {
  direction: 'TB' | 'LR';
  onToggleDirection: () => void;
  onFitView: () => void;
  onToggleExpandAll: () => void;
  isAllExpanded: boolean;
  onNewRootDepartment: () => void;
  onOpenSeedModal: () => void;
}

export const OrgCanvasToolbar: React.FC<OrgCanvasToolbarProps> = ({
  direction,
  onToggleDirection,
  onFitView,
  onToggleExpandAll,
  isAllExpanded,
  onNewRootDepartment,
  onOpenSeedModal,
}) => {
  const { runSimulation, isSimulating, simulationStep, simulationMessage, resetToDefault } =
    useOrgStore();

  return (
    <div className='absolute top-16px left-16px z-20 flex flex-col gap-8px select-none pointer-events-auto'>
      <div className='flex items-center gap-6px bg-[var(--color-bg-2)]/95 backdrop-blur-md px-12px py-8px rounded-12px border border-solid border-[var(--color-border-2)] shadow-xl'>
        <div className='flex items-center gap-6px pr-8px border-r border-[var(--color-border-2)]'>
          <span className='size-22px rounded-6px bg-primary/10 text-primary flex items-center justify-center'>
            <NetworkTree size={14} theme='outline' fill='currentColor' />
          </span>
          <span className='font-bold text-13px text-t-primary'>2D Org Command Center</span>
        </div>

        <Tooltip content={direction === 'TB' ? 'Switch to Horizontal (LR)' : 'Switch to Vertical (TB)'} position='bottom'>
          <Button size='small' type='secondary' onClick={onToggleDirection} className='text-12px'>
            {direction === 'TB' ? 'Vertical (TB)' : 'Horizontal (LR)'}
          </Button>
        </Tooltip>

        <Tooltip content='Fit Viewport' position='bottom'>
          <Button size='small' type='secondary' icon={<FullScreen size={13} />} onClick={onFitView}>
            Fit View
          </Button>
        </Tooltip>

        <Tooltip content={isAllExpanded ? 'Collapse All Branches' : 'Expand All Branches'} position='bottom'>
          <Button size='small' type='secondary' onClick={onToggleExpandAll} className='text-12px'>
            {isAllExpanded ? 'Collapse All' : 'Expand All'}
          </Button>
        </Tooltip>

        <div className='h-16px w-1px bg-[var(--color-border-2)] mx-2px' />

        {/* Simulate CEO Delegation Button */}
        <Tooltip content='Run live 6-step top-down delegation simulation with telemetry glows' position='bottom'>
          <Button
            size='small'
            type='primary'
            loading={isSimulating}
            className='!bg-emerald-600 hover:!bg-emerald-500 !border-none !font-medium !text-12px shadow-sm'
            icon={<Lightning size={13} theme='outline' />}
            onClick={() => void runSimulation()}
          >
            {isSimulating ? `Step ${simulationStep}/6...` : '⚡ Simulate CEO Delegation'}
          </Button>
        </Tooltip>

        {/* Reset / Load Default Organization */}
        <Tooltip content='Reset & Load default 5-department corporate hierarchy with pre-seeded teams' position='bottom'>
          <Button
            size='small'
            type='secondary'
            icon={<Refresh size={13} />}
            onClick={() => {
              resetToDefault();
              setTimeout(onFitView, 100);
            }}
            className='text-12px'
          >
            Reset Default Org
          </Button>
        </Tooltip>

        <Tooltip content='Add New Department' position='bottom'>
          <Button size='small' type='outline' icon={<Plus size={13} />} onClick={onNewRootDepartment}>
            Add Dept
          </Button>
        </Tooltip>

        <Tooltip content='Import / Export Org Seed JSON' position='bottom'>
          <Button size='small' type='text' icon={<Upload size={13} />} onClick={onOpenSeedModal} />
        </Tooltip>
      </div>

      {/* Live Simulation Banner */}
      {isSimulating && (
        <div className='flex items-center gap-8px px-12px py-6px rounded-8px bg-slate-900/90 border border-emerald-500/50 shadow-lg backdrop-blur-md animate-fade-in'>
          <span className='size-8px rounded-full bg-emerald-400 animate-ping' />
          <span className='text-11px font-mono text-emerald-200 font-medium'>
            {simulationMessage}
          </span>
        </div>
      )}
    </div>
  );
};

export default React.memo(OrgCanvasToolbar);
