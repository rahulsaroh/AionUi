/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Modal, Button, Tag, Typography, Checkbox, Space, Alert } from '@arco-design/web-react';
import { Shield, CheckOne, CloseOne, Lock } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { SafetyGateRequest } from '@/common/browser/safetyTypes';
import type { BrowserSessionHealthEvent } from '@/common/browser/types';

const { Paragraph, Text } = Typography;

export type UnifiedApprovalRequest = {
  id: string;
  isSensitiveService?: boolean;
  actionType: string;
  title: string;
  profileName?: string;
  details: {
    platform?: string;
    caption?: string;
    mediaPath?: string;
    summary?: string;
    reason?: string;
  };
};

export const SafetyApprovalModal: React.FC = () => {
  const { t } = useTranslation();
  const [currentRequest, setCurrentRequest] = useState<UnifiedApprovalRequest | null>(null);
  const [rememberChoice, setRememberChoice] = useState(false);
  const [reloginEvent, setReloginEvent] = useState<BrowserSessionHealthEvent | null>(null);

  useEffect(() => {
    const unsubList: Array<() => void> = [];

    if (window.electronAPI?.onBrowserSafetyApprovalRequest) {
      const unsub = window.electronAPI.onBrowserSafetyApprovalRequest((req: unknown) => {
        const safetyReq = req as SafetyGateRequest;
        setCurrentRequest({
          id: safetyReq.id,
          isSensitiveService: false,
          actionType: safetyReq.actionType,
          title: safetyReq.title,
          details: safetyReq.details || {},
        });
        setRememberChoice(false);
      });
      unsubList.push(unsub);
    }

    if (window.electronAPI?.onBrowserSensitiveApprovalRequest) {
      const unsub = window.electronAPI.onBrowserSensitiveApprovalRequest((req: unknown) => {
        const sensitiveReq = req as {
          id: string;
          category: string;
          summary: string;
          profileName?: string;
          confirmation?: { title?: string; description?: string };
        };
        setCurrentRequest({
          id: sensitiveReq.id,
          isSensitiveService: true,
          actionType: sensitiveReq.category,
          title: sensitiveReq.confirmation?.title || `Approval Required: ${sensitiveReq.category}`,
          profileName: sensitiveReq.profileName,
          details: {
            summary: sensitiveReq.summary,
            reason: sensitiveReq.confirmation?.description,
          },
        });
        setRememberChoice(false);
      });
      unsubList.push(unsub);
    }

    if (window.electronAPI?.onBrowserReloginNeeded) {
      const unsub = window.electronAPI.onBrowserReloginNeeded((evt: BrowserSessionHealthEvent) => {
        setReloginEvent(evt);
      });
      unsubList.push(unsub);
    }

    return () => {
      for (const unsub of unsubList) unsub();
    };
  }, []);

  const handleRespond = (approved: boolean) => {
    if (!currentRequest) return;
    if (currentRequest.isSensitiveService && window.electronAPI?.browserRespondSensitiveApproval) {
      window.electronAPI.browserRespondSensitiveApproval({
        id: currentRequest.id,
        approved,
      });
    } else if (window.electronAPI?.browserRespondSafetyApproval) {
      window.electronAPI.browserRespondSafetyApproval({
        requestId: currentRequest.id,
        approved,
        rememberChoice,
      });
    }
    setCurrentRequest(null);
  };

  const handleOpenRelogin = () => {
    if (!reloginEvent) return;
    if (window.electronAPI?.browserNavigate) {
      window.electronAPI.browserNavigate(reloginEvent.url);
    }
  };

  const handleDismissRelogin = () => {
    if (!reloginEvent) return;
    if (window.electronAPI?.browserMarkSessionHealthy) {
      window.electronAPI.browserMarkSessionHealthy(reloginEvent.profileId);
    }
    setReloginEvent(null);
  };

  const getActionColor = (action: string) => {
    switch (action.toLowerCase()) {
      case 'publish':
        return 'orange';
      case 'send':
        return 'blue';
      case 'delete':
        return 'red';
      case 'spend':
      case 'payment':
        return 'gold';
      case 'settings_change':
        return 'purple';
      default:
        return 'arcoblue';
    }
  };

  return (
    <>
      {/* 1. Sensitive Action Approval Modal */}
      {currentRequest && (
        <Modal
          visible={Boolean(currentRequest)}
          title={
            <Space align='center'>
              <Shield theme='filled' size='18' fill='#FF7D00' />
              <span>{t('conversation.browser.safetyGateTitle', 'Action Approval Required')}</span>
              <Tag color={getActionColor(currentRequest.actionType)} size='small'>
                {currentRequest.actionType.toUpperCase()}
              </Tag>
              {currentRequest.profileName && (
                <Tag size='small' color='cyan'>
                  Profile: {currentRequest.profileName}
                </Tag>
              )}
            </Space>
          }
          onCancel={() => handleRespond(false)}
          footer={
            <div className='flex items-center justify-between w-full'>
              {!currentRequest.isSensitiveService ? (
                <Checkbox checked={rememberChoice} onChange={setRememberChoice}>
                  <Text type='secondary' className='text-xs'>
                    {t('conversation.browser.safetyRemember', 'Remember choice')}
                  </Text>
                </Checkbox>
              ) : (
                <div />
              )}
              <Space>
                <Button type='secondary' status='default' icon={<CloseOne />} onClick={() => handleRespond(false)}>
                  {t('conversation.browser.safetyReject', 'Deny')}
                </Button>
                <Button type='primary' status='warning' icon={<CheckOne />} onClick={() => handleRespond(true)}>
                  {t('conversation.browser.safetyApprove', 'Allow')}
                </Button>
              </Space>
            </div>
          }
        >
          <div className='flex flex-col gap-3 py-2'>
            <Paragraph type='secondary' className='mb-2 text-xs'>
              {t(
                'conversation.browser.safetyGateDesc',
                'This action has been classified as sensitive and requires approval before proceeding.'
              )}
            </Paragraph>

            <div className='p-3 bg-[var(--color-fill-2)] rounded border border-[var(--color-border-2)] flex flex-col gap-2'>
              <div className='flex items-center justify-between'>
                <Text bold>{currentRequest.title}</Text>
              </div>

              {currentRequest.details.summary && (
                <div className='flex flex-col gap-1'>
                  <Text type='secondary' className='text-xs'>
                    Target:
                  </Text>
                  <Text className='text-xs font-mono break-all'>{currentRequest.details.summary}</Text>
                </div>
              )}

              {currentRequest.details.reason && (
                <div className='flex flex-col gap-1'>
                  <Text type='secondary' className='text-xs'>
                    Reason:
                  </Text>
                  <Text className='text-xs'>{currentRequest.details.reason}</Text>
                </div>
              )}

              {currentRequest.details.platform && (
                <div className='flex items-center gap-2'>
                  <Text type='secondary' className='text-xs'>
                    Platform:
                  </Text>
                  <Tag size='small'>{currentRequest.details.platform}</Tag>
                </div>
              )}

              {currentRequest.details.caption && (
                <div className='flex flex-col gap-1'>
                  <Text type='secondary' className='text-xs'>
                    Caption:
                  </Text>
                  <div className='p-2 bg-[var(--color-bg-2)] rounded text-xs whitespace-pre-wrap max-h-32 overflow-y-auto border border-[var(--color-border-1)]'>
                    {currentRequest.details.caption}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* 2. Re-login Needed Modal / Banner */}
      {reloginEvent && (
        <Modal
          visible={Boolean(reloginEvent)}
          title={
            <Space align='center'>
              <Lock theme='filled' size='18' fill='#F53F3F' />
              <span>Re-login needed</span>
            </Space>
          }
          onCancel={handleDismissRelogin}
          footer={
            <Space>
              <Button onClick={handleDismissRelogin}>Dismiss</Button>
              <Button type='primary' status='danger' onClick={handleOpenRelogin}>
                Open Profile to Log In
              </Button>
            </Space>
          }
        >
          <div className='flex flex-col gap-3 py-2'>
            <Alert
              type='warning'
              title='Authentication Expired'
              content={`Logged-out state detected for profile "${reloginEvent.profileId}". Automation run is paused (not failed) until re-login is complete.`}
            />
            <div className='p-3 bg-[var(--color-fill-2)] rounded border border-[var(--color-border-2)] text-xs flex flex-col gap-1'>
              <div>
                <Text type='secondary'>Reason: </Text>
                <Text bold>{reloginEvent.reason || 'Login page encountered'}</Text>
              </div>
              <div>
                <Text type='secondary'>URL: </Text>
                <Text code className='break-all'>
                  {reloginEvent.url}
                </Text>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};
