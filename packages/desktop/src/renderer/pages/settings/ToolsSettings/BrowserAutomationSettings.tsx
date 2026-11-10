/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Typography,
  Space,
  Button,
  Tag,
  Switch,
  InputNumber,
  Modal,
  Form,
  Input,
  Select,
  Popconfirm,
  Message,
  Table,
  Checkbox,
  Image,
} from '@arco-design/web-react';
import {
  BrowserChrome,
  Delete,
  Plus,
  Shield,
  FolderDownload,
  ShareSys,
  Refresh,
  FileText,
  PreviewOpen,
} from '@icon-park/react';
import { useBrowserProfiles } from '@/renderer/pages/conversation/hooks/useBrowserProfiles';
import type { SafetyActionType } from '@/common/browser/safetyTypes';
import type { BrowserAuditEntry } from '@/common/browser/types';

const { Text, Paragraph } = Typography;
const FormItem = Form.Item;

export const BrowserAutomationSettings: React.FC = () => {
  const { profiles, activeProfile, switchProfile, createProfile, deleteProfile, clearProfileData } =
    useBrowserProfiles();

  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [form] = Form.useForm();

  // Safety Gate settings state
  const [autoApprovePublish, setAutoApprovePublish] = useState(false);
  const [autoApproveSend, setAutoApproveSend] = useState(false);
  const [autoApproveDelete, setAutoApproveDelete] = useState(false);
  const [autoApproveSpend, setAutoApproveSpend] = useState(false);

  // Social Rate Limiting state
  const [dailyCap, setDailyCap] = useState(10);
  const [todayIgCount, setTodayIgCount] = useState(0);
  const [todayFbCount, setTodayFbCount] = useState(0);

  // Audit Logs & Retention state
  const [auditLogs, setAuditLogs] = useState<BrowserAuditEntry[]>([]);
  const [retentionDays, setRetentionDays] = useState(30);
  const [auditProfileFilter, setAuditProfileFilter] = useState<string>('all');
  const [auditSensitiveOnly, setAuditSensitiveOnly] = useState(false);
  const [previewScreenshot, setPreviewScreenshot] = useState<string | null>(null);

  const loadAuditLogs = useCallback(async () => {
    if (!window.electronAPI?.browserGetAuditLogs) return;
    try {
      const res = await window.electronAPI.browserGetAuditLogs({
        profileId: auditProfileFilter === 'all' ? undefined : auditProfileFilter,
        sensitiveOnly: auditSensitiveOnly ? true : undefined,
        limit: 100,
      });
      if (res?.success && Array.isArray(res.data)) {
        setAuditLogs(res.data);
      }
    } catch {
      // Ignored
    }
  }, [auditProfileFilter, auditSensitiveOnly]);

  useEffect(() => {
    // Load safety auto-approve settings from bridge
    const loadSettings = async () => {
      if (window.electronAPI?.browserGetSafetyAutoApprove) {
        const pub = await window.electronAPI.browserGetSafetyAutoApprove('publish');
        if (pub.success) setAutoApprovePublish(Boolean(pub.data));

        const snd = await window.electronAPI.browserGetSafetyAutoApprove('send');
        if (snd.success) setAutoApproveSend(Boolean(snd.data));

        const del = await window.electronAPI.browserGetSafetyAutoApprove('delete');
        if (del.success) setAutoApproveDelete(Boolean(del.data));

        const spd = await window.electronAPI.browserGetSafetyAutoApprove('spend');
        if (spd.success) setAutoApproveSpend(Boolean(spd.data));
      }

      if (window.electronAPI?.browserGetSocialDailyCap) {
        const cap = await window.electronAPI.browserGetSocialDailyCap();
        if (cap.success && typeof cap.data === 'number') {
          setDailyCap(cap.data);
        }
      }

      if (window.electronAPI?.browserGetSocialDailyCount) {
        const ig = await window.electronAPI.browserGetSocialDailyCount('instagram');
        if (ig.success && typeof ig.data === 'number') setTodayIgCount(ig.data);

        const fb = await window.electronAPI.browserGetSocialDailyCount('facebook');
        if (fb.success && typeof fb.data === 'number') setTodayFbCount(fb.data);
      }

      if (window.electronAPI?.browserGetAuditRetentionDays) {
        const rDays = await window.electronAPI.browserGetAuditRetentionDays();
        if (rDays?.success && typeof rDays.data === 'number') {
          setRetentionDays(rDays.data);
        }
      }
    };

    void loadSettings();
  }, []);

  useEffect(() => {
    void loadAuditLogs();
  }, [loadAuditLogs]);

  const handleToggleAutoApprove = async (actionType: SafetyActionType, enabled: boolean) => {
    if (window.electronAPI?.browserSetSafetyAutoApprove) {
      await window.electronAPI.browserSetSafetyAutoApprove({ actionType, enabled });
      switch (actionType) {
        case 'publish':
          setAutoApprovePublish(enabled);
          break;
        case 'send':
          setAutoApproveSend(enabled);
          break;
        case 'delete':
          setAutoApproveDelete(enabled);
          break;
        case 'spend':
          setAutoApproveSpend(enabled);
          break;
      }
      Message.success(`Updated auto-approval for ${actionType}`);
    }
  };

  const handleUpdateDailyCap = async (cap: number) => {
    setDailyCap(cap);
    if (window.electronAPI?.browserSetSocialDailyCap) {
      await window.electronAPI.browserSetSocialDailyCap(cap);
      Message.success('Updated daily post cap');
    }
  };

  const handleUpdateRetentionDays = async () => {
    if (window.electronAPI?.browserSetAuditRetentionDays) {
      await window.electronAPI.browserSetAuditRetentionDays(retentionDays);
      Message.success(`Updated audit log retention to ${retentionDays} days`);
      void loadAuditLogs();
    }
  };

  const handleClearAuditLogs = async () => {
    if (window.electronAPI?.browserClearAuditLogs) {
      await window.electronAPI.browserClearAuditLogs();
      setAuditLogs([]);
      Message.success('Audit logs cleared');
    }
  };

  const handleCreateProfileSubmit = async () => {
    try {
      const values = await form.validate();
      const allowedDomains = values.allowedDomains
        ? (values.allowedDomains as string)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;

      const assignedTeamIds = values.assignedTeamIds
        ? (values.assignedTeamIds as string)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;

      const assignedProjectIds = values.assignedProjectIds
        ? (values.assignedProjectIds as string)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;

      await createProfile({
        name: values.name,
        backend: values.backend,
        mode: values.mode || 'act',
        allowedDomains,
        assignedTeamIds,
        assignedProjectIds,
        externalChrome: {
          port: values.port ? Number(values.port) : 9222,
        },
      });
      setIsAddModalVisible(false);
      form.resetFields();
      Message.success('Profile created successfully');
    } catch (err) {
      Message.error(err instanceof Error ? err.message : 'Failed to create profile');
    }
  };

  return (
    <div className='flex flex-col gap-6 py-2'>
      {/* 1. Persistent Profiles */}
      <Card
        title={
          <Space>
            <BrowserChrome size='18' />
            <Text bold>Browser Profiles & Persistent Sessions</Text>
          </Space>
        }
        extra={
          <Button type='primary' size='small' icon={<Plus />} onClick={() => setIsAddModalVisible(true)}>
            Add Profile
          </Button>
        }
      >
        <div className='flex flex-col gap-3'>
          <Paragraph type='secondary' className='text-xs mb-1'>
            Profiles keep login cookies, storage, and sessions across app restarts. Use External Chrome for sites that
            restrict embedded webviews (e.g. Google Flow).
          </Paragraph>

          <div className='flex flex-col gap-2'>
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className='p-3 bg-[var(--color-fill-2)] rounded border border-[var(--color-border-2)] flex items-center justify-between'
              >
                <div className='flex items-center gap-3'>
                  <Text bold className='text-sm'>
                    {profile.name}
                  </Text>
                  <Tag color={profile.backend === 'embedded' ? 'arcoblue' : 'purple'} size='small'>
                    {profile.backend === 'embedded'
                      ? 'Embedded Session'
                      : `Chrome CDP :${profile.externalChrome?.port || 9222}`}
                  </Tag>
                  <Tag color={profile.mode === 'research' ? 'orange' : 'blue'} size='small'>
                    {profile.mode === 'research' ? 'Research (Read-Only)' : 'Act (Full)'}
                  </Tag>
                  {profile.allowedDomains && profile.allowedDomains.length > 0 && (
                    <Tag color='cyan' size='small'>
                      Allowlist: {profile.allowedDomains.join(', ')}
                    </Tag>
                  )}
                  {profile.sessionHealth === 'relogin_needed' && (
                    <Tag color='red' size='small'>
                      Re-login needed
                    </Tag>
                  )}
                  {profile.id === activeProfile.id && (
                    <Tag color='green' size='small'>
                      Active
                    </Tag>
                  )}
                </div>

                <Space>
                  {profile.id !== activeProfile.id && (
                    <Button size='mini' type='secondary' onClick={() => switchProfile(profile.id)}>
                      Make Active
                    </Button>
                  )}
                  <Popconfirm
                    title='Clear all session cookies and stored data for this profile?'
                    onOk={() => clearProfileData(profile.id)}
                  >
                    <Button size='mini' type='text' status='warning'>
                      Clear Data
                    </Button>
                  </Popconfirm>
                  {profile.id !== 'default' && (
                    <Popconfirm title='Delete this browser profile?' onOk={() => deleteProfile(profile.id)}>
                      <Button size='mini' type='text' status='danger' icon={<Delete />} />
                    </Popconfirm>
                  )}
                </Space>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* 2. Download Routing */}
      <Card
        title={
          <Space>
            <FolderDownload size='18' />
            <Text bold>Download Storage</Text>
          </Space>
        }
      >
        <div className='flex flex-col gap-2'>
          <Text type='secondary' className='text-xs'>
            Downloads intercepted during browser workflows are routed automatically into workspace date folders:
          </Text>
          <Text code className='text-xs'>
            {'<workspace>/browser-downloads/<profile>/<YYYY-MM-DD>/<filename>'}
          </Text>
        </div>
      </Card>

      {/* 3. Safety Approval Gates */}
      <Card
        title={
          <Space>
            <Shield size='18' />
            <Text bold>Safety Gates & Approval Requirements</Text>
          </Space>
        }
      >
        <div className='flex flex-col gap-4'>
          <Paragraph type='secondary' className='text-xs mb-1'>
            Actions that publish live content, send messages, delete data, or spend money require an explicit prompt
            before executing.
          </Paragraph>

          <div className='grid grid-cols-2 gap-4'>
            <div className='flex items-center justify-between p-3 bg-[var(--color-fill-2)] rounded border border-[var(--color-border-2)]'>
              <div>
                <Text bold className='text-xs block'>
                  Auto-Approve Publish
                </Text>
                <Text type='secondary' className='text-[10px]'>
                  Bypass approval modal when posting to social accounts
                </Text>
              </div>
              <Switch checked={autoApprovePublish} onChange={(v) => handleToggleAutoApprove('publish', v)} />
            </div>

            <div className='flex items-center justify-between p-3 bg-[var(--color-fill-2)] rounded border border-[var(--color-border-2)]'>
              <div>
                <Text bold className='text-xs block'>
                  Auto-Approve Send
                </Text>
                <Text type='secondary' className='text-[10px]'>
                  Bypass approval modal when sending messages
                </Text>
              </div>
              <Switch checked={autoApproveSend} onChange={(v) => handleToggleAutoApprove('send', v)} />
            </div>

            <div className='flex items-center justify-between p-3 bg-[var(--color-fill-2)] rounded border border-[var(--color-border-2)]'>
              <div>
                <Text bold className='text-xs block'>
                  Auto-Approve Delete
                </Text>
                <Text type='secondary' className='text-[10px]'>
                  Bypass approval modal when deleting records
                </Text>
              </div>
              <Switch checked={autoApproveDelete} onChange={(v) => handleToggleAutoApprove('delete', v)} />
            </div>

            <div className='flex items-center justify-between p-3 bg-[var(--color-fill-2)] rounded border border-[var(--color-border-2)]'>
              <div>
                <Text bold className='text-xs block'>
                  Auto-Approve Spend
                </Text>
                <Text type='secondary' className='text-[10px]'>
                  Bypass approval modal when spending funds
                </Text>
              </div>
              <Switch checked={autoApproveSpend} onChange={(v) => handleToggleAutoApprove('spend', v)} />
            </div>
          </div>
        </div>
      </Card>

      {/* 4. Social Posting Protection */}
      <Card
        title={
          <Space>
            <ShareSys size='18' />
            <Text bold>Social Posting Protection & Rate Limits</Text>
          </Space>
        }
      >
        <div className='flex flex-col gap-4'>
          <div className='flex items-center justify-between p-3 bg-[var(--color-fill-2)] rounded border border-[var(--color-border-2)]'>
            <div>
              <Text bold className='text-xs block'>
                Daily Post Cap
              </Text>
              <Text type='secondary' className='text-[10px]'>
                Maximum allowed posts per platform per day to prevent account flags
              </Text>
            </div>
            <InputNumber
              min={1}
              max={100}
              value={dailyCap}
              onChange={(val) => handleUpdateDailyCap(val || 10)}
              style={{ width: 100 }}
            />
          </div>

          <div className='flex items-center gap-6 px-3'>
            <div className='flex items-center gap-2'>
              <Text type='secondary' className='text-xs'>
                Today's Instagram Posts:
              </Text>
              <Tag size='small'>
                {todayIgCount} / {dailyCap}
              </Tag>
            </div>
            <div className='flex items-center gap-2'>
              <Text type='secondary' className='text-xs'>
                Today's Facebook Posts:
              </Text>
              <Tag size='small'>
                {todayFbCount} / {dailyCap}
              </Tag>
            </div>
          </div>
        </div>
      </Card>

      {/* Add Profile Modal */}
      <Modal
        title='Create Browser Profile'
        visible={isAddModalVisible}
        onOk={handleCreateProfileSubmit}
        onCancel={() => setIsAddModalVisible(false)}
      >
        <Form form={form} layout='vertical'>
          <FormItem
            label='Profile Name'
            field='name'
            rules={[{ required: true, message: 'Please enter a profile name' }]}
          >
            <Input placeholder='e.g. instagram-brand, work-account' />
          </FormItem>

          <FormItem label='Backend Type' field='backend' initialValue='embedded'>
            <Select>
              <Select.Option value='embedded'>Embedded (In-App Partition)</Select.Option>
              <Select.Option value='external-chrome'>External Chrome (CDP Port)</Select.Option>
            </Select>
          </FormItem>

          <FormItem
            label='Operating Mode'
            field='mode'
            initialValue='act'
            extra='Research mode prohibits all form submits, uploads, and state-changing actions'
          >
            <Select>
              <Select.Option value='act'>Act (Full Automation Actions)</Select.Option>
              <Select.Option value='research'>Research (Read-Only / No Form Submits)</Select.Option>
            </Select>
          </FormItem>

          <FormItem
            label='Allowed Domains'
            field='allowedDomains'
            extra='Comma-separated domain patterns, e.g. *.youtube.com, youtube.com. Unlisted domains will be blocked.'
          >
            <Input placeholder='*.youtube.com, youtube.com' />
          </FormItem>

          <FormItem
            label='Assigned Team IDs'
            field='assignedTeamIds'
            extra='Comma-separated team IDs. If specified, only these teams may use this profile.'
          >
            <Input placeholder='team-media, team-social' />
          </FormItem>

          <FormItem
            label='Assigned Project IDs'
            field='assignedProjectIds'
            extra='Comma-separated project IDs. If specified, only these projects may use this profile.'
          >
            <Input placeholder='project-alpha, project-beta' />
          </FormItem>

          <FormItem
            label='Chrome Remote Debugging Port'
            field='port'
            initialValue={9222}
            extra='Required when using External Chrome'
          >
            <InputNumber min={1024} max={65535} />
          </FormItem>
        </Form>
      </Modal>

      {/* 5. Browser Automation Audit Trail */}
      <Card
        title={
          <Space>
            <FileText size='18' />
            <Text bold>Browser Action Audit Trail & Forensic Logs</Text>
          </Space>
        }
        extra={
          <Space>
            <Button size='small' icon={<Refresh />} onClick={loadAuditLogs}>
              Refresh
            </Button>
            <Popconfirm title='Clear all browser audit records?' onOk={handleClearAuditLogs}>
              <Button size='small' status='danger' icon={<Delete />}>
                Clear Logs
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <div className='flex flex-col gap-4'>
          <div className='flex items-center justify-between p-3 bg-[var(--color-fill-2)] rounded border border-[var(--color-border-2)] flex-wrap gap-2'>
            <div className='flex items-center gap-3'>
              <Text className='text-xs'>Filter Profile:</Text>
              <Select size='small' value={auditProfileFilter} onChange={setAuditProfileFilter} style={{ width: 160 }}>
                <Select.Option value='all'>All Profiles</Select.Option>
                {profiles.map((p) => (
                  <Select.Option key={p.id} value={p.id}>
                    {p.name}
                  </Select.Option>
                ))}
              </Select>

              <Checkbox checked={auditSensitiveOnly} onChange={setAuditSensitiveOnly}>
                <Text className='text-xs'>Sensitive Actions Only</Text>
              </Checkbox>
            </div>

            <div className='flex items-center gap-2'>
              <Text className='text-xs'>Retention (Days):</Text>
              <InputNumber
                size='small'
                min={1}
                max={365}
                value={retentionDays}
                onChange={(v) => setRetentionDays(v || 30)}
                style={{ width: 80 }}
              />
              <Button size='small' type='primary' onClick={handleUpdateRetentionDays}>
                Save Retention
              </Button>
            </div>
          </div>

          <Table
            data={auditLogs}
            rowKey='id'
            pagination={{ pageSize: 10, size: 'small' }}
            columns={[
              {
                title: 'Time',
                dataIndex: 'timestamp',
                width: 140,
                render: (val: number) => <Text className='text-xs'>{new Date(val).toLocaleTimeString()}</Text>,
              },
              {
                title: 'Profile',
                dataIndex: 'profileId',
                width: 120,
                render: (p: string) => <Tag size='small'>{p}</Tag>,
              },
              {
                title: 'Action',
                dataIndex: 'action',
                width: 110,
                render: (a: string) => (
                  <Text code className='text-xs'>
                    {a}
                  </Text>
                ),
              },
              {
                title: 'URL / Target',
                dataIndex: 'url',
                render: (u: string, row: BrowserAuditEntry) => (
                  <div className='flex flex-col text-xs'>
                    <Text className='font-mono break-all'>{u}</Text>
                    {row.targetSummary && (
                      <Text type='secondary' className='text-[10px]'>
                        {row.targetSummary}
                      </Text>
                    )}
                  </div>
                ),
              },
              {
                title: 'Sensitive',
                dataIndex: 'sensitive',
                width: 90,
                render: (s: boolean) =>
                  s ? (
                    <Tag color='orange' size='small'>
                      Sensitive
                    </Tag>
                  ) : (
                    <Tag color='gray' size='small'>
                      Normal
                    </Tag>
                  ),
              },
              {
                title: 'Status',
                dataIndex: 'status',
                width: 90,
                render: (st: string) => {
                  const color = st === 'success' ? 'green' : st === 'blocked' ? 'orange' : 'red';
                  return (
                    <Tag color={color} size='small'>
                      {st}
                    </Tag>
                  );
                },
              },
              {
                title: 'Screenshots',
                width: 130,
                render: (_col: unknown, row: BrowserAuditEntry) => (
                  <Space size='mini'>
                    {row.screenshotBefore && (
                      <Button
                        size='mini'
                        icon={<PreviewOpen />}
                        onClick={() => setPreviewScreenshot(row.screenshotBefore!)}
                      >
                        Before
                      </Button>
                    )}
                    {row.screenshotAfter && (
                      <Button
                        size='mini'
                        icon={<PreviewOpen />}
                        onClick={() => setPreviewScreenshot(row.screenshotAfter!)}
                      >
                        After
                      </Button>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </Card>

      {/* Screenshot Preview Modal */}
      {previewScreenshot && (
        <Modal
          visible={Boolean(previewScreenshot)}
          title='Action Forensic Screenshot'
          footer={null}
          onCancel={() => setPreviewScreenshot(null)}
          style={{ width: '80vw', maxWidth: 900 }}
        >
          <div className='flex justify-center p-2'>
            <Image src={previewScreenshot} alt='Forensic Screenshot' style={{ maxWidth: '100%', maxHeight: '70vh' }} />
          </div>
        </Modal>
      )}
    </div>
  );
};
