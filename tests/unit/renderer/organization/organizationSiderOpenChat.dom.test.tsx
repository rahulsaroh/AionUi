/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OrgHierarchy, OrgProject } from '@/types/organization';

const { openChatMock } = vi.hoisted(() => ({
  openChatMock: vi.fn(() => ({ ok: true }) as { ok: boolean; error?: string }),
}));

let storeState: Record<string, unknown>;

vi.mock('@/renderer/pages/organization/store/useOrgStore', () => ({
  useOrgStore: () => storeState,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      String(opts?.defaultValue || key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(opts?.[name] ?? '')),
  }),
}));

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useModelProviderList: () => ({
    providers: [],
    getAvailableModels: () => [],
    formatModelLabel: (model: string) => model,
  }),
}));

import OrganizationSiderContent from '@/renderer/components/layout/Sider/OrganizationSiderContent';
import { OrgChatErrorPanel } from '@/renderer/pages/organization/components/OrgChatView';

const makeHierarchy = (): OrgHierarchy => ({
  rootCeo: {
    id: 'root-ceo',
    name: 'Root',
    parentId: null,
    status: 'idle',
    lastActiveAt: 1,
    workspacePath: '/root',
    ceoAgent: {
      id: 'agent-root-ceo',
      canonicalAgentId: 'canonical-root-ceo',
      name: 'CEO',
      title: 'CEO',
      role: 'ceo',
      assignedTeamIds: [],
      status: 'idle',
      lastActiveAt: 1,
    },
  },
  departments: [
    {
      id: 'dept-1',
      name: 'Engineering',
      parentDepartmentId: 'root-ceo',
      workspacePath: '/dept-eng',
      status: 'idle',
      lastActiveAt: 1,
      linkedProjects: [],
      departmentCeoAgent: {
        id: 'agent-dept-head',
        canonicalAgentId: 'canon-dept-head',
        name: 'Dept Head',
        title: 'Department Head',
        role: 'department_head',
        assignedTeamIds: [],
        status: 'idle',
        lastActiveAt: 1,
      },
      pmAgent: {
        id: 'agent-pm',
        canonicalAgentId: 'canon-pm',
        name: 'PM',
        title: 'PM',
        role: 'project_manager',
        assignedTeamIds: [],
        status: 'idle',
        lastActiveAt: 1,
      },
      teams: [
        {
          id: 'team-1',
          departmentId: 'dept-1',
          name: 'Core Team',
          status: 'idle',
          lastActiveAt: 1,
          workspacePath: '/team-core',
          teamLeadAgent: {
            id: 'agent-lead',
            canonicalAgentId: 'canon-lead',
            name: 'Lead',
            title: 'Team Lead',
            role: 'team_lead',
            assignedTeamIds: ['team-1'],
            status: 'idle',
            lastActiveAt: 1,
          },
          specialistMembers: [
            {
              id: 'agent-member',
              canonicalAgentId: 'canon-member',
              name: 'Member',
              title: 'Dev',
              role: 'specialist',
              assignedTeamIds: ['team-1'],
              status: 'idle',
              lastActiveAt: 1,
            },
          ],
        },
      ],
    },
  ],
  lastUpdated: 1,
});

const makeProject = (): OrgProject => ({
  id: 'proj-1',
  name: 'Project One',
  departmentId: 'dept-1',
  teamIds: ['team-1'],
  status: 'active',
  workspacePath: '/proj-one',
  path: '/proj-one',
});

const renderSider = () =>
  render(
    <MemoryRouter>
      <OrganizationSiderContent collapsed={false} siderTooltipProps={{}} />
    </MemoryRouter>
  );

describe('OrganizationSiderContent openChat wiring', () => {
  beforeEach(() => {
    localStorage.clear();
    openChatMock.mockClear();
    storeState = {
      hierarchy: makeHierarchy(),
      projects: [makeProject()],
      conversations: [],
      cronJobs: [],
      nodeStatuses: {},
      updateNodeStatus: vi.fn(),
      addOrgConversation: vi.fn(),
      addDepartment: vi.fn(),
      updateDepartment: vi.fn(),
      addSubTeam: vi.fn(),
      addOrgProject: vi.fn(),
      addTeamMember: vi.fn(),
      updateRootCeo: vi.fn(),
      selectedDepartmentId: 'dept-1',
      selectedTeamId: 'team-1',
      selectedProjectId: null,
      setSelectedDepartment: vi.fn(),
      setSelectedTeam: vi.fn(),
      setSelectedProject: vi.fn(),
      clearOrgSelection: vi.fn(),
      orgViewMode: 'chat',
      setOrgViewMode: vi.fn(),
      selectedConversationId: null,
      setSelectedConversationId: vi.fn(),
      openChat: openChatMock,
    };
  });

  it('opens the department head chat from the department row', () => {
    renderSider();
    fireEvent.click(screen.getByLabelText('Open chat with Engineering'));
    expect(openChatMock).toHaveBeenCalledWith({ type: 'department_head', id: 'dept-1' });
  });

  it('opens the project head chat from the project row and selects the project', () => {
    renderSider();
    fireEvent.click(screen.getByText('Projects'));
    fireEvent.click(screen.getByLabelText('Open chat with Project One'));
    expect(openChatMock).toHaveBeenCalledWith({ type: 'project_head', id: 'proj-1' });
    expect(storeState.setSelectedProject).toHaveBeenCalledWith('proj-1');
  });

  it('opens a member chat from the team roster', () => {
    renderSider();
    fireEvent.click(screen.getByLabelText('Open chat with Member'));
    expect(openChatMock).toHaveBeenCalledWith({ type: 'member', id: 'agent-member' });
  });

  it('does not open a chat when the expand chevron is clicked', () => {
    renderSider();
    fireEvent.click(screen.getByLabelText('Collapse'));
    expect(openChatMock).not.toHaveBeenCalled();
  });

  it('does not open a chat when the row menu button or its items are clicked', () => {
    renderSider();
    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByText('Edit Department'));
    expect(openChatMock).not.toHaveBeenCalled();
  });
});

describe('OrgChatErrorPanel', () => {
  it('renders the inline error with the store error text', () => {
    render(<OrgChatErrorPanel error='Agent could not be resolved' onDismiss={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not open this chat: Agent could not be resolved');
  });

  it('renders nothing when there is no error', () => {
    const { container } = render(<OrgChatErrorPanel error={null} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('calls onDismiss when dismissed', () => {
    const onDismiss = vi.fn();
    render(<OrgChatErrorPanel error='boom' onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
