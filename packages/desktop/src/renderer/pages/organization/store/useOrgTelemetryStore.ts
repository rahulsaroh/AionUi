/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { ipcBridge } from '@/common';
import type { NodeExecutionStatus, ActiveHandoff, NodeActivityUpdate } from '../types';

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

export function updateNodeStatus(teamId: string, status: NodeExecutionStatus) {
  if (!teamId) return;
  telemetryState = {
    ...telemetryState,
    nodeStatuses: {
      ...telemetryState.nodeStatuses,
      [teamId]: status,
    },
  };
  notify();
}

export function updateActivityTicker(teamId: string, update: NodeActivityUpdate) {
  if (!teamId) return;
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
}

export function recordDelegationComplete(params: {
  sourceTeamId: string;
  targetSubTeamId: string;
  success: boolean;
}) {
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
    }, 4000);
  }
}

// Global listener setup for IPC and custom window events
let isInitialized = false;

function initTelemetryBridge() {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  // Window delegation events dispatched from subTeamDelegationBridge
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

  // IPC Team Run Events
  try {
    ipcBridge.team.runStarted?.on((e) => {
      if (e?.team_id) {
        updateNodeStatus(e.team_id, 'thinking');
        updateActivityTicker(e.team_id, {
          message: 'Executing task run...',
          timestamp: Date.now(),
          status: 'thinking',
        });
      }
    });

    ipcBridge.team.runCompleted?.on((e) => {
      if (e?.team_id) {
        updateNodeStatus(e.team_id, 'completed');
        updateActivityTicker(e.team_id, {
          message: 'Task completed successfully',
          timestamp: Date.now(),
          status: 'completed',
        });
        setTimeout(() => {
          updateNodeStatus(e.team_id, 'idle');
        }, 3500);
      }
    });

    ipcBridge.team.runFailed?.on((e) => {
      if (e?.team_id) {
        updateNodeStatus(e.team_id, 'error');
        updateActivityTicker(e.team_id, {
          message: 'Task failed or halted with error',
          timestamp: Date.now(),
          status: 'error',
        });
      }
    });

    ipcBridge.team.slotWorkChanged?.on((e) => {
      if (e?.team_id && e?.slot_work) {
        const state = e.slot_work.state;
        if (state === 'running' || state === 'starting') {
          updateNodeStatus(e.team_id, 'thinking');
        } else if (state === 'idle') {
          updateNodeStatus(e.team_id, 'idle');
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
