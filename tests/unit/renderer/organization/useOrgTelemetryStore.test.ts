/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  updateNodeStatus,
  updateActivityTicker,
  recordDelegationStart,
  recordDelegationComplete,
  findOrgMemberBySlot,
  initTelemetryBridge,
  resetTelemetryBridge,
  toOrgNodeStatus,
  matchCandidateMember,
} from '@/renderer/pages/organization/store/useOrgTelemetryStore';
import {
  setOrgStoreSnapshot,
  getOrgStoreSnapshot,
  setOrgNodeStatus,
} from '@/renderer/pages/organization/store/useOrgStore';
import { computeOrgStatusPropagation } from '@/renderer/pages/organization/utils/orgStatusPropagation';
import { ipcBridge } from '@/common';
import type { OrgHierarchy, OrgProject } from '@/types/organization';

describe('useOrgTelemetryStore', () => {
  beforeEach(() => {
    resetTelemetryBridge();
  });

  it('updates node execution status correctly and maps thinking to working', () => {
    updateNodeStatus('team-1', 'thinking');
    expect(getOrgStoreSnapshot().nodeStatuses['team-1']).toBe('working');

    updateNodeStatus('team-2', 'completed');
    expect(getOrgStoreSnapshot().nodeStatuses['team-2']).toBe('recently_finished');

    updateNodeStatus('team-3', 'error');
    expect(getOrgStoreSnapshot().nodeStatuses['team-3']).toBe('error');

    updateNodeStatus('team-1', 'idle');
    expect(getOrgStoreSnapshot().nodeStatuses['team-1']).toBe('idle');
  });

  it('delegation start and complete update working state in store', () => {
    recordDelegationStart({
      sourceTeamId: 'team-root',
      targetSubTeamId: 'team-child',
      taskDirective: 'Refactor UI Canvas',
    });

    expect(getOrgStoreSnapshot().nodeStatuses['team-root']).toBe('working');
    expect(getOrgStoreSnapshot().nodeStatuses['team-child']).toBe('working');

    recordDelegationComplete({
      sourceTeamId: 'team-root',
      targetSubTeamId: 'team-child',
      success: true,
    });

    expect(getOrgStoreSnapshot().nodeStatuses['team-root']).toBe('recently_finished');
    expect(getOrgStoreSnapshot().nodeStatuses['team-child']).toBe('recently_finished');
  });

  it('toOrgNodeStatus maps status vocabulary consistently', () => {
    expect(toOrgNodeStatus('running')).toBe('working');
    expect(toOrgNodeStatus('starting')).toBe('working');
    expect(toOrgNodeStatus('thinking')).toBe('working');
    expect(toOrgNodeStatus('queued')).toBe('queued_next');
    expect(toOrgNodeStatus('completed')).toBe('recently_finished');
    expect(toOrgNodeStatus('error')).toBe('error');
    expect(toOrgNodeStatus('failed')).toBe('error');
    expect(toOrgNodeStatus('idle')).toBe('idle');
  });

  it('simulates slotWorkChanged for a recruited member and lights up member, team, and edges, clearing on idle', async () => {
    // 1. Setup mock org hierarchy and projects
    const hierarchy: OrgHierarchy = {
      rootCeo: {
        id: 'root-ceo',
        name: 'Root CEO',
        parentId: null,
        status: 'idle',
        lastActiveAt: null,
        ceoAgent: {
          id: 'ceo-agent',
          canonicalAgentId: 'c-ceo',
          name: 'CEO Agent',
          role: 'ceo',
          assignedTeamIds: [],
          lastActiveAt: null,
          status: 'idle',
        },
      },
      departments: [
        {
          id: 'dept-1',
          name: 'Engineering',
          parentDepartmentId: 'root-ceo',
          status: 'idle',
          lastActiveAt: null,
          linkedProjects: [{ id: 'proj-1', name: 'Core Engine' }],
          departmentCeoAgent: {
            id: 'dept-lead-1',
            canonicalAgentId: 'c-dept-lead',
            name: 'Eng VP',
            role: 'department_head',
            assignedTeamIds: [],
            lastActiveAt: null,
            status: 'idle',
          },
          teams: [
            {
              id: 'team-1',
              departmentId: 'dept-1',
              name: 'Backend Team',
              status: 'idle',
              lastActiveAt: null,
              backendTeamId: 'backend-team-100',
              linkedProjectId: 'proj-1',
              teamLeadAgent: {
                id: 'lead-1',
                canonicalAgentId: 'c-lead-1',
                name: 'Devon Cross',
                role: 'team_lead',
                assignedTeamIds: ['team-1'],
                lastActiveAt: null,
                status: 'idle',
              },
              hrCoordinatorAgent: {
                id: 'hr-1',
                canonicalAgentId: 'c-hr-1',
                name: 'Taylor HR',
                role: 'hr_coordinator',
                assignedTeamIds: ['team-1'],
                lastActiveAt: null,
                status: 'idle',
              },
              specialistMembers: [
                {
                  id: 'member-recruited-1',
                  canonicalAgentId: 'c-spec-1',
                  name: 'Aria Sterling',
                  role: 'specialist',
                  assignedTeamIds: ['team-1'],
                  lastActiveAt: null,
                  status: 'idle',
                  backendSlotId: 'slot-recruited-99',
                },
              ],
            },
          ],
        },
      ],
      lastUpdated: Date.now(),
    };

    const projects: OrgProject[] = [
      {
        id: 'proj-1',
        name: 'Core Engine',
        departmentId: 'dept-1',
        teamIds: ['team-1'],
        status: 'active',
        backendTeamId: 'backend-team-100',
      },
    ];

    setOrgStoreSnapshot({
      hierarchy,
      projects,
      nodeStatuses: {},
    });

    // 2. Setup IPC mocks and initialize bridge
    let slotWorkCallback: ((e: any) => Promise<void>) | undefined;
    (ipcBridge.team.slotWorkChanged as any).on = vi.fn((cb) => {
      slotWorkCallback = cb;
      return () => {};
    });

    initTelemetryBridge();
    expect(slotWorkCallback).toBeDefined();

    // 3. Simulate slotWorkChanged: running state for the recruited member's slot
    await slotWorkCallback!({
      team_id: 'backend-team-100',
      slot_work: {
        slot_id: 'slot-recruited-99',
        state: 'running',
      },
    });

    // Verify member node status in useOrgStore
    const stateAfterRun = getOrgStoreSnapshot();
    expect(stateAfterRun.nodeStatuses['member-recruited-1']).toBe('working');

    // 4. Verify computeOrgStatusPropagation lights up member, team, project, dept, rootCeo, and edges
    const propResult = computeOrgStatusPropagation(
      stateAfterRun.hierarchy,
      stateAfterRun.projects,
      stateAfterRun.nodeStatuses
    );

    expect(propResult.workingNodeIds.has('member-recruited-1')).toBe(true);
    expect(propResult.workingNodeIds.has('team-1')).toBe(true);
    expect(propResult.workingNodeIds.has('project-proj-1')).toBe(true);
    expect(propResult.workingNodeIds.has('dept-1')).toBe(true);
    expect(propResult.workingNodeIds.has('root-ceo')).toBe(true);
    expect(propResult.workingEdgeIds.size).toBeGreaterThan(0);
    expect(propResult.workingEdgeIds.has('edge-root-ceo->dept-1')).toBe(true);
    expect(propResult.workingEdgeIds.has('edge-project-proj-1->team-1')).toBe(true);

    // 5. Simulate slotWorkChanged: idle state
    await slotWorkCallback!({
      team_id: 'backend-team-100',
      slot_work: {
        slot_id: 'slot-recruited-99',
        state: 'idle',
      },
    });

    const stateAfterIdle = getOrgStoreSnapshot();
    expect(stateAfterIdle.nodeStatuses['member-recruited-1']).toBe('idle');

    // Verify computeOrgStatusPropagation clears back to idle
    const propResultAfterIdle = computeOrgStatusPropagation(
      stateAfterIdle.hierarchy,
      stateAfterIdle.projects,
      stateAfterIdle.nodeStatuses
    );

    expect(propResultAfterIdle.workingNodeIds.has('member-recruited-1')).toBe(false);
    expect(propResultAfterIdle.workingNodeIds.has('team-1')).toBe(false);
    expect(propResultAfterIdle.workingEdgeIds.size).toBe(0);
  });

  it('backfills missing backendSlotId by reading team from ipcBridge.team', async () => {
    const hierarchy: OrgHierarchy = {
      rootCeo: {
        id: 'root-ceo',
        name: 'Root CEO',
        parentId: null,
        status: 'idle',
        lastActiveAt: null,
        ceoAgent: {
          id: 'ceo-agent',
          canonicalAgentId: 'c-ceo',
          name: 'CEO Agent',
          role: 'ceo',
          assignedTeamIds: [],
          lastActiveAt: null,
          status: 'idle',
        },
      },
      departments: [
        {
          id: 'dept-2',
          name: 'Product',
          parentDepartmentId: 'root-ceo',
          status: 'idle',
          lastActiveAt: null,
          linkedProjects: [],
          departmentCeoAgent: {
            id: 'dept-lead-2',
            canonicalAgentId: 'c-prod-lead',
            name: 'Product VP',
            role: 'department_head',
            assignedTeamIds: [],
            lastActiveAt: null,
            status: 'idle',
          },
          teams: [
            {
              id: 'team-2',
              departmentId: 'dept-2',
              name: 'Frontend Team',
              status: 'idle',
              lastActiveAt: null,
              backendTeamId: 'backend-team-200',
              teamLeadAgent: {
                id: 'lead-2',
                canonicalAgentId: 'c-lead-2',
                name: 'Frontend Lead',
                role: 'team_lead',
                assignedTeamIds: ['team-2'],
                lastActiveAt: null,
                status: 'idle',
              },
              hrCoordinatorAgent: {
                id: 'hr-2',
                canonicalAgentId: 'c-hr-2',
                name: 'HR Lead',
                role: 'hr_coordinator',
                assignedTeamIds: ['team-2'],
                lastActiveAt: null,
                status: 'idle',
              },
              specialistMembers: [
                {
                  id: 'member-to-backfill',
                  canonicalAgentId: 'c-backfill',
                  name: 'Sam Designer',
                  role: 'specialist',
                  assignedTeamIds: ['team-2'],
                  lastActiveAt: null,
                  status: 'idle',
                  // backendSlotId is initially missing!
                },
              ],
            },
          ],
        },
      ],
      lastUpdated: Date.now(),
    };

    setOrgStoreSnapshot({
      hierarchy,
      projects: [],
      nodeStatuses: {},
    });

    (ipcBridge.team.get as any).invoke = vi.fn(async () => ({
      id: 'backend-team-200',
      assistants: [
        {
          slot_id: 'slot-sam-42',
          assistant_name: 'Sam Designer',
          assistant_id: 'c-backfill',
          role: 'teammate',
        },
      ],
    }));

    const result = await findOrgMemberBySlot('backend-team-200', 'slot-sam-42');
    expect(result.member).toBeDefined();
    expect(result.member?.id).toBe('member-to-backfill');
    expect(result.member?.backendSlotId).toBe('slot-sam-42');

    // Verify persisted in store
    const updatedStore = getOrgStoreSnapshot();
    const updatedMember = updatedStore.hierarchy.departments[0].teams[0].specialistMembers[0];
    expect(updatedMember.backendSlotId).toBe('slot-sam-42');
  });

  it('spawn event for an unknown agent creates a member and the glow targets it; duplicate spawn events do not create duplicates', async () => {
    const hierarchy: OrgHierarchy = {
      rootCeo: {
        id: 'root-ceo',
        name: 'Root CEO',
        parentId: null,
        status: 'idle',
        lastActiveAt: null,
        ceoAgent: {
          id: 'ceo-agent',
          canonicalAgentId: 'c-ceo',
          name: 'CEO Agent',
          role: 'ceo',
          assignedTeamIds: [],
          lastActiveAt: null,
          status: 'idle',
        },
      },
      departments: [
        {
          id: 'dept-spawn',
          name: 'Growth',
          parentDepartmentId: 'root-ceo',
          status: 'idle',
          lastActiveAt: null,
          linkedProjects: [{ id: 'proj-spawn', name: 'Growth Loop' }],
          departmentCeoAgent: {
            id: 'dept-head-spawn',
            canonicalAgentId: 'c-growth-head',
            name: 'Growth VP',
            role: 'department_head',
            assignedTeamIds: [],
            lastActiveAt: null,
            status: 'idle',
          },
          teams: [
            {
              id: 'team-spawn',
              departmentId: 'dept-spawn',
              name: 'Viral Ops',
              status: 'idle',
              lastActiveAt: null,
              backendTeamId: 'backend-growth-team',
              linkedProjectId: 'proj-spawn',
              teamLeadAgent: {
                id: 'lead-spawn',
                canonicalAgentId: 'c-lead-growth',
                name: 'Growth Lead',
                role: 'team_lead',
                assignedTeamIds: ['team-spawn'],
                lastActiveAt: null,
                status: 'idle',
              },
              hrCoordinatorAgent: {
                id: 'hr-spawn',
                canonicalAgentId: 'c-hr-growth',
                name: 'Growth HR',
                role: 'hr_coordinator',
                assignedTeamIds: ['team-spawn'],
                lastActiveAt: null,
                status: 'idle',
              },
              specialistMembers: [],
            },
          ],
        },
      ],
      lastUpdated: Date.now(),
    };

    const projects: OrgProject[] = [
      {
        id: 'proj-spawn',
        name: 'Growth Loop',
        departmentId: 'dept-spawn',
        teamIds: ['team-spawn'],
        status: 'active',
        backendTeamId: 'backend-growth-team',
      },
    ];

    setOrgStoreSnapshot({
      hierarchy,
      projects,
      nodeStatuses: {},
    });

    let agentSpawnedCb: ((e: any) => Promise<void>) | undefined;
    let agentRemovedCb: ((e: any) => Promise<void>) | undefined;
    let slotWorkCb: ((e: any) => Promise<void>) | undefined;

    (ipcBridge.team.agentSpawned as any).on = vi.fn((cb) => {
      agentSpawnedCb = cb;
      return () => {};
    });
    (ipcBridge.team.agentRemoved as any).on = vi.fn((cb) => {
      agentRemovedCb = cb;
      return () => {};
    });
    (ipcBridge.team.slotWorkChanged as any).on = vi.fn((cb) => {
      slotWorkCb = cb;
      return () => {};
    });

    initTelemetryBridge();
    expect(agentSpawnedCb).toBeDefined();
    expect(agentRemovedCb).toBeDefined();
    expect(slotWorkCb).toBeDefined();

    // 1. Trigger agentSpawned for an unknown agent
    await agentSpawnedCb!({
      team_id: 'backend-growth-team',
      assistant: {
        slot_id: 'slot-nova-88',
        assistant_name: 'Nova Analyst',
        assistant_id: 'c-nova-analyst',
        role: 'specialist',
      },
    });

    // 2. Member must be created in the team
    const storeAfterSpawn = getOrgStoreSnapshot();
    const team = storeAfterSpawn.hierarchy.departments[0].teams[0];
    expect(team.specialistMembers.length).toBe(1);

    const created = team.specialistMembers[0];
    expect(created.name).toBe('Nova Analyst');
    expect(created.backendSlotId).toBe('slot-nova-88');
    expect(created.canonicalAgentId).toBe('c-nova-analyst');
    expect(created.role).toBe('specialist');

    // 3. Duplicate spawn event should NOT create a duplicate
    await agentSpawnedCb!({
      team_id: 'backend-growth-team',
      assistant: {
        slot_id: 'slot-nova-88',
        assistant_name: 'Nova Analyst',
        assistant_id: 'c-nova-analyst',
        role: 'specialist',
      },
    });

    const storeAfterDup = getOrgStoreSnapshot();
    expect(storeAfterDup.hierarchy.departments[0].teams[0].specialistMembers.length).toBe(1);

    // 4. slotWorkChanged for that slot lights up that member
    await slotWorkCb!({
      team_id: 'backend-growth-team',
      slot_work: {
        slot_id: 'slot-nova-88',
        state: 'running',
      },
    });

    const storeAfterWork = getOrgStoreSnapshot();
    expect(storeAfterWork.nodeStatuses[created.id]).toBe('working');

    // Glow computation targets the newly created member
    const propResult = computeOrgStatusPropagation(
      storeAfterWork.hierarchy,
      storeAfterWork.projects,
      storeAfterWork.nodeStatuses
    );
    expect(propResult.workingNodeIds.has(created.id)).toBe(true);
    expect(propResult.workingNodeIds.has('team-spawn')).toBe(true);

    // 5. agentRemoved removes the member
    await agentRemovedCb!({
      team_id: 'backend-growth-team',
      slot_id: 'slot-nova-88',
    });

    const storeAfterRemoved = getOrgStoreSnapshot();
    expect(storeAfterRemoved.hierarchy.departments[0].teams[0].specialistMembers.length).toBe(0);
  });

  describe('member matching with shared names (Requirement 3)', () => {
    const candidateA = {
      id: 'member-1',
      canonicalAgentId: 'c-alex-alpha',
      name: 'Alex',
      role: 'specialist',
      assignedTeamIds: ['team-1'],
      lastActiveAt: null,
      status: 'idle' as const,
      backendSlotId: 'slot-alex-1',
    };

    const candidateB = {
      id: 'member-2',
      canonicalAgentId: 'c-alex-beta',
      name: 'Alex',
      role: 'specialist',
      assignedTeamIds: ['team-1'],
      lastActiveAt: null,
      status: 'idle' as const,
      backendSlotId: 'slot-alex-2',
    };

    const candidateUnique = {
      id: 'member-3',
      canonicalAgentId: 'c-jordan',
      name: 'Jordan',
      role: 'specialist',
      assignedTeamIds: ['team-1'],
      lastActiveAt: null,
      status: 'idle' as const,
      backendSlotId: 'slot-jordan',
    };

    const candidates = [candidateA, candidateB, candidateUnique];

    it('prefers match by slot id when two members share a name', () => {
      const match = matchCandidateMember(candidates, {
        slot_id: 'slot-alex-2',
        assistant_name: 'Alex',
      });
      expect(match).toBeDefined();
      expect(match?.id).toBe('member-2');
      expect(match?.canonicalAgentId).toBe('c-alex-beta');
    });

    it('prefers match by assistant_id when two members share a name', () => {
      const match = matchCandidateMember(candidates, {
        assistant_id: 'c-alex-alpha',
        assistant_name: 'Alex',
      });
      expect(match).toBeDefined();
      expect(match?.id).toBe('member-1');
      expect(match?.backendSlotId).toBe('slot-alex-1');
    });

    it('returns undefined if multiple members match name and neither slot_id nor assistant_id matches', () => {
      const match = matchCandidateMember(candidates, {
        assistant_name: 'Alex',
      });
      expect(match).toBeUndefined();
    });

    it('matches by name when exactly one candidate matches that name', () => {
      const match = matchCandidateMember(candidates, {
        assistant_name: 'Jordan',
      });
      expect(match).toBeDefined();
      expect(match?.id).toBe('member-3');
    });
  });
});
