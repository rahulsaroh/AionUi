/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Input, Message, Radio, Select, Tag } from '@arco-design/web-react';
import { FolderClose, FolderOpen, NetworkTree, Peoples } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import type { TTeam } from '@/common/types/team/teamTypes';
import AionModal from '@/renderer/components/base/AionModal';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useOrgStore } from '../store/useOrgStore';
import {
  moveWorkplaceProjectToOrg,
  moveWorkplaceTeamToOrg,
  suggestOrgTargetWorkspace,
  type FileTransferChoice,
  type MoveToOrgResult,
} from '../store/moveWorkplaceToOrg';
import { getDefaultDeptPath, joinOrgPath, sanitizeFolderName, validateOrgFolder } from '../utils/orgPathUtils';

export type MoveToOrgTarget =
  | {
      kind: 'team';
      team: TTeam;
      subTeams?: TTeam[];
    }
  | {
      kind: 'project';
      projectName: string;
      sourceWorkspace: string;
      conversations: TChatConversation[];
    };

export type MoveToOrgModalProps = {
  visible: boolean;
  target: MoveToOrgTarget | null;
  onClose: () => void;
  onSuccess?: (result: MoveToOrgResult, openedInOrg: boolean) => void;
};

export const MoveToOrgModal: React.FC<MoveToOrgModalProps> = ({ visible, target, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  let userId = 'system_default_user';
  try {
    const auth = useAuth();
    if (auth.user?.id) userId = auth.user.id;
  } catch {
    // Standalone / test environments without AuthProvider
  }

  const {
    hierarchy,
    updateRootCeo,
    setActiveScope,
    setSelectedDepartment,
    setSelectedTeam,
    setSelectedProject,
    setSelectedConversationId,
    setOrgViewMode,
  } = useOrgStore();

  const [deptMode, setDeptMode] = useState<'existing' | 'new'>('existing');
  const [departmentId, setDepartmentId] = useState('');
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [itemName, setItemName] = useState('');
  const [description, setDescription] = useState('');
  const [targetWorkspace, setTargetWorkspace] = useState('');
  const [hasCustomTargetPath, setHasCustomTargetPath] = useState(false);
  const [fileTransferMode, setFileTransferMode] = useState<FileTransferChoice>('copy');
  const [createLinkedProject, setCreateLinkedProject] = useState(true);
  const [includeSubTeams, setIncludeSubTeams] = useState(true);
  const [removeFromWorkplace, setRemoveFromWorkplace] = useState(true);
  const [openInOrg, setOpenInOrg] = useState(true);
  const [isSourceInsideParent, setIsSourceInsideParent] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [settingMaster, setSettingMaster] = useState(false);
  const [resolvedMasterRoot, setResolvedMasterRoot] = useState<string | null>(hierarchy.rootCeo.workspacePath || null);

  const sourceWorkspace = useMemo(() => {
    if (!target) return '';
    return target.kind === 'team' ? target.team.workspace || '' : target.sourceWorkspace || '';
  }, [target]);

  const selectedDept = useMemo(
    () => hierarchy.departments.find((d) => d.id === departmentId) ?? null,
    [hierarchy.departments, departmentId]
  );

  const masterRoot = hierarchy.rootCeo.workspacePath || resolvedMasterRoot || null;

  const effectiveParentRoot = useMemo(() => {
    if (deptMode === 'existing') {
      return selectedDept?.workspacePath || masterRoot || null;
    }
    if (!masterRoot) return null;
    const trimmedDept = newDepartmentName.trim();
    return trimmedDept ? getDefaultDeptPath(masterRoot, trimmedDept) : masterRoot;
  }, [deptMode, selectedDept, masterRoot, newDepartmentName]);

  // Reset form state whenever the modal opens with a target
  useEffect(() => {
    if (!visible || !target) return;
    const hasDepts = hierarchy.departments.length > 0;
    setDeptMode(hasDepts ? 'existing' : 'new');
    setDepartmentId(hasDepts ? hierarchy.departments[0].id : '');
    setNewDepartmentName('');
    setItemName(target.kind === 'team' ? target.team.name : target.projectName);
    setDescription(target.kind === 'team' ? target.team.description || '' : '');
    setHasCustomTargetPath(false);
    setFileTransferMode('copy');
    setCreateLinkedProject(true);
    setIncludeSubTeams(true);
    setRemoveFromWorkplace(true);
    setOpenInOrg(true);
    setPathError(null);

    if (!hierarchy.rootCeo.workspacePath) {
      void ipcBridge.org
        .getMasterRoot()
        .then((root) => {
          if (root) setResolvedMasterRoot(root);
        })
        .catch(() => {});
    } else {
      setResolvedMasterRoot(hierarchy.rootCeo.workspacePath);
    }
  }, [visible, target, hierarchy.departments, hierarchy.rootCeo.workspacePath]);

  // Check if sourceWorkspace is already inside effectiveParentRoot and compute default targetWorkspace
  useEffect(() => {
    if (!visible || !target) return;
    let cancelled = false;

    const syncDefaultTarget = async () => {
      if (!effectiveParentRoot) {
        if (!cancelled) {
          setIsSourceInsideParent(false);
          if (!hasCustomTargetPath) setTargetWorkspace('');
        }
        return;
      }

      if (sourceWorkspace.trim()) {
        const sourceCheck = await validateOrgFolder(sourceWorkspace, effectiveParentRoot, 'project');
        if (cancelled) return;
        if (sourceCheck.valid && sourceCheck.resolvedPath) {
          setIsSourceInsideParent(true);
          if (!hasCustomTargetPath) {
            setTargetWorkspace(sourceCheck.resolvedPath);
          }
          return;
        }
      }

      setIsSourceInsideParent(false);
      if (!hasCustomTargetPath) {
        const cleanName = itemName.trim() || (target.kind === 'team' ? target.team.name : target.projectName);
        if (deptMode === 'existing') {
          setTargetWorkspace(
            suggestOrgTargetWorkspace({
              itemName: cleanName,
              department: selectedDept,
              masterRoot,
            })
          );
        } else {
          setTargetWorkspace(joinOrgPath(effectiveParentRoot, sanitizeFolderName(cleanName)));
        }
      }
    };

    void syncDefaultTarget();
    return () => {
      cancelled = true;
    };
  }, [
    visible,
    target,
    sourceWorkspace,
    effectiveParentRoot,
    hasCustomTargetPath,
    itemName,
    deptMode,
    selectedDept,
    masterRoot,
  ]);

  // Validate targetWorkspace when set and parent root exists
  useEffect(() => {
    if (!visible) return;
    const trimmed = targetWorkspace.trim();
    if (!trimmed || !effectiveParentRoot) {
      setPathError(null);
      return;
    }
    let cancelled = false;
    void validateOrgFolder(trimmed, effectiveParentRoot, 'project').then((res) => {
      if (!cancelled) {
        setPathError(res.valid ? null : res.error || t('team.organization.moveToOrg.pathOutsideRoot'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visible, targetWorkspace, effectiveParentRoot, t]);

  const handlePickMasterRoot = async () => {
    setSettingMaster(true);
    try {
      const res = await ipcBridge.org.pickMasterRoot();
      if (res.cancelled) return;
      if (!res.success || !res.masterRoot) {
        Message.error(res.error || t('team.organization.moveToOrg.masterRootFailed'));
        return;
      }
      setResolvedMasterRoot(res.masterRoot);
      updateRootCeo({ workspacePath: res.masterRoot });
      Message.success(t('team.organization.moveToOrg.masterRootSet'));
    } catch (err) {
      Message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingMaster(false);
    }
  };

  const handleBrowseTargetFolder = async () => {
    try {
      const paths = await ipcBridge.dialog.showOpen.invoke({
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: effectiveParentRoot || undefined,
      });
      if (paths && paths.length > 0 && paths[0]) {
        setHasCustomTargetPath(true);
        setTargetWorkspace(paths[0]);
      }
    } catch (err) {
      console.error('Failed to open directory dialog:', err);
    }
  };

  const canSubmit = useMemo(() => {
    if (!target || submitting) return false;
    if (!itemName.trim()) return false;
    if (deptMode === 'existing' && !departmentId) return false;
    if (deptMode === 'new' && !newDepartmentName.trim()) return false;
    if (pathError) return false;
    return true;
  }, [target, submitting, itemName, deptMode, departmentId, newDepartmentName, pathError]);

  const handleConfirm = async () => {
    if (!target || !canSubmit) return;
    setSubmitting(true);
    try {
      const deptArgs = deptMode === 'existing' ? { departmentId } : { newDepartmentName: newDepartmentName.trim() };

      let result: MoveToOrgResult;
      if (target.kind === 'team') {
        result = await moveWorkplaceTeamToOrg({
          team: target.team,
          subTeams: includeSubTeams ? (target.subTeams ?? []) : [],
          ...deptArgs,
          targetName: itemName.trim(),
          description: description.trim() || undefined,
          targetWorkspace: targetWorkspace.trim() || undefined,
          fileTransferMode: isSourceInsideParent ? 'none' : fileTransferMode,
          createLinkedProject,
        });
      } else {
        result = await moveWorkplaceProjectToOrg({
          projectName: itemName.trim(),
          sourceWorkspace: target.sourceWorkspace,
          conversations: target.conversations,
          ...deptArgs,
          description: description.trim() || undefined,
          targetWorkspace: targetWorkspace.trim() || undefined,
          fileTransferMode: isSourceInsideParent ? 'none' : fileTransferMode,
          removeFromWorkplace,
          userId,
        });
      }

      Message.success(t('team.organization.moveToOrg.success'));

      if (openInOrg) {
        setActiveScope('organization');
        setSelectedDepartment(result.departmentId);
        setSelectedTeam(result.orgTeamId ?? null);
        setSelectedProject(result.orgProjectId ?? null);
        setSelectedConversationId(null);
        setOrgViewMode('chat');
        void navigate('/organization');
      }

      onSuccess?.(result, openInOrg);
      onClose();
    } catch (err) {
      console.error('[MoveToOrgModal] Failed to move to organization:', err);
      Message.error(err instanceof Error ? err.message : t('team.organization.moveToOrg.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!target) return null;

  const isTeam = target.kind === 'team';
  const subTeamCount = isTeam ? (target.subTeams?.length ?? 0) : 0;
  const memberCount = isTeam ? (target.team.assistants?.length ?? 0) : 0;
  const conversationCount = !isTeam ? target.conversations.length : 0;

  return (
    <AionModal
      visible={visible}
      onCancel={onClose}
      header={{
        title: (
          <div className='flex items-center gap-8px'>
            <NetworkTree size={18} theme='outline' className='text-primary' />
            <span>
              {isTeam ? t('team.organization.moveToOrg.titleTeam') : t('team.organization.moveToOrg.titleProject')}
            </span>
          </div>
        ),
        showClose: true,
      }}
      footer={{
        render: () => (
          <div className='flex justify-end gap-8px'>
            <Button onClick={onClose} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button
              type='primary'
              loading={submitting}
              disabled={!canSubmit}
              onClick={() => void handleConfirm()}
              data-testid='move-to-org-confirm-btn'
            >
              {t('team.organization.moveToOrg.confirm')}
            </Button>
          </div>
        ),
      }}
      style={{ width: '520px' }}
    >
      <div className='flex flex-col gap-14px py-4px'>
        {/* Source Summary */}
        <div className='flex items-center justify-between gap-10px px-12px py-10px rounded-8px bg-fill-2 border border-[var(--color-border-2)]'>
          <div className='flex items-center gap-8px min-w-0'>
            <span className='size-28px rounded-6px bg-fill-3 flex items-center justify-center shrink-0 text-primary'>
              {isTeam ? <Peoples size={15} theme='outline' /> : <FolderClose size={15} theme='outline' />}
            </span>
            <div className='flex flex-col min-w-0'>
              <span className='text-13px font-medium text-t-primary truncate'>
                {isTeam ? target.team.name : target.projectName}
              </span>
              {sourceWorkspace && (
                <span className='text-11px font-mono text-t-tertiary truncate' title={sourceWorkspace}>
                  {sourceWorkspace}
                </span>
              )}
            </div>
          </div>
          <div className='flex items-center gap-6px shrink-0'>
            {isTeam ? (
              <>
                <Tag size='small' color='arcoblue'>
                  {t('team.organization.moveToOrg.membersCount', { count: memberCount })}
                </Tag>
                {subTeamCount > 0 && (
                  <Tag size='small' color='purple'>
                    {t('team.organization.moveToOrg.subTeamsCount', { count: subTeamCount })}
                  </Tag>
                )}
              </>
            ) : (
              <Tag size='small' color='arcoblue'>
                {t('team.organization.moveToOrg.chatsCount', { count: conversationCount })}
              </Tag>
            )}
          </div>
        </div>

        {/* Target Department */}
        <div className='flex flex-col gap-6px'>
          <span className='text-12px font-medium text-t-primary'>
            {t('team.organization.moveToOrg.targetDepartment')}
          </span>
          {hierarchy.departments.length > 0 && (
            <Radio.Group
              value={deptMode}
              onChange={(val) => setDeptMode(val as 'existing' | 'new')}
              className='flex items-center gap-16px'
            >
              <Radio value='existing'>{t('team.organization.moveToOrg.existingDepartment')}</Radio>
              <Radio value='new'>{t('team.organization.moveToOrg.newDepartment')}</Radio>
            </Radio.Group>
          )}
          {deptMode === 'existing' && hierarchy.departments.length > 0 ? (
            <Select
              value={departmentId}
              onChange={(val) => setDepartmentId(val)}
              placeholder={t('team.organization.moveToOrg.selectDepartmentPlaceholder')}
              data-testid='move-to-org-dept-select'
            >
              {hierarchy.departments.map((dept) => (
                <Select.Option key={dept.id} value={dept.id}>
                  <div className='flex items-center justify-between gap-8px'>
                    <span>{dept.name}</span>
                    {dept.workspacePath && (
                      <span className='text-11px font-mono text-t-tertiary truncate max-w-220px'>
                        {dept.workspacePath}
                      </span>
                    )}
                  </div>
                </Select.Option>
              ))}
            </Select>
          ) : (
            <Input
              value={newDepartmentName}
              onChange={setNewDepartmentName}
              placeholder={t('team.organization.moveToOrg.newDepartmentPlaceholder')}
              allowClear
              data-testid='move-to-org-new-dept-input'
            />
          )}
        </div>

        {/* Item Name & Description */}
        <div className='flex flex-col gap-6px'>
          <span className='text-12px font-medium text-t-primary'>{t('team.organization.moveToOrg.nameLabel')}</span>
          <Input
            value={itemName}
            onChange={setItemName}
            placeholder={t('team.organization.moveToOrg.namePlaceholder')}
            data-testid='move-to-org-name-input'
          />
        </div>

        <div className='flex flex-col gap-6px'>
          <span className='text-12px font-medium text-t-primary'>
            {t('team.organization.description', { defaultValue: 'Description' })}
          </span>
          <Input.TextArea
            value={description}
            onChange={setDescription}
            rows={2}
            placeholder={t('team.organization.moveToOrg.descriptionPlaceholder')}
          />
        </div>

        {/* Master Root Notice or Workspace Folder Options */}
        {!masterRoot ? (
          <Alert
            type='warning'
            showIcon
            content={
              <div className='flex items-center justify-between gap-8px'>
                <span className='text-12px'>{t('team.organization.moveToOrg.noMasterRootWarning')}</span>
                <Button
                  size='mini'
                  type='primary'
                  loading={settingMaster}
                  icon={<FolderOpen size={12} />}
                  onClick={() => void handlePickMasterRoot()}
                >
                  {t('team.organization.moveToOrg.setMasterFolder')}
                </Button>
              </div>
            }
          />
        ) : (
          <div className='flex flex-col gap-6px'>
            <span className='text-12px font-medium text-t-primary'>
              {t('team.organization.moveToOrg.orgFolderLabel')}
            </span>
            <div className='flex items-center gap-8px'>
              <Input
                value={targetWorkspace}
                onChange={(val) => {
                  setHasCustomTargetPath(true);
                  setTargetWorkspace(val);
                }}
                placeholder={effectiveParentRoot || ''}
                className='flex-1 !text-12px !font-mono'
                data-testid='move-to-org-workspace-input'
              />
              <Button icon={<FolderOpen size={14} />} onClick={() => void handleBrowseTargetFolder()}>
                {t('common.browse', { defaultValue: 'Browse' })}
              </Button>
            </div>
            {pathError && <span className='text-12px text-danger-6'>{pathError}</span>}
            {isSourceInsideParent ? (
              <span className='text-11px text-t-secondary'>{t('team.organization.moveToOrg.alreadyInOrgRoot')}</span>
            ) : (
              sourceWorkspace &&
              targetWorkspace.trim() && (
                <Radio.Group
                  value={fileTransferMode}
                  onChange={(val) => setFileTransferMode(val as FileTransferChoice)}
                  className='flex flex-col gap-4px pt-2px'
                >
                  <Radio value='copy'>{t('team.organization.moveToOrg.copyFiles')}</Radio>
                  <Radio value='move'>{t('team.organization.moveToOrg.moveFiles')}</Radio>
                  <Radio value='none'>{t('team.organization.moveToOrg.skipFiles')}</Radio>
                </Radio.Group>
              )
            )}
          </div>
        )}

        {/* Scope & Behavior Options */}
        <div className='flex flex-col gap-6px pt-2px'>
          {isTeam ? (
            <>
              <Checkbox checked={createLinkedProject} onChange={setCreateLinkedProject}>
                {t('team.organization.moveToOrg.createLinkedProject')}
              </Checkbox>
              {subTeamCount > 0 && (
                <Checkbox checked={includeSubTeams} onChange={setIncludeSubTeams}>
                  {t('team.organization.moveToOrg.includeSubTeams', { count: subTeamCount })}
                </Checkbox>
              )}
            </>
          ) : (
            <Checkbox checked={removeFromWorkplace} onChange={setRemoveFromWorkplace}>
              {t('team.organization.moveToOrg.removeFromWorkplace')}
            </Checkbox>
          )}
          <Checkbox checked={openInOrg} onChange={setOpenInOrg}>
            {t('team.organization.moveToOrg.openAfterMove')}
          </Checkbox>
        </div>
      </div>
    </AionModal>
  );
};

export default MoveToOrgModal;
