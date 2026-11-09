/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Message, Alert } from '@arco-design/web-react';
import { FolderOpen, FolderClose, CheckOne, Info } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { useOrgStore } from '../store/useOrgStore';
import {
  getRecentWorkspaces,
  addRecentWorkspace,
  DEFAULT_RECENT_WS_KEY,
} from '@/renderer/components/workspace/recentWorkspaces';

interface OrgMasterFolderModalProps {
  visible: boolean;
  onClose: () => void;
  mandatory?: boolean;
}

export const OrgMasterFolderModal: React.FC<OrgMasterFolderModalProps> = ({ visible, onClose, mandatory = false }) => {
  const { t } = useTranslation();
  const { hierarchy, updateRootCeo } = useOrgStore();
  const currentMaster = hierarchy.rootCeo.workspacePath || '';

  const [selectedPath, setSelectedPath] = useState(currentMaster);
  const [loading, setLoading] = useState(false);
  const recentWorkspaces = getRecentWorkspaces(DEFAULT_RECENT_WS_KEY);

  useEffect(() => {
    if (visible) {
      setSelectedPath(hierarchy.rootCeo.workspacePath || '');
    }
  }, [visible, hierarchy.rootCeo.workspacePath]);

  const handleBrowseFolder = async () => {
    try {
      setLoading(true);
      const files = await ipcBridge.dialog.showOpen.invoke({
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: selectedPath || undefined,
      });
      if (files && files.length > 0 && files[0]) {
        setSelectedPath(files[0]);
      }
    } catch (err) {
      console.warn('[OrgMasterFolderModal] browse failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    const trimmed = selectedPath.trim();
    if (!trimmed) {
      Message.warning('Please select a master folder for the organization.');
      return;
    }

    updateRootCeo({ workspacePath: trimmed });
    addRecentWorkspace(trimmed);
    Message.success(`Master organization folder set to: ${trimmed}`);
    onClose();
  };

  return (
    <Modal
      title={
        <div className='flex items-center gap-8px text-15px font-bold'>
          <FolderClose size={20} className='text-amber-500' />
          <span>Organization Master Workspace Folder</span>
        </div>
      }
      visible={visible}
      onOk={handleConfirm}
      onCancel={() => {
        if (mandatory && !hierarchy.rootCeo.workspacePath) {
          Message.info('Note: AI bots require a master workspace folder before disk operations.');
        }
        onClose();
      }}
      okText={currentMaster ? 'Update Master Folder' : 'Set Master Folder'}
      cancelText={mandatory && !hierarchy.rootCeo.workspacePath ? 'Skip for now' : 'Cancel'}
      className='!max-w-560px'
      mountOnEnter={false}
      unmountOnExit={false}
    >
      <div className='flex flex-col gap-16px py-6px select-none'>
        <Alert
          type='info'
          showIcon
          content='Organization Mode organizes your entire AI company under a single master folder. All departments, teams, and projects will be structured within this master root.'
          className='!rounded-8px'
        />

        <div className='flex flex-col gap-6px'>
          <label className='text-12px font-medium text-t-primary flex items-center justify-between'>
            <span>Master Workspace Directory</span>
            {currentMaster ? (
              <span className='text-10px font-mono text-emerald-500 flex items-center gap-4px'>
                <CheckOne size={12} /> Currently Configured
              </span>
            ) : (
              <span className='text-10px font-mono text-amber-500'>Required for File Access</span>
            )}
          </label>

          <div className='flex items-center gap-8px'>
            <Input
              value={selectedPath}
              onChange={setSelectedPath}
              placeholder='Select or paste absolute folder path (e.g. C:\MyCompany or /Users/me/Org)...'
              className='flex-1 !text-12px !font-mono'
            />
            <Button
              type='primary'
              icon={<FolderOpen size={14} />}
              loading={loading}
              onClick={() => void handleBrowseFolder()}
              className='!rounded-8px !text-12px !px-12px shrink-0'
            >
              Browse
            </Button>
          </div>
        </div>

        {recentWorkspaces.length > 0 && (
          <div className='flex flex-col gap-6px'>
            <span className='text-11px font-mono text-t-tertiary uppercase tracking-wider'>Recent Directories</span>
            <div className='flex flex-col gap-4px max-h-120px overflow-y-auto pr-4px'>
              {recentWorkspaces.slice(0, 4).map((recent) => (
                <button
                  key={recent}
                  type='button'
                  onClick={() => setSelectedPath(recent)}
                  className={`text-left text-11px font-mono p-8px rounded-6px border transition-colors cursor-pointer truncate ${
                    selectedPath === recent
                      ? 'bg-primary/10 border-primary text-primary font-medium'
                      : 'bg-fill-1 border-[var(--color-border-2)] text-t-secondary hover:bg-fill-2'
                  }`}
                >
                  {recent}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className='p-12px rounded-8px bg-fill-2 border border-[var(--color-border-2)] flex flex-col gap-6px text-11px text-t-secondary'>
          <span className='font-semibold text-t-primary flex items-center gap-4px'>
            <Info size={13} className='text-primary' /> Automatic Subfolder Scaffolding:
          </span>
          <div className='font-mono text-10px flex flex-col gap-2px text-t-tertiary pl-16px'>
            <div>📁 [Master Folder] /</div>
            <div>&nbsp;&nbsp;├── 📁 departments / (Department specific codebases)</div>
            <div>&nbsp;&nbsp;└── 📁 projects / (Assigned project repositories)</div>
          </div>
          <span className='text-10px text-t-tertiary'>
            Subsequent department, team, and project folders will be verified against this master root to guarantee
            security and organization boundaries.
          </span>
        </div>
      </div>
    </Modal>
  );
};
