/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Running command tracker for org shell commands.
 * Allows killing a running command and querying running status.
 */

export interface RunningCommand {
  id: string;
  projectId: string;
  command: string;
  cwd: string;
  startTime: number;
  pid: number;
}

const runningCommands = new Map<string, RunningCommand & { proc: ChildProcess }>();

/**
 * Start tracking a running command.
 */
export function trackCommand(id: string, projectId: string, command: string, cwd: string, proc: ChildProcess): void {
  runningCommands.set(id, {
    id,
    projectId,
    command,
    cwd,
    startTime: Date.now(),
    pid: proc.pid ?? 0,
    proc,
  });
}

/**
 * Get running command info by ID.
 */
export function getRunningCommand(id: string): RunningCommand | undefined {
  const entry = runningCommands.get(id);
  if (!entry) return undefined;
  return {
    id: entry.id,
    projectId: entry.projectId,
    command: entry.command,
    cwd: entry.cwd,
    startTime: entry.startTime,
    pid: entry.pid,
  };
}

/**
 * List all running commands for a project.
 */
export function listRunningCommands(projectId?: string): RunningCommand[] {
  const result: RunningCommand[] = [];
  for (const entry of runningCommands.values()) {
    if (!projectId || entry.projectId === projectId) {
      result.push({
        id: entry.id,
        projectId: entry.projectId,
        command: entry.command,
        cwd: entry.cwd,
        startTime: entry.startTime,
        pid: entry.pid,
      });
    }
  }
  return result;
}

/**
 * Kill a running command by ID.
 */
export function killCommand(id: string): { success: boolean; error?: string } {
  const entry = runningCommands.get(id);
  if (!entry) {
    return { success: false, error: 'Command not found' };
  }

  try {
    // On Windows, use taskkill; on Unix, use kill
    const isWindows = process.platform === 'win32';
    if (isWindows) {
      spawn('taskkill', ['/PID', String(entry.pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-entry.pid, 'SIGTERM'); // kill process group
      // Force kill after 2s
      setTimeout(() => {
        try {
          process.kill(-entry.pid, 'SIGKILL');
        } catch {}
      }, 2000);
    }
    runningCommands.delete(id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Clean up finished command from tracking.
 */
export function untrackCommand(id: string): void {
  runningCommands.delete(id);
}

/**
 * Auto-approve policy mapping.
 * Maps UI "Auto-approve" setting to actual approval policy level.
 */
export type AutoApproveLevel = 'none' | 'read_only' | 'auto_edit' | 'full_auto';

export function mapAutoApproveToPolicy(level: AutoApproveLevel): 'read_only' | 'auto_edit' | 'full_auto' {
  switch (level) {
    case 'none':
      return 'read_only';
    case 'read_only':
      return 'read_only';
    case 'auto_edit':
      return 'auto_edit';
    case 'full_auto':
      return 'full_auto';
    default:
      return 'auto_edit';
  }
}

/**
 * Human-readable label for auto-approve level.
 */
export function autoApproveLabel(level: AutoApproveLevel): string {
  switch (level) {
    case 'none':
      return 'Ask for everything (read_only)';
    case 'read_only':
      return 'Ask for edits & shell (read_only)';
    case 'auto_edit':
      return 'Auto-approve edits, ask for shell (auto_edit)';
    case 'full_auto':
      return 'Auto-approve edits & shell (full_auto)';
    default:
      return 'Auto-approve edits, ask for shell (auto_edit)';
  }
}
