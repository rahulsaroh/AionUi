/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Button, Dropdown, Menu, Tooltip, Input } from '@arco-design/web-react';
import { Brain, Down } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { iconColors } from '@/renderer/styles/colors';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import {
  RuntimeSelectorModelList,
  type RuntimeSelectorModelGroup,
} from '@/renderer/components/agent/runtimeSelectorOptions';
import type { OrgAgentModelConfig } from '@/types/organization';

interface OrgModelSelectorProps {
  currentModel?: OrgAgentModelConfig;
  onSelectModel: (model: OrgAgentModelConfig) => void;
  disabled?: boolean;
  className?: string;
}

const FALLBACK_POPULAR_MODELS: RuntimeSelectorModelGroup[] = [
  {
    key: 'standard',
    title: 'Standard Models',
    models: [
      { id: 'standard::claude-3-7-sonnet', label: 'Claude 3.7 Sonnet' },
      { id: 'standard::claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
      { id: 'standard::gpt-4o', label: 'GPT-4o' },
      { id: 'standard::gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'standard::gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'standard::deepseek-chat', label: 'DeepSeek V3' },
      { id: 'standard::deepseek-reasoner', label: 'DeepSeek R1' },
    ],
  },
];

export const OrgModelSelector: React.FC<OrgModelSelectorProps> = ({
  currentModel,
  onSelectModel,
  disabled = false,
  className,
}) => {
  const { t } = useTranslation();
  const { providers, getAvailableModels, formatModelLabel } = useModelProviderList();
  const [customInput, setCustomInput] = useState('');

  const modelLookup = useMemo(() => {
    const map = new Map<string, { providerId: string; modelId: string; displayName: string }>();
    for (const provider of providers ?? []) {
      const models = getAvailableModels(provider);
      for (const modelName of models) {
        const compositeKey = `${provider.id}::${modelName}`;
        const label = formatModelLabel ? formatModelLabel(provider, modelName) : modelName;
        map.set(compositeKey, { providerId: provider.id, modelId: modelName, displayName: label });
      }
    }
    return map;
  }, [providers, getAvailableModels, formatModelLabel]);

  const modelGroups: RuntimeSelectorModelGroup[] = useMemo(() => {
    const groups: RuntimeSelectorModelGroup[] = [];
    for (const provider of providers ?? []) {
      const models = getAvailableModels(provider);
      if (models.length === 0) continue;
      groups.push({
        key: provider.id,
        title: provider.name || provider.platform || provider.id,
        models: models.map((modelName) => ({
          id: `${provider.id}::${modelName}`,
          label: formatModelLabel ? formatModelLabel(provider, modelName) : modelName,
        })),
      });
    }

    // If current model is a custom/assigned model not present in providers, expose it
    if (currentModel?.modelId) {
      const isKnown = Array.from(modelLookup.values()).some((v) => v.modelId === currentModel.modelId);
      if (!isKnown) {
        groups.unshift({
          key: 'custom',
          title: t('common.assigned', { defaultValue: 'Assigned / Custom' }),
          models: [
            {
              id: currentModel.providerId
                ? `${currentModel.providerId}::${currentModel.modelId}`
                : `custom::${currentModel.modelId}`,
              label: currentModel.modelName || currentModel.modelId,
            },
          ],
        });
      }
    }

    if (groups.length === 0) {
      return FALLBACK_POPULAR_MODELS;
    }
    return groups;
  }, [providers, getAvailableModels, formatModelLabel, currentModel, modelLookup, t]);

  const currentCompositeId = useMemo(() => {
    if (!currentModel?.modelId) return '';
    if (currentModel.providerId) {
      return `${currentModel.providerId}::${currentModel.modelId}`;
    }
    for (const [key, entry] of modelLookup.entries()) {
      if (entry.modelId === currentModel.modelId) return key;
    }
    return currentModel.modelId;
  }, [currentModel, modelLookup]);

  const activeDisplayLabel = useMemo(() => {
    if (!currentModel?.modelId) {
      return t('conversation.selectModel', { defaultValue: 'Select Model' });
    }
    const found = modelLookup.get(currentCompositeId);
    if (found) return found.displayName;
    return currentModel.modelName || currentModel.modelId;
  }, [currentModel, currentCompositeId, modelLookup, t]);

  const handleSelectKey = (id: string) => {
    const found = modelLookup.get(id);
    if (found) {
      onSelectModel({
        providerId: found.providerId,
        modelId: found.modelId,
        modelName: found.displayName,
      });
      return;
    }
    if (id.includes('::')) {
      const parts = id.split('::');
      const prov = parts[0];
      const mod = parts.slice(1).join('::');
      onSelectModel({
        providerId: prov === 'standard' || prov === 'custom' ? undefined : prov,
        modelId: mod,
        modelName: mod,
      });
      return;
    }
    onSelectModel({
      modelId: id,
      modelName: id,
    });
  };

  const handleApplyCustomModel = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSelectModel({
      modelId: trimmed,
      modelName: trimmed,
    });
    setCustomInput('');
  };

  if (disabled) {
    return (
      <Tooltip content={t('conversation.modelDisabled', { defaultValue: 'Model selection disabled' })}>
        <Button
          size='small'
          shape='round'
          className={classNames('!text-11px !h-26px !px-10px flex items-center gap-6px', className)}
          style={{ cursor: 'default' }}
        >
          <Brain theme='outline' size='13' fill={iconColors.secondary} className='shrink-0' />
          <span className='truncate max-w-140px'>{activeDisplayLabel}</span>
        </Button>
      </Tooltip>
    );
  }

  const modelListNode = (
    <RuntimeSelectorModelList groups={modelGroups} currentModelId={currentCompositeId} onSelect={handleSelectKey} />
  );

  return (
    <Dropdown
      trigger='click'
      droplist={
        <div className='p-6px bg-[var(--color-bg-2)] border border-[var(--color-border-2)] rounded-8px shadow-lg min-w-220px max-w-320px'>
          <Menu className='!max-h-300px !overflow-y-auto'>{modelListNode}</Menu>
          <div className='p-6px border-t border-[var(--color-border-2)] mt-6px flex flex-col gap-4px'>
            <span className='text-10px text-t-tertiary px-2px font-medium'>
              {t('common.customModel', { defaultValue: 'Custom Model' })}
            </span>
            <Input.Search
              size='mini'
              placeholder={t('common.enterModelId', { defaultValue: 'Type model ID...' })}
              value={customInput}
              onChange={setCustomInput}
              searchButton={t('common.set', { defaultValue: 'Set' })}
              onSearch={handleApplyCustomModel}
              onPressEnter={() => handleApplyCustomModel(customInput)}
              className='!text-11px'
            />
          </div>
        </div>
      }
      position='tl'
    >
      <Button
        size='small'
        shape='round'
        className={classNames(
          '!text-11px !h-26px !px-10px flex items-center gap-6px hover:!border-primary transition-colors',
          className
        )}
      >
        <Brain theme='outline' size='13' fill={iconColors.secondary} className='shrink-0 text-primary' />
        <span className='truncate max-w-160px font-medium'>{activeDisplayLabel}</span>
        <Down theme='outline' size='11' className='shrink-0 text-t-tertiary' />
      </Button>
    </Dropdown>
  );
};
