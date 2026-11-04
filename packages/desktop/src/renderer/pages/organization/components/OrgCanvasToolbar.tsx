/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Tooltip, Dropdown, Menu } from '@arco-design/web-react';
import { Down, Right, Plus, NetworkTree, FullScreen, Upload, MoreOne } from '@icon-park/react';

type OrgCanvasToolbarProps = {
  direction: 'TB' | 'LR';
  onToggleDirection: () => void;
  onFitView: () => void;
  onToggleExpandAll: () => void;
  isAllExpanded: boolean;
  onNewRootDepartment: () => void;
  onOpenSeedModal: () => void;
};

export const OrgCanvasToolbar: React.FC<OrgCanvasToolbarProps> = ({
  direction,
  onToggleDirection,
  onFitView,
  onToggleExpandAll,
  isAllExpanded,
  onNewRootDepartment,
  onOpenSeedModal,
}) => {
  return (
    <div className='absolute top-16px left-16px z-10 flex items-center gap-6px bg-[var(--color-bg-2)]/90 backdrop-blur-md px-12px py-8px rounded-10px border border-solid border-[var(--color-border-2)] shadow-xl select-none'>
      <div className='flex items-center gap-6px pr-8px border-r border-[var(--color-border-2)]'>
        <span className='size-20px rounded-4px bg-primary/10 text-primary flex items-center justify-center'>
          <NetworkTree size={14} theme='outline' fill='currentColor' />
        </span>
        <span className='font-semibold text-13px text-t-primary'>Organization Canvas</span>
      </div>

      <Tooltip content={direction === 'TB' ? 'Switch to Horizontal (LR)' : 'Switch to Vertical (TB)'} position='bottom'>
        <Button size='small' type='secondary' onClick={onToggleDirection} className='text-12px'>
          {direction === 'TB' ? 'Vertical (TB)' : 'Horizontal (LR)'}
        </Button>
      </Tooltip>

      <Tooltip content='Fit All Departments to Viewport' position='bottom'>
        <Button size='small' type='secondary' icon={<FullScreen size={14} />} onClick={onFitView}>
          Fit View
        </Button>
      </Tooltip>

      <Tooltip content={isAllExpanded ? 'Collapse All Sub-Branches' : 'Expand All Sub-Branches'} position='bottom'>
        <Button size='small' type='secondary' onClick={onToggleExpandAll}>
          {isAllExpanded ? 'Collapse All' : 'Expand All'}
        </Button>
      </Tooltip>

      <Tooltip content='Create New Root Department / HQ' position='bottom'>
        <Button size='small' type='primary' icon={<Plus size={14} />} onClick={onNewRootDepartment}>
          New Root HQ
        </Button>
      </Tooltip>

      <Tooltip content='Import Org Seed Template JSON' position='bottom'>
        <Button size='small' type='outline' icon={<Upload size={14} />} onClick={onOpenSeedModal}>
          Import Seed JSON
        </Button>
      </Tooltip>
    </div>
  );
};

export default React.memo(OrgCanvasToolbar);
