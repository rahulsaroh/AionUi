/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';

/**
 * Per-project audit log.
 *
 * Every shell command, file change (with diff) and approval decision is appended as a
 * single JSON line (jsonl) under:
 *   <masterRoot>/.aionui/audit/<projectId>.jsonl
 *
 * Secrets are never written: callers must pass already-sanitized command/file text.
 * The service itself also redacts obvious secret assignments defensively.
 */

export type OrgAuditKind = 'command' | 'file_change' | 'approval' | 'checkpoint' | 'undo';

export interface OrgAuditEntry {
  id: string;
  timestamp: number;
  projectId: string;
  kind: OrgAuditKind;
  /** Short human summary of what happened. */
  summary: string;
  /** Shell command (command kind). */
  command?: string;
  cwd?: string;
  exitCode?: number;
  timedOut?: boolean;
  durationMs?: number;
  /** File change details. */
  filePath?: string;
  /** Unified-ish diff text for file changes. */
  diff?: string;
  /** Approval decision. */
  decision?: 'allow' | 'ask' | 'deny' | 'approved' | 'rejected';
  reason?: string;
  /** Free-form extra metadata (must not contain secrets). */
  meta?: Record<string, unknown>;
}

const MAX_LOG_BYTES = 32 * 1024 * 1024; // 32 MB rotation cap per project

function auditDir(masterRoot: string): string {
  return path.join(masterRoot, '.aionui', 'audit');
}

function logFile(masterRoot: string, projectId: string): string {
  const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
  return path.join(auditDir(masterRoot), `${safeId}.jsonl`);
}

/** Defensive secret redaction for any string that may be persisted. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    // KEY=value / TOKEN: value / password=... style assignments
    .replace(
      /((?:api[_-]?key|secret|token|password|passwd|pwd|credential|access[_-]?key)\s*[:=]\s*)(\S+)/gi,
      (_m, p1: string) => `${p1}[REDACTED]`
    )
    // Bearer tokens
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
}

export function sanitizeAuditEntry(entry: OrgAuditEntry): OrgAuditEntry {
  const clean: OrgAuditEntry = { ...entry };
  if (clean.summary) clean.summary = redactSecrets(clean.summary);
  if (clean.command) clean.command = redactSecrets(clean.command);
  if (clean.diff) clean.diff = redactSecrets(clean.diff);
  if (clean.reason) clean.reason = redactSecrets(clean.reason);
  return clean;
}

/**
 * Append a single audit entry to the project's jsonl log.
 * Fails closed silently if the master root is unavailable (audit must never break execution,
 * but callers can check the returned boolean).
 */
export function appendAuditEntry(masterRoot: string | null, entry: OrgAuditEntry): boolean {
  if (!masterRoot) return false;
  try {
    const dir = auditDir(masterRoot);
    fs.mkdirSync(dir, { recursive: true });
    const file = logFile(masterRoot, entry.projectId);
    const full: OrgAuditEntry = sanitizeAuditEntry({
      ...entry,
      id: entry.id || crypto.randomUUID(),
      timestamp: entry.timestamp || Date.now(),
    });
    // Rotate if oversized: keep the file bounded.
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_LOG_BYTES) {
        fs.writeFileSync(file, '');
      }
    } catch {
      // file may not exist yet
    }
    fs.appendFileSync(file, JSON.stringify(full) + '\n', 'utf8');
    return true;
  } catch (err) {
    console.warn('[orgAuditLog] Failed to append audit entry:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Read all audit entries for a project (oldest first). Returns [] on any error. */
export function readAuditLog(masterRoot: string | null, projectId: string): OrgAuditEntry[] {
  if (!masterRoot) return [];
  try {
    const file = logFile(masterRoot, projectId);
    if (!fs.existsSync(file)) return [];
    const content = fs.readFileSync(file, 'utf8');
    const entries: OrgAuditEntry[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as OrgAuditEntry);
      } catch {
        // skip malformed line
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/** Convenience: resolve the audit log file path for a project (used by the viewer/export). */
export function getAuditLogPath(masterRoot: string, projectId: string): string {
  return logFile(masterRoot, projectId);
}

/** For testing/reset: no persistent state is kept, provided for symmetry. */
export function _resetAuditLog(): void {
  // no-op: audit log is file-backed
}

/** Default temp dir helper (exported for tests that need an isolated root). */
export function defaultAuditTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-audit-'));
}