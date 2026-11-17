/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { ipcBridge } from '@/common';
import type { NodeExecutionStatus, ActiveHandoff, NodeActivityUpdate } from '../types';
import type { OrgNodeStatus, OrgProject, OrgTeamNode, OrgAgentMember } from '@/types/organization';
import { touchNodeActivity, setOrgNodeStatus, getOrgStoreSnapshot, updateMemberBackendSlotId } from './useOrgStore';

type OrgTelemetryState = {
  nodeStatuses: Record<string, NodeExecutionStatus>;
  activeHandoffs: Record<string, ActiveHandoff>;
  activityTicker: Record<string, NodeActivityUpdate>;
};

let telemetryState: OrgTelemetryState = {
  nodeStatuses: {},
  activeHandoffs: {},
  activityTicker: {},
};

const listeners = new Set<(state: OrgTelemetryState) => void>();

function notify() {
  const snapshot = { ...telemetryState };
  listeners.forEach((listener) => listener(snapshot));
}

export function toOrgNodeStatus(status: string): OrgNodeStatus {
  switch (status) {
    case 'running':
    case 'starting':
    case 'thinking':
    case 'working':
    case 'delegating':
      return 'working';
    case 'queued':
    case 'queued_next':
      return 'queued_next';
    case 'completed':
    case 'finished':
    case 'recently_finished':
      return 'recently_finished';
    case 'error':
    case 'failed':
      return 'error';
    case 'dormant':
      return 'dormant';
    case 'idle':
    default:
      return 'idle';
  }
}

export function updateNodeStatus(nodeId: string, status: NodeExecutionStatus | OrgNodeStatus) {
  if (!nodeId) return;
  const mappedStatus = toOrgNodeStatus(status);
  telemetryState = {
    ...telemetryState,
    nodeStatuses: {
      ...telemetryState.nodeStatuses,
      [nodeId]: status as NodeExecutionStatus,
    },
  };
  notify();

  setOrgNodeStatus(nodeId, mappedStatus);
}

export function updateActivityTicker(teamId: string, update: NodeActivityUpdate) {
  if (!teamId) return;
  touchNodeActivity(teamId);
  telemetryState = {
    ...telemetryState,
    activityTicker: {
      ...telemetryState.activityTicker,
      [teamId]: update,
    },
  };
  notify();
}

export function recordDelegationStart(params: {
  sourceTeamId: string;
  targetSubTeamId: string;
  taskDirective: string;
}) {
  const { sourceTeamId, targetSubTeamId, taskDirective } = params;
  touchNodeActivity(sourceTeamId);
  touchNodeActivity(targetSubTeamId);
  const handoffId = `${sourceTeamId}->${targetSubTeamId}`;

  const handoff: ActiveHandoff = {
    id: handoffId,
    sourceTeamId,
    targetSubTeamId,
    taskDirective,
    timestamp: Date.now(),
    status: 'in_flight',
  };

  telemetryState = {
    ...telemetryState,
    activeHandoffs: {
      ...telemetryState.activeHandoffs,
      [handoffId]: handoff,
    },
    nodeStatuses: {
      ...telemetryState.nodeStatuses,
      [sourceTeamId]: 'delegating',
      [targetSubTeamId]: 'thinking',
    },
    activityTicker: {
      ...telemetryState.activityTicker,
      [sourceTeamId]: {
        message: `Delegating to child: "${taskDirective.slice(0, 50)}${taskDirective.length > 50 ? '...' : ''}"`,
        timestamp: Date.now(),
        status: 'delegating',
      },
      [targetSubTeamId]: {
        message: `Received delegated task: "${taskDirective.slice(0, 50)}${taskDirective.length > 50 ? '...' : ''}"`,
        timestamp: Date.now(),
        status: 'thinking',
      },
    },
  };
  notify();

  setOrgNodeStatus(sourceTeamId, 'working');
  setOrgNodeStatus(targetSubTeamId, 'working');
}

export function recordDelegationComplete(params: { sourceTeamId: string; targetSubTeamId: string; success: boolean }) {
  const { sourceTeamId, targetSubTeamId, success } = params;
  const handoffId = `${sourceTeamId}->${targetSubTeamId}`;

  const existing = telemetryState.activeHandoffs[handoffId];
  if (existing) {
    telemetryState = {
      ...telemetryState,
      activeHandoffs: {
        ...telemetryState.activeHandoffs,
        [handoffId]: {
          ...existing,
          status: success ? 'completed' : 'error',
        },
      },
      nodeStatuses: {
        ...telemetryState.nodeStatuses,
        [sourceTeamId]: success ? 'completed' : 'error',
        [targetSubTeamId]: success ? 'completed' : 'error',
      },
    };
    notify();

    setOrgNodeStatus(sourceTeamId, success ? 'recently_finished' : 'error');
    setOrgNodeStatus(targetSubTeamId, success ? 'recently_finished' : 'error');

    // Auto-clear completed handoff and return nodes to idle after 4 seconds
    setTimeout(() => {
      const nextHandoffs = { ...telemetryState.activeHandoffs };
      delete nextHandoffs[handoffId];
      telemetryState = {
        ...telemetryState,
        activeHandoffs: nextHandoffs,
        nodeStatuses: {
          ...telemetryState.nodeStatuses,
          [sourceTeamId]: 'idle',
          [targetSubTeamId]: 'idle',
        },
      };
      notify();
      setOrgNodeStatus(sourceTeamId, 'idle');
      setOrgNodeStatus(targetSubTeamId, 'idle');
    }, 4000);
  }
}

export async function findOrgMemberBySlot(
  teamId: string,
  slotId?: string | null
): Promise<{
  project?: OrgProject;
  team?: OrgTeamNode;
  member?: OrgAgentMember;
}> {
  const store = getOrgStoreSnapshot();

  // 1. Find project where backendTeamId === teamId
  const project = store.projects.find((p) => p.backendTeamId === teamId);

  // 2. Find team in hierarchy where backendTeamId === teamId, or linked to project
  const allTeams: OrgTeamNode[] = [];
  store.hierarchy.departments.forEach((dept) => {
    dept.teams.forEach((t) => allTeams.push(t));
  });

  let team = allTeams.find((t) => t.backendTeamId === teamId);
  if (!team && project) {
    team = allTeams.find((t) => project.teamIds?.includes(t.id) || t.linkedProjectId === project.id);
  }

  // Collect candidate members
  const candidateMembers: OrgAgentMember[] = [];
  if (team) {
    if (team.teamLeadAgent) candidateMembers.push(team.teamLeadAgent);
    if (team.hrCoordinatorAgent) candidateMembers.push(team.hrCoordinatorAgent);
    if (team.specialistMembers) candidateMembers.push(...team.specialistMembers);
    if (team.members) {
      team.members.forEach((m) => {
        if (!candidateMembers.some((c) => c.id === m.id)) {
          candidateMembers.push(m);
        }
      });
    }
  }
  if (project?.memberIds) {
    (store.members || []).forEach((m) => {
      if (project.memberIds?.includes(m.id) && !candidateMembers.some((c) => c.id === m.id)) {
        candidateMembers.push(m);
      }
    });
  }

  if (!slotId) {
    return { project, team };
  }

  // Check if any candidate has matching backendSlotId
  let member = candidateMembers.find((m) => m.backendSlotId === slotId);
  if (member) {
    return { project, team, member };
  }

  // Also check all members across all departments/teams in store
  const allStoreMembers: OrgAgentMember[] = [
    store.hierarchy.rootCeo.ceoAgent,
    ...(store.hierarchy.rootCeo.chiefOfStaffAgent ? [store.hierarchy.rootCeo.chiefOfStaffAgent] : []),
    ...store.hierarchy.departments.map((d) => d.departmentCeoAgent),
    ...allTeams.flatMap((t) => [t.teamLeadAgent, t.hrCoordinatorAgent, ...(t.specialistMembers || [])]),
    ...(store.members || []),
  ];
  member = allStoreMembers.find((m) => m?.backendSlotId === slotId);
  if (member) {
    return { project, team, member };
  }

  // Backfill by reading the team's agents via ipcBridge.team
  try {
    const backendTeam = await ipcBridge.team?.get?.invoke?.({ id: teamId });
    if (backendTeam) {
      const assistants = backendTeam.assistants || backendTeam.agents || [];
      if (Array.isArray(assistants)) {
        for (const ast of assistants) {
          if (!ast?.slot_id) continue;
          let target: OrgAgentMember | undefined;
          if (ast.role === 'leader' && team?.teamLeadAgent) {
            target = team.teamLeadAgent;
          } else {
            target = candidateMembers.find(
              (m) =>
                (m.name && ast.assistant_name && m.name.toLowerCase() === ast.assistant_name.toLowerCase()) ||
                (m.canonicalAgentId && ast.assistant_id && m.canonicalAgentId === ast.assistant_id) ||
                m.id === ast.assistant_id
            );
          }
          if (target) {
            target.backendSlotId = ast.slot_id;
            updateMemberBackendSlotId(target.id, ast.slot_id);
          }
        }

        const matchedAst = assistants.find((a: { slot_id?: string }) => a.slot_id === slotId);
        if (matchedAst) {
          const matchedMember = candidateMembers.find((m) => m.backendSlotId === slotId);
          if (matchedMember) {
            return { project, team, member: matchedMember };
          }
        }
      }
    }
  } catch (err) {
    console.warn('[useOrgTelemetryStore] Backfill from ipcBridge.team failed:', err);
  }

  return { project, team, member };
}

// Global listener setup for IPC and custom window events
let isInitialized = false;

export function resetTelemetryBridge() {
  isInitialized = false;
  telemetryState = {
    nodeStatuses: {},
    activeHandoffs: {},
    activityTicker: {},
  };
}

export function initTelemetryBridge() {
  if (isInitialized) return;
  isInitialized = true;

  // Window delegation events dispatched from subTeamDelegationBridge
  if (typeof window !== 'undefined') {
    window.addEventListener('subteam:delegation', ((event: CustomEvent) => {
      const detail = event.detail;
      if (!detail) return;
      if (detail.type === 'start') {
        recordDelegationStart({
          sourceTeamId: detail.sourceTeamId,
          targetSubTeamId: detail.targetSubTeamId,
          taskDirective: detail.taskDirective || 'Sub-team task',
        });
      } else if (detail.type === 'complete') {
        recordDelegationComplete({
          sourceTeamId: detail.sourceTeamId,
          targetSubTeamId: detail.targetSubTeamId,
          success: Boolean(detail.success),
        });
      }
    }) as EventListener);
  }

  // IPC Team Run Events
  try {
    ipcBridge.team.runStarted?.on(async (e) => {
      if (e?.team_id) {
        const { team, project } = await findOrgMemberBySlot(e.team_id);
        const targetId = team?.teamLeadAgent?.id || team?.id || project?.id || e.team_id;
        touchNodeActivity(targetId);
        setOrgNodeStatus(targetId, 'working');
        updateActivityTicker(targetId, {
          message: 'Executing task run...',
          timestamp: Date.now(),
          status: 'thinking',
        });
      }
    });

    ipcBridge.team.runCompleted?.on(async (e) => {
      if (e?.team_id) {
        const { team, project } = await findOrgMemberBySlot(e.team_id);
        const targetId = team?.teamLeadAgent?.id || team?.id || project?.id || e.team_id;
        setOrgNodeStatus(targetId, 'recently_finished');
        updateActivityTicker(targetId, {
          message: 'Task completed successfully',
          timestamp: Date.now(),
          status: 'completed',
        });
      }
    });

    ipcBridge.team.runFailed?.on(async (e) => {
      if (e?.team_id) {
        const { team, project } = await findOrgMemberBySlot(e.team_id);
        const targetId = team?.teamLeadAgent?.id || team?.id || project?.id || e.team_id;
        setOrgNodeStatus(targetId, 'error');
        updateActivityTicker(targetId, {
          message: 'Task failed or halted with error',
          timestamp: Date.now(),
          status: 'error',
        });
      }
    });

    ipcBridge.team.slotWorkChanged?.on(async (e) => {
      if (e?.team_id && e?.slot_work) {
        const slotId = e.slot_work.slot_id;
        const state = e.slot_work.state;
        const orgStatus = toOrgNodeStatus(state);

        const { member, team, project } = await findOrgMemberBySlot(e.team_id, slotId);
        const targetId = member?.id || team?.id || project?.id;

        if (targetId) {
          if (orgStatus === 'working') {
            touchNodeActivity(targetId);
          }
          setOrgNodeStatus(targetId, orgStatus);
          updateActivityTicker(targetId, {
            message: member ? `${member.name} (${state})` : `Slot ${slotId} is ${state}`,
            timestamp: Date.now(),
            agentName: member?.name,
            status: orgStatus === 'working' ? 'thinking' : orgStatus === 'error' ? 'error' : 'idle',
          });
        }
      }
    });

    ipcBridge.team.childTurnStarted?.on(async (e) => {
      if (e?.team_id && e?.slot_id) {
        const { member, team, project } = await findOrgMemberBySlot(e.team_id, e.slot_id);
        const targetId = member?.id || team?.id || project?.id;
        if (targetId) {
          touchNodeActivity(targetId);
          setOrgNodeStatus(targetId, 'working');
          updateActivityTicker(targetId, {
            message: member ? `${member.name} executing turn` : `Child turn started on slot ${e.slot_id}`,
            timestamp: Date.now(),
            agentName: member?.name,
            status: 'thinking',
          });
        }
      }
    });

    ipcBridge.team.childTurnCompleted?.on(async (e) => {
      if (e?.team_id && e?.slot_id) {
        const { member, team, project } = await findOrgMemberBySlot(e.team_id, e.slot_id);
        const targetId = member?.id || team?.id || project?.id;
        if (targetId) {
          setOrgNodeStatus(targetId, 'recently_finished');
          updateActivityTicker(targetId, {
            message: member ? `${member.name} finished turn` : `Child turn completed on slot ${e.slot_id}`,
            timestamp: Date.now(),
            agentName: member?.name,
            status: 'completed',
          });
        }
      }
    });

    ipcBridge.team.childTurnCancelled?.on(async (e) => {
      if (e?.team_id && e?.slot_id) {
        const { member, team, project } = await findOrgMemberBySlot(e.team_id, e.slot_id);
        const targetId = member?.id || team?.id || project?.id;
        if (targetId) {
          setOrgNodeStatus(targetId, 'idle');
        }
      }
    });

    ipcBridge.team.agentSpawned?.on(async (e) => {
      if (e?.team_id && e?.assistant) {
        const { team } = await findOrgMemberBySlot(e.team_id);
        if (team && e.assistant.slot_id) {
          const members = team.specialistMembers || [];
          const matched = members.find(
            (m) =>
              (m.name &&
                e.assistant.assistant_name &&
                m.name.toLowerCase() === e.assistant.assistant_name.toLowerCase()) ||
              m.id === e.assistant.assistant_id
          );
          if (matched) {
            updateMemberBackendSlotId(matched.id, e.assistant.slot_id);
          }
        }
      }
    });
  } catch (err) {
    console.warn('[useOrgTelemetryStore] IPC subscriptions warning:', err);
  }
}

export function useOrgTelemetryStore() {
  const [state, setState] = useState<OrgTelemetryState>(telemetryState);

  useEffect(() => {
    initTelemetryBridge();
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);

  const getNodeStatus = (teamId: string): NodeExecutionStatus => {
    return state.nodeStatuses[teamId] || 'idle';
  };

  const getActivity = (teamId: string): NodeActivityUpdate | undefined => {
    return state.activityTicker[teamId];
  };

  const getActiveHandoff = (sourceTeamId: string, targetSubTeamId: string): ActiveHandoff | undefined => {
    return state.activeHandoffs[`${sourceTeamId}->${targetSubTeamId}`];
  };

  return {
    ...state,
    getNodeStatus,
    getActivity,
    getActiveHandoff,
    updateNodeStatus,
    updateActivityTicker,
    recordDelegationStart,
    recordDelegationComplete,
  };
}
