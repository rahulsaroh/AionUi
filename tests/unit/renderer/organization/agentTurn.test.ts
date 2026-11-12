/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { OrgHierarchy, OrgProject } from '@/types/organization';

const mocks = vi.hoisted(() => {
  const runCeoTurnMock = vi.fn();
  const executeDirectMessageMock = vi.fn();
  const OrgDelegationEngineMock = vi.fn().mockImplementation(function () {
    this.executeDirectMessage = executeDirectMessageMock;
  });
  return { runCeoTurnMock, executeDirectMessageMock, OrgDelegationEngineMock };
});

vi.mock('@/renderer/pages/organization/utils/ceoExecutionService', () => ({
  runCeoTurn: mocks.runCeoTurnMock,
}));

vi.mock('@/renderer/pages/organization/utils/orgDelegationEngine', () => ({
  OrgDelegationEngine: mocks.OrgDelegationEngineMock,
}));

import { runAgentTurn } from '@/renderer/pages/organization/utils/agentTurn';

const hierarchy: OrgHierarchy = {
  rootCeo: {
    id: 'root-ceo',
    name: 'Root',
    parentId: null,
    status: 'idle',
    lastActiveAt: 1,
    workspacePath: '/root',
    ceoAgent: {
      id: 'agent-root-ceo',
      canonicalAgentId: 'canon-ceo',
      name: 'CEO',
      title: 'CEO',
      role: 'ceo',
      assignedTeamIds: [],
      status: 'idle',
      lastActiveAt: 1,
    },
  },
  departments: [],
  lastUpdated: 1,
};

const projects: OrgProject[] = [];

describe('runAgentTurn', () => {
  beforeEach(() => {
    mocks.runCeoTurnMock.mockReset();
    mocks.executeDirectMessageMock.mockReset();
    mocks.OrgDelegationEngineMock.mockClear();
  });

  it('routes CEO turns through runCeoTurn, not executeDirectMessage', async () => {
    mocks.runCeoTurnMock.mockReturnValue({
      events: (async function* () {
        yield { type: 'done', data: { finalSynthesis: 'ok' } };
      })(),
      cancel: vi.fn(async () => {}),
    });

    const result = runAgentTurn({
      hierarchy,
      projects,
      threadId: 't1',
      target: { type: 'ceo', id: 'root-ceo' },
      userText: 'hello',
      agent: hierarchy.rootCeo.ceoAgent,
      workspacePath: '/root',
      systemContext: 'ctx',
      isCeo: true,
    });

    const events = [];
    for await (const ev of result.events) events.push(ev);
    expect(mocks.runCeoTurnMock).toHaveBeenCalledTimes(1);
    expect(mocks.executeDirectMessageMock).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('routes non-CEO turns through executeDirectMessage, not runCeoTurn', async () => {
    mocks.executeDirectMessageMock.mockResolvedValue('direct response');
    const agent = {
      id: 'agent-x',
      canonicalAgentId: 'canon-x',
      name: 'Agent X',
      title: 'Dev',
      role: 'specialist' as const,
      assignedTeamIds: [],
      status: 'idle' as const,
      lastActiveAt: 1,
    };

    const result = runAgentTurn({
      hierarchy,
      projects,
      threadId: 't2',
      target: { type: 'member', id: 'agent-x' },
      userText: 'hello',
      agent,
      workspacePath: '/proj',
      systemContext: 'ctx',
    });

    const events = [];
    for await (const ev of result.events) events.push(ev);
    expect(mocks.runCeoTurnMock).not.toHaveBeenCalled();
    expect(mocks.OrgDelegationEngineMock).toHaveBeenCalled();
    expect(mocks.executeDirectMessageMock).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });
});
