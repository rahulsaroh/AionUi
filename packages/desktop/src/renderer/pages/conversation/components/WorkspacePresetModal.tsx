/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Input, Message, Modal, Radio, Tag } from '@arco-design/web-react';
import { MagicWand } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import {
  WORKSPACE_OUTPUT_PRESETS,
  getWorkspacePreset,
  saveWorkspacePreset,
  type WorkspacePresetId,
} from '@/renderer/utils/workspace/workspacePresets';

type WorkspacePresetModalProps = {
  visible: boolean;
  workspace?: string;
  onClose: () => void;
  onSaved?: (presetId: WorkspacePresetId) => void;
};

export const WorkspacePresetModal: React.FC<WorkspacePresetModalProps> = ({ visible, workspace, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [presetId, setPresetId] = useState<WorkspacePresetId>('default');
  const [customInstructions, setCustomInstructions] = useState('');

  useEffect(() => {
    if (!visible) return;
    const saved = getWorkspacePreset(workspace);
    setPresetId(saved.presetId);
    setCustomInstructions(saved.customInstructions ?? '');
  }, [visible, workspace]);

  const handleSave = () => {
    saveWorkspacePreset(workspace, {
      presetId,
      customInstructions: presetId === 'custom' ? customInstructions : undefined,
    });
    Message.success(t('conversation.workspacePresetSaved', { defaultValue: 'Workspace output preset saved' }));
    onSaved?.(presetId);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      onOk={handleSave}
      okText={t('common.save', { defaultValue: 'Save' })}
      cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
      title={
        <div className='flex items-center gap-8px'>
          <MagicWand theme='outline' size='18' />
          <span>{t('conversation.workspacePresetTitle', { defaultValue: 'Workspace Output Preset' })}</span>
        </div>
      }
      className='w-[92vw] max-w-[580px]'
    >
      <div className='flex flex-col gap-12px'>
        <div className='flex items-center justify-between text-12px text-t-secondary'>
          <span>
            {t('conversation.workspacePresetDesc', {
              defaultValue: 'Choose a default output style for this workspace.',
            })}
          </span>
          {workspace && (
            <Tag size='small' color='arcoblue' className='max-w-[220px] truncate'>
              {workspace}
            </Tag>
          )}
        </div>

        <Radio.Group
          value={presetId}
          onChange={(val) => setPresetId(val as WorkspacePresetId)}
          className='flex flex-col gap-8px'
        >
          {WORKSPACE_OUTPUT_PRESETS.map((preset) => (
            <div
              key={preset.id}
              onClick={() => setPresetId(preset.id)}
              className={`p-10px rd-8px border cursor-pointer transition-colors ${
                presetId === preset.id ? 'border-primary-6 bg-primary-1/20' : 'border-border-1 bg-fill-1'
              }`}
            >
              <Radio value={preset.id}>
                <span className='font-600 text-13px text-t-primary'>{preset.label}</span>
              </Radio>
              <div className='text-12px text-t-secondary pl-24px mt-2px'>{preset.description}</div>
            </div>
          ))}
        </Radio.Group>

        {presetId === 'custom' && (
          <Input.TextArea
            value={customInstructions}
            onChange={setCustomInstructions}
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder={t('conversation.workspacePresetCustomPlaceholder', {
              defaultValue: 'Enter custom formatting, tone, or output rules...',
            })}
          />
        )}
      </div>
    </Modal>
  );
};

export default WorkspacePresetModal;
