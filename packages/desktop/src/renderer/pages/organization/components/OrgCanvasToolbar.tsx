/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import { FullScreen, Plus, NetworkTree, Lightning, Refresh, Upload, FolderPlus, MessageOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useOrgStore } from '../store/useOrgStore';

type OrgCanvasToolbarProps = {
  direction: 'TB' | 'LR';
  onToggleDirection: () => void;
  onFitView: () => void;
  onToggleExpandAll: () => void;
  isAllExpanded: boolean;
  onNewRootDepartment: () => void;
  onNewProject: () => void;
  onOpenSeedModal: () => void;
};

export const OrgCanvasToolbar: React.FC<OrgCanvasToolbarProps> = ({
  direction,
  onToggleDirection,
  onFitView,
  onToggleExpandAll,
  isAllExpanded,
  onNewRootDepartment,
  onNewProject,
  onOpenSeedModal,
}) => {
  const { t } = useTranslation();
  const { runSimulation, isSimulating, simulationStep, simulationMessage, resetToDefault, setOrgViewMode } =
    useOrgStore();

  return (
    <div className='absolute top-16px left-16px z-20 flex flex-col gap-8px select-none pointer-events-auto'>
      <div className='flex flex-wrap items-center gap-6px bg-[var(--color-bg-2)]/95 backdrop-blur-md px-12px py-8px rounded-12px border border-solid border-[var(--color-border-2)] shadow-xl max-w-[calc(100vw-260px)]'>
        {/* Back to Chat button */}
        <Button
          size='small'
          type='primary'
          icon={<MessageOne size={13} theme='outline' />}
          onClick={() => setOrgViewMode('chat')}
          className='text-12px font-medium'
        >
          💬 Chat View
        </Button>

        <div className='h-16px w-1px bg-[var(--color-border-2)] mx-2px' />

        {/* View controls */}
        <div className='flex items-center gap-6px pr-8px border-r border-[var(--color-border-2)]'>
          <span className='size-22px rounded-6px bg-primary/10 text-primary flex items-center justify-center'>
            <NetworkTree size={14} theme='outline' fill='currentColor' />
          </span>
          <span className='font-bold text-13px text-t-primary'>2D Org Command Center</span>
        </div>

        <div className='flex items-center gap-6px'>
          <Tooltip
            content={direction === 'TB' ? 'Switch to Horizontal (LR)' : 'Switch to Vertical (TB)'}
            position='bottom'
          >
            <Button size='small' type='secondary' onClick={onToggleDirection} className='text-12px'>
              {direction === 'TB' ? 'Vertical (TB)' : 'Horizontal (LR)'}
            </Button>
          </Tooltip>

          <Tooltip content='Fit Viewport to content' position='bottom'>
            <Button size='small' type='secondary' icon={<FullScreen size={13} />} onClick={onFitView}>
              Fit View
            </Button>
          </Tooltip>

          <Tooltip content={isAllExpanded ? 'Collapse All Branches' : 'Expand All Branches'} position='bottom'>
            <Button size='small' type='secondary' onClick={onToggleExpandAll} className='text-12px'>
              {isAllExpanded ? 'Collapse All' : 'Expand All'}
            </Button>
          </Tooltip>
        </div>

        <div className='h-16px w-1px bg-[var(--color-border-2)] mx-2px' />

        {/* Organization actions */}
        <div className='flex items-center gap-6px pr-8px border-r border-[var(--color-border-2)]'>
          <Tooltip content={t('team.organization.addDepartment', { defaultValue: 'Add Department' })} position='bottom'>
            <Button size='small' type='outline' icon={<Plus size={13} />} onClick={onNewRootDepartment}>
              {t('team.organization.addDepartment', { defaultValue: 'Add Department' })}
            </Button>
          </Tooltip>

          <Tooltip content={t('team.organization.addProject', { defaultValue: 'Add Project' })} position='bottom'>
            <Button size='small' type='outline' icon={<FolderPlus size={13} />} onClick={onNewProject}>
              {t('team.organization.addProject', { defaultValue: 'Add Project' })}
            </Button>
          </Tooltip>

          <Tooltip content='Import / Export Org Seed JSON' position='bottom'>
            <Button size='small' type='text' icon={<Upload size={13} />} onClick={onOpenSeedModal} />
          </Tooltip>
        </div>

        <div className='h-16px w-1px bg-[var(--color-border-2)] mx-2px' />

        {/* Simulation & reset */}
        <div className='flex items-center gap-6px'>
          <Tooltip content='Demo animation of simulated delegation across hierarchy' position='bottom'>
            <Button
              size='small'
              type='primary'
              loading={isSimulating}
              className='!bg-emerald-600 hover:!bg-emerald-500 !border-none !font-medium !text-12px shadow-sm'
              icon={<Lightning size={13} theme='outline' />}
              onClick={() => void runSimulation()}
            >
              {isSimulating ? `Step ${simulationStep}/4...` : 'Demo animation'}
            </Button>
          </Tooltip>

          <Tooltip content='Clear organization data and return to a blank canvas' position='bottom'>
            <Button
              size='small'
              type='secondary'
              icon={<Refresh size={13} />}
              onClick={() => {
                if (
                  !window.confirm(
                    'Are you sure you want to reset the organization to a blank canvas (Root CEO only)? All departments and custom projects will be reset.'
                  )
                )
                  return;
                resetToDefault();
                setTimeout(onFitView, 100);
              }}
              className='text-12px'
            >
              Reset to Blank Canvas
            </Button>
          </Tooltip>
        </div>
      </div>

      {isSimulating && (
        <div className='flex items-center gap-8px px-12px py-6px rounded-8px bg-slate-900/90 border border-emerald-500/50 shadow-lg backdrop-blur-md animate-fade-in'>
          <span className='size-8px rounded-full bg-emerald-400 animate-ping' />
          <span className='text-11px font-mono text-emerald-200 font-medium'>{simulationMessage}</span>
        </div>
      )}
    </div>
  );
};

export default React.memo(OrgCanvasToolbar);
