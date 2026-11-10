/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Card, Button, Tag, Typography, Space, Empty, Message } from '@arco-design/web-react';
import { SunOne, CheckOne, CloseOne, Refresh, Send, FileCode, Left } from '@icon-park/react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLatestDigest, generateMorningDigest, saveLatestDigest, deliverDigest } from '@/common/digest';
import { useApprovalsInbox } from '@/common/autonomy';

const { Title, Text } = Typography;

export const TodayPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { digest, refresh } = useLatestDigest();
  const { items: pendingApprovals, approve, deny } = useApprovalsInbox();

  // If no stored digest, generate on the fly
  const currentDigest = useMemo(() => {
    return digest ?? generateMorningDigest();
  }, [digest]);

  const handleRefreshDigest = () => {
    const fresh = generateMorningDigest();
    saveLatestDigest(fresh);
    refresh();
    Message.success(t('today.refreshed', { defaultValue: 'Daily digest updated' }));
  };

  const handleDeliverToChannels = async () => {
    const res = await deliverDigest(currentDigest);
    Message.success(
      t('today.delivered', {
        defaultValue: `Delivered to: ${res.deliveredChannels.join(', ')}`,
      })
    );
  };

  return (
    <div className='p-20px max-w-1000px mx-auto flex flex-col gap-16px'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-12px'>
          <Button icon={<Left size={16} />} size='small' onClick={() => navigate(-1)} />
          <div className='flex items-center gap-8px'>
            <SunOne size={24} className='text-orange-500' />
            <Title heading={4} style={{ margin: 0 }}>
              {t('today.title', { defaultValue: `Today — Morning Digest (${currentDigest.dateString})` })}
            </Title>
          </div>
        </div>

        <Space>
          <Button icon={<Refresh size={14} />} onClick={handleRefreshDigest}>
            {t('today.refresh', { defaultValue: 'Refresh Digest' })}
          </Button>
          <Button type='primary' icon={<Send size={14} />} onClick={handleDeliverToChannels}>
            {t('today.deliverChannels', { defaultValue: 'Send to Channels' })}
          </Button>
        </Space>
      </div>

      {/* 24h Summary Cards */}
      <div className='grid grid-cols-2 md:grid-cols-4 gap-12px'>
        <Card className='rounded-12px shadow-sm border-t-3 border-t-green-500'>
          <Text type='secondary'>Runs Completed</Text>
          <div className='text-24px font-bold text-green-600 mt-4px'>{currentDigest.runs.completed}</div>
        </Card>
        <Card className='rounded-12px shadow-sm border-t-3 border-t-red-500'>
          <Text type='secondary'>Runs Failed</Text>
          <div className='text-24px font-bold text-red-600 mt-4px'>{currentDigest.runs.failed}</div>
        </Card>
        <Card className='rounded-12px shadow-sm border-t-3 border-t-blue-500'>
          <Text type='secondary'>Waiting / In-Progress</Text>
          <div className='text-24px font-bold text-blue-600 mt-4px'>{currentDigest.runs.waiting}</div>
        </Card>
        <Card className='rounded-12px shadow-sm border-t-3 border-t-primary'>
          <Text type='secondary'>24h Spend</Text>
          <div className='text-24px font-bold text-primary mt-4px'>{currentDigest.spend.costText}</div>
        </Card>
      </div>

      {/* Outputs Produced Section */}
      <Card
        title={
          <Space>
            <FileCode size={16} />
            <Text bold>Outputs Produced ({currentDigest.outputs.length})</Text>
          </Space>
        }
        className='rounded-12px shadow-sm'
      >
        {currentDigest.outputs.length === 0 ? (
          <Empty description='No outputs produced in the last 24 hours.' />
        ) : (
          <div className='flex flex-col gap-8px'>
            {currentDigest.outputs.map((out) => (
              <div
                key={out.id}
                className='p-10px border border-[var(--color-border-2)] rounded-8px flex justify-between items-center hover:bg-fill-2 transition-colors'
              >
                <div className='flex items-center gap-8px'>
                  <Tag color='arcoblue'>{out.type}</Tag>
                  <Text bold>{out.title}</Text>
                </div>
                <Button size='small' type='text' onClick={() => (window.location.hash = out.link.replace('#', ''))}>
                  View Output
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Items Needing Approval Section */}
      <Card
        title={
          <Space>
            <CheckOne size={16} />
            <Text bold>Items Needing My Approval ({pendingApprovals.length})</Text>
          </Space>
        }
        className='rounded-12px shadow-sm'
        extra={
          <Button size='small' type='text' onClick={() => navigate('/approvals')}>
            Go to Approvals Inbox
          </Button>
        }
      >
        {pendingApprovals.length === 0 ? (
          <div className='p-12px text-center text-t-tertiary'>
            All clear! No items currently waiting for your approval.
          </div>
        ) : (
          <div className='flex flex-col gap-8px'>
            {pendingApprovals.map((item) => (
              <div
                key={item.id}
                className='p-12px border border-[var(--color-border-2)] rounded-8px flex justify-between items-center'
              >
                <div className='flex flex-col gap-4px min-w-0'>
                  <div className='flex items-center gap-6px'>
                    <Text bold className='text-14px'>
                      {item.title}
                    </Text>
                    {item.teamName && <Tag size='small'>{item.teamName}</Tag>}
                    {item.agentName && (
                      <Tag size='small' color='cyan'>
                        {item.agentName}
                      </Tag>
                    )}
                  </div>
                  {item.command && (
                    <Text code className='text-12px truncate max-w-500px'>
                      {item.command}
                    </Text>
                  )}
                  {item.description && (
                    <Text type='secondary' className='text-12px'>
                      {item.description}
                    </Text>
                  )}
                </div>

                <Space>
                  <Button
                    size='small'
                    type='primary'
                    status='success'
                    icon={<CheckOne size={12} />}
                    onClick={() => {
                      approve(item);
                      Message.success('Approved');
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    size='small'
                    status='danger'
                    icon={<CloseOne size={12} />}
                    onClick={() => {
                      deny(item);
                      Message.info('Denied');
                    }}
                  >
                    Deny
                  </Button>
                </Space>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default TodayPage;
