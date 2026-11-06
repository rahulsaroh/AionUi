/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Input, Message, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { OrgDepartmentNode } from '@/types/organization';
import { useOrgStore } from '../store/useOrgStore';

type Props = {
  visible: boolean;
  department: OrgDepartmentNode | null;
  onClose: () => void;
};

export const OrgDepartmentModal: React.FC<Props> = ({ visible, department, onClose }) => {
  const { t } = useTranslation();
  const { updateDepartment } = useOrgStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!visible || !department) return;
    setName(department.name);
    setDescription(department.description ?? '');
  }, [visible, department]);

  const handleSave = () => {
    if (!department || !name.trim()) return;
    updateDepartment(department.id, {
      name: name.trim(),
      description: description.trim() || undefined,
    });
    Message.success(t('team.organization.departmentSaved', { defaultValue: 'Department saved' }));
    onClose();
  };

  return (
    <Modal
      title={t('team.organization.editDepartment', { defaultValue: 'Edit Department' })}
      visible={visible}
      onCancel={onClose}
      onOk={handleSave}
      okButtonProps={{ disabled: !name.trim() }}
      okText={t('team.organization.save', { defaultValue: 'Save' })}
      cancelText={t('team.organization.cancel', { defaultValue: 'Cancel' })}
    >
      <div className='flex flex-col gap-10px'>
        <div className='flex flex-col gap-4px'>
          <span className='text-12px text-t-secondary'>
            {t('team.organization.departmentName', { defaultValue: 'Department name' })}
          </span>
          <Input value={name} onChange={setName} autoFocus />
        </div>
        <div className='flex flex-col gap-4px'>
          <span className='text-12px text-t-secondary'>
            {t('team.organization.description', { defaultValue: 'Description' })}
          </span>
          <Input.TextArea value={description} onChange={setDescription} rows={3} />
        </div>
      </div>
    </Modal>
  );
};

export default React.memo(OrgDepartmentModal);
