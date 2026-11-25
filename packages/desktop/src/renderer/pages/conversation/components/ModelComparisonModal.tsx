/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Input, Message, Modal, Select, Spin, Tag } from '@arco-design/web-react';
import { Contrast, PlayOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import { resolveWorkspacePresetInstructions } from '@/renderer/utils/workspace/workspacePresets';

type ModelOption = {
  key: string;
  label: string;
  provider: IProvider;
  modelName: string;
};

type ComparisonSlotState = {
  status: 'idle' | 'running' | 'done' | 'error';
  content: string;
  durationMs?: number;
  conversationId?: string;
  error?: string;
};

type ModelComparisonModalProps = {
  visible: boolean;
  workspace?: string;
  onClose: () => void;
  onOpenConversation?: (conversationId: string) => void;
};

const POLL_INTERVAL_MS = 900;
const MAX_POLL_MS = 60_000;

const extractLastAssistantText = (messages: unknown[]): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i] as {
      position?: string;
      type?: string;
      content?: { content?: string } | string;
    };
    if (msg?.position === 'left' || msg?.type === 'text') {
      if (typeof msg.content === 'string' && msg.content.trim()) {
        return msg.content;
      }
      if (msg.content && typeof msg.content === 'object' && typeof msg.content.content === 'string') {
        if (msg.content.content.trim()) {
          return msg.content.content;
        }
      }
    }
  }
  return '';
};

export const ModelComparisonModal: React.FC<ModelComparisonModalProps> = ({
  visible,
  workspace,
  onClose,
  onOpenConversation,
}) => {
  const { t } = useTranslation();
  const { providers, getAvailableModels, formatModelLabel } = useModelProviderList();
  const [prompt, setPrompt] = useState('');
  const [modelKeyA, setModelKeyA] = useState<string>('');
  const [modelKeyB, setModelKeyB] = useState<string>('');
  const [slotA, setSlotA] = useState<ComparisonSlotState>({ status: 'idle', content: '' });
  const [slotB, setSlotB] = useState<ComparisonSlotState>({ status: 'idle', content: '' });
  const cancelledRef = useRef(false);

  const modelOptions = useMemo<ModelOption[]>(() => {
    const list: ModelOption[] = [];
    for (const provider of providers) {
      const models = getAvailableModels(provider);
      for (const modelName of models) {
        list.push({
          key: `${provider.id}::${modelName}`,
          label: formatModelLabel(provider, modelName),
          provider,
          modelName,
        });
      }
    }
    return list;
  }, [formatModelLabel, getAvailableModels, providers]);

  useEffect(() => {
    if (!visible) {
      cancelledRef.current = true;
      return;
    }
    cancelledRef.current = false;
    if (!modelKeyA && modelOptions.length > 0) {
      setModelKeyA(modelOptions[0].key);
    }
    if (!modelKeyB && modelOptions.length > 1) {
      setModelKeyB(modelOptions[1].key);
    } else if (!modelKeyB && modelOptions.length > 0) {
      setModelKeyB(modelOptions[0].key);
    }
  }, [modelKeyA, modelKeyB, modelOptions, visible]);

  const runSingleModel = async (
    option: ModelOption,
    fullPrompt: string,
    setSlot: React.Dispatch<React.SetStateAction<ComparisonSlotState>>
  ) => {
    const startMs = performance.now();
    setSlot({ status: 'running', content: '' });
    try {
      const modelPayload: TProviderWithModel = {
        ...option.provider,
        use_model: option.modelName,
      };
      const conv = await ipcBridge.conversation.create.invoke({
        type: 'aionrs',
        name: `Compare: ${option.modelName}`,
        model: modelPayload,
        extra: {
          workspace,
        },
      });
      if (!conv?.id) {
        throw new Error('Failed to create comparison conversation');
      }

      await ipcBridge.conversation.sendMessage.invoke({
        conversation_id: conv.id,
        input: fullPrompt,
        loading_id: `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      });

      const deadline = Date.now() + MAX_POLL_MS;
      let latestText = '';
      while (!cancelledRef.current && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const res = await (
          ipcBridge.conversation as unknown as {
            getMessages?: {
              invoke: (args: { conversation_id: string; page: number; page_size: number }) => Promise<unknown>;
            };
          }
        ).getMessages?.invoke({
          conversation_id: conv.id,
          page: 1,
          page_size: 50,
        });
        const list = Array.isArray(res) ? res : ((res as { list?: unknown[] } | null)?.list ?? []);
        const text = extractLastAssistantText(list);
        if (text) {
          latestText = text;
          setSlot({
            status: 'running',
            content: text,
            conversationId: conv.id,
          });
        }
        const statusRes = await ipcBridge.conversation.get.invoke({ id: conv.id });
        const convStatus = (statusRes as { status?: string } | null)?.status;
        if (convStatus === 'finished' || (text && convStatus !== 'running')) {
          break;
        }
      }

      setSlot({
        status: 'done',
        content: latestText || t('conversation.compareNoResponse', { defaultValue: 'No response received.' }),
        durationMs: Math.round(performance.now() - startMs),
        conversationId: conv.id,
      });
    } catch (err) {
      setSlot({
        status: 'error',
        content: '',
        durationMs: Math.round(performance.now() - startMs),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleRunComparison = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      Message.warning(t('conversation.comparePromptRequired', { defaultValue: 'Enter a prompt to compare models.' }));
      return;
    }
    const optA = modelOptions.find((m) => m.key === modelKeyA);
    const optB = modelOptions.find((m) => m.key === modelKeyB);
    if (!optA || !optB) {
      Message.warning(t('conversation.compareSelectModels', { defaultValue: 'Select two models to compare.' }));
      return;
    }

    const presetInstructions = resolveWorkspacePresetInstructions(workspace);
    const fullPrompt = presetInstructions ? `${presetInstructions}\n\n${trimmed}` : trimmed;

    await Promise.all([runSingleModel(optA, fullPrompt, setSlotA), runSingleModel(optB, fullPrompt, setSlotB)]);
  };

  const isRunning = slotA.status === 'running' || slotB.status === 'running';

  const renderSlot = (
    title: string,
    selectedKey: string,
    onSelect: (key: string) => void,
    slot: ComparisonSlotState
  ) => (
    <div className='flex flex-col gap-10px p-12px rd-10px border border-border-1 bg-fill-1 min-h-[280px]'>
      <div className='flex items-center justify-between gap-8px'>
        <span className='font-600 text-13px text-t-primary shrink-0'>{title}</span>
        <Select
          size='small'
          showSearch
          value={selectedKey}
          onChange={onSelect}
          className='flex-1 min-w-0'
          disabled={isRunning}
          placeholder={t('conversation.compareSelectModelPlaceholder', { defaultValue: 'Select model' })}
        >
          {modelOptions.map((opt) => (
            <Select.Option key={opt.key} value={opt.key}>
              {opt.label}
            </Select.Option>
          ))}
        </Select>
      </div>

      <div className='flex items-center justify-between text-11px text-t-tertiary'>
        <div className='flex items-center gap-6px'>
          {slot.status === 'running' && <Spin size={12} />}
          {typeof slot.durationMs === 'number' && (
            <Tag size='small' color='arcoblue'>
              {(slot.durationMs / 1000).toFixed(1)}s
            </Tag>
          )}
          {slot.content && <span>{slot.content.length} chars</span>}
        </div>
        {slot.conversationId && onOpenConversation && (
          <Button
            size='mini'
            type='text'
            onClick={() => {
              onOpenConversation(slot.conversationId as string);
              onClose();
            }}
          >
            {t('conversation.compareOpenChat', { defaultValue: 'Open Chat' })}
          </Button>
        )}
      </div>

      <div className='flex-1 overflow-y-auto max-h-[260px] p-10px rd-8px bg-base border border-border-1 text-13px text-t-primary whitespace-pre-wrap leading-20px'>
        {slot.status === 'error' ? (
          <span className='text-danger-6'>{slot.error || 'Comparison failed'}</span>
        ) : slot.content ? (
          slot.content
        ) : slot.status === 'running' ? (
          <span className='text-t-tertiary'>
            {t('conversation.compareGenerating', { defaultValue: 'Generating response...' })}
          </span>
        ) : (
          <span className='text-t-tertiary'>
            {t('conversation.compareReadyHint', { defaultValue: 'Output will appear here.' })}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      title={
        <div className='flex items-center gap-8px'>
          <Contrast theme='outline' size='18' />
          <span>{t('conversation.compareTitle', { defaultValue: 'Side-by-Side Model Comparison' })}</span>
        </div>
      }
      className='w-[94vw] max-w-[960px]'
    >
      {modelOptions.length === 0 ? (
        <Empty
          description={t('conversation.compareNoModels', {
            defaultValue: 'Configure at least one model provider in Settings to compare outputs.',
          })}
        />
      ) : (
        <div className='flex flex-col gap-14px'>
          <div className='flex flex-col gap-8px'>
            <Input.TextArea
              value={prompt}
              onChange={setPrompt}
              autoSize={{ minRows: 2, maxRows: 5 }}
              disabled={isRunning}
              placeholder={t('conversation.comparePromptPlaceholder', {
                defaultValue: 'Enter a prompt to test across two models side-by-side...',
              })}
            />
            <div className='flex justify-end'>
              <Button
                type='primary'
                icon={<PlayOne size='14' />}
                loading={isRunning}
                onClick={() => void handleRunComparison()}
              >
                {t('conversation.compareRun', { defaultValue: 'Compare Models' })}
              </Button>
            </div>
          </div>

          <div className='grid grid-cols-1 md:grid-cols-2 gap-12px'>
            {renderSlot('Model A', modelKeyA, setModelKeyA, slotA)}
            {renderSlot('Model B', modelKeyB, setModelKeyB, slotB)}
          </div>
        </div>
      )}
    </Modal>
  );
};

export default ModelComparisonModal;
