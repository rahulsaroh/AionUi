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
import { WorkspaceFolderSelect } from '@renderer/components/workspace';
import { useOrgStore } from '../store/useOrgStore';
import { validateWithinMaster, getDefaultProjectPath } from '../utils/orgPathUtils';

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
  const { hierarchy, upsertOrgProject, deleteOrgProject } = useOrgStore();
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [path, setPath] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<NonNullable<OrgProject['status']>>('active');
  const [pathScopeError, setPathScopeError] = useState<string | null>(null);

  const masterRoot = hierarchy.rootCeo.workspacePath || null;

  useEffect(() => {
    if (!path.trim() || !masterRoot) {
      setPathScopeError(null);
      return;
    }
    let cancelled = false;
    void validateWithinMaster(path, masterRoot).then((res) => {
      if (!cancelled) {
        setPathScopeError(
          res.valid ? null : res.error || 'Project folder must be inside the organization master folder'
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path, masterRoot]);

  useEffect(() => {
    if (!visible) return;
    if (project) {
      setName(project.name);
      setDepartmentId(project.departmentId);
      setTeamId(project.teamIds?.[0] ?? '');
      setPath(project.path ?? '');
      setDescription(project.description ?? '');
      setStatus(project.status ?? 'active');
      return;
    }
    const fallbackDept = defaultDepartmentId || hierarchy.departments[0]?.id || '';
    setName('');
    setDepartmentId(fallbackDept);
    setTeamId(defaultTeamId ?? '');
    setPath('');
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
    if (!name.trim() || !departmentId) return;

    if (path.trim() && masterRoot) {
      const check = await validateWithinMaster(path, masterRoot);
      if (!check.valid) {
        Message.error(check.error || 'Project folder must be inside the organization master folder');
        setPathScopeError(check.error || 'Project folder must be inside the organization master folder');
        return;
      }
    }

    try {
      upsertOrgProject({
        id: project?.id ?? `proj-${Date.now()}`,
        name: name.trim(),
        departmentId,
        teamIds: teamId ? [teamId] : [],
        path: path.trim() || undefined,
        description: description.trim() || undefined,
        status,
      });
      Message.success(t('team.organization.projectSaved', { defaultValue: 'Project saved' }));
      onClose();
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
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
            <Button onClick={onClose}>{t('team.organization.cancel', { defaultValue: 'Cancel' })}</Button>
            <Button type='primary' disabled={!name.trim() || !departmentId} onClick={handleSave}>
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
              {t('team.organization.folder', { defaultValue: 'Folder / codebase path' })}
            </span>
            {masterRoot && name.trim() && (
              <Button
                size='mini'
                type='text'
                onClick={() => setPath(getDefaultProjectPath(masterRoot, name))}
                className='!text-10px !h-20px !px-4px text-primary'
              >
                Auto-scaffold in Master Root
              </Button>
            )}
          </div>
          <WorkspaceFolderSelect
            value={path}
            onChange={setPath}
            placeholder={t('team.organization.assignFolder', { defaultValue: 'Assign folder inside master root...' })}
            recentLabel={t('team.create.recentLabel', { defaultValue: 'Recent' })}
            chooseDifferentLabel={t('team.create.chooseDifferentFolder', { defaultValue: 'Choose a different folder' })}
          />
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
