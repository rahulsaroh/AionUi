/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  appendAuditEntry,
  readAuditLog,
  getAuditLogPath,
  redactSecrets,
  sanitizeAuditEntry,
} from '../../../packages/desktop/src/process/services/org/orgAuditLog';

describe('orgAuditLog: per-project jsonl audit log', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-audit-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  });

  it('appends and reads back entries in order', () => {
    expect(appendAuditEntry(root, { projectId: 'p1', kind: 'command', summary: 'run tests', command: 'npm test' })).toBe(
      true
    );
    appendAuditEntry(root, {
      projectId: 'p1',
      kind: 'file_change',
      summary: 'edit main',
      filePath: 'lib/main.dart',
      diff: '+hello',
    });
    appendAuditEntry(root, { projectId: 'p1', kind: 'approval', summary: 'allow', decision: 'approved' });

    const entries = readAuditLog(root, 'p1');
    expect(entries).toHaveLength(3);
    expect(entries[0].kind).toBe('command');
    expect(entries[1].diff).toBe('+hello');
    expect(entries[2].decision).toBe('approved');
    expect(entries[0].id).toBeTruthy();
  });

  it('isolates logs by project', () => {
    appendAuditEntry(root, { projectId: 'p1', kind: 'command', summary: 'a' });
    appendAuditEntry(root, { projectId: 'p2', kind: 'command', summary: 'b' });

    expect(readAuditLog(root, 'p1')).toHaveLength(1);
    expect(readAuditLog(root, 'p2')).toHaveLength(1);
    expect(readAuditLog(root, 'p1')[0].summary).toBe('a');
  });

  it('writes valid jsonl (one JSON object per line)', () => {
    appendAuditEntry(root, { projectId: 'p1', kind: 'command', summary: 'x' });
    appendAuditEntry(root, { projectId: 'p1', kind: 'command', summary: 'y' });

    const file = getAuditLogPath(root, 'p1');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('returns empty array for unknown project or missing root', () => {
    expect(readAuditLog(root, 'nonexistent')).toEqual([]);
    expect(readAuditLog(null, 'p1')).toEqual([]);
    expect(appendAuditEntry(null, { projectId: 'p1', kind: 'command', summary: 'x' })).toBe(false);
  });

  it('redacts secrets from persisted text', () => {
    expect(redactSecrets('API_KEY=sk-12345 secret')).toBe('API_KEY=[REDACTED] secret');
    expect(redactSecrets('Authorization: Bearer abc.def.ghi')).toBe('Authorization: Bearer [REDACTED]');
    expect(redactSecrets('password = hunter2')).toBe('password = [REDACTED]');

    appendAuditEntry(root, {
      projectId: 'p1',
      kind: 'command',
      summary: 'export',
      command: 'export GITHUB_TOKEN=ghp_secret123',
    });
    const [entry] = readAuditLog(root, 'p1');
    expect(entry.command).not.toContain('ghp_secret123');
    expect(entry.command).toContain('[REDACTED]');
  });

  it('sanitizeAuditEntry redacts summary, command, diff, reason', () => {
    const clean = sanitizeAuditEntry({
      id: 'x',
      timestamp: 1,
      projectId: 'p1',
      kind: 'command',
      summary: 'token=abc',
      command: 'run --api-key=zzz',
      diff: '+password: plain',
      reason: 'token=xyz',
    });
    expect(clean.summary).toContain('[REDACTED]');
    expect(clean.command).toContain('[REDACTED]');
    expect(clean.diff).toContain('[REDACTED]');
    expect(clean.reason).toContain('[REDACTED]');
  });
});