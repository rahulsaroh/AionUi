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
  generateGitDiff,
  readProjectAuditLog,
  buildMemberFinalReport,
  formatReportAsMarkdown,
} from '../../../packages/desktop/src/process/services/org/orgReporting';

describe('orgReporting: git diff + audit log + final report', () => {
  let tempDir: string;
  let projectDir: string;
  let auditDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-report-test-'));
    projectDir = path.join(tempDir, 'project1');
    auditDir = path.join(projectDir, '.aionui-audit');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(auditDir, { recursive: true });

    // Initialize git repo
    const { spawnSync } = require('node:child_process');
    spawnSync('git', ['init'], { cwd: projectDir, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: projectDir, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: projectDir, stdio: 'ignore' });

    // Initial commit
    fs.writeFileSync(path.join(projectDir, 'README.md'), '# Project\n');
    spawnSync('git', ['add', '.'], { cwd: projectDir, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'Initial'], { cwd: projectDir, stdio: 'ignore' });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('generates git diff for modified files', async () => {
    const { spawnSync } = require('node:child_process');
    // Add file to git first
    fs.writeFileSync(path.join(projectDir, 'file1.txt'), 'v1');
    spawnSync('git', ['add', 'file1.txt'], { cwd: projectDir, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'add file1'], { cwd: projectDir, stdio: 'ignore' });

    // Now modify it
    fs.writeFileSync(path.join(projectDir, 'file1.txt'), 'v2');
    const diff = await generateGitDiff(projectDir);
    expect(diff.hasChanges).toBe(true);
    expect(diff.filesChanged).toBe(1);
    expect(diff.additions).toBeGreaterThan(0);
    expect(diff.diff).toContain('file1.txt');
  });

  it('returns no changes for clean repo', async () => {
    const diff = await generateGitDiff(projectDir);
    expect(diff.hasChanges).toBe(false);
    expect(diff.filesChanged).toBe(0);
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(0);
  });

  it('reads audit log entries', () => {
    const entry1 = {
      kind: 'command',
      summary: 'Ran: echo hello',
      timestamp: Date.now() - 1000,
      command: 'echo hello',
      cwd: '/tmp',
      exitCode: 0,
    };
    const entry2 = {
      kind: 'approval',
      summary: 'Shell approved: rm -rf',
      timestamp: Date.now() - 500,
      command: 'rm -rf /tmp/test',
      decision: 'approved',
      reason: 'risky command',
    };
    fs.writeFileSync(path.join(auditDir, 'audit-1.json'), JSON.stringify(entry1));
    fs.writeFileSync(path.join(auditDir, 'audit-2.json'), JSON.stringify(entry2));

    const entries = readProjectAuditLog(projectDir);
    expect(entries.length).toBe(2);
    expect(entries[0].kind).toBe('approval'); // newest first
    expect(entries[1].kind).toBe('command');
  });

  it('reads audit log entries filtered by since', () => {
    const now = Date.now();
    const oldEntry = {
      kind: 'command',
      summary: 'Old command',
      timestamp: now - 10000,
    };
    const newEntry = {
      kind: 'command',
      summary: 'New command',
      timestamp: now - 1000,
    };
    fs.writeFileSync(path.join(auditDir, 'audit-old.json'), JSON.stringify(oldEntry));
    fs.writeFileSync(path.join(auditDir, 'audit-new.json'), JSON.stringify(newEntry));

    const entries = readProjectAuditLog(projectDir, now - 5000);
    expect(entries.length).toBe(1);
    expect(entries[0].summary).toBe('New command');
  });

  it('builds member final report', async () => {
    const toolExecutions = [
      {
        tool: 'run_shell',
        args: { command: 'echo hello' },
        success: true,
        durationMs: 100,
        timestamp: Date.now() - 500,
      },
      {
        tool: 'write_file',
        args: { path: '/tmp/file.txt', content: 'test' },
        success: false,
        error: 'Permission denied',
        timestamp: Date.now() - 200,
      },
    ];

    const report = await buildMemberFinalReport({
      memberId: 'm1',
      memberName: 'TestBot',
      role: 'specialist',
      projectId: 'p1',
      projectName: 'MyProject',
      projectFolder: projectDir,
      taskDescription: 'Create a test file',
      startedAt: Date.now() - 1000,
      toolExecutions,
    });

    expect(report.memberId).toBe('m1');
    expect(report.memberName).toBe('TestBot');
    expect(report.role).toBe('specialist');
    expect(report.toolExecutions.length).toBe(2);
    expect(report.finalStatus).toBe('partial'); // one success, one failure
    expect(report.summary).toContain('Create a test file');
    expect(report.durationMs).toBeGreaterThan(0);
  });

  it('formats report as markdown', async () => {
    const report = await buildMemberFinalReport({
      memberId: 'm1',
      memberName: 'TestBot',
      role: 'specialist',
      projectId: 'p1',
      projectName: 'MyProject',
      projectFolder: projectDir,
      taskDescription: 'Test task',
      startedAt: Date.now() - 1000,
      toolExecutions: [
        {
          tool: 'run_shell',
          args: { command: 'echo hello' },
          success: true,
          durationMs: 50,
          timestamp: Date.now() - 500,
        },
      ],
    });

    const markdown = formatReportAsMarkdown(report);
    expect(markdown).toContain('# Final Report: TestBot');
    expect(markdown).toContain('TestBot');
    expect(markdown).toContain('specialist');
    expect(markdown).toContain('MyProject');
    expect(markdown).toContain('run_shell');
    expect(markdown).toContain('echo hello');
    expect(markdown).toContain('✅');
  });
});
