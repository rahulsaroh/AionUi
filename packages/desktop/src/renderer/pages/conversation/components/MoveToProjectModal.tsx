/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Checkbox, Input, Message, Radio, Select, Tooltip } from '@arco-design/web-react';
import { FolderClose, FolderOpen } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import AionModal from '@/renderer/components/base/AionModal';
import { addRecentWorkspace, getRecentWorkspaces } from '@/renderer/components/workspace';
import { emitter } from '@/renderer/utils/emitter';
import { getLastDirectoryName } from '@/renderer/utils/workspace/workspace';
import { updateWorkspaceTime } from '@/renderer/utils/workspace/workspaceHistory';
import type { WorkspaceGroup } from '../GroupedHistory/types';

export type MoveToProjectModalProps = {
  visible: boolean;
  conversations: TChatConversation[];
  projectGroups: WorkspaceGroup[];
  onCancel: () => void;
  onSuccess: () => void;
};

export const MoveToProjectModal: React.FC<MoveToProjectModalProps> = ({
  visible,
  conversations,
  projectGroups,
  onCancel,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('');
  const [customPath, setCustomPath] = useState<string>('');
  const [transferFiles, setTransferFiles] = useState<boolean>(true);
  const [transferMode, setTransferMode] = useState<'move' | 'copy'>('move');
  const [loading, setLoading] = useState<boolean>(false);

  // Collect unique existing projects from groups and recent workspaces
  const existingProjects = useMemo(() => {
    const map = new Map<string, { name: string; path: string }>();

    projectGroups.forEach((g) => {
      if (g.workspace) {
        map.set(g.workspace, { name: g.display_name, path: g.workspace });
      }
    });

    try {
      const recent = getRecentWorkspaces();
      recent.forEach((p) => {
        if (p && !map.has(p)) {
          map.set(p, { name: getLastDirectoryName(p), path: p });
        }
      });
    } catch {
      // Ignore recent workspaces errors
    }

    return Array.from(map.values());
  }, [projectGroups]);

  // Current workspace summary
  const currentWorkspaceInfo = useMemo(() => {
    if (!conversations.length) return '';
    const firstConv = conversations[0];
    const ws = firstConv.extra?.workspace;
    const isCustom = firstConv.extra?.custom_workspace;
    if (isCustom && ws) {
      return ws;
    }
    return t('conversation.history.temporaryWorkspace');
  }, [conversations, t]);

  const handleBrowseFolder = async () => {
    try {
      const paths = await ipcBridge.dialog.showOpen.invoke({
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: await ipcBridge.application.getPath.invoke({ name: 'home' }).catch((): undefined => undefined),
      });
      if (paths && paths.length > 0) {
        setCustomPath(paths[0]);
      }
    } catch (err) {
      console.error('Failed to open directory dialog:', err);
    }
  };

  const handleConfirmMove = async () => {
    const targetPath = mode === 'existing' ? selectedWorkspace.trim() : customPath.trim();

    if (!targetPath) {
      Message.warning(t('conversation.history.noFolderSelected'));
      return;
    }

    // Check if target is identical to source for all conversations
    const allSame = conversations.every(
      (c) => c.extra?.workspace && c.extra.workspace === targetPath && c.extra?.custom_workspace
    );
    if (allSame) {
      Message.warning(t('conversation.history.sameFolderWarning'));
      return;
    }

    setLoading(true);

    try {
      // Ensure target folder exists on disk via file transfer provider
      await ipcBridge.fs.transferWorkspaceFiles
        .invoke({
          sourcePath: targetPath,
          targetPath,
          operation: 'copy',
        })
        .catch(() => {});

      // Transfer data / files if requested
      if (transferFiles) {
        for (const conv of conversations) {
          const sourcePath = conv.extra?.workspace;
          if (sourcePath && sourcePath !== targetPath) {
            await ipcBridge.fs.transferWorkspaceFiles
              .invoke({
                sourcePath,
                targetPath,
                operation: transferMode,
              })
              .catch((err) => {
                console.warn('Failed to transfer workspace files:', err);
              });
          }
        }
      }

      // Find if target project has a known project_id
      const targetGroup = projectGroups.find((g) => g.workspace === targetPath);
      const targetProjectId = targetGroup?.conversations?.find((c) => c.project_id)?.project_id;

      // Update conversation records
      for (const conv of conversations) {
        await ipcBridge.conversation.update.invoke({
          id: conv.id,
          updates: {
            extra: {
              ...conv.extra,
              workspace: targetPath,
              custom_workspace: true,
            },
            ...(targetProjectId ? { project_id: targetProjectId } : {}),
          },
        });
      }

      // Add to recent workspaces and update workspace time
      addRecentWorkspace(targetPath);
      updateWorkspaceTime(targetPath);

      Message.success(t('conversation.history.moveToProjectSuccess'));
      emitter.emit('chat.history.refresh');
      onSuccess();
    } catch (err) {
      console.error('Failed to move conversation to project:', err);
      Message.error(t('conversation.history.moveToProjectFailed'));
    } finally {
      setLoading(false);
    }
  };

  const conversationCount = conversations.length;
  const singleTitle = conversationCount === 1 ? conversations[0]?.name || t('conversation.historySearch.untitled') : '';

  return (
    <AionModal
      visible={visible}
      onCancel={onCancel}
      header={{
        title: t('conversation.history.moveToProjectTitle'),
      }}
      footer={{
        render: () => (
          <div className='flex justify-end gap-8px'>
            <Button onClick={onCancel} disabled={loading}>
              {t('common.cancel')}
            </Button>
            <Button type='primary' loading={loading} onClick={handleConfirmMove}>
              {t('conversation.history.move')}
            </Button>
          </div>
        ),
      }}
      style={{ width: '480px' }}
    >
      <div className='flex flex-col gap-14px py-4px'>
        {/* Header Description */}
        <div className='text-13px text-t-secondary'>
          {conversationCount === 1 ? (
            <span>
              {t('conversation.history.moveToProjectDescSingle')}{' '}
              <strong className='text-t-primary truncate inline-block max-w-280px align-bottom'>{singleTitle}</strong>
            </span>
          ) : (
            <span>{t('conversation.history.moveToProjectDescBatch', { count: conversationCount })}</span>
          )}
        </div>

        {/* Current Location */}
        <div className='flex items-center gap-6px text-11px text-t-quaternary bg-fill-1 px-8px py-4px rounded-4px border border-border'>
          <FolderClose theme='outline' size='12' className='shrink-0' />
          <span className='shrink-0'>{t('conversation.history.currentLocation')}:</span>
          <span className='truncate font-mono' title={currentWorkspaceInfo}>
            {currentWorkspaceInfo}
          </span>
        </div>

        {/* Mode Selector */}
        <div className='flex flex-col gap-6px'>
          <label className='text-12px font-medium text-t-primary'>{t('conversation.history.targetProject')}</label>
          <Radio.Group
            type='button'
            value={mode}
            onChange={(val) => setMode(val as 'existing' | 'new')}
            className='w-full flex'
          >
            <Radio value='existing' className='flex-1 text-center justify-center'>
              {t('conversation.history.existingProject')}
            </Radio>
            <Radio value='new' className='flex-1 text-center justify-center'>
              {t('conversation.history.newProject')}
            </Radio>
          </Radio.Group>
        </div>

        {/* Existing Project Select */}
        {mode === 'existing' ? (
          <div className='flex flex-col gap-6px'>
            <Select
              placeholder={t('conversation.history.selectProjectPlaceholder')}
              value={selectedWorkspace}
              onChange={setSelectedWorkspace}
              showSearch
              filterOption={(inputValue, option) => {
                const optProps = (option as { props?: { value?: string } })?.props;
                const val = String(optProps?.value || '');
                return val.toLowerCase().includes(inputValue.toLowerCase());
              }}
            >
              {existingProjects.map((proj) => (
                <Select.Option key={proj.path} value={proj.path}>
                  <div className='flex flex-col py-1px'>
                    <span className='text-13px font-medium text-t-primary leading-tight'>{proj.name}</span>
                    <span className='text-11px text-t-quaternary truncate max-w-380px leading-tight' title={proj.path}>
                      {proj.path}
                    </span>
                  </div>
                </Select.Option>
              ))}
            </Select>
            {existingProjects.length === 0 && (
              <span className='text-11px text-t-quaternary'>{t('conversation.history.noExistingProjects')}</span>
            )}
          </div>
        ) : (
          /* New Project Folder Picker */
          <div className='flex flex-col gap-6px'>
            <div className='flex gap-8px'>
              <Input
                placeholder={t('conversation.history.projectFolderPlaceholder')}
                value={customPath}
                onChange={setCustomPath}
                className='flex-1'
                allowClear
              />
              <Tooltip content={t('conversation.history.browse')}>
                <Button type='secondary' icon={<FolderOpen theme='outline' size='14' />} onClick={handleBrowseFolder}>
                  {t('conversation.history.browse')}
                </Button>
              </Tooltip>
            </div>
            {customPath && (
              <span className='text-11px text-t-quaternary truncate'>
                {t('conversation.history.newProjectName')}: {getLastDirectoryName(customPath)}
              </span>
            )}
          </div>
        )}

        {/* Data & Files Transfer Settings */}
        <div className='border border-border rounded-8px p-12px bg-fill-2 flex flex-col gap-8px'>
          <Checkbox checked={transferFiles} onChange={setTransferFiles}>
            <span className='text-12px font-medium text-t-primary'>{t('conversation.history.transferFilesLabel')}</span>
          </Checkbox>
          <p className='text-11px text-t-quaternary ml-22px -mt-4px leading-normal'>
            {t('conversation.history.transferFilesDesc')}
          </p>
          {transferFiles && (
            <div className='ml-22px pt-4px'>
              <Radio.Group
                value={transferMode}
                onChange={(val) => setTransferMode(val as 'move' | 'copy')}
                direction='vertical'
                className='flex flex-col gap-6px'
              >
                <Radio value='move'>
                  <span className='text-12px text-t-secondary'>{t('conversation.history.operationMove')}</span>
                </Radio>
                <Radio value='copy'>
                  <span className='text-12px text-t-secondary'>{t('conversation.history.operationCopy')}</span>
                </Radio>
              </Radio.Group>
            </div>
          )}
        </div>
      </div>
    </AionModal>
  );
};
