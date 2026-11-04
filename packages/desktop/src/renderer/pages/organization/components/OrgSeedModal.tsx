/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Modal, Input, Button, Message } from '@arco-design/web-react';
import { Upload } from '@icon-park/react';
import { ipcBridge } from '@/common';
import { useSWRConfig } from 'swr';

type OrgSeedModalProps = {
  visible: boolean;
  onClose: () => void;
};

const DEFAULT_SAMPLE_SEED = JSON.stringify(
  [
    {
      name: 'Global Enterprise HQ',
      departmentRole: 'Corporate Leadership',
      description: 'Central executive command steering corporate operations.',
      assistants: [
        {
          assistant_name: 'CEO Orchestrator',
          assistant_backend: 'claude',
          role: 'leader',
          whenToUseHint: 'Strategic orchestration and division governance',
        },
        {
          assistant_name: 'Chief Architect',
          assistant_backend: 'claude',
          role: 'teammate',
          whenToUseHint: 'System-wide architecture and tech alignment',
        },
      ],
    },
    {
      name: 'Engineering Division',
      departmentRole: 'Software & Infrastructure',
      description: 'Product engineering, platform infrastructure, and QA.',
      parentName: 'Global Enterprise HQ',
      assistants: [
        {
          assistant_name: 'VP of Engineering',
          assistant_backend: 'claude',
          role: 'leader',
          whenToUseHint: 'Engineering sprint tracking and delegation',
        },
        {
          assistant_name: 'DevOps Lead',
          assistant_backend: 'claude',
          role: 'teammate',
          whenToUseHint: 'CI/CD and deployment pipelines',
        },
      ],
    },
    {
      name: 'Frontend Core Sub-Team',
      departmentRole: 'UI/UX & Web Client',
      description: 'React, Electron, UnoCSS, and visual design implementation.',
      parentName: 'Engineering Division',
      assistants: [
        {
          assistant_name: 'Frontend Lead',
          assistant_backend: 'claude',
          role: 'leader',
          whenToUseHint: 'Component development and layout styling',
        },
        {
          assistant_name: 'UI Designer Agent',
          assistant_backend: 'claude',
          role: 'teammate',
          whenToUseHint: 'Design tokens and accessibility compliance',
        },
      ],
    },
  ],
  null,
  2
);

export const OrgSeedModal: React.FC<OrgSeedModalProps> = ({ visible, onClose }) => {
  const [jsonContent, setJsonContent] = useState(DEFAULT_SAMPLE_SEED);
  const [importing, setImporting] = useState(false);
  const { mutate } = useSWRConfig();

  const handleImport = async () => {
    try {
      const parsed = JSON.parse(jsonContent);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('Seed JSON must be a non-empty array of department objects.');
      }

      setImporting(true);
      const nameToIdMap = new Map<string, string>();

      for (const item of parsed) {
        const parentId = item.parentName ? nameToIdMap.get(item.parentName) : item.parentId || null;

        const assistants = (item.assistants || [
          {
            assistant_name: `${item.name} Lead`,
            assistant_backend: 'claude',
            role: 'leader',
          },
        ]).map((a: any, idx: number) => ({
          slot_id: `slot-${Date.now()}-${idx}`,
          conversation_id: '',
          role: a.role || (idx === 0 ? 'leader' : 'teammate'),
          assistant_backend: a.assistant_backend || 'claude',
          assistant_name: a.assistant_name || `Agent ${idx + 1}`,
          status: 'idle',
          whenToUseHint: a.whenToUseHint || 'Department task execution',
          context_reset: { supported: true, availability: 'ready' },
        }));

        const newTeam = await ipcBridge.team.create.invoke({
          name: item.name,
          workspace: item.workspace || '',
          workspace_mode: 'shared',
          leader_assistant_id: '',
          assistants,
          parentId,
          departmentRole: item.departmentRole || 'General Department',
          description: item.description || '',
        });

        if (newTeam?.id) {
          nameToIdMap.set(item.name, newTeam.id);
        }
      }

      Message.success('Organization hierarchy seed imported successfully!');
      void mutate('teams:list');
      onClose();
    } catch (err) {
      Message.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      title={
        <div className='flex items-center gap-8px'>
          <Upload size={16} theme='outline' fill='currentColor' className='text-primary' />
          <span>Import Organization Seed JSON</span>
        </div>
      }
      visible={visible}
      onOk={handleImport}
      onCancel={onClose}
      confirmLoading={importing}
      okText='Import & Generate Org Tree'
      cancelText='Cancel'
      style={{ width: 560 }}
    >
      <div className='flex flex-col gap-10px'>
        <div className='text-12px text-t-secondary'>
          Paste or edit an enterprise hierarchical JSON tree. Departments referencing a parent will be nested automatically.
        </div>
        <Input.TextArea
          rows={12}
          value={jsonContent}
          onChange={setJsonContent}
          className='font-mono text-11px'
        />
        <div className='flex justify-between items-center text-11px text-t-tertiary'>
          <Button size='mini' type='text' onClick={() => setJsonContent(DEFAULT_SAMPLE_SEED)}>
            Reset to Sample Corporate Hierarchy
          </Button>
          <span>Valid JSON required</span>
        </div>
      </div>
    </Modal>
  );
};

export default OrgSeedModal;
