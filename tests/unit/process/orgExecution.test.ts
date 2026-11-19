/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  executeListDir,
  executeReadFile,
  executeWriteFile,
  executeRunShell,
  setOrgBashApprovalBroker,
} from '../../../packages/desktop/src/process/services/org/orgExecution';
import { setMasterRoot, resetMasterRoot } from '../../../packages/desktop/src/process/services/org/orgScope';
import { _resetApprovalTokens } from '../../../packages/desktop/src/process/services/org/orgApproval';
import { readAuditLog } from '../../../packages/desktop/src/process/services/org/orgAuditLog';
import type { ApprovalRequest } from '../../../packages/desktop/src/process/services/org/orgExecution';

describe('orgExecution: jailed shell/file tools with policy + audit', () => {
  let tempRoot: string;
  let projectFolder: string;
  let outsideFolder: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-exec-test-'));
    projectFolder = path.join(tempRoot, 'org', 'projects', 'app1');
    outsideFolder = path.join(tempRoot, 'outside');
    fs.mkdirSync(projectFolder, { recursive: true });
    fs.mkdirSync(outsideFolder, { recursive: true });
    setMasterRoot(path.join(tempRoot, 'org'));
    _resetApprovalTokens();
    setOrgBashApprovalBroker(null);
  });

  afterEach(() => {
    resetMasterRoot();
    _resetApprovalTokens();
    setOrgBashApprovalBroker(null);
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  });

  const ctxAuto = () => ({ projectId: 'p1', projectFolder, policy: 'auto_edit' as const });
  const ctxFull = () => ({ projectId: 'p1', projectFolder, policy: 'full_auto' as const });
  const ctxRead = () => ({ projectId: 'p1', projectFolder, policy: 'read_only' as const });

  it('writes a file inside the folder under auto_edit without approval', async () => {
    const res = await executeWriteFile({ path: 'lib/main.dart', content: 'void main(){}' }, ctxAuto(), {
      masterRoot: path.join(tempRoot, 'org'),
    });
    expect(res.success).toBe(true);
    const written = path.join(projectFolder, 'lib', 'main.dart');
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.readFileSync(written, 'utf8')).toBe('void main(){}');
  });

  it('records a file change with diff in the audit log', async () => {
    const masterRoot = path.join(tempRoot, 'org');
    await executeWriteFile({ path: 'a.txt', content: 'line1\n' }, ctxAuto(), { masterRoot });
    await executeWriteFile({ path: 'a.txt', content: 'line1\nline2\n' }, ctxAuto(), { masterRoot });

    const entries = readAuditLog(masterRoot, 'p1');
    const changes = entries.filter((e) => e.kind === 'file_change');
    const change = changes[changes.length - 1];
    expect(change).toBeTruthy();
    expect(change?.diff).toContain('+line2');
  });

  it('JAIL: rejects write with ".." traversal', async () => {
    const res = await executeWriteFile({ path: '../escape.txt', content: 'x' }, ctxFull(), {
      masterRoot: path.join(tempRoot, 'org'),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/outside the project folder/);
    expect(fs.existsSync(path.join(tempRoot, 'org', 'projects', 'escape.txt'))).toBe(false);
  });

  it('JAIL: rejects absolute path to another folder', async () => {
    const target = path.join(outsideFolder, 'evil.txt');
    const res = await executeWriteFile({ path: target, content: 'x' }, ctxFull(), {
      masterRoot: path.join(tempRoot, 'org'),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/outside the project folder/);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('JAIL: rejects read outside the folder', async () => {
    fs.writeFileSync(path.join(outsideFolder, 'secret.txt'), 'topsecret');
    const res = await executeReadFile({ path: path.join(outsideFolder, 'secret.txt') }, ctxRead(), {
      masterRoot: path.join(tempRoot, 'org'),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/outside the project folder/);
  });

  it('JAIL: rejects shell whose cwd is outside the folder', async () => {
    const res = await executeRunShell({ command: 'echo hi', cwd: outsideFolder }, ctxFull(), {
      masterRoot: path.join(tempRoot, 'org'),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/outside the project folder/);
  });

  it('JAIL: rejects shell referencing another drive / absolute outside path', async () => {
    // ".." traversal is caught by risk denylist -> outside -> always ask -> deny by default broker
    setOrgBashApprovalBroker(async () => 'deny');
    const res = await executeRunShell({ command: 'cat ..\\..\\secret.txt' }, ctxFull(), {
      masterRoot: path.join(tempRoot, 'org'),
    });
    expect(res.success).toBe(false);
    expect(res.denied || res.needsApproval).toBeTruthy();
  });

  it('POLICY read_only: shell asks (denied by default broker)', async () => {
    const res = await executeRunShell({ command: 'echo hi' }, ctxRead(), {
      masterRoot: path.join(tempRoot, 'org'),
    });
    expect(res.success).toBe(false);
    expect(res.needsApproval || res.denied).toBeTruthy();
  });

  it('POLICY auto_edit: safe in-folder shell asks; broker allow runs it', async () => {
    setOrgBashApprovalBroker(async () => 'allow');
    const res = await executeRunShell(
      { command: process.platform === 'win32' ? 'Write-Output hello' : 'echo hello' },
      ctxAuto(),
      { masterRoot: path.join(tempRoot, 'org') }
    );
    expect(res.success).toBe(true);
    expect(res.exitCode).toBe(0);
    expect((res.stdout || '').toLowerCase()).toContain('hello');
  });

  it('POLICY auto_edit: broker deny blocks shell and audits a rejection', async () => {
    const masterRoot = path.join(tempRoot, 'org');
    setOrgBashApprovalBroker(async () => 'deny');
    const res = await executeRunShell({ command: 'echo hi' }, ctxAuto(), { masterRoot });
    expect(res.success).toBe(false);
    const entries = readAuditLog(masterRoot, 'p1');
    expect(entries.some((e) => e.kind === 'approval' && e.decision === 'rejected')).toBe(true);
  });

  it('POLICY full_auto: safe in-folder shell runs without asking', async () => {
    const res = await executeRunShell(
      { command: process.platform === 'win32' ? 'Write-Output ok' : 'echo ok' },
      ctxFull(),
      { masterRoot: path.join(tempRoot, 'org') }
    );
    expect(res.success).toBe(true);
    expect(res.exitCode).toBe(0);
  });

  it('full_auto still asks for git push --force (always-ask destructive)', async () => {
    const broker = vi.fn(async () => 'deny' as const);
    setOrgBashApprovalBroker(broker);
    const res = await executeRunShell({ command: 'git push origin main --force' }, ctxFull(), {
      masterRoot: path.join(tempRoot, 'org'),
    });
    expect(res.success).toBe(false);
    expect(broker).toHaveBeenCalledOnce();
    expect(res.denied || res.needsApproval).toBeTruthy();
  });

  it('audit records a successful command', async () => {
    const masterRoot = path.join(tempRoot, 'org');
    await executeRunShell({ command: process.platform === 'win32' ? 'Write-Output done' : 'echo done' }, ctxFull(), {
      masterRoot,
    });
    const entries = readAuditLog(masterRoot, 'p1');
    expect(entries.some((e) => e.kind === 'command' && e.exitCode === 0)).toBe(true);
  });

  it('redacts secrets from audited commands', async () => {
    const masterRoot = path.join(tempRoot, 'org');
    // Non-risky command that includes a secret-looking token; audit must redact it.
    await executeRunShell(
      { command: process.platform === 'win32' ? 'Write-Output GITHUB_TOKEN=ghp_x' : 'echo GITHUB_TOKEN=ghp_x' },
      ctxFull(),
      { masterRoot }
    );
    const entries = readAuditLog(masterRoot, 'p1');
    const cmd = entries.find((e) => e.kind === 'command');
    expect(cmd?.command).not.toContain('ghp_x');
  });
});
