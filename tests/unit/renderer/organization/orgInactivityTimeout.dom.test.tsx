/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOrgStore, touchNodeActivity } from '@/renderer/pages/organization/store/useOrgStore';
import { ipcBridge } from '@/common';

describe('Inactivity-based stale timeout and automations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resets a working node to idle after full inactivity window (10 min)', () => {
    const { result } = renderHook(() => useOrgStore());

    act(() => {
      result.current.updateNodeStatus('spec-member-1', 'working');
    });

    expect(result.current.nodeStatuses['spec-member-1']).toBe('working');

    // Advance 9 minutes (silence)
    act(() => {
      vi.advanceTimersByTime(9 * 60 * 1000);
    });

    // Still working
    expect(result.current.nodeStatuses['spec-member-1']).toBe('working');

    // Advance 1 more minute (total 10 minutes of silence)
    act(() => {
      vi.advanceTimersByTime(1 * 60 * 1000);
    });

    // Resets to idle
    expect(result.current.nodeStatuses['spec-member-1']).toBe('idle');
  });

  it('restarts inactivity timer on activity at minute 4, keeping node working past minute 5', () => {
    const { result } = renderHook(() => useOrgStore());

    act(() => {
      result.current.updateNodeStatus('spec-member-1', 'working');
    });

    expect(result.current.nodeStatuses['spec-member-1']).toBe('working');

    // Advance 4 minutes
    act(() => {
      vi.advanceTimersByTime(4 * 60 * 1000);
    });
    expect(result.current.nodeStatuses['spec-member-1']).toBe('working');

    // Activity arrives at minute 4 (stream chunk, tool call, telemetry)
    act(() => {
      touchNodeActivity('spec-member-1');
    });

    // Advance 2 more minutes (total t = 6 min, past the former 5-min threshold)
    act(() => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });

    // Must still be working!
    expect(result.current.nodeStatuses['spec-member-1']).toBe('working');

    // Advance 7 more minutes (t = 13 min, 9 min since last activity at minute 4)
    act(() => {
      vi.advanceTimersByTime(7 * 60 * 1000);
    });
    expect(result.current.nodeStatuses['spec-member-1']).toBe('working');

    // Advance 1 more minute (t = 14 min, 10 min since last activity at minute 4)
    act(() => {
      vi.advanceTimersByTime(1 * 60 * 1000);
    });

    // Now resets to idle after full 10-minute silence window
    expect(result.current.nodeStatuses['spec-member-1']).toBe('idle');
  });

  it('transitions recently_finished to idle after 2000ms', () => {
    const { result } = renderHook(() => useOrgStore());

    act(() => {
      result.current.updateNodeStatus('spec-member-1', 'recently_finished');
    });

    expect(result.current.nodeStatuses['spec-member-1']).toBe('recently_finished');

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.nodeStatuses['spec-member-1']).toBe('idle');
  });

  it('wires runOrgCronJob to light up Root CEO, department, and team with working -> recently_finished -> idle', async () => {
    const { result } = renderHook(() => useOrgStore());

    const testDept = {
      id: 'dept-eng',
      name: 'Engineering',
      parentId: 'root-ceo',
      color: '#3b82f6',
      departmentCeoAgent: {
        id: 'agent-dept-eng',
        canonicalAgentId: 'canonical-dept-eng',
        name: 'Head of Engineering',
        title: 'VP of Engineering',
        role: 'department_head' as const,
        icon: 'code',
        assistant_backend: 'acp' as const,
        assignedTeamIds: [],
        lastActiveAt: Date.now(),
        status: 'idle' as const,
      },
      teams: [
        {
          id: 'team-backend',
          name: 'Backend Core',
          parentId: 'dept-eng',
          teamLeadAgent: {
            id: 'lead-backend',
            canonicalAgentId: 'canonical-lead-backend',
            name: 'Backend Lead',
            role: 'lead' as const,
            icon: 'server',
            assistant_backend: 'acp' as const,
            assignedTeamIds: ['team-backend'],
            lastActiveAt: Date.now(),
            status: 'idle' as const,
          },
          specialistMembers: [],
          lastActiveAt: Date.now(),
          status: 'idle' as const,
        },
      ],
      lastActiveAt: Date.now(),
      status: 'idle' as const,
    };

    await act(async () => {
      await result.current.addDepartment(testDept);
    });

    const dept = testDept;
    const team = testDept.teams[0];
    const rootCeo = result.current.hierarchy.rootCeo;

    const testJob = {
      id: 'cron-test-1',
      departmentId: dept.id,
      name: 'Daily Pipeline Check',
      taskDirective: 'Review open tasks and health',
      cronExpression: '0 9 * * *',
      enabled: true,
    };

    act(() => {
      result.current.addOrgCronJob(testJob);
    });

    // Mock ipcBridge.cron.runNow
    const runNowSpy = vi.spyOn(ipcBridge.cron.runNow, 'invoke').mockResolvedValue({ conversation_id: 'conv-cron' });

    await act(async () => {
      await result.current.runOrgCronJob(testJob.id);
    });

    expect(runNowSpy).toHaveBeenCalledWith({ job_id: testJob.id });

    // After run, nodes were set to recently_finished
    expect(result.current.nodeStatuses[rootCeo.id]).toBe('recently_finished');
    expect(result.current.nodeStatuses[dept.id]).toBe('recently_finished');
    expect(result.current.nodeStatuses[team.id]).toBe('recently_finished');

    // Advance 2000ms: auto-fades to idle
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.nodeStatuses[rootCeo.id]).toBe('idle');
    expect(result.current.nodeStatuses[dept.id]).toBe('idle');
    expect(result.current.nodeStatuses[team.id]).toBe('idle');
  });
});
