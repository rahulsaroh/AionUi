/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Button, Empty, Modal, Radio, Tag } from '@arco-design/web-react';
import { CheckOne, Download, LinkCloud } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { IMcpServer } from '@/common/config/storage';
import { AionSearchInput } from '@/renderer/components/base';

export type McpRegistryCategory = 'all' | 'developer' | 'web' | 'data' | 'productivity';

export type McpRegistryEntry = {
  id: string;
  name: string;
  title: string;
  description: string;
  category: Exclude<McpRegistryCategory, 'all'>;
  requiresEnv?: string[];
  transport: IMcpServer['transport'];
};

export const CURATED_MCP_REGISTRY: McpRegistryEntry[] = [
  {
    id: 'filesystem',
    name: 'filesystem',
    title: 'Filesystem',
    description: 'Read, write, search, and manage local files and directories safely.',
    category: 'developer',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    },
  },
  {
    id: 'fetch',
    name: 'fetch',
    title: 'Web Fetch',
    description: 'Fetch web pages and convert HTML content into clean Markdown for agents.',
    category: 'web',
    transport: {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch'],
    },
  },
  {
    id: 'sequential-thinking',
    name: 'sequential-thinking',
    title: 'Sequential Thinking',
    description: 'Structured step-by-step reasoning and problem decomposition tool.',
    category: 'productivity',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    },
  },
  {
    id: 'memory',
    name: 'memory',
    title: 'Knowledge Graph Memory',
    description: 'Persistent entity and relation memory across agent sessions.',
    category: 'productivity',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
  },
  {
    id: 'context7',
    name: 'context7',
    title: 'Context7 Docs',
    description: 'Retrieve up-to-date library documentation and code examples.',
    category: 'developer',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
    },
  },
  {
    id: 'playwright',
    name: 'playwright',
    title: 'Playwright Browser',
    description: 'Automate browser navigation, screenshots, and DOM inspection.',
    category: 'web',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
    },
  },
  {
    id: 'github',
    name: 'github',
    title: 'GitHub',
    description: 'Search repositories, inspect issues, pull requests, and commit history.',
    category: 'developer',
    requiresEnv: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    },
  },
  {
    id: 'sqlite',
    name: 'sqlite',
    title: 'SQLite Explorer',
    description: 'Query and inspect local SQLite databases with schema awareness.',
    category: 'data',
    transport: {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-sqlite', '--db-path', './data.db'],
    },
  },
];

type McpRegistryModalProps = {
  visible: boolean;
  existingServerNames: string[];
  onCancel: () => void;
  onInstall: (server: Omit<IMcpServer, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
};

const CATEGORY_COLORS: Record<Exclude<McpRegistryCategory, 'all'>, string> = {
  developer: 'arcoblue',
  web: 'cyan',
  data: 'purple',
  productivity: 'green',
};

const McpRegistryModal: React.FC<McpRegistryModalProps> = ({ visible, existingServerNames, onCancel, onInstall }) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<McpRegistryCategory>('all');
  const [installingId, setInstallingId] = useState<string | null>(null);

  const normalizedExisting = useMemo(
    () => new Set(existingServerNames.map((name) => name.toLowerCase())),
    [existingServerNames]
  );

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CURATED_MCP_REGISTRY.filter((entry) => {
      if (category !== 'all' && entry.category !== category) {
        return false;
      }
      if (!q) return true;
      return (
        entry.title.toLowerCase().includes(q) ||
        entry.name.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q)
      );
    });
  }, [category, search]);

  const handleInstall = async (entry: McpRegistryEntry) => {
    setInstallingId(entry.id);
    try {
      const jsonConfig = {
        mcpServers: {
          [entry.name]: entry.transport,
        },
      };
      await onInstall({
        name: entry.name,
        description: entry.description,
        enabled: true,
        transport: entry.transport,
        original_json: JSON.stringify(jsonConfig, null, 2),
      });
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <Modal
      visible={visible}
      onCancel={onCancel}
      footer={null}
      title={
        <div className='flex items-center gap-8px'>
          <LinkCloud theme='outline' size='18' />
          <span>{t('settings.mcpRegistryTitle', { defaultValue: 'MCP Server Registry' })}</span>
        </div>
      }
      className='w-[92vw] max-w-[760px]'
    >
      <div className='flex flex-col gap-14px'>
        <div className='flex flex-wrap items-center justify-between gap-10px'>
          <AionSearchInput
            className='w-full sm:w-[260px]'
            placeholder={t('settings.mcpRegistrySearchPlaceholder', { defaultValue: 'Search MCP servers...' })}
            value={search}
            onChange={setSearch}
          />
          <Radio.Group
            type='button'
            size='small'
            value={category}
            onChange={(val) => setCategory(val as McpRegistryCategory)}
          >
            <Radio value='all'>{t('common.all', { defaultValue: 'All' })}</Radio>
            <Radio value='developer'>{t('settings.mcpRegistryCatDeveloper', { defaultValue: 'Developer' })}</Radio>
            <Radio value='web'>{t('settings.mcpRegistryCatWeb', { defaultValue: 'Web' })}</Radio>
            <Radio value='data'>{t('settings.mcpRegistryCatData', { defaultValue: 'Data' })}</Radio>
            <Radio value='productivity'>
              {t('settings.mcpRegistryCatProductivity', { defaultValue: 'Productivity' })}
            </Radio>
          </Radio.Group>
        </div>

        {filteredEntries.length === 0 ? (
          <Empty description={t('settings.mcpRegistryEmpty', { defaultValue: 'No matching MCP servers found' })} />
        ) : (
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-12px max-h-[420px] overflow-y-auto pr-4px'>
            {filteredEntries.map((entry) => {
              const isInstalled = normalizedExisting.has(entry.name.toLowerCase());
              return (
                <div
                  key={entry.id}
                  className='flex flex-col justify-between gap-10px p-12px rd-10px border border-border-1 bg-fill-1'
                >
                  <div className='flex flex-col gap-6px'>
                    <div className='flex items-center justify-between gap-8px'>
                      <span className='font-600 text-14px text-t-primary'>{entry.title}</span>
                      <Tag size='small' color={CATEGORY_COLORS[entry.category]}>
                        {entry.category}
                      </Tag>
                    </div>
                    <p className='m-0 text-12px text-t-secondary leading-18px'>{entry.description}</p>
                    {entry.requiresEnv && entry.requiresEnv.length > 0 && (
                      <div className='text-11px text-t-tertiary'>
                        {t('settings.mcpRegistryRequiresEnv', {
                          env: entry.requiresEnv.join(', '),
                          defaultValue: `Requires env: ${entry.requiresEnv.join(', ')}`,
                        })}
                      </div>
                    )}
                  </div>
                  <div className='flex items-center justify-between pt-4px border-t border-border-1'>
                    <code className='text-11px text-t-tertiary truncate max-w-[180px]'>
                      {entry.transport.type === 'stdio'
                        ? `${entry.transport.command} ${entry.transport.args?.[0] ?? ''}`
                        : entry.transport.url}
                    </code>
                    {isInstalled ? (
                      <Tag size='small' color='green' icon={<CheckOne size='12' />}>
                        {t('settings.mcpRegistryInstalled', { defaultValue: 'Installed' })}
                      </Tag>
                    ) : (
                      <Button
                        size='mini'
                        type='primary'
                        icon={<Download size='12' />}
                        loading={installingId === entry.id}
                        onClick={() => void handleInstall(entry)}
                      >
                        {t('settings.mcpRegistryInstall', { defaultValue: 'Install' })}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default McpRegistryModal;
