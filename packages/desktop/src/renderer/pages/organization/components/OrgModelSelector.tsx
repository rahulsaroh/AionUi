/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Button, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
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

export const OrgModelSelector: React.FC<OrgModelSelectorProps> = ({
  currentModel,
  onSelectModel,
  disabled = false,
  className,
}) => {
  const { t } = useTranslation();
  const { providers, getAvailableModels, formatModelLabel } = useModelProviderList();

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

  const modelGroups = useMemo<RuntimeSelectorModelGroup[]>(() => {
    const groups: RuntimeSelectorModelGroup[] = [];
    for (const provider of providers ?? []) {
      const models = getAvailableModels(provider);
      if (!models.length) continue;
      groups.push({
        key: provider.id,
        title: provider.name,
        models: models.map((modelName) => {
          const id = `${provider.id}::${modelName}`;
          return {
            id,
            label: formatModelLabel ? formatModelLabel(provider, modelName) : modelName,
          };
        }),
      });
    }
    return groups;
  }, [providers, getAvailableModels, formatModelLabel]);

  // Identify composite key for current selection
  const currentCompositeId = useMemo(() => {
    if (!currentModel?.modelId) return null;
    if (currentModel.providerId) {
      const directKey = `${currentModel.providerId}::${currentModel.modelId}`;
      if (modelLookup.has(directKey)) return directKey;
    }
    for (const [key, val] of modelLookup.entries()) {
      if (val.modelId === currentModel.modelId) return key;
    }
    return null;
  }, [currentModel, modelLookup]);

  const activeDisplayLabel = useMemo(() => {
    if (!currentModel?.modelId) {
      return t('conversation.welcome.selectModel', { defaultValue: 'Select Model' });
    }
    if (currentCompositeId && modelLookup.has(currentCompositeId)) {
      return modelLookup.get(currentCompositeId)!.displayName;
    }
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
    }
  };

  if (disabled || modelGroups.length === 0) {
    return (
      <Tooltip
        content={
          modelGroups.length === 0
            ? t('conversation.noModelConfigured', { defaultValue: 'Configure models in App Settings' })
            : undefined
        }
      >
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
      droplist={<Menu className='!max-h-360px !overflow-y-auto'>{modelListNode}</Menu>}
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
