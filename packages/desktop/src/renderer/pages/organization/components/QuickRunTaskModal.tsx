/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Modal, Input, Button, Message } from '@arco-design/web-react';
import { Play } from '@icon-park/react';
import { ipcBridge } from '@/common';
import type { TTeam } from '@/common/types/team/teamTypes';

type QuickRunTaskModalProps = {
  team: TTeam | null;
  visible: boolean;
  onClose: () => void;
};

export const QuickRunTaskModal: React.FC<QuickRunTaskModalProps> = ({ team, visible, onClose }) => {
  const [directive, setDirective] = useState('');
  const [loading, setLoading] = useState(false);

  if (!team) return null;

  const handleRun = async () => {
    if (!directive.trim()) return;
    setLoading(true);
    try {
      await ipcBridge.team.sendMessage.invoke({
        team_id: team.id,
        input: directive.trim(),
      });
      Message.success(`Task dispatched to ${team.name} Leader!`);
      setDirective('');
      onClose();
    } catch (err) {
      Message.error(`Failed to dispatch task: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <div className='flex items-center gap-8px'>
          <Play theme='outline' size={16} fill='currentColor' className='text-primary' />
          <span>Dispatch Directive to {team.name}</span>
        </div>
      }
      visible={visible}
      onOk={handleRun}
      onCancel={onClose}
      confirmLoading={loading}
      okText='Dispatch Task'
      cancelText='Cancel'
      style={{ width: 480 }}
      alignCenter
    >
      <div className='flex flex-col gap-12px'>
        <div className='text-12px text-t-secondary'>
          Direct command will be received by the Lead agent of this department and delegated to specialists as needed.
        </div>
        <Input.TextArea
          autoFocus
          rows={4}
          value={directive}
          onChange={setDirective}
          placeholder='e.g. Audit the mobile UI components and verify accessibility tokens...'
          onPressEnter={(e) => {
            if (e.ctrlKey || e.metaKey) {
              void handleRun();
            }
          }}
        />
        <div className='text-11px text-t-tertiary flex justify-between'>
          <span>Press Cmd/Ctrl + Enter to dispatch</span>
          <span>Department: {team.departmentRole || 'General'}</span>
        </div>
      </div>
    </Modal>
  );
};

export default QuickRunTaskModal;
