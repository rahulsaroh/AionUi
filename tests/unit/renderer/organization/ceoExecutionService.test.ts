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
});
