/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Modal,
  Checkbox,
  Input,
  Form,
  Message,
  Typography,
  Space,
  Alert,
  Button,
  Collapse,
} from '@arco-design/web-react';
import { Github, Plus, FileText, UploadOne, Delete } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { knowledgeRepo, memberHandbook } from '@/common/adapter/ipcBridge';
import type { KnowledgeRepo } from '@/common/types/knowledgeRepo';
import { useMemberKnowledge } from './useMemberKnowledge';

export type MemberKnowledgePanelProps = {
  memberKey: string;
  memberName?: string;
  visible: boolean;
  onClose: () => void;
  onSaved?: (assignedRepoIds: string[], whenToUseHint?: string) => void;
};

export const MemberKnowledgePanel: React.FC<MemberKnowledgePanelProps> = ({
  memberKey,
  memberName,
  visible,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation();
  const {
    allRepos,
    assignedRepoIds,
    whenToUseHint,
    loading: hookLoading,
    refresh,
    saveAssignment,
    addAndAssignRepo,
  } = useMemberKnowledge(memberKey);

  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>([]);
  const [hint, setHint] = useState<string>('');
  const [trustApprovalRepo, setTrustApprovalRepo] = useState<KnowledgeRepo | null>(null);
  const [previewInstructions, setPreviewInstructions] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Array<{ ruleA: string; ruleB: string; resolvedInFavorOf: string }>>([]);

  // "Add by GitHub link" form state
  const [isAddingGithub, setIsAddingGithub] = useState<boolean>(false);
  const [githubUrl, setGithubUrl] = useState<string>('');
  const [githubRef, setGithubRef] = useState<string>('main');
  const [githubToken, setGithubToken] = useState<string>('');
  const [cloning, setCloning] = useState<boolean>(false);

  // Document Knowledge state
  const [isAddingDoc, setIsAddingDoc] = useState<boolean>(false);
  const [docName, setDocName] = useState<string>('');
  const [docContent, setDocContent] = useState<string>('');
  const [existingDoc, setExistingDoc] = useState<{ fileName: string; content: string; estimatedTokens: number } | null>(
    null
  );
  const [savingDoc, setSavingDoc] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      setSelectedRepoIds(assignedRepoIds);
      setHint(whenToUseHint);
      setIsAddingGithub(false);
      setGithubUrl('');
      setGithubRef('main');
      setGithubToken('');
      setIsAddingDoc(false);

      if (memberKey) {
        void memberHandbook
          .read(memberKey)
          .then((detail) => {
            if (detail && detail.content) {
              setExistingDoc({
                fileName: detail.fileName,
                content: detail.content,
                estimatedTokens: detail.estimatedTokens || Math.ceil(detail.content.length / 4),
              });
              setDocContent(detail.content);
              setDocName(detail.fileName);
            } else {
              setExistingDoc(null);
              setDocContent('');
              setDocName('');
            }
          })
          .catch(() => {
            setExistingDoc(null);
          });
      }
    }
  }, [visible, assignedRepoIds, whenToUseHint, memberKey]);

  // Check for rule conflicts whenever selected repos change
  useEffect(() => {
    if (selectedRepoIds.length > 0) {
      void knowledgeRepo
        .buildInstructions({
          memberName: memberName || 'Teammate',
          rolePrompt: '',
          repoIds: selectedRepoIds,
          whenToUseHint: hint,
        })
        .then((res) => {
          setConflicts(res.conflicts || []);
        })
        .catch(() => {
          setConflicts([]);
        });
    } else {
      setConflicts([]);
    }
  }, [selectedRepoIds, hint, memberName]);

  const handlePreview = async () => {
    try {
      const parts: string[] = [];
      if (existingDoc?.content || docContent.trim()) {
        parts.push(
          `### Document Knowledge (${docName || existingDoc?.fileName || 'Custom Document'})\n${docContent.trim() || existingDoc?.content || ''}`
        );
      }
      if (selectedRepoIds.length > 0) {
        const res = await knowledgeRepo.buildInstructions({
          memberName: memberName || 'Teammate',
          rolePrompt: '',
          repoIds: selectedRepoIds,
          whenToUseHint: hint,
          forceFullPlaybook: true,
        });
        if (res.instructions) {
          parts.push(res.instructions);
        }
      }
      setPreviewInstructions(parts.join('\n\n---\n\n') || 'No knowledge or document attached.');
    } catch (err: unknown) {
      Message.error((err as Error).message || 'Failed to preview instructions');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === 'string') {
        setDocContent(text);
        setDocName(file.name);
        setIsAddingDoc(true);
        Message.success(`Loaded document: ${file.name}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSaveDocKnowledge = async () => {
    if (!docContent.trim()) {
      Message.warning('Please enter or upload document content');
      return;
    }
    setSavingDoc(true);
    try {
      const readRes = await memberHandbook.read(memberKey);
      if (readRes) {
        await memberHandbook.update({
          memberKey,
          content: docContent.trim(),
        });
      } else {
        await memberHandbook.create({
          memberKey,
          memberName: memberName || 'Teammate',
          role: 'specialist',
          customContent: docContent.trim(),
        });
      }
      setExistingDoc({
        fileName: docName || 'HANDBOOK.md',
        content: docContent.trim(),
        estimatedTokens: Math.ceil(docContent.length / 4),
      });
      setIsAddingDoc(false);
      Message.success('Document knowledge saved and attached to teammate!');
    } catch (err: unknown) {
      Message.error((err as Error).message || 'Failed to save document knowledge');
    } finally {
      setSavingDoc(false);
    }
  };

  const handleRemoveDocKnowledge = async () => {
    try {
      await memberHandbook.delete({ memberKey });
      setExistingDoc(null);
      setDocContent('');
      setDocName('');
      setIsAddingDoc(false);
      Message.success('Document knowledge removed');
    } catch (err: unknown) {
      Message.error((err as Error).message || 'Failed to remove document knowledge');
    }
  };

  const handleSelectRepos = (vals: string[]) => {
    // Check if any newly selected repo is untrusted
    for (const id of vals) {
      if (!selectedRepoIds.includes(id)) {
        const repo = allRepos.find((r) => r.id === id);
        if (repo && repo.trustStatus === 'untrusted') {
          setTrustApprovalRepo(repo);
          return;
        }
      }
    }
    setSelectedRepoIds(vals);
  };

  const handleApproveTrust = async () => {
    if (!trustApprovalRepo) return;
    try {
      await knowledgeRepo.setTrust({ id: trustApprovalRepo.id, trustStatus: 'trusted' });
      trustApprovalRepo.trustStatus = 'trusted';
      setSelectedRepoIds((prev) => Array.from(new Set([...prev, trustApprovalRepo.id])));
      setTrustApprovalRepo(null);
      Message.success('Repository trusted and attached');
      await refresh();
    } catch (err: unknown) {
      Message.error((err as Error).message || 'Failed to trust repository');
    }
  };

  const handleCloneAndAssign = async () => {
    if (!githubUrl.trim()) {
      Message.warning('Please enter a GitHub repository URL');
      return;
    }
    setCloning(true);
    try {
      const newRepo = await addAndAssignRepo({
        gitUrl: githubUrl.trim(),
        ref: githubRef.trim() || 'main',
        authToken: githubToken.trim() || undefined,
      });
      setSelectedRepoIds((prev) => Array.from(new Set([...prev, newRepo.id])));
      setIsAddingGithub(false);
      setGithubUrl('');
      setGithubRef('main');
      setGithubToken('');
      Message.success('Repository cloned and assigned as knowledge');
    } catch (err: unknown) {
      Message.error((err as Error).message || 'Failed to clone repository');
    } finally {
      setCloning(false);
    }
  };

  const handleOk = async () => {
    try {
      await saveAssignment(selectedRepoIds, hint);
      Message.success(t('team.knowledgeRepos.assignedSuccess', { defaultValue: 'Knowledge assigned' }));
      onSaved?.(selectedRepoIds, hint);
      onClose();
    } catch (err: unknown) {
      Message.error((err as Error).message || 'Failed to assign knowledge');
    }
  };

  const displayName = memberName || memberKey;

  return (
    <>
      <Modal
        title={`${t('team.knowledgeRepos.attachRepos', { defaultValue: 'Knowledge' })}: ${displayName}`}
        visible={visible}
        onOk={handleOk}
        onCancel={onClose}
        style={{ width: 640 }}
        confirmLoading={hookLoading}
      >
        <Form layout='vertical'>
          {conflicts.length > 0 && (
            <Alert
              type='warning'
              title={t('team.knowledgeRepos.conflictsWarning', {
                defaultValue: 'Rule conflicts detected: higher-priority repo took precedence.',
              })}
              content={
                <ul className='m-0 ps-16px text-12px'>
                  {conflicts.map((c, i) => (
                    <li key={i}>
                      Conflict between <code>{c.ruleA}</code> and <code>{c.ruleB}</code>. Higher-priority repo took
                      precedence ({c.resolvedInFavorOf}).
                    </li>
                  ))}
                </ul>
              }
              className='mb-12px'
            />
          )}

          <Form.Item label={t('team.knowledgeRepos.whenToUseHint', { defaultValue: 'When to use' })}>
            <Input value={hint} onChange={setHint} placeholder='e.g. video production pipeline or backend coding' />
          </Form.Item>

          <Form.Item label={t('team.knowledgeRepos.title', { defaultValue: 'Knowledge' })}>
            {allRepos.length === 0 ? (
              <div className='py-8px'>
                <Typography.Text type='secondary'>
                  {t('team.knowledgeRepos.noRepos', { defaultValue: 'No knowledge repositories added yet.' })}
                </Typography.Text>
              </div>
            ) : (
              <Checkbox.Group
                value={selectedRepoIds}
                onChange={(vals) => handleSelectRepos(vals as string[])}
                direction='vertical'
              >
                <Space direction='vertical' className='w-full'>
                  {allRepos.map((repo) => (
                    <Checkbox key={repo.id} value={repo.id}>
                      <div className='flex flex-col'>
                        <span className='font-medium text-t-primary'>{repo.name}</span>
                        <span className='text-12px text-[color:var(--text-secondary)]'>
                          {repo.manifest?.alwaysOnRules?.length || 0} rules,{' '}
                          {repo.manifest?.onDemandSkills?.length || 0} skills ({repo.ref})
                          {repo.syncStatus === 'syncing' ? ' • Syncing...' : ''}
                          {repo.trustStatus === 'reapproval_required' ? ' • Re-approval needed' : ''}
                        </span>
                      </div>
                    </Checkbox>
                  ))}
                </Space>
              </Checkbox.Group>
            )}
          </Form.Item>

          {/* Add by GitHub Link Section */}
          <div className='mt-8px border border-solid border-[color:var(--border-base)] rounded-6px p-10px bg-[color:var(--bg-2)]'>
            <div className='flex items-center justify-between'>
              <span className='text-12px font-semibold text-t-primary flex items-center gap-6px'>
                <Github theme='outline' size='14' />
                {t('team.knowledgeRepos.addByGithub', { defaultValue: 'Add by GitHub link' })}
              </span>
              <Button
                size='mini'
                type={isAddingGithub ? 'secondary' : 'outline'}
                icon={<Plus theme='outline' size='12' />}
                onClick={() => setIsAddingGithub(!isAddingGithub)}
              >
                {isAddingGithub ? 'Cancel' : 'Add New'}
              </Button>
            </div>

            {isAddingGithub && (
              <div className='mt-10px flex flex-col gap-8px'>
                <Input
                  value={githubUrl}
                  onChange={setGithubUrl}
                  placeholder='https://github.com/owner/repository'
                  size='small'
                />
                <div className='flex gap-8px'>
                  <Input
                    value={githubRef}
                    onChange={setGithubRef}
                    placeholder='Branch or tag (default: main)'
                    size='small'
                    className='w-1/2'
                  />
                  <Input.Password
                    value={githubToken}
                    onChange={setGithubToken}
                    placeholder='Token (optional for private)'
                    size='small'
                    className='w-1/2'
                  />
                </div>
                <div className='flex justify-end pt-4px'>
                  <Button size='small' type='primary' loading={cloning} onClick={handleCloneAndAssign}>
                    Clone & Attach
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Add Document Knowledge Section */}
          <div className='mt-10px border border-solid border-[color:var(--border-base)] rounded-6px p-10px bg-[color:var(--bg-2)]'>
            <div className='flex items-center justify-between'>
              <span className='text-12px font-semibold text-t-primary flex items-center gap-6px'>
                <FileText theme='outline' size='14' />
                {t('team.knowledgeRepos.documentKnowledge', {
                  defaultValue: 'Document Knowledge (Files, Notes & SOPs)',
                })}
              </span>
              <div className='flex items-center gap-6px'>
                <input
                  type='file'
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                  accept='.md,.txt,.json,.yaml,.yml,.py,.ts,.js,.doc,.docx,.pdf,.csv'
                />
                <Button
                  size='mini'
                  type='outline'
                  icon={<UploadOne theme='outline' size='12' />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t('common.upload', { defaultValue: 'Upload File' })}
                </Button>
                <Button
                  size='mini'
                  type={isAddingDoc ? 'secondary' : 'outline'}
                  icon={<Plus theme='outline' size='12' />}
                  onClick={() => setIsAddingDoc(!isAddingDoc)}
                >
                  {isAddingDoc ? 'Cancel' : existingDoc ? 'Edit Document' : 'Add Text Document'}
                </Button>
              </div>
            </div>

            {/* Existing document info card */}
            {existingDoc && !isAddingDoc && (
              <div className='mt-8px p-8px rounded bg-[var(--color-bg-3)] border border-[var(--color-border-2)] flex items-center justify-between'>
                <div className='flex flex-col min-w-0'>
                  <span className='font-medium text-12px text-t-primary truncate'>📄 {existingDoc.fileName}</span>
                  <span className='text-10px text-t-tertiary'>
                    Attached (~{existingDoc.estimatedTokens} tokens) · Injected into teammate handbook
                  </span>
                </div>
                <div className='flex items-center gap-4px'>
                  <Button
                    size='mini'
                    type='text'
                    onClick={() => {
                      setDocContent(existingDoc.content);
                      setDocName(existingDoc.fileName);
                      setIsAddingDoc(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size='mini'
                    type='text'
                    status='danger'
                    icon={<Delete size={12} />}
                    onClick={handleRemoveDocKnowledge}
                  />
                </div>
              </div>
            )}

            {isAddingDoc && (
              <div className='mt-10px flex flex-col gap-8px'>
                <Input
                  value={docName}
                  onChange={setDocName}
                  placeholder='Document Name (e.g. guidelines.md or coding_standards.txt)'
                  size='small'
                />
                <Input.TextArea
                  value={docContent}
                  onChange={setDocContent}
                  placeholder='Paste or type document text, guidelines, instructions, or rules here...'
                  rows={6}
                />
                <div className='flex items-center justify-between pt-4px'>
                  <span className='text-11px text-t-tertiary'>
                    ~{Math.ceil(docContent.length / 4)} estimated tokens
                  </span>
                  <div className='flex items-center gap-6px'>
                    <Button size='small' onClick={() => setIsAddingDoc(false)}>
                      Cancel
                    </Button>
                    <Button size='small' type='primary' loading={savingDoc} onClick={handleSaveDocKnowledge}>
                      Save Document Knowledge
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className='flex justify-end pt-12px'>
            <Button
              size='small'
              onClick={handlePreview}
              disabled={selectedRepoIds.length === 0 && !existingDoc && !docContent.trim()}
            >
              {t('team.knowledgeRepos.effectiveInstructions', { defaultValue: 'Preview Effective Instructions' })}
            </Button>
          </div>
        </Form>
      </Modal>

      {/* Trust Approval Dialog on First Assignment */}
      <Modal
        title='Approve Knowledge Repository'
        visible={Boolean(trustApprovalRepo)}
        onOk={handleApproveTrust}
        onCancel={() => setTrustApprovalRepo(null)}
      >
        {trustApprovalRepo && (
          <div className='flex flex-col gap-10px'>
            <Alert
              type='info'
              content='This repository contains agent instructions, skills, or scripts. Explicit approval is required before attaching it to a teammate.'
            />
            <div>
              <Typography.Text bold>URL:</Typography.Text> <code>{trustApprovalRepo.gitUrl}</code>
            </div>
            <div>
              <Typography.Text bold>Ref:</Typography.Text> <code>{trustApprovalRepo.ref}</code>
            </div>
            <div>
              <Typography.Text bold>Detected Rules:</Typography.Text>{' '}
              {trustApprovalRepo.manifest?.alwaysOnRules?.length || 0}
            </div>
            <div>
              <Typography.Text bold>Detected Skills/Workflows:</Typography.Text>{' '}
              {trustApprovalRepo.manifest?.onDemandSkills?.length || 0}
            </div>
            {trustApprovalRepo.manifest?.setupFiles?.length > 0 && (
              <div>
                <Typography.Text bold type='error'>
                  Detected Setup / Tool Files:
                </Typography.Text>{' '}
                {trustApprovalRepo.manifest.setupFiles.map((f) => f.relativePath).join(', ')}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Effective Instructions Preview Modal */}
      <Modal
        title={t('team.knowledgeRepos.effectiveInstructions', { defaultValue: 'Preview Effective Instructions' })}
        visible={Boolean(previewInstructions)}
        onOk={() => setPreviewInstructions(null)}
        onCancel={() => setPreviewInstructions(null)}
        style={{ width: 720 }}
      >
        <pre className='p-12px bg-[var(--color-bg-2)] rounded text-12px max-h-450px overflow-y-auto whitespace-pre-wrap font-mono'>
          {previewInstructions}
        </pre>
      </Modal>
    </>
  );
};
