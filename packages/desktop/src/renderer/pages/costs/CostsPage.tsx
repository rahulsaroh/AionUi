/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  Card,
  Table,
  Tabs,
  Button,
  Tag,
  Drawer,
  Modal,
  Input,
  Typography,
  Space,
  Progress,
  Message,
} from '@arco-design/web-react';
import { Finance, Robot, Peoples, SettingConfig, Left } from '@icon-park/react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  useCostLedger,
  getLedgerEntries,
  formatCost,
  formatTokens,
  loadPriceTable,
  savePriceTable,
  resetPriceTableToDefault,
  setBudget,
  type RunRecord,
  type PriceTable,
} from '@/common/costs';
import { useOrgStore } from '@/renderer/pages/organization/store/useOrgStore';

const { Title, Text, Paragraph } = Typography;
const TabPane = Tabs.TabPane;

export const CostsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { runs, budgets, todaySpend, modelSpend, getSpendForRun, getSpendForTeam } = useCostLedger();
  const { hierarchy } = useOrgStore();

  const [activeTab, setActiveTab] = useState('runs');
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [timelineDrawerOpen, setTimelineDrawerOpen] = useState(false);
  const [priceTableModalOpen, setPriceTableModalOpen] = useState(false);
  const [priceTableJson, setPriceTableJson] = useState('');
  const [editingBudget, setEditingBudget] = useState<{
    scopeType: 'team_daily' | 'department_monthly';
    scopeId: string;
    currentAmount: number;
  } | null>(null);
  const [newBudgetAmount, setNewBudgetAmount] = useState<string>('');

  const runLedgerEntries = useMemo(() => {
    if (!selectedRun) return [];
    return getLedgerEntries(selectedRun.id);
  }, [selectedRun]);

  const handleOpenTimeline = (run: RunRecord) => {
    setSelectedRun(run);
    setTimelineDrawerOpen(true);
  };

  const handleOpenPriceTable = () => {
    const table = loadPriceTable();
    setPriceTableJson(JSON.stringify(table, null, 2));
    setPriceTableModalOpen(true);
  };

  const handleSavePriceTable = () => {
    try {
      const parsed = JSON.parse(priceTableJson) as PriceTable;
      savePriceTable(parsed);
      Message.success(t('costs.priceTableSaved', { defaultValue: 'Price table saved successfully' }));
      setPriceTableModalOpen(false);
    } catch {
      Message.error(t('costs.invalidJson', { defaultValue: 'Invalid JSON format' }));
    }
  };

  const handleResetPriceTable = () => {
    const def = resetPriceTableToDefault();
    setPriceTableJson(JSON.stringify(def, null, 2));
    Message.info(t('costs.priceTableReset', { defaultValue: 'Reset to default price table' }));
  };

  const handleSaveBudget = () => {
    if (!editingBudget) return;
    const amount = parseFloat(newBudgetAmount);
    if (isNaN(amount) || amount < 0) {
      Message.error(t('costs.invalidAmount', { defaultValue: 'Please enter a valid positive number' }));
      return;
    }
    setBudget(editingBudget.scopeType, editingBudget.scopeId, amount);
    Message.success(t('costs.budgetSaved', { defaultValue: 'Budget updated successfully' }));
    setEditingBudget(null);
  };

  // 1. By Run columns
  const runColumns = [
    {
      title: 'Run ID',
      dataIndex: 'id',
      render: (id: string) => <Text code>{id}</Text>,
    },
    {
      title: 'Trigger',
      dataIndex: 'trigger',
      render: (trig: string) => {
        const color = trig === 'cron' ? 'purple' : trig === 'channel' ? 'blue' : 'green';
        return <Tag color={color}>{trig}</Tag>;
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (status: string) => {
        const color =
          status === 'completed' ? 'green' : status === 'failed' ? 'red' : status === 'paused' ? 'orange' : 'arcoblue';
        return <Tag color={color}>{status}</Tag>;
      },
    },
    {
      title: 'Started At',
      dataIndex: 'started_at',
      render: (ts: number) => new Date(ts).toLocaleString(),
    },
    {
      title: 'Duration',
      render: (_: unknown, r: RunRecord) => {
        if (!r.ended_at) return 'In Progress';
        const ms = r.ended_at - r.started_at;
        return `${Math.round(ms / 1000)}s`;
      },
    },
    {
      title: 'Total Spend',
      render: (_: unknown, r: RunRecord) => {
        const info = getSpendForRun(r.id);
        if (info.hasUnknown) {
          return info.totalSpend > 0 ? `~${formatCost(info.totalSpend)}*` : 'unknown';
        }
        return formatCost(info.totalSpend);
      },
    },
    {
      title: 'Actions',
      render: (_: unknown, r: RunRecord) => (
        <Button size='small' type='text' onClick={() => handleOpenTimeline(r)}>
          View Timeline
        </Button>
      ),
    },
  ];

  // 2. By Team rows
  const allTeams = useMemo(() => {
    return hierarchy.departments.flatMap((d) => d.teams);
  }, [hierarchy]);

  const teamColumns = [
    {
      title: 'Team Name',
      dataIndex: 'name',
      render: (name: string, row: { id: string }) => (
        <Space>
          <Peoples theme='outline' size={14} />
          <Text bold>{name || row.id}</Text>
        </Space>
      ),
    },
    {
      title: "Today's Spend",
      render: (_: unknown, row: { id: string }) => {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const spend = getSpendForTeam(row.id, startOfDay.getTime());
        return spend.hasUnknown ? `~${formatCost(spend.totalSpend)}*` : formatCost(spend.totalSpend);
      },
    },
    {
      title: 'Daily Budget',
      render: (_: unknown, row: { id: string }) => {
        const foundBudget = budgets.find((item) => item.scope_type === 'team_daily' && item.scope_id === row.id);
        return foundBudget ? formatCost(foundBudget.amount) : 'None';
      },
    },
    {
      title: 'Budget Utilization',
      render: (_: unknown, row: { id: string }) => {
        const foundBudget = budgets.find((item) => item.scope_type === 'team_daily' && item.scope_id === row.id);
        if (!foundBudget || foundBudget.amount <= 0) return <Text type='secondary'>No limit</Text>;
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const spend = getSpendForTeam(row.id, startOfDay.getTime()).totalSpend;
        const pct = Math.min(100, Math.round((spend / foundBudget.amount) * 100));
        const status = pct >= 100 ? 'error' : pct >= 80 ? 'warning' : 'normal';
        return <Progress percent={pct} status={status} size='small' style={{ width: 120 }} />;
      },
    },
    {
      title: 'Actions',
      render: (_: unknown, row: { id: string }) => {
        const foundBudget = budgets.find((item) => item.scope_type === 'team_daily' && item.scope_id === row.id);
        return (
          <Button
            size='small'
            type='text'
            onClick={() => {
              setEditingBudget({
                scopeType: 'team_daily',
                scopeId: row.id,
                currentAmount: foundBudget?.amount ?? 0,
              });
              setNewBudgetAmount(foundBudget?.amount?.toString() ?? '10');
            }}
          >
            Set Budget
          </Button>
        );
      },
    },
  ];

  // 3. By Department rows
  const departmentColumns = [
    {
      title: 'Department Name',
      dataIndex: 'name',
      render: (name: string) => <Text bold>{name}</Text>,
    },
    {
      title: "This Month's Spend",
      render: (_: unknown, row: { id: string; teamIds?: string[]; teams?: Array<{ id: string }> }) => {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        let total = 0;
        let hasUnknown = false;
        const teamIds = row.teamIds || (row.teams || []).map((tm) => tm.id);
        for (const tId of teamIds) {
          const s = getSpendForTeam(tId, startOfMonth.getTime());
          total += s.totalSpend;
          if (s.hasUnknown) hasUnknown = true;
        }
        return hasUnknown ? `~${formatCost(total)}*` : formatCost(total);
      },
    },
    {
      title: 'Monthly Budget',
      render: (_: unknown, row: { id: string }) => {
        const foundBudget = budgets.find(
          (item) => item.scope_type === 'department_monthly' && item.scope_id === row.id
        );
        return foundBudget ? formatCost(foundBudget.amount) : 'None';
      },
    },
    {
      title: 'Budget Utilization',
      render: (_: unknown, row: { id: string; teamIds?: string[]; teams?: Array<{ id: string }> }) => {
        const foundBudget = budgets.find(
          (item) => item.scope_type === 'department_monthly' && item.scope_id === row.id
        );
        if (!foundBudget || foundBudget.amount <= 0) return <Text type='secondary'>No limit</Text>;
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        let total = 0;
        const teamIds = row.teamIds || (row.teams || []).map((tm) => tm.id);
        for (const tId of teamIds) {
          total += getSpendForTeam(tId, startOfMonth.getTime()).totalSpend;
        }
        const pct = Math.min(100, Math.round((total / foundBudget.amount) * 100));
        const status = pct >= 100 ? 'error' : pct >= 80 ? 'warning' : 'normal';
        return <Progress percent={pct} status={status} size='small' style={{ width: 120 }} />;
      },
    },
    {
      title: 'Actions',
      render: (_: unknown, row: { id: string }) => {
        const foundBudget = budgets.find(
          (item) => item.scope_type === 'department_monthly' && item.scope_id === row.id
        );
        return (
          <Button
            size='small'
            type='text'
            onClick={() => {
              setEditingBudget({
                scopeType: 'department_monthly',
                scopeId: row.id,
                currentAmount: foundBudget?.amount ?? 0,
              });
              setNewBudgetAmount(foundBudget?.amount?.toString() ?? '100');
            }}
          >
            Set Budget
          </Button>
        );
      },
    },
  ];

  // 4. By Model rows
  const modelRows = useMemo(() => {
    return Object.entries(modelSpend).map(([model, data]) => {
      return Object.assign({ model }, data);
    });
  }, [modelSpend]);

  const modelColumns = [
    {
      title: 'Model',
      dataIndex: 'model',
      render: (m: string) => <Text code>{m}</Text>,
    },
    {
      title: 'Calls',
      dataIndex: 'callCount',
    },
    {
      title: 'Input Tokens',
      dataIndex: 'inputTokens',
      render: (c: number) => formatTokens(c),
    },
    {
      title: 'Output Tokens',
      dataIndex: 'outputTokens',
      render: (c: number) => formatTokens(c),
    },
    {
      title: 'Total Spend',
      dataIndex: 'totalSpend',
      render: (spend: number, r: { unknownCount: number }) => {
        if (r.unknownCount > 0) {
          return spend > 0 ? `~${formatCost(spend)}*` : 'unknown';
        }
        return formatCost(spend);
      },
    },
  ];

  return (
    <div className='p-20px max-w-1200px mx-auto flex flex-col gap-16px'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-12px'>
          <Button icon={<Left size={16} />} size='small' onClick={() => navigate(-1)} />
          <div className='flex items-center gap-8px'>
            <Finance size={24} className='text-primary' />
            <Title heading={4} style={{ margin: 0 }}>
              {t('costs.title', { defaultValue: 'Cost Tracking & Budgets' })}
            </Title>
          </div>
        </div>

        <Space>
          <Button icon={<SettingConfig size={14} />} onClick={handleOpenPriceTable}>
            {t('costs.priceTable', { defaultValue: 'Edit Price Table' })}
          </Button>
        </Space>
      </div>

      {/* Summary Stats Card */}
      <div className='grid grid-cols-1 md:grid-cols-3 gap-12px'>
        <Card className='rounded-12px shadow-sm'>
          <Text type='secondary'>{t('costs.todaySpend', { defaultValue: "Today's Total Spend" })}</Text>
          <div className='text-24px font-bold mt-4px'>
            {todaySpend.hasUnknown ? `~${formatCost(todaySpend.totalSpend)}*` : formatCost(todaySpend.totalSpend)}
          </div>
        </Card>
        <Card className='rounded-12px shadow-sm'>
          <Text type='secondary'>{t('costs.activeBudgets', { defaultValue: 'Configured Budgets' })}</Text>
          <div className='text-24px font-bold mt-4px'>{budgets.length}</div>
        </Card>
        <Card className='rounded-12px shadow-sm'>
          <Text type='secondary'>{t('costs.totalRunsRecorded', { defaultValue: 'Total Runs Tracked' })}</Text>
          <div className='text-24px font-bold mt-4px'>{runs.length}</div>
        </Card>
      </div>

      {/* Main Tabs */}
      <Card className='rounded-12px shadow-sm'>
        <Tabs activeTab={activeTab} onChange={setActiveTab}>
          <TabPane key='runs' title={t('costs.byRun', { defaultValue: 'By Run' })}>
            <Table
              rowKey='id'
              columns={runColumns}
              data={runs}
              pagination={{ pageSize: 10 }}
              noDataElement={<div>No execution runs recorded yet.</div>}
            />
          </TabPane>

          <TabPane key='teams' title={t('costs.byTeam', { defaultValue: 'By Team' })}>
            <Table
              rowKey='id'
              columns={teamColumns}
              data={allTeams}
              pagination={{ pageSize: 10 }}
              noDataElement={<div>No teams configured.</div>}
            />
          </TabPane>

          <TabPane key='departments' title={t('costs.byDepartment', { defaultValue: 'By Department' })}>
            <Table
              rowKey='id'
              columns={departmentColumns}
              data={hierarchy.departments}
              pagination={{ pageSize: 10 }}
              noDataElement={<div>No departments configured.</div>}
            />
          </TabPane>

          <TabPane key='models' title={t('costs.byModel', { defaultValue: 'By Model' })}>
            <Table
              rowKey='model'
              columns={modelColumns}
              data={modelRows}
              pagination={{ pageSize: 10 }}
              noDataElement={<div>No model usage recorded yet.</div>}
            />
          </TabPane>
        </Tabs>
      </Card>

      {/* Run Detail Timeline Drawer */}
      <Drawer
        title={`Run Timeline: ${selectedRun?.id ?? ''}`}
        visible={timelineDrawerOpen}
        onOk={() => setTimelineDrawerOpen(false)}
        onCancel={() => setTimelineDrawerOpen(false)}
        width={540}
        footer={null}
      >
        {selectedRun && (
          <div className='flex flex-col gap-12px'>
            <div className='p-12px rounded-8px bg-fill-2 flex flex-col gap-4px'>
              <div className='flex justify-between'>
                <Text bold>Trigger:</Text> <Tag>{selectedRun.trigger}</Tag>
              </div>
              <div className='flex justify-between'>
                <Text bold>Status:</Text> <Tag>{selectedRun.status}</Tag>
              </div>
              <div className='flex justify-between'>
                <Text bold>Started:</Text> <Text>{new Date(selectedRun.started_at).toLocaleString()}</Text>
              </div>
              {selectedRun.ended_at && (
                <div className='flex justify-between'>
                  <Text bold>Duration:</Text>{' '}
                  <Text>{Math.round((selectedRun.ended_at - selectedRun.started_at) / 1000)}s</Text>
                </div>
              )}
            </div>

            <Title heading={6}>LLM Usage Events ({runLedgerEntries.length})</Title>
            {runLedgerEntries.length === 0 ? (
              <Text type='secondary'>No LLM calls recorded for this run.</Text>
            ) : (
              <div className='flex flex-col gap-8px'>
                {runLedgerEntries.map((e) => (
                  <div
                    key={e.id}
                    className='p-10px border border-[var(--color-border-2)] rounded-8px flex flex-col gap-4px'
                  >
                    <div className='flex justify-between items-center'>
                      <Space>
                        <Robot size={14} />
                        <Text bold>{e.agent_role}</Text>
                      </Space>
                      <Text type='secondary' className='text-11px'>
                        {new Date(e.created_at).toLocaleTimeString()}
                      </Text>
                    </div>
                    <div className='flex justify-between text-12px'>
                      <Text code>{e.model}</Text>
                      <Text bold className='text-primary'>
                        {e.estimated_cost !== null ? formatCost(e.estimated_cost) : 'unknown'}
                      </Text>
                    </div>
                    <div className='text-11px text-t-tertiary flex justify-between'>
                      <span>Input: {formatTokens(e.input_tokens)}</span>
                      <span>Output: {formatTokens(e.output_tokens)}</span>
                      <span>Provider: {e.provider}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* Edit Price Table Modal */}
      <Modal
        title={t('costs.priceTableTitle', { defaultValue: 'Edit Model Price Table (JSON)' })}
        visible={priceTableModalOpen}
        onOk={handleSavePriceTable}
        onCancel={() => setPriceTableModalOpen(false)}
        style={{ width: 600 }}
      >
        <Paragraph type='secondary' className='text-12px mb-8px'>
          {t('costs.priceTableDesc', {
            defaultValue: 'Prices are in USD per 1M tokens. CLI agents without token metrics remain unknown.',
          })}
        </Paragraph>
        <Input.TextArea rows={12} value={priceTableJson} onChange={setPriceTableJson} className='font-mono text-12px' />
        <div className='mt-8px'>
          <Button size='small' onClick={handleResetPriceTable}>
            Reset to Defaults
          </Button>
        </div>
      </Modal>

      {/* Set Budget Modal */}
      <Modal
        title='Configure Budget Limit ($ USD)'
        visible={Boolean(editingBudget)}
        onOk={handleSaveBudget}
        onCancel={() => setEditingBudget(null)}
      >
        <div className='flex flex-col gap-8px'>
          <Text>
            Set budget limit for {editingBudget?.scopeType === 'team_daily' ? 'Team Daily' : 'Department Monthly'}{' '}
            limit:
          </Text>
          <Input
            prefix='$'
            type='number'
            value={newBudgetAmount}
            onChange={setNewBudgetAmount}
            placeholder='e.g. 25.00'
          />
        </div>
      </Modal>
    </div>
  );
};

export default CostsPage;
