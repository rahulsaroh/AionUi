/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  trackCommand,
  getRunningCommand,
  listRunningCommands,
  killCommand,
  untrackCommand,
  mapAutoApproveToPolicy,
  autoApproveLabel,
} from '../../../packages/desktop/src/process/services/org/orgRunningCommands';

describe('orgRunningCommands: command tracking + auto-approve mapping', () => {
  beforeEach(() => {
    // Clear tracking map
    for (const key of (globalThis as any).__runningCommandsKeys || []) {
      try {
        untrackCommand(key);
      } catch {}
    }
  });

  afterEach(() => {
    for (const key of (globalThis as any).__runningCommandsKeys || []) {
      try {
        untrackCommand(key);
      } catch {}
    }
  });

  it('tracks a running command and can retrieve it', async () => {
    // Create a dummy child process
    const proc = { pid: 12345, kill: vi.fn() };
    trackCommand('cmd-1', 'p1', 'echo hello', '/tmp/p1', proc as any);

    const cmd = getRunningCommand('cmd-1');
    expect(cmd).toBeDefined();
    expect(cmd?.id).toBe('cmd-1');
    expect(cmd?.projectId).toBe('p1');
    expect(cmd?.command).toBe('echo hello');
    expect(cmd?.cwd).toBe('/tmp/p1');
    expect(cmd?.pid).toBe(12345);
    expect(cmd?.startTime).toBeGreaterThan(0);
  });

  it('lists running commands for a project', async () => {
    const proc = { pid: 12345, kill: vi.fn() };
    trackCommand('cmd-1', 'p1', 'echo a', '/tmp/p1', proc as any);
    trackCommand('cmd-2', 'p2', 'echo b', '/tmp/p2', proc as any);
    trackCommand('cmd-3', 'p1', 'echo c', '/tmp/p1', proc as any);

    const p1Cmds = listRunningCommands('p1');
    expect(p1Cmds.length).toBe(2);
    expect(p1Cmds.every((c) => c.projectId === 'p1')).toBe(true);

    const allCmds = listRunningCommands();
    expect(allCmds.length).toBe(3);
  });

  it('killCommand removes tracking', async () => {
    const proc = { pid: 99999, kill: vi.fn() };
    trackCommand('cmd-kill', 'p1', 'sleep 100', '/tmp/p1', proc as any);

    const before = getRunningCommand('cmd-kill');
    expect(before).toBeDefined();

    // killCommand tries to kill process - on test it may fail but should remove tracking
    const result = killCommand('cmd-kill');
    expect(result.success).toBe(true); // tracking removed

    const after = getRunningCommand('cmd-kill');
    expect(after).toBeUndefined();
  });

  it('untrackCommand removes tracking', async () => {
    const proc = { pid: 12345, kill: vi.fn() };
    trackCommand('cmd-untrack', 'p1', 'echo test', '/tmp/p1', proc as any);

    untrackCommand('cmd-untrack');
    expect(getRunningCommand('cmd-untrack')).toBeUndefined();
  });

  it('mapAutoApproveToPolicy maps levels correctly', () => {
    expect(mapAutoApproveToPolicy('none')).toBe('read_only');
    expect(mapAutoApproveToPolicy('read_only')).toBe('read_only');
    expect(mapAutoApproveToPolicy('auto_edit')).toBe('auto_edit');
    expect(mapAutoApproveToPolicy('full_auto')).toBe('full_auto');
  });

  it('autoApproveLabel returns human-readable labels', () => {
    expect(autoApproveLabel('none')).toContain('read_only');
    expect(autoApproveLabel('read_only')).toContain('read_only');
    expect(autoApproveLabel('auto_edit')).toContain('auto_edit');
    expect(autoApproveLabel('full_auto')).toContain('full_auto');
  });
});
