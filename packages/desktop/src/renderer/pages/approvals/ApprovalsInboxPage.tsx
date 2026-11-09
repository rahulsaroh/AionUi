/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Button, Checkbox, Empty, Tag, Typography, Card, Space, Drawer, Table, Message } from '@arco-design/web-react';
import {
  CheckOne,
  CloseOne,
  History,
  Peoples,
  Robot,
  Terminal,
  FileCode,
  Thunderbolt,
  Time,
  Filter,
} from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useApprovalsInbox, type InboxApprovalItem, useAuditLogs } from '@/common/autonomy';

const { Title, Text, Paragraph } = Typography;

export const ApprovalsInboxPage: React.FC = () => {
  const { t } = useTranslation();
  const { items, pendingCount, approve, deny, approveAlways, batchApprove, batchDeny } = useApprovalsInbox();
  const auditLogs = useAuditLogs();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filterTeam, setFilterTeam] = useState<string>('all');
  const [auditDrawerVisible, setAuditDrawerVisible] = useState<boolean>(false);
  const [processing, setProcessing] = useState<boolean>(false);

  // Filter items by team if selected
  const filteredItems = useMemo(() => {
    if (filterTeam === 'all') return items;
    return items.filter((i) => i.teamId === filterTeam || (!i.teamId && filterTeam === 'solo'));
  }, [items, filterTeam]);

  // Unique teams for filter dropdown
  const uniqueTeams = useMemo(() => {
    const teams = new Map<string, string>();
    for (const item of items) {
      if (item.teamId) {
        teams.set(item.teamId, item.teamName || item.teamId);
      }
    }
    return Array.from(teams.entries());
  }, [items]);

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIds(filteredItems.map((i) => i.id));
      } else {
        setSelectedIds([]);
      }
    },
    [filteredItems]
  );

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, []);

  const handleBatchApprove = useCallback(async () => {
    const selected = items.filter((i) => selectedIds.includes(i.id));
    if (selected.length === 0) return;
    setProcessing(true);
    try {
      await batchApprove(selected);
      setSelectedIds([]);
      Message.success(t('approvals.batchApproveSuccess', { defaultValue: 'Approved selected items' }));
    } finally {
      setProcessing(false);
    }
  }, [items, selectedIds, batchApprove, t]);

  const handleBatchDeny = useCallback(async () => {
    const selected = items.filter((i) => selectedIds.includes(i.id));
    if (selected.length === 0) return;
    setProcessing(true);
    try {
      await batchDeny(selected);
      setSelectedIds([]);
      Message.info(t('approvals.batchDenySuccess', { defaultValue: 'Denied selected items' }));
    } finally {
      setProcessing(false);
    }
  }, [items, selectedIds, batchDeny, t]);

  const handleSingleApprove = useCallback(
    async (item: InboxApprovalItem) => {
      setProcessing(true);
      try {
        await approve(item);
        setSelectedIds((prev) => prev.filter((id) => id !== item.id));
        Message.success(t('approvals.approved', { defaultValue: 'Action approved' }));
      } finally {
        setProcessing(false);
      }
    },
    [approve, t]
  );

  const handleSingleDeny = useCallback(
    async (item: InboxApprovalItem) => {
      setProcessing(true);
      try {
        await deny(item);
        setSelectedIds((prev) => prev.filter((id) => id !== item.id));
        Message.info(t('approvals.denied', { defaultValue: 'Action denied' }));
      } finally {
        setProcessing(false);
      }
    },
    [deny, t]
  );

  const handleSingleApproveAlways = useCallback(
    async (item: InboxApprovalItem) => {
      setProcessing(true);
      try {
        await approveAlways(item);
        setSelectedIds((prev) => prev.filter((id) => id !== item.id));
        Message.success(
          t('approvals.approvedAlways', {
            defaultValue: 'Action approved and saved rule for this project',
          })
        );
      } finally {
        setProcessing(false);
      }
    },
    [approveAlways, t]
  );

  const isAllSelected = filteredItems.length > 0 && selectedIds.length === filteredItems.length;

  return (
    <div className='flex flex-col h-full w-full bg-bg-1 overflow-y-auto p-24px' data-testid='approvals-inbox-page'>
      {/* Header */}
      <div className='flex items-center justify-between pb-16px border-b border-border-1 mb-20px'>
        <div className='flex items-center gap-12px'>
          <Title heading={4} style={{ margin: 0 }}>
            {t('approvals.inboxTitle', { defaultValue: 'Approvals Inbox' })}
          </Title>
          {pendingCount > 0 && (
            <Tag color='red' className='font-semibold' data-testid='inbox-pending-badge'>
              {t('approvals.pendingCount', { count: pendingCount, defaultValue: `${pendingCount} Pending` })}
            </Tag>
          )}
        </div>

        <div className='flex items-center gap-12px'>
          <Button
            icon={<History />}
            type='secondary'
            size='small'
            onClick={() => setAuditDrawerVisible(true)}
            data-testid='btn-view-audit-log'
          >
            {t('approvals.auditLog', { defaultValue: 'Audit Log' })}
          </Button>

          {selectedIds.length > 0 && (
            <Space>
              <Button
                type='primary'
                status='success'
                size='small'
                icon={<CheckOne />}
                loading={processing}
                onClick={handleBatchApprove}
                data-testid='btn-batch-approve'
              >
                {t('approvals.batchApprove', { defaultValue: `Approve Selected (${selectedIds.length})` })}
              </Button>
              <Button
                type='primary'
                status='danger'
                size='small'
                icon={<CloseOne />}
                loading={processing}
                onClick={handleBatchDeny}
                data-testid='btn-batch-deny'
              >
                {t('approvals.batchDeny', { defaultValue: `Deny Selected (${selectedIds.length})` })}
              </Button>
            </Space>
          )}
        </div>
      </div>

      {/* Filter and Bulk Action Bar */}
      {items.length > 0 && (
        <div className='flex items-center justify-between py-10px px-16px bg-fill-2 rd-8px mb-16px'>
          <div className='flex items-center gap-12px'>
            <Checkbox
              checked={isAllSelected}
              indeterminate={selectedIds.length > 0 && !isAllSelected}
              onChange={handleSelectAll}
              data-testid='checkbox-select-all'
            >
              <span className='text-13px text-t-secondary'>
                {t('approvals.selectAll', { defaultValue: 'Select All' })}
              </span>
            </Checkbox>
          </div>

          {uniqueTeams.length > 0 && (
            <div className='flex items-center gap-8px'>
              <Filter size='14' className='text-t-secondary' />
              <Button
                size='mini'
                type={filterTeam === 'all' ? 'primary' : 'secondary'}
                onClick={() => setFilterTeam('all')}
              >
                {t('approvals.allTeams', { defaultValue: 'All' })}
              </Button>
              {uniqueTeams.map(([tId, tName]) => (
                <Button
                  key={tId}
                  size='mini'
                  type={filterTeam === tId ? 'primary' : 'secondary'}
                  onClick={() => setFilterTeam(tId)}
                  data-testid={`filter-team-${tId}`}
                >
                  {tName}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Items List */}
      {filteredItems.length === 0 ? (
        <div className='flex-1 flex items-center justify-center py-60px'>
          <Empty
            description={t('approvals.emptyInbox', {
              defaultValue: 'No pending approvals across any conversation, team or run.',
            })}
          />
        </div>
      ) : (
        <div className='flex flex-col gap-12px'>
          {filteredItems.map((item) => {
            const isSelected = selectedIds.includes(item.id);
            return (
              <Card
                key={item.id}
                data-testid={`approval-item-${item.id}`}
                className='border border-border-2 hover:border-primary transition-colors rd-8px shadow-sm'
              >
                <div className='flex items-start gap-16px'>
                  <Checkbox
                    checked={isSelected}
                    onChange={() => handleToggleSelect(item.id)}
                    className='mt-2px'
                    data-testid={`checkbox-item-${item.id}`}
                  />

                  <div className='flex-1 flex flex-col gap-8px'>
                    {/* Header line: Badges & Team info */}
                    <div className='flex items-center justify-between flex-wrap gap-8px'>
                      <div className='flex items-center gap-8px flex-wrap'>
                        {item.teamName && (
                          <Tag color='arcoblue' size='small' icon={<Peoples />}>
                            {item.teamName}
                          </Tag>
                        )}
                        {item.agentName && (
                          <Tag color='cyan' size='small' icon={<Robot />}>
                            {item.agentName}
                          </Tag>
                        )}
                        {item.isHeadless && (
                          <Tag color='orange' size='small' icon={<Time />}>
                            {t('approvals.headlessBadge', { defaultValue: 'Headless Task' })}
                          </Tag>
                        )}
                        <Text className='font-semibold text-15px text-t-primary'>{item.title}</Text>
                      </div>

                      {item.expiresAt && (
                        <Text type='secondary' className='text-12px'>
                          {t('approvals.expiresIn', {
                            defaultValue: `Expires in ${Math.max(0, Math.round((item.expiresAt - Date.now()) / 60000))} min`,
                          })}
                        </Text>
                      )}
                    </div>

                    {/* Description */}
                    {item.description && (
                      <Paragraph type='secondary' className='text-13px m-0'>
                        {item.description}
                      </Paragraph>
                    )}

                    {/* Command preview */}
                    {item.command && (
                      <div className='bg-fill-3 p-8px rd-6px font-mono text-12px flex items-center gap-6px overflow-x-auto'>
                        <Terminal size='14' className='shrink-0 text-t-secondary' />
                        <code>{item.command}</code>
                      </div>
                    )}

                    {/* Diff preview */}
                    {item.diffPreview && (
                      <div className='bg-fill-3 p-8px rd-6px font-mono text-12px overflow-x-auto'>
                        <div className='flex items-center gap-6px mb-4px text-t-secondary'>
                          <FileCode size='14' />
                          <span>{t('approvals.diffPreview', { defaultValue: 'File Diff' })}</span>
                        </div>
                        <pre className='m-0 whitespace-pre-wrap'>{item.diffPreview}</pre>
                      </div>
                    )}

                    {/* Publish preview card */}
                    {item.publishPreview && (
                      <div
                        className='bg-fill-2 p-12px rd-8px border border-border-2 flex flex-col gap-8px'
                        data-testid={`publish-preview-${item.id}`}
                      >
                        <div className='flex items-center justify-between'>
                          <Tag color='arcoblue' size='small'>
                            {item.publishPreview.platform.toUpperCase()}
                          </Tag>
                          {item.publishPreview.contentHash && (
                            <Text type='secondary' className='text-11px font-mono'>
                              Hash: {item.publishPreview.contentHash.slice(0, 10)}...
                            </Text>
                          )}
                        </div>
                        <Text className='font-semibold text-14px text-t-primary'>{item.publishPreview.title}</Text>
                        {item.publishPreview.description && (
                          <Paragraph type='secondary' className='text-12px m-0'>
                            {item.publishPreview.description}
                          </Paragraph>
                        )}
                        {item.publishPreview.thumbnailUrl && (
                          <div className='rd-6px overflow-hidden max-h-180px flex justify-center bg-black/10'>
                            <img
                              src={item.publishPreview.thumbnailUrl}
                              alt='Thumbnail preview'
                              className='object-cover max-h-180px rd-4px'
                              data-testid='publish-preview-thumbnail'
                            />
                          </div>
                        )}
                        {item.publishPreview.videoUrl && (
                          <div className='rd-6px overflow-hidden max-h-240px bg-black'>
                            <video
                              controls
                              src={item.publishPreview.videoUrl}
                              className='w-full max-h-240px'
                              data-testid='publish-preview-video'
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className='flex items-center justify-end gap-10px pt-8px border-t border-border-1 mt-6px'>
                      <Button
                        size='small'
                        type='outline'
                        status='success'
                        icon={<CheckOne />}
                        disabled={processing}
                        onClick={() => handleSingleApprove(item)}
                        data-testid={`btn-approve-${item.id}`}
                      >
                        {t('approvals.approve', { defaultValue: 'Approve' })}
                      </Button>
                      <Button
                        size='small'
                        type='outline'
                        status='danger'
                        icon={<CloseOne />}
                        disabled={processing}
                        onClick={() => handleSingleDeny(item)}
                        data-testid={`btn-deny-${item.id}`}
                      >
                        {t('approvals.deny', { defaultValue: 'Deny' })}
                      </Button>
                      <Button
                        size='small'
                        type='secondary'
                        icon={<Thunderbolt />}
                        disabled={processing}
                        onClick={() => handleSingleApproveAlways(item)}
                        data-testid={`btn-approve-always-${item.id}`}
                      >
                        {t('approvals.approveAlways', { defaultValue: 'Always Allow in Project' })}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Audit Log Drawer */}
      <Drawer
        width={680}
        title={t('approvals.auditLogDrawerTitle', { defaultValue: 'Approval Decision Audit Trail' })}
        visible={auditDrawerVisible}
        onOk={() => setAuditDrawerVisible(false)}
        onCancel={() => setAuditDrawerVisible(false)}
        footer={null}
      >
        <Table
          data={auditLogs}
          rowKey='id'
          pagination={{ pageSize: 15 }}
          columns={[
            {
              title: t('approvals.auditTime', { defaultValue: 'Time' }),
              dataIndex: 'createdAt',
              render: (ts: number) => new Date(ts).toLocaleTimeString(),
              width: 100,
            },
            {
              title: t('approvals.auditDecision', { defaultValue: 'Decision' }),
              dataIndex: 'decision',
              render: (dec: string) => {
                const color = dec === 'approved' ? 'green' : dec === 'denied' ? 'red' : 'gray';
                return <Tag color={color}>{dec.toUpperCase()}</Tag>;
              },
              width: 100,
            },
            {
              title: t('approvals.auditChannel', { defaultValue: 'Channel' }),
              dataIndex: 'channel',
              render: (ch: string) => <Tag color='arcoblue'>{ch}</Tag>,
              width: 110,
            },
            {
              title: t('approvals.auditAction', { defaultValue: 'Action' }),
              dataIndex: 'action',
              render: (act: string, r) => (
                <div>
                  <div className='font-semibold text-13px'>{act}</div>
                  {r.details && <div className='text-12px text-t-secondary font-mono'>{r.details}</div>}
                </div>
              ),
            },
            {
              title: t('approvals.auditBy', { defaultValue: 'By' }),
              dataIndex: 'decisionBy',
              width: 90,
            },
          ]}
        />
      </Drawer>
    </div>
  );
};

export default ApprovalsInboxPage;
