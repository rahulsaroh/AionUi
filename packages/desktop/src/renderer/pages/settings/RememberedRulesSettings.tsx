/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Button, Card, Empty, Input, Message, Popconfirm, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { Delete, Search, Shield, Toolkit } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useRememberedRules, type RememberedRule } from '@/common/autonomy';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const { Title, Text } = Typography;

export const RememberedRulesContent: React.FC = () => {
  const { t } = useTranslation();
  const { rules, revokeRule } = useRememberedRules();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRules = useMemo(() => {
    if (!searchQuery.trim()) return rules;
    const q = searchQuery.toLowerCase();
    return rules.filter(
      (r) =>
        r.projectId.toLowerCase().includes(q) || r.tool.toLowerCase().includes(q) || r.pattern.toLowerCase().includes(q)
    );
  }, [rules, searchQuery]);

  const handleRevoke = (id: string) => {
    const ok = revokeRule(id);
    if (ok) {
      Message.success(t('settings.rules.revoked', { defaultValue: 'Rule revoked' }));
    }
  };

  return (
    <div className='flex flex-col gap-16px w-full max-w-900px' data-testid='remembered-rules-page'>
      <div className='flex items-center justify-between pb-12px border-b border-border-1'>
        <div>
          <Title heading={5} style={{ margin: 0 }}>
            {t('settings.rules.title', { defaultValue: 'Remembered Approval Rules' })}
          </Title>
          <Text type='secondary' className='text-13px'>
            {t('settings.rules.desc', {
              defaultValue:
                'Rules saved when selecting "Always allow in this project". These rules permit specific tools and patterns without prompting.',
            })}
          </Text>
        </div>

        <Input
          prefix={<Search />}
          placeholder={t('settings.rules.search', { defaultValue: 'Search project, tool, pattern...' })}
          style={{ width: 280 }}
          value={searchQuery}
          onChange={setSearchQuery}
          allowClear
        />
      </div>

      {rules.length === 0 ? (
        <Card className='rd-8px border border-border-2 py-40px'>
          <Empty
            description={t('settings.rules.empty', {
              defaultValue: 'No remembered rules yet. Choose "Always allow in this project" when approving an action.',
            })}
          />
        </Card>
      ) : (
        <Table
          data={filteredRules}
          rowKey='id'
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: t('settings.rules.project', { defaultValue: 'Project' }),
              dataIndex: 'projectId',
              render: (proj: string) => (
                <Tag color='arcoblue' size='small'>
                  {proj}
                </Tag>
              ),
              width: 140,
            },
            {
              title: t('settings.rules.tool', { defaultValue: 'Tool' }),
              dataIndex: 'tool',
              render: (tool: string) => (
                <div className='flex items-center gap-6px'>
                  <Toolkit size='14' className='text-t-secondary' />
                  <span className='font-mono font-semibold text-13px'>{tool}</span>
                </div>
              ),
              width: 160,
            },
            {
              title: t('settings.rules.pattern', { defaultValue: 'Allowed Pattern' }),
              dataIndex: 'pattern',
              render: (pattern: string) => (
                <code className='bg-fill-3 px-8px py-4px rd-4px text-12px font-mono break-all'>{pattern}</code>
              ),
            },
            {
              title: t('settings.rules.created', { defaultValue: 'Created' }),
              dataIndex: 'createdAt',
              render: (ts: number) => new Date(ts).toLocaleDateString(),
              width: 120,
            },
            {
              title: t('settings.rules.actions', { defaultValue: 'Action' }),
              render: (_col, record: RememberedRule) => (
                <Popconfirm
                  title={t('settings.rules.confirmRevoke', { defaultValue: 'Revoke this remembered rule?' })}
                  onOk={() => handleRevoke(record.id)}
                  okText={t('common.revoke', { defaultValue: 'Revoke' })}
                  cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
                >
                  <Button
                    type='text'
                    status='danger'
                    size='small'
                    icon={<Delete />}
                    data-testid={`btn-revoke-rule-${record.id}`}
                  >
                    {t('settings.rules.revokeBtn', { defaultValue: 'Revoke' })}
                  </Button>
                </Popconfirm>
              ),
              width: 110,
            },
          ]}
        />
      )}
    </div>
  );
};

export const RememberedRulesSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <RememberedRulesContent />
    </SettingsPageWrapper>
  );
};

export default RememberedRulesSettings;
