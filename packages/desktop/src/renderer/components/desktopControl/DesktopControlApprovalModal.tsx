/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Message, Modal, Space, Tag, Typography } from '@arco-design/web-react';
import { Shield } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { DesktopApprovalRequest } from '@/common/desktopControl';

const { Text, Paragraph } = Typography;

export const DesktopControlApprovalModal: React.FC = () => {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<DesktopApprovalRequest[]>([]);

  useEffect(() => {
    const unsubApproval = window.electronAPI?.onDesktopControlApprovalRequested?.((req) => {
      setQueue((prev) => [...prev, req]);
    });

    const unsubStop = window.electronAPI?.onDesktopControlEmergencyStopped?.(() => {
      setQueue([]);
      Message.warning(t('settings.desktopControlSettings.emergencyStoppedToast'));
    });

    return () => {
      unsubApproval?.();
      unsubStop?.();
    };
  }, [t]);

  const active = queue[0] ?? null;

  const handleDecision = useCallback(
    async (approved: boolean) => {
      if (!active) return;
      setQueue((prev) => prev.slice(1));
      await window.electronAPI?.desktopControlRespondApproval?.({ id: active.id, approved });
    },
    [active]
  );

  return (
    <Modal
      visible={Boolean(active)}
      title={
        <Space>
          <Shield theme='outline' size='18' />
          <span>{t('settings.desktopControlSettings.approvalModalTitle')}</span>
        </Space>
      }
      okText={t('settings.desktopControlSettings.approvalAllow')}
      cancelText={t('settings.desktopControlSettings.approvalDeny')}
      onOk={() => void handleDecision(true)}
      onCancel={() => void handleDecision(false)}
      maskClosable={false}
    >
      {active && (
        <div className='flex flex-col gap-12px'>
          <div className='flex items-center gap-8px'>
            <Tag color='orange'>{active.tool}</Tag>
            <Text bold>{active.summary}</Text>
          </div>
          <Paragraph className='mb-0 text-t-secondary text-12px break-all'>{active.details}</Paragraph>
        </div>
      )}
    </Modal>
  );
};
