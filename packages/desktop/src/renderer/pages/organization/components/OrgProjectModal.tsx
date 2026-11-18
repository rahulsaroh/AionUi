/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Message, Modal, Select } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { OrgProject } from '@/types/organization';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { WorkspaceFolderSelect } from '@renderer/components/workspace';
import { useOrgStore } from '../store/useOrgStore';
import { validateWithinMaster, validateOrgFolder, getDefaultProjectPath } from '../utils/orgPathUtils';
import { createProjectBackendTeam } from '../store/orgBackendTeam';

type OrgProjectModalProps = {
  visible: boolean;
  project: OrgProject | null;
  defaultDepartmentId?: string;
  defaultTeamId?: string;
  onClose: () => void;
};

export const OrgProjectModal: React.FC<OrgProjectModalProps> = ({
  visible,
  project,
  defaultDepartmentId,
  defaultTeamId,
  onClose,
}) => {
  const { t } = useTranslation();
  let user: { id?: string } | undefined;
  try {
    const auth = useAuth();
    user = auth.user;
  } catch {
    // In standalone or test environments without AuthProvider
    user = undefined;
  }
  const { hierarchy, upsertOrgProject, deleteOrgProject } = useOrgStore();
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [folderPaths, setFolderPaths] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<NonNullable<OrgProject['status']>>('active');
  const [pathScopeError, setPathScopeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const masterRoot = hierarchy.rootCeo.workspacePath || null;

  useEffect(() => {
    const paths = folderPaths.filter((folderPath) => folderPath.trim());
    if (paths.length === 0 || !masterRoot) {
      setPathScopeError(null);
      return;
    }
    let cancelled = false;
    void Promise.all(paths.map((folderPath) => validateWithinMaster(folderPath, masterRoot))).then((results) => {
      if (!cancelled) {
        const invalid = results.find((result) => !result.valid);
        setPathScopeError(
          invalid?.error || (invalid ? 'Project folder must be inside the organization master folder' : null)
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [folderPaths, masterRoot]);

  useEffect(() => {
    if (!visible) return;
    if (project) {
      setName(project.name);
      setDepartmentId(project.departmentId);
      setTeamId(project.teamIds?.[0] ?? '');
      setFolderPaths(
        project.workspacePaths?.length
          ? project.workspacePaths
          : project.workspacePath || project.path
            ? [project.workspacePath || project.path || '']
            : ['']
      );
      setDescription(project.description ?? '');
      setStatus(project.status ?? 'active');
      return;
    }
    const fallbackDept = defaultDepartmentId || hierarchy.departments[0]?.id || '';
    setName('');
    setDepartmentId(fallbackDept);
    setTeamId(defaultTeamId ?? '');
    setFolderPaths(['']);
    setDescription('');
    setStatus('active');
  }, [visible, project, defaultDepartmentId, defaultTeamId, hierarchy.departments]);

  const teamOptions = useMemo(() => {
    const department = hierarchy.departments.find((item) => item.id === departmentId);
    return department?.teams ?? [];
  }, [hierarchy.departments, departmentId]);

  useEffect(() => {
    if (teamId && !teamOptions.some((team) => team.id === teamId)) {
      setTeamId('');
    }
  }, [teamId, teamOptions]);

  const handleSave = async () => {
    if (!name.trim() || !departmentId || saving) return;

    const effectivePaths = [...new Set(folderPaths.map((folderPath) => folderPath.trim()).filter(Boolean))];
    if (effectivePaths.length === 0 && masterRoot) effectivePaths.push(getDefaultProjectPath(masterRoot, name.trim()));
    const effectivePath = effectivePaths[0] || '';

    if (masterRoot) {
      for (const folderPath of effectivePaths) {
        const check = await validateWithinMaster(folderPath, masterRoot);
        if (!check.valid) {
          Message.error(check.error || 'Project folder must be inside the organization master folder');
          setPathScopeError(check.error || 'Project folder must be inside the organization master folder');
          return;
        }
      }
    }
    const parentRoot =
      hierarchy.departments.find((department) => department.id === departmentId)?.workspacePath || masterRoot;
    if (parentRoot) {
      for (const folderPath of effectivePaths) {
        const check = await validateOrgFolder(folderPath, parentRoot, 'project');
        if (!check.valid) {
          Message.error(check.error || 'Project folders must be inside the department folder');
          setPathScopeError(check.error || 'Project folders must be inside the department folder');
          return;
        }
      }
    }

    setSaving(true);
    let backendTeamId = project?.backendTeamId;

    try {
      if (!backendTeamId) {
        if (!effectivePath) {
          throw new Error('Project folder path is required to initialize the project team.');
        }
        backendTeamId = await createProjectBackendTeam({
          name: name.trim(),
          workspacePath: effectivePath,
          description: description.trim() || undefined,
          masterRoot,
          userId: user?.id ?? 'system_default_user',
        });
      }

      upsertOrgProject({
        id: project?.id ?? `proj-${Date.now()}`,
        name: name.trim(),
        departmentId,
        teamIds: teamId ? [teamId] : [],
        path: effectivePath || undefined,
        workspacePath: effectivePath || undefined,
        workspacePaths: effectivePaths,
        context: { ...project?.context, workspacePaths: effectivePaths },
        description: description.trim() || undefined,
        status,
        backendTeamId,
        mode: project?.mode || 'organization',
      });
      Message.success(t('team.organization.projectSaved', { defaultValue: 'Project saved' }));
      onClose();
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!project) return;
    Modal.confirm({
      title: t('team.organization.deleteProject', { defaultValue: 'Delete project' }),
      content: t('team.organization.deleteProjectConfirm', { defaultValue: 'Delete this project assignment?' }),
      okButtonProps: { status: 'danger' },
      onOk: () => {
        deleteOrgProject(project.id);
        Message.success(t('team.organization.projectDeleted', { defaultValue: 'Project deleted' }));
        onClose();
      },
    });
  };

  return (
    <Modal
      title={
        project
          ? t('team.organization.editProject', { defaultValue: 'Edit Project' })
          : t('team.organization.addProject', { defaultValue: 'Add Project' })
      }
      visible={visible}
      onCancel={onClose}
      footer={
        <div className='flex items-center justify-between gap-8px'>
          <div>
            {project ? (
              <Button status='danger' icon={<Delete size={14} />} onClick={handleDelete}>
                {t('team.organization.deleteProject', { defaultValue: 'Delete project' })}
              </Button>
            ) : null}
          </div>
          <div className='flex items-center gap-8px'>
            <Button onClick={onClose} disabled={saving}>
              {t('team.organization.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              type='primary'
              loading={saving}
              disabled={!name.trim() || !departmentId || saving}
              onClick={handleSave}
            >
              {t('team.organization.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        </div>
      }
    >
      <div className='flex flex-col gap-10px'>
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
          <Select value={departmentId} onChange={setDepartmentId}>
            {hierarchy.departments.map((department) => (
              <Select.Option key={department.id} value={department.id}>
                {department.name}
              </Select.Option>
            ))}
          </Select>
        </div>
        <div className='flex flex-col gap-4px'>
          <span className='text-12px text-t-secondary'>{t('team.organization.team', { defaultValue: 'Team' })}</span>
          <Select
            value={teamId}
            onChange={setTeamId}
            allowClear
            placeholder={t('team.organization.noTeam', { defaultValue: 'No team' })}
          >
            {teamOptions.map((team) => (
              <Select.Option key={team.id} value={team.id}>
                {team.name}
              </Select.Option>
            ))}
          </Select>
        </div>
        <div className='flex flex-col gap-4px'>
          <div className='flex items-center justify-between'>
            <span className='text-12px text-t-secondary'>
              {t('team.organization.folder', { defaultValue: 'Folder / codebase path' })} (
              {folderPaths.filter((folderPath) => folderPath.trim()).length})
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
          <div className='flex flex-col gap-6px'>
            {folderPaths.map((folderPath, index) => (
              <div key={`project-folder-${index}`} className='flex items-center gap-6px'>
                <div className='min-w-0 flex-1'>
                  <WorkspaceFolderSelect
                    value={folderPath}
                    onChange={(nextPath) =>
                      setFolderPaths((current) =>
                        current.map((item, itemIndex) => (itemIndex === index ? nextPath : item))
                      )
                    }
                    placeholder={t('team.organization.assignFolder', {
                      defaultValue: 'Assign folder inside master root...',
                    })}
                    recentLabel={t('team.create.recentLabel', { defaultValue: 'Recent' })}
                    chooseDifferentLabel={t('team.create.chooseDifferentFolder', {
                      defaultValue: 'Choose a different folder',
                    })}
                  />
                </div>
                {folderPaths.length > 1 && (
                  <Button
                    size='mini'
                    type='text'
                    status='danger'
                    aria-label={t('common.remove', { defaultValue: 'Remove' })}
                    onClick={() => setFolderPaths((current) => current.filter((_, itemIndex) => itemIndex !== index))}
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
              disabled={folderPaths.length >= 20}
              onClick={() => setFolderPaths((current) => (current.length < 20 ? [...current, ''] : current))}
            >
              {t('common.add', { defaultValue: 'Add' })}
            </Button>
          </div>
          {pathScopeError ? (
            <span className='text-10px text-red-500 font-mono'>{pathScopeError}</span>
          ) : masterRoot ? (
            <span className='text-10px text-t-tertiary truncate'>
              Must reside inside master folder: <code className='text-primary'>{masterRoot}</code>
            </span>
          ) : null}
          <span className='text-11px text-t-tertiary'>
            {t('team.organization.folderHint', {
              defaultValue: 'Assign a folder so agents can work in this codebase.',
            })}
          </span>
        </div>
        <div className='flex flex-col gap-4px'>
          <span className='text-12px text-t-secondary'>
            {t('team.organization.description', { defaultValue: 'Description' })}
          </span>
          <Input.TextArea value={description} onChange={setDescription} rows={2} />
        </div>
        <div className='flex flex-col gap-4px'>
          <span className='text-12px text-t-secondary'>Status</span>
          <Select value={status} onChange={(value) => setStatus(value as NonNullable<OrgProject['status']>)}>
            <Select.Option value='active'>
              {t('team.organization.statusActive', { defaultValue: 'Active' })}
            </Select.Option>
            <Select.Option value='dormant'>
              {t('team.organization.statusDormant', { defaultValue: 'Dormant' })}
            </Select.Option>
            <Select.Option value='done'>{t('team.organization.statusDone', { defaultValue: 'Done' })}</Select.Option>
          </Select>
        </div>
      </div>
    </Modal>
  );
};

export default React.memo(OrgProjectModal);
