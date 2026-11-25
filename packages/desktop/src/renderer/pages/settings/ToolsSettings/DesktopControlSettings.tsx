/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Image,
  Input,
  Message,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from '@arco-design/web-react';
import { Caution, Computer, Delete, PreviewOpen, Refresh, Shield } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useDesktopControlStatus } from '@/renderer/components/desktopControl';
import type { DesktopAuditEntry, DesktopScreenshotResult } from '@/common/desktopControl';

const { Text, Paragraph } = Typography;

export const DesktopControlSettings: React.FC = () => {
  const { t } = useTranslation();
  const { status, auditLogs, updateConfig, emergencyStop, resume, clearAuditLogs, capturePreview, refresh } =
    useDesktopControlStatus();

  const [hotkeyInput, setHotkeyInput] = useState<string>('');
  const [previewShot, setPreviewShot] = useState<DesktopScreenshotResult | null>(null);
  const [capturing, setCapturing] = useState(false);

  const effectiveHotkey = hotkeyInput || status?.emergencyHotkey || 'CommandOrControl+Shift+X';

  const handleToggleEnabled = useCallback(
    async (enabled: boolean) => {
      const next = await updateConfig({ enabled });
      if (next) {
        Message.success(
          enabled
            ? t('settings.desktopControlSettings.enabledToast')
            : t('settings.desktopControlSettings.disabledToast')
        );
      }
    },
    [t, updateConfig]
  );

  const handleToggleConfirmation = useCallback(
    async (requireConfirmation: boolean) => {
      await updateConfig({ requireConfirmation });
    },
    [updateConfig]
  );

  const handleSaveHotkey = useCallback(async () => {
    const trimmed = effectiveHotkey.trim();
    if (!trimmed) return;
    const next = await updateConfig({ emergencyHotkey: trimmed });
    if (next) {
      setHotkeyInput('');
      Message.success(t('settings.desktopControlSettings.hotkeySavedToast'));
    }
  }, [effectiveHotkey, t, updateConfig]);

  const handleCapturePreview = useCallback(async () => {
    setCapturing(true);
    try {
      const shot = await capturePreview();
      if (shot) {
        setPreviewShot(shot);
      }
    } catch (err) {
      Message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCapturing(false);
    }
  }, [capturePreview]);

  if (!status) {
    return (
      <Card>
        <Text type='secondary'>{t('settings.desktopControlSettings.unavailableInWeb')}</Text>
      </Card>
    );
  }

  return (
    <div className='flex flex-col gap-16px py-8px'>
      {!status.supported && (
        <Alert
          type='warning'
          showIcon
          content={t('settings.desktopControlSettings.unsupportedPlatform', { platform: status.platform })}
        />
      )}

      {status.emergencyAborted && (
        <Alert
          type='error'
          showIcon
          title={t('settings.desktopControlSettings.emergencyActiveTitle')}
          content={t('settings.desktopControlSettings.emergencyActiveDesc')}
          action={
            <Button size='small' type='primary' onClick={() => void resume()}>
              {t('settings.desktopControlSettings.resumeButton')}
            </Button>
          }
        />
      )}

      <Card
        title={
          <Space>
            <Computer theme='outline' size='18' />
            <Text bold>{t('settings.desktopControlSettings.title')}</Text>
            <Tag color={status.enabled ? (status.emergencyAborted ? 'red' : 'green') : 'gray'} size='small'>
              {status.enabled
                ? status.emergencyAborted
                  ? t('settings.desktopControlSettings.statusPaused')
                  : t('settings.desktopControlSettings.statusEnabled')
                : t('settings.desktopControlSettings.statusDisabled')}
            </Tag>
          </Space>
        }
        extra={
          <Space>
            <Button
              size='small'
              icon={<PreviewOpen theme='outline' size='14' />}
              loading={capturing}
              disabled={!status.supported}
              onClick={() => void handleCapturePreview()}
            >
              {t('settings.desktopControlSettings.testScreenshot')}
            </Button>
            {status.enabled && !status.emergencyAborted && (
              <Button
                size='small'
                status='danger'
                icon={<Caution theme='outline' size='14' />}
                onClick={() => void emergencyStop()}
              >
                {t('settings.desktopControlSettings.emergencyStopButton')}
              </Button>
            )}
          </Space>
        }
      >
        <div className='flex flex-col gap-16px'>
          <Paragraph type='secondary' className='mb-0 text-12px'>
            {t('settings.desktopControlSettings.description')}
          </Paragraph>

          <div className='flex items-center justify-between p-12px bg-[var(--color-fill-2)] rounded border border-[var(--color-border-2)]'>
            <div className='flex flex-col gap-4px'>
              <Text bold className='text-13px'>
                {t('settings.desktopControlSettings.enableLabel')}
              </Text>
              <Text type='secondary' className='text-12px'>
                {t('settings.desktopControlSettings.enableDesc')}
              </Text>
            </div>
            <Switch
              checked={status.enabled}
              disabled={!status.supported}
              onChange={(val) => void handleToggleEnabled(val)}
            />
          </div>

          <div className='flex items-center justify-between p-12px bg-[var(--color-fill-2)] rounded border border-[var(--color-border-2)]'>
            <div className='flex flex-col gap-4px'>
              <Text bold className='text-13px'>
                {t('settings.desktopControlSettings.confirmLabel')}
              </Text>
              <Text type='secondary' className='text-12px'>
                {t('settings.desktopControlSettings.confirmDesc')}
              </Text>
            </div>
            <Switch
              checked={status.requireConfirmation}
              disabled={!status.supported}
              onChange={(val) => void handleToggleConfirmation(val)}
            />
          </div>

          <div className='flex items-center justify-between gap-12px p-12px bg-[var(--color-fill-2)] rounded border border-[var(--color-border-2)]'>
            <div className='flex flex-col gap-4px'>
              <Text bold className='text-13px'>
                {t('settings.desktopControlSettings.hotkeyLabel')}
              </Text>
              <Text type='secondary' className='text-12px'>
                {t('settings.desktopControlSettings.hotkeyDesc')}
              </Text>
            </div>
            <Space>
              <Input
                size='small'
                style={{ width: 220 }}
                value={effectiveHotkey}
                onChange={setHotkeyInput}
                placeholder='CommandOrControl+Shift+X'
              />
              <Button size='small' type='primary' onClick={() => void handleSaveHotkey()}>
                {t('common.save')}
              </Button>
            </Space>
          </div>
        </div>
      </Card>

      <Card
        title={
          <Space>
            <Shield theme='outline' size='18' />
            <Text bold>{t('settings.desktopControlSettings.auditTitle')}</Text>
          </Space>
        }
        extra={
          <Space>
            <Button size='small' icon={<Refresh theme='outline' size='14' />} onClick={() => void refresh()}>
              {t('settings.desktopControlSettings.refreshButton')}
            </Button>
            <Button
              size='small'
              status='danger'
              icon={<Delete theme='outline' size='14' />}
              onClick={() => void clearAuditLogs()}
            >
              {t('settings.desktopControlSettings.clearButton')}
            </Button>
          </Space>
        }
      >
        <Table
          data={auditLogs}
          rowKey='id'
          pagination={{ pageSize: 8, size: 'small' }}
          noDataElement={<Text type='secondary'>{t('settings.desktopControlSettings.auditEmpty')}</Text>}
          columns={[
            {
              title: t('settings.desktopControlSettings.colTime'),
              dataIndex: 'timestamp',
              width: 110,
              render: (val: number) => <Text className='text-12px'>{new Date(val).toLocaleTimeString()}</Text>,
            },
            {
              title: t('settings.desktopControlSettings.colTool'),
              dataIndex: 'tool',
              width: 170,
              render: (tool: string) => (
                <Text code className='text-12px'>
                  {tool}
                </Text>
              ),
            },
            {
              title: t('settings.desktopControlSettings.colSummary'),
              dataIndex: 'summary',
              render: (summary: string, row: DesktopAuditEntry) => (
                <div className='flex flex-col'>
                  <Text className='text-12px'>{summary}</Text>
                  {row.error && (
                    <Text type='error' className='text-11px'>
                      {row.error}
                    </Text>
                  )}
                </div>
              ),
            },
            {
              title: t('settings.desktopControlSettings.colStatus'),
              dataIndex: 'status',
              width: 100,
              render: (st: DesktopAuditEntry['status']) => {
                const color = st === 'success' ? 'green' : st === 'blocked' ? 'orange' : 'red';
                return (
                  <Tag color={color} size='small'>
                    {st}
                  </Tag>
                );
              },
            },
          ]}
        />
      </Card>

      <Modal
        visible={Boolean(previewShot)}
        title={t('settings.desktopControlSettings.previewModalTitle')}
        footer={null}
        onCancel={() => setPreviewShot(null)}
        style={{ width: '80vw', maxWidth: 920 }}
      >
        {previewShot && (
          <div className='flex flex-col gap-8px items-center'>
            <Text type='secondary' className='text-12px'>
              {`${previewShot.width}×${previewShot.height}px (scale ${previewShot.scaleFactor}x)`}
            </Text>
            <Image
              src={`data:${previewShot.mimeType};base64,${previewShot.base64}`}
              alt='Desktop Screenshot Preview'
              style={{ maxWidth: '100%', maxHeight: '70vh' }}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};
