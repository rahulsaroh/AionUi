/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Select, Tag, InputNumber, Message } from '@arco-design/web-react';
import { Edit, FolderOpen, Setting, Terminal, LinkOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { OrgAgentMember, OrgDepartmentNode, OrgProject, OrgTeamNode } from '@/types/organization';
import { useOrgStore } from '../store/useOrgStore';
import { WorkspaceFolderSelect } from '@renderer/components/workspace';
import { MemberKnowledgePanel, KnowledgeChip } from '@/renderer/components/knowledge';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import {
  validateWithinMaster,
  validateOrgFolder,
  getDefaultDeptPath,
  getDefaultTeamPath,
  getDefaultProjectPath,
} from '../utils/orgPathUtils';

type EditEntityType = 'department' | 'team' | 'member' | 'project' | 'ceo';

type OrgEntityEditModalProps = {
  visible: boolean;
  entity: EditEntityType;
  /** The entity being edited. For members, also pass teamId or projectId via `context`. */
  data: OrgDepartmentNode | OrgTeamNode | OrgAgentMember | OrgProject | import('@/types/organization').RootCEO | null;
  context?: { departmentId?: string; teamId?: string; projectId?: string };
  onClose: () => void;
  onSave?: () => void;
};

export const OrgEntityEditModal: React.FC<OrgEntityEditModalProps> = ({
  visible,
  entity,
  data,
  context = {},
  onClose,
  onSave,
}) => {
  const { t } = useTranslation();
  const {
    updateDepartment,
    updateTeamNode,
    updateTeamMember,
    updateMember,
    addTeamMember,
    upsertOrgProject,
    updateRootCeo,
    updateAgentModel,
    removeDepartment,
    removeOrgTeam,
    removeTeamMember,
    removeMemberFromProject,
    deleteMember,
    deleteOrgProject,
    hierarchy,
    projects,
  } = useOrgStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [headName, setHeadName] = useState('');
  const [headPrompt, setHeadPrompt] = useState('');
  const [hrName, setHrName] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberRole, setMemberRole] = useState('');
  const [memberPrompt, setMemberPrompt] = useState('');
  const [memberMcp, setMemberMcp] = useState('');
  const [isKnowledgePanelOpen, setIsKnowledgePanelOpen] = useState(false);
  const [projectRepoIds, setProjectRepoIds] = useState<string[]>([]);
  const [draftProjectId] = useState(() => `proj-${Date.now()}`);
  const [modelId, setModelId] = useState('claude-3-7-sonnet');
  const [parentDeptId, setParentDeptId] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [folderPaths, setFolderPaths] = useState<string[]>([]);
  const [buildCmd, setBuildCmd] = useState('');
  const [runCmd, setRunCmd] = useState('');
  const [projectDeptId, setProjectDeptId] = useState('');
  const [projectTeamId, setProjectTeamId] = useState('');
  const [projectStatus, setProjectStatus] = useState<'active' | 'dormant' | 'done'>('active');
  const [pathScopeError, setPathScopeError] = useState<string | null>(null);

  const masterRoot = hierarchy.rootCeo.workspacePath || null;

  useEffect(() => {
    const paths = (entity === 'team' || entity === 'project' ? folderPaths : [folderPath]).filter((path) =>
      path.trim()
    );
    if (paths.length === 0 || !masterRoot) {
      setPathScopeError(null);
      return;
    }
    let cancelled = false;
    void Promise.all(paths.map((path) => validateWithinMaster(path, masterRoot))).then((results) => {
      if (!cancelled) {
        const invalid = results.find((result) => !result.valid);
        setPathScopeError(invalid?.error || (invalid ? 'Folder must be inside the organization master folder' : null));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [folderPath, folderPaths, entity, masterRoot]);

  const { providers, getAvailableModels, formatModelLabel } = useModelProviderList();

  const configuredModelOptions = useMemo(() => {
    const list: Array<{ label: string; value: string; group?: string; providerId?: string }> = [];
    for (const provider of providers ?? []) {
      const models = getAvailableModels(provider);
      for (const m of models) {
        list.push({
          label: formatModelLabel ? formatModelLabel(provider, m) : `${provider.name} - ${m}`,
          value: m,
          group: provider.name,
          providerId: provider.id,
        });
      }
    }
    // Fallback standard options if no providers yet configured
    if (list.length === 0) {
      list.push(
        { label: 'Claude 3.7 Sonnet', value: 'claude-3-7-sonnet' },
        { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet' },
        { label: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku' },
        { label: 'GPT-4o', value: 'gpt-4o' },
        { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
        { label: 'Gemini 2.0 Flash', value: 'gemini-2.0-flash' },
        { label: 'DeepSeek V3', value: 'deepseek-chat' },
        { label: 'DeepSeek R1', value: 'deepseek-reasoner' }
      );
    }
    if (modelId && !list.some((o) => o.value === modelId)) {
      list.unshift({
        label: `${t('common.customModel', { defaultValue: 'Custom Model' })}: ${modelId}`,
        value: modelId,
        group: 'Custom',
      });
    }
    return list;
  }, [providers, getAvailableModels, formatModelLabel, modelId, t]);

  const departmentOptions = useMemo(
    () => hierarchy.departments.map((d) => ({ label: d.name, value: d.id })),
    [hierarchy.departments]
  );

  const teamOptions = useMemo(() => {
    const dept = hierarchy.departments.find((d) => d.id === projectDeptId);
    return dept?.teams.map((t) => ({ label: t.name, value: t.id })) ?? [];
  }, [hierarchy.departments, projectDeptId]);

  const isEdit = Boolean(data);

  useEffect(() => {
    if (!visible) return;
    if (!data) {
      setProjectRepoIds([]);
      return;
    }
    setFolderPath('');
    setFolderPaths([]);
    setProjectDeptId('');
    setProjectTeamId('');

    if (entity === 'ceo') {
      const rootCeo = hierarchy.rootCeo;
      setName(rootCeo.name);
      setDescription('Chief Executive Command');
      setHeadName(rootCeo.ceoAgent.name);
      setHeadPrompt(rootCeo.ceoAgent.title ?? '');
      setModelId(rootCeo.ceoAgent.model?.modelId ?? 'claude-3-7-sonnet');
      setFolderPath(rootCeo.workspacePath ?? '');
    } else if (entity === 'department') {
      const dept = data as OrgDepartmentNode;
      setName(dept.name);
      setDescription(dept.description ?? '');
      setHeadName(dept.departmentCeoAgent.name);
      setHeadPrompt(dept.departmentCeoAgent.title ?? '');
      setModelId(dept.departmentCeoAgent.model?.modelId ?? 'claude-3-7-sonnet');
      setParentDeptId(dept.parentDepartmentId ?? '');
      setFolderPath(dept.workspacePath ?? '');
    } else if (entity === 'team') {
      const team = data as OrgTeamNode;
      setName(team.name);
      setDescription(team.description ?? '');
      setHeadName(team.teamLeadAgent.name);
      setHeadPrompt(team.teamLeadAgent.title ?? '');
      setModelId(team.teamLeadAgent.model?.modelId ?? 'claude-3-7-sonnet');
      setHrName(team.hrCoordinatorAgent?.name ?? '');
      setFolderPath(team.workspacePath ?? '');
      setFolderPaths(
        team.workspacePaths?.length ? team.workspacePaths : team.workspacePath ? [team.workspacePath] : ['']
      );
    } else if (entity === 'member') {
      const member = data as OrgAgentMember;
      setMemberName(member.name);
      setMemberRole(member.title ?? member.role);
      setMemberPrompt(member.title ?? '');
      setModelId(member.model?.modelId ?? 'claude-3-7-sonnet');
      setMemberMcp(member.assistant_backend ?? '');
    } else if (entity === 'project') {
      const project = data as OrgProject;
      setName(project.name);
      setDescription(project.description ?? '');
      setProjectDeptId(project.departmentId);
      setProjectTeamId(project.teamIds?.[0] ?? '');
      setFolderPath(project.workspacePath ?? project.path ?? '');
      setFolderPaths(
        project.workspacePaths?.length
          ? project.workspacePaths
          : project.workspacePath || project.path
            ? [project.workspacePath || project.path || '']
            : ['']
      );
      setProjectStatus((project.status ?? 'active') as 'active' | 'dormant' | 'done');
      setProjectRepoIds(project.context?.repos ?? []);
      setModelId(project.model?.modelId ?? '');
    }
  }, [visible, data, entity]);

  const handleSave = useCallback(async () => {
    const paths = (entity === 'team' || entity === 'project' ? folderPaths : [folderPath]).filter((path) =>
      path.trim()
    );
    if (masterRoot) {
      for (const path of paths) {
        const check = await validateWithinMaster(path, masterRoot);
        if (!check.valid) {
          Message.error(check.error || 'Folder must be inside the organization master folder');
          setPathScopeError(check.error || 'Folder must be inside the organization master folder');
          return;
        }
      }
    }
    if (entity === 'project' && paths.length > 0) {
      const parentRoot =
        hierarchy.departments.find((department) => department.id === projectDeptId)?.workspacePath || masterRoot;
      if (parentRoot) {
        for (const path of paths) {
          const check = await validateOrgFolder(path, parentRoot, 'project');
          if (!check.valid) {
            Message.error(check.error || 'Project folders must be inside the department folder');
            setPathScopeError(check.error || 'Project folders must be inside the department folder');
            return;
          }
        }
      }
    }

    if (entity === 'ceo') {
      updateRootCeo({
        name: name.trim() || hierarchy.rootCeo.name,
        workspacePath: folderPath.trim() || null,
      });
      const matchedProvider = providers?.find((p) => getAvailableModels(p).includes(modelId));
      updateAgentModel(hierarchy.rootCeo.ceoAgent.id, {
        modelId,
        providerId: matchedProvider?.id,
        modelName: matchedProvider && formatModelLabel ? formatModelLabel(matchedProvider, modelId) : modelId,
      });
      Message.success(t('team.organization.saved', { defaultValue: 'Saved successfully' }));
      onSave?.();
      onClose();
      return;
    }

    if (entity === 'department' && data) {
      const dept = data as OrgDepartmentNode;
      if (!name.trim()) return;
      const matchedProvider = providers?.find((provider) => getAvailableModels(provider).includes(modelId));
      updateDepartment(dept.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        departmentCeoAgent: {
          ...dept.departmentCeoAgent,
          name: headName.trim() || dept.departmentCeoAgent.name,
          title: headPrompt.trim() || dept.departmentCeoAgent.title,
          model: {
            modelId: modelId.trim() || 'claude-3-7-sonnet',
            providerId: matchedProvider?.id,
            modelName: matchedProvider && formatModelLabel ? formatModelLabel(matchedProvider, modelId) : modelId,
          },
        },
        parentDepartmentId: parentDeptId.trim() || null,
        workspacePath: folderPath.trim() || undefined,
      });
      onSave?.();
      onClose();
      return;
    }

    if (entity === 'team' && data && context.teamId) {
      const team = data as OrgTeamNode;
      if (!name.trim()) return;
      const assignedPaths = [...new Set(folderPaths.map((path) => path.trim()).filter(Boolean))];
      updateTeamNode(team.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        workspacePath: assignedPaths[0] || null,
        workspacePaths: assignedPaths,
        teamLeadAgent: {
          ...team.teamLeadAgent,
          name: headName.trim() || team.teamLeadAgent.name,
          title: headPrompt.trim() || team.teamLeadAgent.title,
          model: { modelId: modelId.trim() || 'claude-3-7-sonnet' },
        },
        ...(team.hrCoordinatorAgent
          ? {
              hrCoordinatorAgent: {
                ...team.hrCoordinatorAgent,
                name: hrName.trim() || team.hrCoordinatorAgent.name,
              },
            }
          : {}),
      });
      onSave?.();
      onClose();
      return;
    }

    if (entity === 'member') {
      if (!memberName.trim()) return;
      if (data) {
        const member = data as OrgAgentMember;
        const targetTeamId = context.teamId || member.assignedTeamIds?.[0];
        if (targetTeamId) {
          updateTeamMember(targetTeamId, member.id, {
            name: memberName.trim(),
            title: memberPrompt.trim() || undefined,
            role: (memberRole.trim() || member.role) as OrgAgentMember['role'],
            model: { modelId: modelId.trim() || 'claude-3-7-sonnet' },
            assistant_backend: memberMcp.trim() || undefined,
          });
        }
        updateMember(member.id, {
          name: memberName.trim(),
          title: memberPrompt.trim() || undefined,
          role: (memberRole.trim() || member.role) as OrgAgentMember['role'],
          model: { modelId: modelId.trim() || 'claude-3-7-sonnet' },
          assistant_backend: memberMcp.trim() || undefined,
        });
      } else if (context.teamId) {
        const newMember: OrgAgentMember = {
          id: `member-${Date.now()}`,
          canonicalAgentId: `canonical-member-${Date.now()}`,
          name: memberName.trim(),
          role: (memberRole.trim() || 'specialist') as OrgAgentMember['role'],
          title: memberPrompt.trim() || memberRole.trim() || 'Specialist',
          assignedTeamIds: [context.teamId],
          lastActiveAt: Date.now(),
          status: 'idle',
          model: { modelId: modelId.trim() || 'claude-3-7-sonnet' },
          assistant_backend: memberMcp.trim() || undefined,
        };
        addTeamMember(context.teamId, newMember);
      }
      onSave?.();
      onClose();
      return;
    }

    if (entity === 'project') {
      if (!name.trim() || !projectDeptId) return;
      const assignedPaths = [...new Set(folderPaths.map((path) => path.trim()).filter(Boolean))];
      const matchedOpt = configuredModelOptions.find((o) => o.value === modelId.trim());
      const selectedModel = modelId.trim()
        ? {
            modelId: modelId.trim(),
            providerId: matchedOpt?.providerId,
            modelName: matchedOpt?.label || modelId.trim(),
          }
        : undefined;

      const resolvedProjectId = (data as OrgProject | null)?.id ?? draftProjectId;
      upsertOrgProject({
        id: resolvedProjectId,
        name: name.trim(),
        departmentId: projectDeptId,
        teamIds: projectTeamId ? [projectTeamId] : [],
        path: assignedPaths[0] || undefined,
        workspacePath: assignedPaths[0] || null,
        workspacePaths: assignedPaths,
        context: {
          ...(data as OrgProject | null)?.context,
          workspacePaths: assignedPaths,
          repos: projectRepoIds,
        },
        description: description.trim() || undefined,
        status: projectStatus,
        model: selectedModel,
        leadAssistantId: (data as OrgProject | null)?.leadAssistantId,
        backendTeamId: (data as OrgProject | null)?.backendTeamId,
      });
      onSave?.();
      onClose();
      return;
    }
  }, [
    entity,
    data,
    context.teamId,
    name,
    description,
    headName,
    headPrompt,
    hrName,
    memberName,
    memberRole,
    memberPrompt,
    memberMcp,
    modelId,
    parentDeptId,
    folderPath,
    folderPaths,
    masterRoot,
    buildCmd,
    runCmd,
    projectDeptId,
    projectTeamId,
    projectStatus,
    projectRepoIds,
    draftProjectId,
    updateDepartment,
    updateTeamNode,
    updateTeamMember,
    updateMember,
    addTeamMember,
    upsertOrgProject,
    updateRootCeo,
    updateAgentModel,
    hierarchy.rootCeo,
    hierarchy.departments,
    providers,
    getAvailableModels,
    formatModelLabel,
    t,
    onSave,
    onClose,
  ]);

  const isProject = entity === 'project';
  const isMember = entity === 'member';
  const isTeam = entity === 'team';
  const isDept = entity === 'department';
  const isCeo = entity === 'ceo';
  const isRemovableMember = Boolean(
    isMember &&
    context.teamId &&
    hierarchy.departments.some((department) =>
      department.teams.some(
        (team) => team.id === context.teamId && team.specialistMembers.some((member) => member.id === data?.id)
      )
    )
  );

  const renderFolderList = (paths: string[], setPaths: React.Dispatch<React.SetStateAction<string[]>>) => (
    <div className='flex flex-col gap-6px'>
      {paths.map((path, index) => (
        <div key={`folder-${index}`} className='flex items-center gap-6px'>
          <div className='min-w-0 flex-1'>
            <WorkspaceFolderSelect
              value={path}
              onChange={(nextPath) =>
                setPaths((current) => current.map((item, itemIndex) => (itemIndex === index ? nextPath : item)))
              }
              placeholder={t('team.organization.assignFolder', { defaultValue: 'Choose folder' })}
              recentLabel={t('team.create.recentLabel', { defaultValue: 'Recent' })}
              chooseDifferentLabel={t('team.create.chooseDifferentFolder', { defaultValue: 'Browse folder' })}
            />
          </div>
          {paths.length > 1 && (
            <Button
              size='mini'
              type='text'
              status='danger'
              aria-label={t('common.remove', { defaultValue: 'Remove' })}
              onClick={() => setPaths((current) => current.filter((_, itemIndex) => itemIndex !== index))}
            >
              {t('common.remove', { defaultValue: 'Remove' })}
            </Button>
          )}
        </div>
      ))}
      <Button
        size='mini'
        type='text'
        className='self-start'
        disabled={paths.length >= 20}
        onClick={() => setPaths((current) => (current.length < 20 ? [...current, ''] : current))}
      >
        {t('common.add', { defaultValue: 'Add' })}
      </Button>
    </div>
  );

  const handleDelete = () => {
    if (!data || isCeo) return;
    Modal.confirm({
      title: t('common.delete', { defaultValue: 'Delete' }),
      content: t('team.sider.deleteConfirmContent', { defaultValue: 'This action cannot be undone.' }),
      okText: t('common.delete', { defaultValue: 'Delete' }),
      cancelText: t('common.cancel', { defaultValue: 'Cancel' }),
      okButtonProps: { status: 'danger' },
      onOk: () => {
        let deleted = false;
        if (isDept) deleted = removeDepartment(data.id);
        else if (isTeam) deleted = removeOrgTeam(data.id);
        else if (isMember && context.teamId) {
          deleted = removeTeamMember(context.teamId, data.id);
        } else if (isMember && context.projectId) {
          removeMemberFromProject(context.projectId, data.id);
          deleted = true;
        } else if (isMember) {
          deleteMember(data.id);
          deleted = true;
        } else if (isProject) {
          deleteOrgProject(data.id);
          deleted = true;
        }
        if (!deleted) {
          Message.error(t('common.deleteFailed', { defaultValue: 'Could not delete this item.' }));
          return;
        }
        Message.success(t('common.deleteSuccess', { defaultValue: 'Deleted successfully' }));
        onSave?.();
        onClose();
      },
    });
  };

  return (
    <>
      <Modal
        title={
          <div className='flex items-center gap-6px'>
            <Setting size={16} theme='outline' />
            <span className='font-bold text-13px text-t-primary'>
              {isCeo ? 'Edit Executive HQ (Root CEO)' : ''}
              {isDept ? t('team.organization.editDepartment', { defaultValue: 'Edit Department' }) : ''}
              {isTeam ? 'Edit Team' : ''}
              {isMember ? 'Edit Team Member' : ''}
              {isProject ? t('team.organization.editProject', { defaultValue: 'Edit Project' }) : ''}
            </span>
          </div>
        }
        visible={visible}
        onCancel={onClose}
        onOk={handleSave}
        okText={t('team.organization.save', { defaultValue: 'Save' })}
        cancelText={t('team.organization.cancel', { defaultValue: 'Cancel' })}
        okButtonProps={{ disabled: !name.trim() && !isMember && !isProject ? !name.trim() : false }}
        footer={
          <div className='flex items-center justify-between gap-8px'>
            <div>
              {data && (isDept || isTeam || isRemovableMember || isProject) ? (
                <Button status='danger' onClick={handleDelete}>
                  {t('common.delete', { defaultValue: 'Delete' })}
                </Button>
              ) : null}
            </div>
            <div className='flex items-center gap-8px'>
              <Button onClick={onClose}>{t('team.organization.cancel', { defaultValue: 'Cancel' })}</Button>
              <Button type='primary' onClick={() => void handleSave()}>
                {t('team.organization.save', { defaultValue: 'Save' })}
              </Button>
            </div>
          </div>
        }
      >
        <div className='flex flex-col gap-10px'>
          {isCeo && (
            <>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>HQ Display Name</span>
                <Input value={name} onChange={setName} placeholder='Root Executive HQ' />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Global CEO Agent Name</span>
                <Input value={headName} onChange={setHeadName} placeholder='Global Organization CEO' />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Title / Role</span>
                <Input value={headPrompt} onChange={setHeadPrompt} placeholder='Chief Executive Officer' />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Assigned AI Model (Root Default)</span>
                <Select
                  value={modelId}
                  onChange={setModelId}
                  placeholder='Select model for Root CEO...'
                  showSearch
                  allowCreate
                >
                  {configuredModelOptions.map((opt) => (
                    <Select.Option key={opt.value} value={opt.value}>
                      {opt.label}
                    </Select.Option>
                  ))}
                </Select>
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Master Organization Folder</span>
                <WorkspaceFolderSelect
                  value={folderPath}
                  onChange={setFolderPath}
                  placeholder='Bind master workspace directory...'
                  recentLabel={t('common.recent', { defaultValue: 'Recent' })}
                  chooseDifferentLabel={t('common.chooseFolder', { defaultValue: 'Browse...' })}
                />
              </div>
            </>
          )}
          {isDept && (
            <>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>
                  {t('team.organization.departmentName', { defaultValue: 'Department name' })}
                </span>
                <Input value={name} onChange={setName} autoFocus />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>
                  {t('team.organization.description', { defaultValue: 'Description' })}
                </span>
                <Input.TextArea value={description} onChange={setDescription} rows={2} />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Head / CEO Agent Name</span>
                <Input value={headName} onChange={setHeadName} />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>System Prompt / Role</span>
                <Input.TextArea value={headPrompt} onChange={setHeadPrompt} rows={2} />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Assigned AI Bot Model</span>
                <Select
                  value={modelId}
                  onChange={setModelId}
                  allowCreate
                  showSearch
                  placeholder='Select or type AI model'
                >
                  {configuredModelOptions.map((option) => (
                    <Select.Option key={option.value} value={option.value}>
                      {option.label}
                    </Select.Option>
                  ))}
                </Select>
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Parent Department</span>
                <Select value={parentDeptId} onChange={setParentDeptId} allowClear placeholder='Top-level (Root CEO)'>
                  {departmentOptions.map((opt) => (
                    <Select.Option key={opt.value} value={opt.value}>
                      {opt.label}
                    </Select.Option>
                  ))}
                </Select>
              </div>
              <div className='flex flex-col gap-4px'>
                <div className='flex items-center justify-between'>
                  <span className='text-12px text-t-secondary'>Department Workspace Folder Path</span>
                  {masterRoot && name.trim() && (
                    <Button
                      size='mini'
                      type='text'
                      onClick={() => setFolderPath(getDefaultDeptPath(masterRoot, name))}
                      className='!text-10px !h-20px !px-4px text-primary'
                    >
                      Auto-scaffold in Master Root
                    </Button>
                  )}
                </div>
                <div className='flex items-center gap-6px'>
                  <WorkspaceFolderSelect
                    value={folderPath}
                    onChange={setFolderPath}
                    placeholder='Choose subfolder within master root...'
                    recentLabel='Recent'
                    chooseDifferentLabel='Browse Folder...'
                  />
                </div>
                {pathScopeError ? (
                  <span className='text-10px text-red-500 font-mono'>{pathScopeError}</span>
                ) : masterRoot ? (
                  <span className='text-10px text-t-tertiary truncate'>
                    Must reside inside master folder: <code className='text-primary'>{masterRoot}</code>
                  </span>
                ) : (
                  <span className='text-10px text-amber-500'>Organization master folder is not set yet.</span>
                )}
              </div>
            </>
          )}

          {isTeam && (
            <>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Team Name</span>
                <Input value={name} onChange={setName} autoFocus />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>
                  {t('team.organization.description', { defaultValue: 'Description' })}
                </span>
                <Input.TextArea value={description} onChange={setDescription} rows={2} />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Team Lead / Head Name</span>
                <Input value={headName} onChange={setHeadName} />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Team Lead System Prompt</span>
                <Input.TextArea value={headPrompt} onChange={setHeadPrompt} rows={2} />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Assigned AI Bot Model (from App Settings)</span>
                <Select value={modelId} onChange={setModelId} allowCreate placeholder='Select or type AI model'>
                  {configuredModelOptions.map((opt) => (
                    <Select.Option key={opt.value} value={opt.value}>
                      {opt.label}
                    </Select.Option>
                  ))}
                </Select>
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>HR Coordinator Name</span>
                <Input value={hrName} onChange={setHrName} />
              </div>
              <div className='flex flex-col gap-4px'>
                <div className='flex items-center justify-between'>
                  <span className='text-12px text-t-secondary'>
                    {t('team.organization.folder', { defaultValue: 'Workspace folders' })} (
                    {folderPaths.filter((path) => path.trim()).length})
                  </span>
                  {masterRoot && name.trim() && (
                    <Button
                      size='mini'
                      type='text'
                      onClick={() => {
                        const dept = hierarchy.departments.find((d) => d.id === context.departmentId);
                        setFolderPaths([getDefaultTeamPath(masterRoot, dept?.name || 'department', name)]);
                      }}
                      className='!text-10px !h-20px !px-4px text-primary'
                    >
                      Auto-scaffold in Master Root
                    </Button>
                  )}
                </div>
                {renderFolderList(folderPaths, setFolderPaths)}
                {pathScopeError ? (
                  <span className='text-10px text-red-500 font-mono'>{pathScopeError}</span>
                ) : masterRoot ? (
                  <span className='text-10px text-t-tertiary truncate'>
                    Must reside inside master folder: <code className='text-primary'>{masterRoot}</code>
                  </span>
                ) : null}
              </div>
            </>
          )}

          {isMember && (
            <>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Member Name</span>
                <Input value={memberName} onChange={setMemberName} autoFocus />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Role</span>
                <Input value={memberRole} onChange={setMemberRole} />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>System Prompt</span>
                <Input.TextArea value={memberPrompt} onChange={setMemberPrompt} rows={2} />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Assigned AI Bot Model (from App Settings)</span>
                <Select value={modelId} onChange={setModelId} allowCreate placeholder='Select or type AI model'>
                  {configuredModelOptions.map((opt) => (
                    <Select.Option key={opt.value} value={opt.value}>
                      {opt.label}
                    </Select.Option>
                  ))}
                </Select>
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>MCP Tools / Backend</span>
                <Input value={memberMcp} onChange={setMemberMcp} placeholder='e.g. acp, filesystem, ...' />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Shared Departments</span>
                <Tag className='text-10px text-t-tertiary'>{context.departmentId || 'Current department'}</Tag>
              </div>
              {data && 'id' in data && (
                <div className='flex flex-col gap-4px'>
                  <span className='text-12px text-t-secondary'>Knowledge</span>
                  <div className='flex items-center gap-8px'>
                    <KnowledgeChip
                      memberKey={`org:${(data as OrgAgentMember).id}`}
                      memberName={memberName || (data as OrgAgentMember).name}
                      onClick={() => setIsKnowledgePanelOpen(true)}
                      showWhenEmpty
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {isProject && (
            <>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>
                  {t('team.organization.projectName', { defaultValue: 'Project name' })}
                </span>
                <Input value={name} onChange={setName} autoFocus />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>
                  {t('team.organization.department', { defaultValue: 'Department' })}
                </span>
                <Select value={projectDeptId} onChange={setProjectDeptId}>
                  {departmentOptions.map((opt) => (
                    <Select.Option key={opt.value} value={opt.value}>
                      {opt.label}
                    </Select.Option>
                  ))}
                </Select>
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>
                  {t('team.organization.team', { defaultValue: 'Team' })}
                </span>
                <Select value={projectTeamId} onChange={setProjectTeamId} allowClear placeholder='No team'>
                  {teamOptions.map((opt) => (
                    <Select.Option key={opt.value} value={opt.value}>
                      {opt.label}
                    </Select.Option>
                  ))}
                </Select>
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>{t('common.model', { defaultValue: 'Model' })}</span>
                <Select
                  value={modelId}
                  onChange={setModelId}
                  allowCreate
                  showSearch
                  allowClear
                  placeholder={t('conversation.selectModel', { defaultValue: 'Select or enter custom model...' })}
                >
                  {configuredModelOptions.map((opt) => (
                    <Select.Option key={opt.value} value={opt.value}>
                      {opt.label}
                    </Select.Option>
                  ))}
                </Select>
              </div>
              <div className='flex flex-col gap-4px'>
                <div className='flex items-center justify-between'>
                  <span className='text-12px text-t-secondary'>
                    {t('team.organization.folder', { defaultValue: 'Workspace folders' })} (
                    {folderPaths.filter((path) => path.trim()).length})
                  </span>
                  {masterRoot && name.trim() && (
                    <Button
                      size='mini'
                      type='text'
                      onClick={() => setFolderPaths([getDefaultProjectPath(masterRoot, name)])}
                      className='!text-10px !h-20px !px-4px text-primary'
                    >
                      Auto-scaffold in Master Root
                    </Button>
                  )}
                </div>
                {renderFolderList(folderPaths, setFolderPaths)}
                {pathScopeError ? (
                  <span className='text-10px text-red-500 font-mono'>{pathScopeError}</span>
                ) : masterRoot ? (
                  <span className='text-10px text-t-tertiary truncate'>
                    Must reside inside master folder: <code className='text-primary'>{masterRoot}</code>
                  </span>
                ) : null}
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Build Command</span>
                <Input value={buildCmd} onChange={setBuildCmd} placeholder='e.g. bun run build' />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Run Command</span>
                <Input value={runCmd} onChange={setRunCmd} placeholder='e.g. bun run dev' />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>
                  {t('team.organization.description', { defaultValue: 'Description' })}
                </span>
                <Input.TextArea value={description} onChange={setDescription} rows={2} />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>Status</span>
                <Select value={projectStatus} onChange={setProjectStatus}>
                  <Select.Option value='active'>
                    {t('team.organization.statusActive', { defaultValue: 'Active' })}
                  </Select.Option>
                  <Select.Option value='dormant'>
                    {t('team.organization.statusDormant', { defaultValue: 'Dormant' })}
                  </Select.Option>
                  <Select.Option value='done'>
                    {t('team.organization.statusDone', { defaultValue: 'Done' })}
                  </Select.Option>
                </Select>
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>
                  {t('team.knowledgeRepos.chipLabel', { defaultValue: 'Knowledge' })}
                </span>
                <div className='flex items-center gap-8px'>
                  <KnowledgeChip
                    memberKey={`project:${(data as OrgProject | null)?.id ?? draftProjectId}`}
                    memberName={name || (data as OrgProject | null)?.name || 'Project'}
                    onClick={() => setIsKnowledgePanelOpen(true)}
                    showWhenEmpty
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
      {isMember && data && 'id' in data && (
        <MemberKnowledgePanel
          memberKey={`org:${(data as OrgAgentMember).id}`}
          memberName={memberName || (data as OrgAgentMember).name}
          visible={isKnowledgePanelOpen}
          onClose={() => setIsKnowledgePanelOpen(false)}
        />
      )}
      {isProject && (
        <MemberKnowledgePanel
          memberKey={`project:${(data as OrgProject | null)?.id ?? draftProjectId}`}
          memberName={name || (data as OrgProject | null)?.name || 'Project'}
          visible={isKnowledgePanelOpen}
          hideDocumentKnowledge
          onClose={() => setIsKnowledgePanelOpen(false)}
          onSaved={(ids) => setProjectRepoIds(ids)}
        />
      )}
    </>
  );
};

export default React.memo(OrgEntityEditModal);
