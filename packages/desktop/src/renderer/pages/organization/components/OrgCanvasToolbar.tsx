/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import { Button, Tooltip, Dropdown, Menu, Message } from '@arco-design/web-react';
import {
  FullScreen,
  Plus,
  NetworkTree,
  Lightning,
  Refresh,
  Upload,
  FolderPlus,
  MessageOne,
  Play,
} from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useOrgStore } from '../store/useOrgStore';
import type { OrgNodeStatus } from '@/types/organization';

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
  const {
    hierarchy,
    nodeStatuses,
    updateNodeStatus,
    runSimulation,
    isSimulating,
    simulationStep,
    simulationMessage,
    resetToDefault,
    setOrgViewMode,
    activeFilter,
    setActiveFilter,
  } = useOrgStore();

  const handleSimulateStatus = useCallback(
    (status: OrgNodeStatus, targetShared = false) => {
      // Find all specialist members across teams
      const allSpecialists = hierarchy.departments.flatMap((d) =>
        d.teams.flatMap((t) => t.specialistMembers.map((m) => ({ member: m, teamId: t.id, deptName: d.name })))
      );

      if (allSpecialists.length === 0) {
        Message.warning('No specialist members found in hierarchy to simulate.');
        return;
      }

      let target = allSpecialists[0];
      if (targetShared) {
        // Find one appearing in multiple teams
        const counts: Record<string, number> = {};
        allSpecialists.forEach((s) => {
          counts[s.member.canonicalAgentId] = (counts[s.member.canonicalAgentId] || 0) + 1;
        });
        const sharedTarget = allSpecialists.find((s) => counts[s.member.canonicalAgentId] > 1);
        if (sharedTarget) {
          target = sharedTarget;
        }
      }

      const memberId = target.member.id;
      const canonicalId = target.member.canonicalAgentId;
      const memberName = target.member.name;

      updateNodeStatus(memberId, status);
      if (canonicalId && canonicalId !== memberId) {
        updateNodeStatus(canonicalId, status);
      }
      Message.info(`Simulated "${status}" on ${memberName} (${target.deptName})`);

      // If recently_finished, return to idle after 2s
      if (status === 'recently_finished') {
        setTimeout(() => {
          updateNodeStatus(memberId, 'idle');
          if (canonicalId && canonicalId !== memberId) {
            updateNodeStatus(canonicalId, 'idle');
          }
          Message.success(`${memberName} completed task, returned to idle`);
        }, 2000);
      }
    },
    [hierarchy, updateNodeStatus]
  );

  const handleClearAllSimulation = useCallback(() => {
    Object.keys(nodeStatuses).forEach((id) => {
      updateNodeStatus(id, 'idle');
    });
    Message.success('Cleared all simulated statuses. All members idle.');
  }, [nodeStatuses, updateNodeStatus]);

  const simulationMenu = (
    <Menu className='!bg-slate-900 !border-slate-700 !text-slate-200 text-11px'>
      <Menu.Item key='work-single' onClick={() => handleSimulateStatus('working', false)}>
        <span className='flex items-center gap-6px'>
          <span className='size-6px rounded-full bg-emerald-400 animate-ping' />
          <span>Simulate Working (Pulsing Glow)</span>
        </span>
      </Menu.Item>
      <Menu.Item key='work-shared' onClick={() => handleSimulateStatus('working', true)}>
        <span className='flex items-center gap-6px'>
          <span className='size-6px rounded-full bg-indigo-400 animate-ping' />
          <span>Simulate Shared Working (Multi-Team Glow)</span>
        </span>
      </Menu.Item>
      <Menu.Item key='queued' onClick={() => handleSimulateStatus('queued_next', false)}>
        <span className='flex items-center gap-6px'>
          <span className='size-6px rounded-full bg-amber-400' />
          <span>Simulate Queued (Amber Pulse)</span>
        </span>
      </Menu.Item>
      <Menu.Item key='error' onClick={() => handleSimulateStatus('error', false)}>
        <span className='flex items-center gap-6px'>
          <span className='size-6px rounded-full bg-rose-500' />
          <span>Simulate Error (Static Red Glow)</span>
        </span>
      </Menu.Item>
      <Menu.Item key='finished' onClick={() => handleSimulateStatus('recently_finished', false)}>
        <span className='flex items-center gap-6px'>
          <span className='size-6px rounded-full bg-teal-400' />
          <span>Simulate Finished (Green Flash 2s)</span>
        </span>
      </Menu.Item>
      <Menu.Item key='clear' onClick={handleClearAllSimulation} className='border-t border-slate-700'>
        <span className='flex items-center gap-6px text-slate-400 hover:text-slate-200'>
          <Refresh size={11} />
          <span>Clear / Reset All to Idle</span>
        </span>
      </Menu.Item>
    </Menu>
  );

  return (
    <div className='absolute bottom-20px left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-8px select-none pointer-events-auto'>
      <div className='flex flex-wrap items-center gap-6px bg-[var(--color-bg-2)]/95 backdrop-blur-md px-12px py-8px rounded-12px border border-solid border-[var(--color-border-2)] shadow-2xl max-w-[calc(100vw-260px)]'>
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
          <span className='size-22px rounded-6px bg-primary-light-1 text-primary flex items-center justify-center'>
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

        {/* Canvas Filter Chips: All / Active / Dormant / Shared */}
        <div className='flex items-center gap-2px bg-fill-2 p-2px rounded-8px border border-[var(--color-border-2)]'>
          {(['all', 'active', 'dormant', 'shared'] as const).map((filterKey) => {
            const isSelected = activeFilter === filterKey;
            return (
              <button
                key={filterKey}
                type='button'
                onClick={() => setActiveFilter(filterKey)}
                className={`px-8px py-3px rounded-6px text-11px font-medium capitalize transition-all border-none cursor-pointer select-none ${
                  isSelected
                    ? '!bg-primary !text-white shadow-xs font-semibold'
                    : '!bg-transparent !text-t-secondary hover:!text-t-primary hover:!bg-fill-3'
                }`}
              >
                {filterKey}
              </button>
            );
          })}
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

        {/* Dev Status Simulation Control (Gated to development builds only) */}
        <div className='flex items-center gap-6px'>
          {import.meta.env.DEV && (
            <Dropdown droplist={simulationMenu} position='top'>
              <Button
                size='small'
                type='outline'
                className='text-12px !text-cyan-400 !border-cyan-500/50 hover:!bg-cyan-950/40 font-mono'
                icon={<Lightning size={13} theme='outline' />}
              >
                Simulate Glow
              </Button>
            </Dropdown>
          )}

          <Tooltip content='Demo autonomous delegation flow' position='bottom'>
            <Button
              size='small'
              type='primary'
              loading={isSimulating}
              className='!bg-emerald-600 hover:!bg-emerald-500 !border-none !font-medium !text-12px shadow-sm'
              icon={<Play size={12} theme='outline' />}
              onClick={() => void runSimulation()}
            >
              {isSimulating ? `Step ${simulationStep}/4...` : 'Demo Tour'}
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
              Reset
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
