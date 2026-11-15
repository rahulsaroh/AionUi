/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';

export interface ShellExecutionLog {
  id: string;
  command: string;
  cwd: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  timestamp: number;
}

const shellLogs: ShellExecutionLog[] = [];
const MAX_LOGS = 500;

/**
 * Record a shell command execution in the in-memory telemetry log.
 */
export function recordShellExecution(log: Omit<ShellExecutionLog, 'id' | 'timestamp'>): ShellExecutionLog {
  const entry: ShellExecutionLog = {
    ...log,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };
  shellLogs.push(entry);
  if (shellLogs.length > MAX_LOGS) {
    shellLogs.shift();
  }
  return entry;
}

/**
 * Retrieve execution logs.
 */
export function getShellExecutionLogs(): ShellExecutionLog[] {
  return [...shellLogs];
}

/**
 * Clear execution logs (testing and resets).
 */
export function _resetShellExecutionLogs(): void {
  shellLogs.length = 0;
}
