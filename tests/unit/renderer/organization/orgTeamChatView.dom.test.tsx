/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrgTeamChatHeader } from '@/renderer/pages/organization/components/teamChat/OrgTeamChatHeader';
import { OrgTeamChatSlot } from '@/renderer/pages/organization/components/teamChat/OrgTeamChatSlot';
import { SiderMemberRow } from '@/renderer/components/layout/Sider/SiderMemberRow';
import type { OrgTeamNode, OrgAgentMember, OrgConversation } from '@/types/organization';

const mockTranslate = (key: string, opts?: Record<string, unknown>): string => {
  let str = (opts?.defaultValue as string) || key;
  if (opts) {
    for (const [k, v] of Object.entries(opts)) {
      str = str.replace(`{{${k}}}`, String(v));
    }
  }
  return str;
};

vi.mock('@/renderer/services/i18n', () => ({
  default: {
    t: mockTranslate,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

let storeState: Record<string, unknown> = {};

vi.mock('@/renderer/pages/organization/store/useOrgStore', () => ({
  useOrgStore: () => storeState,
}));

const mockTeamLead: OrgAgentMember = {
  id: 'lead-1',
  name: 'Alice Lead',
  role: 'lead',
  title: 'Lead Architect',
  status: 'idle',
};

const mockHr: OrgAgentMember = {
  id: 'hr-1',
  name: 'Bob HR',
  role: 'hr',
  title: 'HR Coordinator',
  status: 'idle',
};

const mockSpecialist: OrgAgentMember = {
  id: 'spec-1',
  name: 'Charlie Dev',
  role: 'specialist',
  title: 'Senior Developer',
  status: 'idle',
};

const mockTeam: OrgTeamNode = {
  id: 'team-eng-core',
  departmentId: 'dept-1',
  name: 'Core Engineering',
  teamLeadAgent: mockTeamLead,
  hrCoordinatorAgent: mockHr,
  specialistMembers: [mockSpecialist],
  status: 'idle',
  lastActiveAt: Date.now(),
};

describe('OrgTeamChatHeader', () => {
  it('renders team name, department tag, and all team member tabs', () => {
    const onSelectMember = vi.fn();
    const onChangeViewMode = vi.fn();

    render(
      <OrgTeamChatHeader
        team={mockTeam}
        departmentName='Engineering'
        members={[mockTeamLead, mockHr, mockSpecialist]}
        activeMemberId='lead-1'
        viewMode='parallel'
        onChangeViewMode={onChangeViewMode}
        onSelectMember={onSelectMember}
      />
    );

    expect(screen.getByText('Core Engineering')).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();

    // Verify all member tabs are rendered
    expect(screen.getByText('Alice Lead')).toBeInTheDocument();
    expect(screen.getByText('Bob HR')).toBeInTheDocument();
    expect(screen.getByText('Charlie Dev')).toBeInTheDocument();

    // Clicking a tab triggers selection
    fireEvent.click(screen.getByText('Bob HR'));
    expect(onSelectMember).toHaveBeenCalledWith('hr-1');
  });

  it('triggers view mode switch between parallel and single', () => {
    const onChangeViewMode = vi.fn();

    render(
      <OrgTeamChatHeader
        team={mockTeam}
        departmentName='Engineering'
        members={[mockTeamLead, mockHr, mockSpecialist]}
        activeMemberId='lead-1'
        viewMode='parallel'
        onChangeViewMode={onChangeViewMode}
        onSelectMember={vi.fn()}
      />
    );

    // Click single view mode button
    const singleButton = screen.getByText('Single');
    fireEvent.click(singleButton);
    expect(onChangeViewMode).toHaveBeenCalledWith('single');

    // Click parallel view mode button
    const parallelButton = screen.getByText('Parallel');
    fireEvent.click(parallelButton);
    expect(onChangeViewMode).toHaveBeenCalledWith('parallel');
  });
});

describe('OrgTeamChatSlot', () => {
  const mockConversation: OrgConversation = {
    id: 'conv-1',
    title: 'Alice Lead - Chat',
    type: 'agent_direct',
    sourceNodeId: 'team-eng-core',
    targetNodeId: 'lead-1',
    teamId: 'team-eng-core',
    targetAgentId: 'lead-1',
    timestamp: Date.now(),
    summary: '',
    messages: [
      {
        id: 'msg-1',
        sender: 'User',
        role: 'user',
        content: 'Hello team lead',
        timestamp: Date.now() - 1000,
      },
      {
        id: 'msg-2',
        sender: 'Alice Lead',
        role: 'assistant',
        content: 'Hi! Ready to coordinate tasks.',
        timestamp: Date.now(),
      },
    ],
  };

  it('renders member header with role tag and message history', () => {
    const onToggleFullscreen = vi.fn();
    const onSendMessage = vi.fn();

    render(
      <OrgTeamChatSlot
        member={mockTeamLead}
        team={mockTeam}
        conversation={mockConversation}
        isLeader={true}
        isHr={false}
        isFullscreen={false}
        isExecuting={false}
        onToggleFullscreen={onToggleFullscreen}
        onSendMessage={onSendMessage}
        onSelectModel={vi.fn()}
      />
    );

    expect(screen.getAllByText('Alice Lead').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('LEAD')).toBeInTheDocument();
    expect(screen.getByText('Hello team lead')).toBeInTheDocument();
    expect(screen.getByText('Hi! Ready to coordinate tasks.')).toBeInTheDocument();
  });

  it('triggers onToggleFullscreen when fullscreen button clicked', () => {
    const onToggleFullscreen = vi.fn();

    render(
      <OrgTeamChatSlot
        member={mockHr}
        team={mockTeam}
        conversation={mockConversation}
        isLeader={false}
        isHr={true}
        isFullscreen={false}
        isExecuting={false}
        onToggleFullscreen={onToggleFullscreen}
        onSendMessage={vi.fn()}
        onSelectModel={vi.fn()}
      />
    );

    const fullscreenBtn = screen.getByRole('button', { name: /Full screen/i });
    fireEvent.click(fullscreenBtn);
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it('sends message when user types and sends', async () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);

    render(
      <OrgTeamChatSlot
        member={mockSpecialist}
        team={mockTeam}
        conversation={mockConversation}
        isLeader={false}
        isHr={false}
        isFullscreen={false}
        isExecuting={false}
        onToggleFullscreen={vi.fn()}
        onSendMessage={onSendMessage}
        onSelectModel={vi.fn()}
      />
    );

    const textarea = screen.getByPlaceholderText(/Message Charlie Dev/i);
    fireEvent.change(textarea, { target: { value: 'Analyze performance' } });

    const sendButton = screen.getByRole('button', { name: /Send/i });
    fireEvent.click(sendButton);

    expect(onSendMessage).toHaveBeenCalledWith('Analyze performance');
  });
});

describe('OrgChatView with Team Chat Mode', () => {
  it('renders all team members side by side when chatting with team leader or HR', async () => {
    const { OrgChatView } = await import('@/renderer/pages/organization/components/OrgChatView');
    const { MemoryRouter } = await import('react-router-dom');

    const leadConversation: OrgConversation = {
      id: 'conv-lead-1',
      title: 'Alice Lead - Chat',
      type: 'agent_direct',
      sourceNodeId: 'team-eng-core',
      targetNodeId: 'lead-1',
      teamId: 'team-eng-core',
      targetAgentId: 'lead-1',
      timestamp: Date.now(),
      summary: '',
      messages: [],
    };

    const mockHierarchy: OrgHierarchy = {
      rootCeo: {
        id: 'root-ceo',
        name: 'Root CEO',
        parentId: null,
        ceoAgent: { id: 'ceo-1', name: 'CEO', role: 'ceo', status: 'idle' },
        status: 'idle',
        lastActiveAt: 1,
        workspacePath: '/root',
      },
      departments: [
        {
          id: 'dept-1',
          name: 'Engineering',
          parentDepartmentId: 'root-ceo',
          status: 'idle',
          lastActiveAt: 1,
          linkedProjects: [],
          departmentCeoAgent: { id: 'dept-head-1', name: 'Dept Head', role: 'department_head', status: 'idle' },
          teams: [mockTeam],
        },
      ],
      lastUpdated: 1,
    };

    // Mock store state
    storeState = {
      hierarchy: mockHierarchy,
      projects: [],
      conversations: [leadConversation],
      selectedConversationId: 'conv-lead-1',
      selectedTeamId: 'team-eng-core',
      setSelectedConversationId: vi.fn(),
      setOrgViewMode: vi.fn(),
      setSelectedDepartment: vi.fn(),
      setSelectedTeam: vi.fn(),
      setSelectedProject: vi.fn(),
      addOrgConversation: vi.fn(),
      addDepartment: vi.fn(),
      addSubTeam: vi.fn(),
      addOrgProject: vi.fn(),
      addTeamMember: vi.fn(),
      updateNodeStatus: vi.fn(),
      touchNodeActivity: vi.fn(),
      updateAgentModel: vi.fn(),
      updateRootCeo: vi.fn(),
      openChatError: null,
      clearOpenChatError: vi.fn(),
      autoApprovePermissions: 'off',
      setAutoApprovePermissions: vi.fn(),
    };

    render(
      <MemoryRouter>
        <OrgChatView />
      </MemoryRouter>
    );

    // Header rendered with Team name
    expect(screen.getByText('Core Engineering')).toBeInTheDocument();

    // All 3 team members are present in the side-by-side view
    expect(screen.getAllByText('Alice Lead').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Bob HR').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Charlie Dev').length).toBeGreaterThanOrEqual(1);

    // View toggle is present with Parallel and Single
    expect(screen.getByText('Parallel')).toBeInTheDocument();
    expect(screen.getByText('Single')).toBeInTheDocument();

    // Toggle to Single mode
    fireEvent.click(screen.getByText('Single'));

    // In single mode, the single full-screen member is active
    expect(screen.getAllByText('Alice Lead').length).toBeGreaterThanOrEqual(1);
  });

  describe('SiderMemberRow', () => {
    it('does not display "No chats yet." and handles selection & new chat separately', () => {
      const onSelectMember = vi.fn();
      const onNewChat = vi.fn();
      const onToggleCollapse = vi.fn();

      const { rerender } = render(
        <SiderMemberRow
          member={mockSpecialist}
          isSelected={false}
          hasChats={false}
          onSelectMember={onSelectMember}
          onNewChat={onNewChat}
        />
      );

      // Verify no "No chats yet." text exists
      expect(screen.queryByText(/no chats/i)).not.toBeInTheDocument();

      // Click member row -> onSelectMember
      fireEvent.click(screen.getByText('Charlie Dev'));
      expect(onSelectMember).toHaveBeenCalledTimes(1);

      // Click '+' icon -> onNewChat
      const newChatBtn = screen.getByRole('button', { name: /new chat with charlie dev/i });
      fireEvent.click(newChatBtn);
      expect(onNewChat).toHaveBeenCalledTimes(1);

      // When hasChats is true and onToggleCollapse provided, collapse button is shown
      rerender(
        <SiderMemberRow
          member={mockSpecialist}
          isSelected={false}
          hasChats={true}
          isCollapsed={false}
          onToggleCollapse={onToggleCollapse}
          onSelectMember={onSelectMember}
          onNewChat={onNewChat}
        />
      );

      const collapseBtn = screen.getByTitle('Collapse chats');
      expect(collapseBtn).toBeInTheDocument();
      fireEvent.click(collapseBtn);
      expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    });
  });
});
