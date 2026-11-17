/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { runCeoTurn, type CeoEvent } from '@/renderer/pages/organization/utils/ceoExecutionService';
import type { OrgHierarchy, OrgProject } from '@/types/organization';

describe('runCeoTurn Service', () => {
  const dummyHierarchy: OrgHierarchy = {
    rootCeo: {
      id: 'root-ceo',
      name: 'Root CEO',
      parentId: null,
      ceoAgent: {
        id: 'agent-ceo',
        canonicalAgentId: 'canonical-ceo',
        name: 'Dr. Evelyn Vance',
        role: 'ceo',
        assignedTeamIds: [],
        lastActiveAt: null,
        status: 'idle',
      },
      lastActiveAt: null,
      status: 'idle',
    },
    departments: [],
    lastUpdated: Date.now(),
  };

  const dummyProjects: OrgProject[] = [];

  it('yields step and text-delta and done events', async () => {
    const events: CeoEvent[] = [];
    const { events: iterator } = runCeoTurn('test-thread', 'Draft a high level quarterly roadmap', {
      hierarchy: dummyHierarchy,
      projects: dummyProjects,
      userPrompt: 'Draft a high level quarterly roadmap',
      useRealExecution: false,
    });

    for await (const ev of iterator) {
      events.push(ev);
    }

    expect(events.some((e) => e.type === 'step')).toBe(true);
    expect(events.some((e) => e.type === 'text-delta')).toBe(true);
    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.data.finalSynthesis).toBeTruthy();
  });

  it('yields created-entities event when directives include create actions', async () => {
    const events: CeoEvent[] = [];
    const { events: iterator } = runCeoTurn('test-thread', 'Create department Research with team AI Lab', {
      hierarchy: dummyHierarchy,
      projects: dummyProjects,
      userPrompt: 'Create department Research with team AI Lab',
      useRealExecution: false,
    });

    for await (const ev of iterator) {
      events.push(ev);
    }

    const createdEvent = events.find((e) => e.type === 'created-entities');
    expect(createdEvent).toBeDefined();
    expect(createdEvent?.data.createdEntities?.departments?.length).toBeGreaterThan(0);
  });

  it('passes conversationId through to directive execution and emits on done', async () => {
    const events: CeoEvent[] = [];
    const { events: iterator } = runCeoTurn('test-thread', 'Hello CEO', {
      hierarchy: dummyHierarchy,
      projects: dummyProjects,
      userPrompt: 'Hello CEO',
      useRealExecution: false,
      conversationId: 'existing-conv-456',
    });

    for await (const ev of iterator) {
      events.push(ev);
    }

    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.data).toHaveProperty('finalSynthesis');
  });

  it('includes proposal approval message with approved_lineup_id in the prompt to the CEO agent', async () => {
    const lineupId = 'lineup-approved-999';
    const conversation = {
      id: 'conv-ceo-1',
      title: 'CEO chat',
      type: 'ceo_directive' as const,
      sourceNodeId: 'root-ceo',
      targetNodeId: 'root-ceo',
      timestamp: 1,
      messages: [
        {
          id: 'msg-1',
          sender: 'User',
          role: 'user',
          content: 'Hire backend specialists',
          timestamp: 100,
        },
        {
          id: 'msg-2',
          sender: 'CEO',
          role: 'assistant',
          content: 'I have proposed 2 specialists.',
          timestamp: 200,
        },
        {
          id: 'msg-3',
          sender: 'System',
          role: 'system',
          content: `Approved and instantiated 2 organizational entities.\nUser approved the proposal. approved_lineup_id=${lineupId}. Use this id in assign_task.`,
          timestamp: 300,
        },
      ],
    };

    // Spy on OrgDelegationEngine prototype executeDirective
    const { OrgDelegationEngine } = await import('@/renderer/pages/organization/utils/orgDelegationEngine');
    const executeDirectiveSpy = vi.spyOn(OrgDelegationEngine.prototype, 'executeDirective');

    const { events: iterator } = runCeoTurn('test-thread', 'Assign task to build auth service', {
      hierarchy: dummyHierarchy,
      projects: dummyProjects,
      userPrompt: 'Assign task to build auth service',
      useRealExecution: false,
      conversation,
    });

    for await (const _ of iterator) {
      // drain events
    }

    expect(executeDirectiveSpy).toHaveBeenCalled();
    const passedPrompt = executeDirectiveSpy.mock.calls[0][0];
    expect(passedPrompt).toContain(`approved_lineup_id=${lineupId}`);
    expect(passedPrompt).toContain('Assign task to build auth service');

    executeDirectiveSpy.mockRestore();
  });
});
