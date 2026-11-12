/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Modal, Input, Button, Message } from '@arco-design/web-react';
import { Upload, Refresh } from '@icon-park/react';
import { useOrgStore } from '../store/useOrgStore';
import { createDefaultOrgHierarchy } from '../utils/defaultOrgSeed';

type OrgSeedModalProps = {
  visible: boolean;
  onClose: () => void;
};

export const OrgSeedModal: React.FC<OrgSeedModalProps> = ({ visible, onClose }) => {
  const { hierarchy, resetToDefault } = useOrgStore();
  const [jsonContent, setJsonContent] = useState(() => JSON.stringify(hierarchy, null, 2));
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    try {
      const parsed = JSON.parse(jsonContent);
      if (!parsed || !parsed.rootCeo || !Array.isArray(parsed.departments)) {
        throw new Error('Seed JSON must include rootCeo and departments array.');
      }

      setImporting(true);
      localStorage.setItem('aionui:org-hierarchy', JSON.stringify(parsed));
      Message.success('Organization hierarchy seed loaded successfully!');
      window.location.reload();
      onClose();
    } catch (err) {
      Message.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const handleResetDefault = () => {
    if (
      !window.confirm(
        'Reset organization to default blank canvas (Root CEO only)? This will overwrite your current configuration.'
      )
    ) {
      return;
    }
    resetToDefault();
    setJsonContent(JSON.stringify(createDefaultOrgHierarchy(), null, 2));
    Message.success('Reset to blank canvas (Root CEO only).');
    onClose();
  };

  return (
    <Modal
      title={
        <div className='flex items-center gap-8px'>
          <Upload size={16} theme='outline' fill='currentColor' className='text-primary' />
          <span>Organization Corporate Hierarchy Seed</span>
        </div>
      }
      visible={visible}
      onOk={handleImport}
      onCancel={onClose}
      confirmLoading={importing}
      okText='Apply JSON Hierarchy'
      cancelText='Cancel'
      style={{ width: 620 }}
    >
      <div className='flex flex-col gap-10px'>
        <div className='text-12px text-t-secondary'>
          Configure or export the complete corporate hierarchy (Root CEO, Departments, Sub-Teams, Leaders, and
          Specialists).
        </div>
        <Input.TextArea rows={14} value={jsonContent} onChange={setJsonContent} className='font-mono text-11px' />
        <div className='flex justify-between items-center text-11px text-t-tertiary'>
          <Button size='small' type='secondary' icon={<Refresh size={12} />} onClick={handleResetDefault}>
            Reset to Blank Canvas
          </Button>
          <span>Valid JSON format</span>
        </div>
      </div>
    </Modal>
  );
};

export default OrgSeedModal;
