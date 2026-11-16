/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Message, Modal, Popconfirm, Radio, Spin, Tag, Tooltip } from '@arco-design/web-react';
import {
  BookOpen,
  Copy,
  Edit,
  FolderOpen,
  History,
  PreviewClose,
  PreviewOpen,
  Refresh,
  Robot,
  Save,
  Time,
  Undo,
} from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { memberHandbook } from '@/common/adapter/ipcBridge';
import type { HandbookDetail, HandbookHistoryItem, HandbookStatus } from '@/common/types/team/handbookTypes';
import { generateHandbookContent, matchRoleTemplate } from '@/process/services/memberHandbook/handbookTemplates';
import {
  buildCompressedPrompt,
  estimateTokens,
  parseHandbookMarkdown,
} from '@/process/services/memberHandbook/handbookPrompt';

export type MemberHandbookModalProps = {
  visible: boolean;
  memberKey: string;
  memberName: string;
  role?: string;
  model?: string;
  onClose: () => void;
  onSaved?: (detail: HandbookDetail) => void;
};

export const MemberHandbookModal: React.FC<MemberHandbookModalProps> = ({
  visible,
  memberKey,
  memberName,
  role,
  model,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'edit' | 'preview' | 'history'>('edit');
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [handbook, setHandbook] = useState<HandbookDetail | null>(null);
  const [status, setStatus] = useState<HandbookStatus | null>(null);
  const [content, setContent] = useState<string>('');
  const [historyItems, setHistoryItems] = useState<HandbookHistoryItem[]>([]);
  const [externalEditDetected, setExternalEditDetected] = useState<boolean>(false);

  // AI Draft dialog state
  const [isDraftModalOpen, setIsDraftModalOpen] = useState<boolean>(false);
  const [draftGoal, setDraftGoal] = useState<string>('');
  const [isDrafting, setIsDrafting] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    if (!memberKey) return;
    setLoading(true);
    try {
      const st = await memberHandbook.getStatus({ memberKey, memberName });
      setStatus(st);

      let detail = await memberHandbook.read(memberKey, model);
      if (!detail && (!st.exists || st.status === 'not_created')) {
        // Auto-create on open if not created yet
        detail = await memberHandbook.create({
          memberKey,
          memberName,
          role,
          model,
        });
        const nextSt = await memberHandbook.getStatus({ memberKey, memberName });
        setStatus(nextSt);
      }

      if (detail) {
        setHandbook(detail);
        setContent(detail.content);
        setExternalEditDetected(false);
      }

      const hist = await memberHandbook.listHistory(memberKey);
      setHistoryItems(hist || []);
    } catch (err) {
      Message.error(t('team.handbook.loadFailed', { defaultValue: 'Failed to load employee handbook' }));
      console.warn('[MemberHandbookModal] loadData failed:', err);
    } finally {
      setLoading(false);
    }
  }, [memberKey, memberName, role, model, t]);

  useEffect(() => {
    if (visible && memberKey) {
      void loadData();
    }
  }, [visible, memberKey, loadData]);

  // Periodic external disk edit poll
  useEffect(() => {
    if (!visible || !memberKey) return;
    const interval = setInterval(async () => {
      try {
        const currentDetail = await memberHandbook.read(memberKey, model);
        if (currentDetail && handbook && currentDetail.fileHash !== handbook.fileHash) {
          setExternalEditDetected(true);
        }
      } catch {
        // ignore polling errors
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [visible, memberKey, model, handbook]);

  const handleCopyPath = useCallback(async () => {
    const filePath = handbook?.filePath || status?.filePath;
    if (!filePath) return;
    try {
      await navigator.clipboard.writeText(filePath);
      Message.success(t('team.handbook.pathCopied', { defaultValue: 'Handbook path copied to clipboard' }));
    } catch {
      Message.error('Failed to copy path');
    }
  }, [handbook, status, t]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const success = await memberHandbook.openFolder();
      if (!success) {
        Message.warning('Cannot open folder in this environment');
      }
    } catch (err) {
      Message.error(String(err));
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!memberKey) return;
    setSaving(true);
    try {
      const res = await memberHandbook.update({ memberKey, content });
      if (res.success) {
        Message.success(t('team.handbook.saved', { defaultValue: 'Handbook saved successfully' }));
        const updated = await memberHandbook.read(memberKey, model);
        if (updated) {
          setHandbook(updated);
          onSaved?.(updated);
        }
        setExternalEditDetected(false);
        const hist = await memberHandbook.listHistory(memberKey);
        setHistoryItems(hist || []);
      }
    } catch (err) {
      Message.error(t('team.handbook.saveFailed', { defaultValue: 'Failed to save handbook: ' }) + String(err));
    } finally {
      setSaving(false);
    }
  }, [memberKey, content, model, onSaved, t]);

  const handleRevert = useCallback(
    async (historyId: string) => {
      if (!memberKey) return;
      setSaving(true);
      try {
        const reverted = await memberHandbook.revert({ memberKey, historyId });
        setHandbook(reverted);
        setContent(reverted.content);
        Message.success(t('team.handbook.reverted', { defaultValue: 'Handbook reverted to selected version' }));
        setActiveTab('edit');
        onSaved?.(reverted);
        const hist = await memberHandbook.listHistory(memberKey);
        setHistoryItems(hist || []);
      } catch (err) {
        Message.error(t('team.handbook.revertFailed', { defaultValue: 'Failed to revert handbook: ' }) + String(err));
      } finally {
        setSaving(false);
      }
    },
    [memberKey, onSaved, t]
  );

  const handleReloadExternal = useCallback(async () => {
    if (!memberKey) return;
    await loadData();
    Message.info(t('team.handbook.reloaded', { defaultValue: 'Reloaded from disk' }));
  }, [memberKey, loadData, t]);

  const handleDraftWithAi = useCallback(async () => {
    setIsDrafting(true);
    try {
      const template = matchRoleTemplate(role);
      const seedPrompt = draftGoal.trim()
        ? `Primary Goal / Directive: ${draftGoal.trim()}\n\n${template.identityAndRole}`
        : undefined;

      const drafted = generateHandbookContent({
        memberName,
        role,
        seedPrompt,
        notes: draftGoal.trim() ? `Target Objective: ${draftGoal.trim()}` : undefined,
      });

      setContent(drafted);
      setIsDraftModalOpen(false);
      setDraftGoal('');
      setActiveTab('edit');
      Message.success(
        t('team.handbook.draftApplied', { defaultValue: 'AI draft applied to editor. Review and save.' })
      );
    } catch (err) {
      Message.error('Draft generation failed: ' + String(err));
    } finally {
      setIsDrafting(false);
    }
  }, [memberName, role, draftGoal, t]);

  const estimatedTokens = useMemo(() => estimateTokens(content), [content]);
  const budgetTokens = handbook?.budgetTokens || 3000;
  const isOverBudget = estimatedTokens > budgetTokens;

  const previewBlock = useMemo(() => {
    if (!content) return '';
    const parsed = parseHandbookMarkdown(content);
    return buildCompressedPrompt(parsed, memberName, role, budgetTokens);
  }, [content, memberName, role, budgetTokens]);

  return (
    <Modal
      title={
        <div className='flex items-center gap-8px'>
          <BookOpen size={18} theme='outline' className='text-primary' />
          <span className='font-bold text-15px text-t-primary'>
            {t('team.handbook.title', { defaultValue: 'Employee Handbook' })}: {memberName}
          </span>
          {role && (
            <Tag color='arcoblue' size='small' className='font-medium'>
              {role}
            </Tag>
          )}
        </div>
      }
      visible={visible}
      onCancel={onClose}
      footer={null}
      style={{ width: '850px', maxWidth: '92vw', borderRadius: 12 }}
      className='member-handbook-modal'
    >
      <div className='flex flex-col gap-12px min-h-480px'>
        {/* Status and Action Ribbon */}
        <div className='p-10px rounded-8px bg-fill-2 border border-[var(--color-border-2)] flex flex-col gap-8px'>
          <div className='flex items-center justify-between flex-wrap gap-8px'>
            <div className='flex items-center gap-8px'>
              {status?.status === 'created' ? (
                <Tag color='green' size='small'>
                  {t('team.handbook.statusCreated', { defaultValue: 'Handbook: created' })}
                </Tag>
              ) : status?.status === 'error' ? (
                <Tag color='red' size='small'>
                  {t('team.handbook.statusError', {
                    defaultValue: 'Handbook: error: {{reason}}',
                    reason: status?.reason || 'Unknown error',
                  })}
                </Tag>
              ) : (
                <Tag color='orange' size='small'>
                  {t('team.handbook.statusNotCreated', {
                    defaultValue: 'Handbook: not created: {{reason}}',
                    reason: status?.reason || 'Pending creation',
                  })}
                </Tag>
              )}

              <span className='text-11px text-t-tertiary font-mono truncate max-w-360px'>
                {status?.filePath || handbook?.filePath || '...'}
              </span>
            </div>

            <div className='flex items-center gap-6px'>
              <Button type='secondary' size='mini' icon={<FolderOpen size={13} />} onClick={handleOpenFolder}>
                {t('team.handbook.openFolder', { defaultValue: 'Open folder' })}
              </Button>
              <Button type='secondary' size='mini' icon={<Copy size={13} />} onClick={handleCopyPath}>
                {t('team.handbook.copyPath', { defaultValue: 'Copy path' })}
              </Button>
              <Button type='outline' size='mini' icon={<Robot size={13} />} onClick={() => setIsDraftModalOpen(true)}>
                {t('team.handbook.draftWithAi', { defaultValue: 'Draft with AI' })}
              </Button>
            </div>
          </div>

          <div className='flex items-center justify-between text-11px text-t-secondary pt-4px border-t border-[var(--color-border-2)]/60'>
            <span>
              {t('team.handbook.tokenBudget', {
                defaultValue: 'Estimated tokens: {{estimated}} / Budget: {{budget}}',
                estimated: estimatedTokens,
                budget: budgetTokens,
              })}
            </span>
            {isOverBudget && (
              <span className='text-[color:var(--color-danger-6)] font-medium'>
                {t('team.handbook.budgetExceeded', {
                  defaultValue: 'Exceeds context budget; will be auto-compressed when injected.',
                })}
              </span>
            )}
          </div>
        </div>

        {/* External edit warning banner */}
        {externalEditDetected && (
          <Alert
            type='warning'
            content={
              <div className='flex items-center justify-between'>
                <span>
                  {t('team.handbook.externalEditNotice', {
                    defaultValue: 'This handbook file was modified externally on disk.',
                  })}
                </span>
                <Button size='mini' type='primary' status='warning' onClick={handleReloadExternal}>
                  {t('team.handbook.reloadFromDisk', { defaultValue: 'Reload from disk' })}
                </Button>
              </div>
            }
          />
        )}

        {/* View Mode Radio Switcher */}
        <div className='flex items-center justify-between'>
          <Radio.Group
            type='button'
            size='small'
            value={activeTab}
            onChange={(val) => setActiveTab(val as 'edit' | 'preview' | 'history')}
          >
            <Radio value='edit'>
              <div className='flex items-center gap-4px'>
                <Edit size={13} />
                <span>{t('team.handbook.editTab', { defaultValue: 'Editor' })}</span>
              </div>
            </Radio>
            <Radio value='preview'>
              <div className='flex items-center gap-4px'>
                <PreviewOpen size={13} />
                <span>{t('team.handbook.previewTab', { defaultValue: 'Preview Injection' })}</span>
              </div>
            </Radio>
            <Radio value='history'>
              <div className='flex items-center gap-4px'>
                <History size={13} />
                <span>
                  {t('team.handbook.historyTab', { defaultValue: 'History & Revert' })} ({historyItems?.length || 0})
                </span>
              </div>
            </Radio>
          </Radio.Group>

          {activeTab === 'edit' && (
            <Button type='primary' size='small' loading={saving} icon={<Save size={13} />} onClick={handleSave}>
              {t('team.handbook.save', { defaultValue: 'Save Handbook' })}
            </Button>
          )}
        </div>

        {/* Tab Contents */}
        {loading ? (
          <div className='h-360px flex items-center justify-center'>
            <Spin dot />
          </div>
        ) : activeTab === 'edit' ? (
          <div className='flex-1 flex flex-col min-h-360px'>
            <Input.TextArea
              value={content}
              onChange={setContent}
              autoSize={{ minRows: 16, maxRows: 24 }}
              className='font-mono text-12px !rounded-8px leading-relaxed'
              placeholder='# Employee Handbook...'
            />
          </div>
        ) : activeTab === 'preview' ? (
          <div className='flex-1 flex flex-col gap-8px min-h-360px'>
            <div className='text-12px text-t-secondary'>
              {t('team.handbook.previewExplanation', {
                defaultValue:
                  'This is the actual prompt block that will be injected into the agent on the first message (or hash change).',
              })}
            </div>
            <pre className='flex-1 p-12px rounded-8px bg-fill-2 border border-[var(--color-border-2)] text-12px font-mono text-t-primary whitespace-pre-wrap overflow-y-auto max-h-400px'>
              {previewBlock}
            </pre>
          </div>
        ) : (
          <div className='flex-1 flex flex-col gap-6px min-h-360px overflow-y-auto max-h-400px pr-4px'>
            {!historyItems || historyItems.length === 0 ? (
              <div className='py-32px text-center text-13px text-t-tertiary'>
                {t('team.handbook.noHistory', { defaultValue: 'No previous versions found in history.' })}
              </div>
            ) : (
              historyItems.map((item, idx) => (
                <div
                  key={item.id}
                  className='p-10px rounded-8px bg-fill-2 border border-[var(--color-border-2)] flex items-center justify-between gap-12px'
                >
                  <div className='flex flex-col min-w-0 flex-1'>
                    <div className='flex items-center gap-8px text-12px font-bold text-t-primary'>
                      <Time size={12} />
                      <span>{new Date(item.timestamp).toLocaleString()}</span>
                      {idx === 0 && (
                        <Tag size='small' color='blue'>
                          Current
                        </Tag>
                      )}
                    </div>
                    <span className='text-11px text-t-secondary truncate mt-2px'>{item.contentPreview}</span>
                  </div>

                  {idx > 0 && (
                    <Popconfirm
                      title={t('team.handbook.revertConfirm', { defaultValue: 'Revert to this version?' })}
                      onOk={() => handleRevert(item.id)}
                    >
                      <Button size='mini' type='outline' icon={<Undo size={12} />}>
                        {t('team.handbook.revert', { defaultValue: 'Revert' })}
                      </Button>
                    </Popconfirm>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* AI Draft Popover / Dialog */}
      <Modal
        title={
          <div className='flex items-center gap-8px'>
            <Robot size={16} />
            <span>{t('team.handbook.draftWithAi', { defaultValue: 'Draft with AI' })}</span>
          </div>
        }
        visible={isDraftModalOpen}
        onCancel={() => setIsDraftModalOpen(false)}
        onOk={handleDraftWithAi}
        okButtonProps={{ loading: isDrafting }}
        okText={t('team.handbook.applyDraft', { defaultValue: 'Apply Draft' })}
        style={{ width: 500, borderRadius: 10 }}
      >
        <div className='flex flex-col gap-10px py-8px'>
          <span className='text-13px text-t-primary font-medium'>
            {t('team.handbook.draftGoalLabel', {
              defaultValue: 'Describe the primary objective or goal for this teammate:',
            })}
          </span>
          <Input.TextArea
            value={draftGoal}
            onChange={setDraftGoal}
            rows={4}
            placeholder={t('team.handbook.draftGoalPlaceholder', {
              defaultValue: 'e.g. Build robust end-to-end regression tests for our payment flow and mobile UI.',
            })}
            className='text-12px !rounded-8px'
          />
          <div className='text-11px text-t-tertiary'>
            Drafting synthesizes specialized talents, numbered SOP methodology, and rules tailored to{' '}
            <strong>{role || memberName}</strong>.
          </div>
        </div>
      </Modal>
    </Modal>
  );
};
