/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type {
  OrgAgentMember,
  OrgConversation,
  OrgCreatedEntityRef,
  OrgDepartmentNode,
  OrgHierarchy,
  OrgProject,
  OrgTeamNode,
} from '@/types/organization';

const { runAgentTurnMock } = vi.hoisted(() => ({ runAgentTurnMock: vi.fn() }));

let storeState: Record<string, unknown>;

vi.mock('@/renderer/pages/organization/store/useOrgStore', () => ({
  useOrgStore: () => storeState,
}));

vi.mock('@/renderer/pages/organization/utils/agentTurn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/pages/organization/utils/agentTurn')>();
  return { ...actual, runAgentTurn: runAgentTurnMock };
});

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useModelProviderList: () => ({
    providers: [{ id: 'p1' }],
    getAvailableModels: () => ['model-lead'],
    formatModelLabel: (_provider: unknown, model: string) => model,
  }),
}));

vi.mock('@/renderer/pages/organization/components/OrgModelSelector', () => ({
  OrgModelSelector: ({ currentModel }: { currentModel?: { modelName?: string; modelId?: string } }) => (
    <span data-testid='org-model-selector'>{currentModel?.modelName || currentModel?.modelId || 'No model'}</span>
  ),
}));

vi.mock('@/renderer/pages/organization/components/OrgMasterFolderModal', () => ({
  OrgMasterFolderModal: () => null,
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  };
});

const { openFolderWithMock } = vi.hoisted(() => ({ openFolderWithMock: vi.fn(async () => undefined) }));

vi.mock('@/common', () => ({
  ipcBridge: {
    shell: { openFolderWith: { invoke: openFolderWithMock } },
    org: { saveData: vi.fn(async () => undefined), loadData: vi.fn(async () => null) },
    conversation: { stop: { invoke: vi.fn(async () => undefined) } },
  },
}));

import { OrgChatView } from '@/renderer/pages/organization/components/OrgChatView';

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
      model: { providerId: 'p1', modelId: 'model-ceo', modelName: 'CEO Model' },
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
            model: { providerId: 'p1', modelId: 'model-lead', modelName: 'Lead Model' },
          },
          specialistMembers: [],
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

const makeConversation = (messages: OrgConversation['messages'] = []): OrgConversation => ({
  id: 'conv-proj-1',
  title: 'Project One - Chat',
  type: 'team_execution',
  projectId: 'proj-1',
  departmentId: 'dept-1',
  teamId: 'team-1',
  sourceNodeId: 'team-1',
  targetNodeId: 'team-1',
  targetAgentId: 'agent-lead',
  targetRole: 'team_lead',
  targetAgentName: 'Lead',
  timestamp: 1,
  summary: '',
  messages,
});

const makeAgent = (id: string, name: string, role: string, extra: Partial<OrgAgentMember> = {}): OrgAgentMember => ({
  id,
  canonicalAgentId: `canon-${id}`,
  name,
  title: name,
  role,
  assignedTeamIds: [],
  lastActiveAt: 1,
  status: 'idle',
  ...extra,
});

const makeCeoConversation = (messages: OrgConversation['messages'] = []): OrgConversation => ({
  id: 'conv-ceo-1',
  title: 'CEO chat',
  type: 'ceo_directive',
  sourceNodeId: 'root-ceo',
  targetNodeId: 'root-ceo',
  timestamp: 1,
  summary: '',
  messages,
});

const renderView = () =>
  render(
    <MemoryRouter>
      <OrgChatView />
    </MemoryRouter>
  );

const sendPrompt = async (text: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
};

describe('OrgChatView unified agent turn', () => {
  beforeEach(() => {
    runAgentTurnMock.mockReset();
    openFolderWithMock.mockClear();
    runAgentTurnMock.mockImplementation(() => ({
      events: (async function* () {
        yield { type: 'text-delta', data: { text: 'Project reply' } };
        yield { type: 'done', data: { finalSynthesis: 'Project reply' } };
      })(),
      cancel: vi.fn(),
    }));

    storeState = {
      hierarchy: makeHierarchy(),
      projects: [makeProject()],
      conversations: [makeConversation()],
      selectedConversationId: 'conv-proj-1',
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
      updateAgentModel: vi.fn(),
      updateRootCeo: vi.fn(),
      openChatError: null,
      clearOpenChatError: vi.fn(),
    };
  });

  it('sends a project-head thread through runAgentTurn with the project workspace', async () => {
    renderView();
    await sendPrompt('hello project');

    await waitFor(() => expect(runAgentTurnMock).toHaveBeenCalledTimes(1));
    const options = runAgentTurnMock.mock.calls[0][0];
    expect(options.threadId).toBe('conv-proj-1');
    expect(options.target).toEqual({ type: 'project_head', id: 'proj-1' });
    expect(options.agent.id).toBe('agent-lead');
    expect(options.workspacePath).toBe('/proj-one');
    expect(options.isCeo).toBe(false);
    expect(options.userText).toBe('hello project');
    expect(options.systemContext).toContain('[Org Agent Context]');
    expect(options.systemContext).toContain('Project One');
  });

  it('shows the target agent, its model, the working folder and the idle status in the header', () => {
    renderView();
    expect(screen.getByText('Lead')).toBeInTheDocument();
    expect(screen.getByText('Team Lead')).toBeInTheDocument();
    expect(screen.getByTestId('org-model-selector')).toHaveTextContent('Lead Model');
    expect(screen.getByText('/proj-one')).toBeInTheDocument();
    expect(screen.getByLabelText('Status: Idle')).toBeInTheDocument();
  });

  it('opens the working folder in the OS file manager through the folder-open IPC', async () => {
    renderView();
    fireEvent.click(screen.getByLabelText('Open working folder'));
    await waitFor(() =>
      expect(openFolderWithMock).toHaveBeenCalledWith({ folder_path: '/proj-one', tool: 'explorer' })
    );
  });

  it('stops a non-CEO thread through the agent turn cancel handle', async () => {
    let cancelled = false;
    runAgentTurnMock.mockImplementation(() => ({
      events: (async function* () {
        yield { type: 'text-delta', data: { text: 'working' } };
        await new Promise(() => {});
      })(),
      cancel: () => {
        cancelled = true;
        return Promise.resolve();
      },
    }));

    // A prior message keeps the live execution indicator mounted.
    storeState = {
      ...storeState,
      conversations: [makeConversation([{ id: 'm0', sender: 'Lead', role: 'assistant', content: 'hi', timestamp: 1 }])],
    };

    renderView();
    await sendPrompt('long task');

    const stopButtons = await screen.findAllByText('Stop');
    fireEvent.click(stopButtons[0]);

    await waitFor(() => expect(cancelled).toBe(true));
    await waitFor(() => expect(screen.queryByText('Stop')).toBeNull());
  });

  it('retries a failed non-CEO turn with the last user message', async () => {
    runAgentTurnMock
      .mockImplementationOnce(() => ({
        events: (async function* () {
          yield { type: 'error', data: { error: 'boom' } };
        })(),
        cancel: vi.fn(),
      }))
      .mockImplementationOnce(() => ({
        events: (async function* () {
          yield { type: 'done', data: { finalSynthesis: 'recovered' } };
        })(),
        cancel: vi.fn(),
      }));

    const conversation = makeConversation([
      { id: 'u1', sender: 'User', role: 'user', content: 'hello again', timestamp: 1 },
    ]);
    storeState = { ...storeState, conversations: [conversation] };

    renderView();
    await sendPrompt('hello again');

    const retryButton = await screen.findByText('Retry');
    fireEvent.click(retryButton);

    await waitFor(() => expect(runAgentTurnMock).toHaveBeenCalledTimes(2));
    expect(runAgentTurnMock.mock.calls[1][0].userText).toBe('hello again');
  });

  it('applies CEO created entities exactly once and renders the Created card with select links', async () => {
    const createdDepartment: OrgDepartmentNode = {
      id: 'dept-new',
      name: 'Research',
      parentDepartmentId: 'root-ceo',
      workspacePath: '/research',
      status: 'idle',
      lastActiveAt: 1,
      linkedProjects: [],
      departmentCeoAgent: makeAgent('agent-research-head', 'Research Head', 'department_head'),
      teams: [],
    };
    const createdTeam: OrgTeamNode = {
      id: 'team-new',
      departmentId: 'dept-new',
      name: 'AI Lab',
      teamLeadAgent: makeAgent('agent-ai-lead', 'AI Lead', 'team_lead'),
      hrCoordinatorAgent: makeAgent('agent-ai-hr', 'AI HR', 'hr_coordinator'),
      specialistMembers: [makeAgent('agent-ai-eng', 'AI Engineer', 'specialist')],
      lastActiveAt: 1,
      status: 'idle',
      workspacePath: '/ai-lab',
    };
    const createdProject: OrgProject = {
      id: 'proj-new',
      name: 'Project New',
      departmentId: 'dept-new',
      teamIds: ['team-new'],
      status: 'active',
      workspacePath: '/proj-new',
      path: '/proj-new',
    };
    const createdMember = makeAgent('agent-ai-eng', 'AI Engineer', 'specialist');
    const createdEntities = {
      departments: [createdDepartment],
      teams: [{ departmentId: 'dept-new', team: createdTeam }],
      projects: [createdProject],
      members: [{ teamId: 'team-new', member: createdMember }],
    };

    runAgentTurnMock.mockImplementation(() => ({
      events: (async function* () {
        yield { type: 'created-entities', data: { createdEntities } };
        yield { type: 'done', data: { finalSynthesis: 'created everything' } };
      })(),
      cancel: vi.fn(),
    }));

    storeState = {
      ...storeState,
      conversations: [makeCeoConversation()],
      selectedConversationId: 'conv-ceo-1',
    };

    renderView();
    await sendPrompt('create Research');

    await waitFor(() => expect(storeState.addOrgConversation).toHaveBeenCalled());
    const options = runAgentTurnMock.mock.calls[0][0];
    expect(options.target).toEqual({ type: 'ceo', id: 'agent-root-ceo' });
    expect(options.isCeo).toBe(true);

    expect(storeState.addDepartment).toHaveBeenCalledTimes(1);
    expect(storeState.addDepartment).toHaveBeenCalledWith(createdDepartment);
    expect(storeState.addSubTeam).toHaveBeenCalledTimes(1);
    expect(storeState.addSubTeam).toHaveBeenCalledWith('dept-new', createdTeam);
    expect(storeState.addOrgProject).toHaveBeenCalledTimes(1);
    expect(storeState.addOrgProject).toHaveBeenCalledWith(createdProject);
    expect(storeState.addTeamMember).toHaveBeenCalledTimes(1);
    expect(storeState.addTeamMember).toHaveBeenCalledWith('team-new', createdMember);

    const addOrgConversationMock = storeState.addOrgConversation as ReturnType<typeof vi.fn>;
    const finalConversation = addOrgConversationMock.mock.calls.at(-1)?.[0] as OrgConversation;
    const createdMessage = finalConversation.messages.find((m) => m.createdEntities && m.createdEntities.length > 0);
    expect(createdMessage?.content).toContain('Created:');
    const createdRefs = createdMessage?.createdEntities as OrgCreatedEntityRef[];
    expect(createdRefs.map((r) => r.name)).toEqual(['Research', 'AI Lab', 'Project New', 'AI Engineer']);

    // Render the final conversation so the card and its links are visible.
    cleanup();
    storeState = {
      ...storeState,
      conversations: [finalConversation],
      selectedConversationId: finalConversation.id,
    };
    renderView();

    expect(screen.getAllByText(/Created:/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Research/ }));
    expect(storeState.setSelectedDepartment).toHaveBeenCalledWith('dept-new');
    expect(storeState.setOrgViewMode).toHaveBeenCalledWith('canvas');
  });

  it('renders legacy ceo-role replies the same way as assistant replies', () => {
    storeState = {
      ...storeState,
      conversations: [
        makeCeoConversation([
          { id: 'a1', sender: 'CEO', role: 'ceo', content: 'legacy ceo reply', timestamp: 1 },
          { id: 'a2', sender: 'CEO', role: 'assistant', content: 'new assistant reply', timestamp: 2 },
        ]),
      ],
      selectedConversationId: 'conv-ceo-1',
    };

    renderView();

    const legacy = screen.getByText('legacy ceo reply');
    const assistant = screen.getByText('new assistant reply');
    expect(legacy).toBeInTheDocument();
    expect(assistant).toBeInTheDocument();
    expect(legacy.className).toBe(assistant.className);
    expect(screen.getAllByText('CEO').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('👑').length).toBeGreaterThanOrEqual(2);
  });
});
