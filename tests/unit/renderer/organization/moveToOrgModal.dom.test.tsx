/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TTeam } from '@/common/types/team/teamTypes';
import type { OrgHierarchy } from '@/types/organization';

const { navigateMock, moveTeamMock, moveProjectMock, pickMasterRootMock, messageSuccessMock, messageErrorMock } =
  vi.hoisted(() => ({
    navigateMock: vi.fn(),
    moveTeamMock: vi.fn(async () => ({
      departmentId: 'dept-eng',
      orgTeamId: 'team-org-1',
      orgProjectId: 'proj-org-1',
      movedTeamIds: ['wp-team-1'],
      movedConversationIds: [],
      workspacePath: '/company/hq/departments/engineering/my-team',
      status: 'active' as const,
    })),
    moveProjectMock: vi.fn(async () => ({
      departmentId: 'dept-eng',
      orgProjectId: 'proj-org-2',
      movedTeamIds: [],
      movedConversationIds: ['c-1'],
      workspacePath: '/company/hq/departments/engineering/my-project',
      status: 'active' as const,
    })),
    pickMasterRootMock: vi.fn(async () => ({ success: true, masterRoot: '/company/hq' })),
    messageSuccessMock: vi.fn(),
    messageErrorMock: vi.fn(),
  }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) || key,
  }),
}));

vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    org: {
      getMasterRoot: vi.fn(async () => '/company/hq'),
      pickMasterRoot: pickMasterRootMock,
      assertWithinScope: vi.fn(async (targetPath: string, allowedRoot: string) => ({
        allowed: targetPath.startsWith(allowedRoot),
        resolved: targetPath,
      })),
      loadData: vi.fn(async () => null),
      saveData: vi.fn(async () => true),
      getProjects: vi.fn(async () => []),
      saveProjects: vi.fn(async () => true),
      getMembers: vi.fn(async () => []),
    },
    dialog: {
      showOpen: { invoke: vi.fn(async () => []) },
    },
  },
}));

vi.mock('@/renderer/pages/organization/store/moveWorkplaceToOrg', () => ({
  moveWorkplaceTeamToOrg: moveTeamMock,
  moveWorkplaceProjectToOrg: moveProjectMock,
  suggestOrgTargetWorkspace: ({
    itemName,
    department,
  }: {
    itemName: string;
    department?: { workspacePath?: string | null } | null;
  }) => (department?.workspacePath ? `${department.workspacePath}/${itemName.toLowerCase().replace(/\s+/g, '-')}` : ''),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      success: messageSuccessMock,
      error: messageErrorMock,
    },
  };
});

import { MoveToOrgModal } from '@/renderer/pages/organization/move/MoveToOrgModal';
import { resetOrgStoreForTesting, setOrgStoreSnapshot } from '@/renderer/pages/organization/store/useOrgStore';

const hierarchyWithDept: OrgHierarchy = {
  rootCeo: {
    id: 'root-ceo',
    name: 'HQ',
    parentId: null,
    workspacePath: '/company/hq',
    status: 'idle',
    lastActiveAt: 1000,
    ceoAgent: {
      id: 'agent-ceo',
      canonicalAgentId: 'c-ceo',
      name: 'CEO',
      role: 'ceo',
      assignedTeamIds: [],
      lastActiveAt: 1000,
      status: 'idle',
    },
  },
  departments: [
    {
      id: 'dept-eng',
      name: 'Engineering',
      parentDepartmentId: 'root-ceo',
      workspacePath: '/company/hq/departments/engineering',
      status: 'idle',
      lastActiveAt: 1000,
      linkedProjects: [],
      teams: [],
      departmentCeoAgent: {
        id: 'agent-head-eng',
        canonicalAgentId: 'c-head-eng',
        name: 'Eng Head',
        role: 'department_head',
        assignedTeamIds: [],
        lastActiveAt: 1000,
        status: 'idle',
      },
    },
  ],
  lastUpdated: 1000,
};

const sampleTeam: TTeam = {
  id: 'wp-team-1',
  user_id: 'user-1',
  name: 'My Team',
  workspace: '/workplace/my-team',
  workspace_mode: 'shared',
  leader_assistant_id: 'slot-1',
  assistants: [
    {
      slot_id: 'slot-1',
      conversation_id: 'conv-1',
      role: 'leader',
      assistant_backend: 'claude',
      assistant_name: 'Lead',
      status: 'idle',
      context_reset: { supported: true, availability: 'ready' },
    },
  ],
  created_at: 1000,
  updated_at: 2000,
};

describe('MoveToOrgModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetOrgStoreForTesting();
    setOrgStoreSnapshot({
      activeScope: 'workplace',
      hierarchy: hierarchyWithDept,
      projects: [],
    });
  });

  it('submits moveWorkplaceTeamToOrg with selected existing department and navigates to /organization', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(
      <MoveToOrgModal
        visible={true}
        target={{ kind: 'team', team: sampleTeam }}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    const confirmBtn = screen.getByTestId('move-to-org-confirm-btn');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(moveTeamMock).toHaveBeenCalledWith(
        expect.objectContaining({
          team: sampleTeam,
          departmentId: 'dept-eng',
          targetName: 'My Team',
        })
      );
    });
    expect(navigateMock).toHaveBeenCalledWith('/organization');
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('prompts for new department name when organization has no departments and disables confirm until filled', async () => {
    setOrgStoreSnapshot({
      activeScope: 'workplace',
      hierarchy: { ...hierarchyWithDept, departments: [] },
    });

    render(
      <MoveToOrgModal
        visible={true}
        target={{
          kind: 'project',
          projectName: 'My Project',
          sourceWorkspace: '/workplace/my-project',
          conversations: [],
        }}
        onClose={vi.fn()}
      />
    );

    const confirmBtn = screen.getByTestId('move-to-org-confirm-btn');
    expect(confirmBtn).toBeDisabled();

    const newDeptInput = screen.getByTestId('move-to-org-new-dept-input');
    fireEvent.change(newDeptInput, { target: { value: 'Design' } });
    expect(confirmBtn).not.toBeDisabled();

    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(moveProjectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectName: 'My Project',
          newDepartmentName: 'Design',
        })
      );
    });
  });

  it('surfaces error message and keeps modal open when move fails', async () => {
    moveTeamMock.mockRejectedValueOnce(new Error('Target folder is invalid'));
    const onClose = vi.fn();

    render(<MoveToOrgModal visible={true} target={{ kind: 'team', team: sampleTeam }} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('move-to-org-confirm-btn'));

    await waitFor(() => {
      expect(messageErrorMock).toHaveBeenCalledWith('Target folder is invalid');
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
