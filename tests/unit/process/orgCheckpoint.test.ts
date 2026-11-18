/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createCheckpoint,
  undoCheckpoint,
  listCheckpoints,
  clearCheckpoints,
} from '../../../packages/desktop/src/process/services/org/orgCheckpoint';

describe('orgCheckpoint: git stash-based checkpoint/undo', () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-checkpoint-test-'));
    projectDir = path.join(tempDir, 'project1');
    fs.mkdirSync(projectDir, { recursive: true });

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

  it('creates a checkpoint and returns checkpointId', async () => {
    fs.writeFileSync(path.join(projectDir, 'tracked.txt'), 'v1');
    const { spawnSync } = require('node:child_process');
    spawnSync('git', ['add', 'tracked.txt'], { cwd: projectDir, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'add tracked'], { cwd: projectDir, stdio: 'ignore' });

    // Now make a change to checkpoint
    fs.writeFileSync(path.join(projectDir, 'tracked.txt'), 'v2');
    const res = await createCheckpoint(projectDir, 'p1');
    expect(res.success).toBe(true);
    expect(res.checkpointId).toBeDefined();
    expect(res.checkpointId).not.toBe('empty');
    expect(res.checkpointId).toMatch(/^org-checkpoint-p1-\d+$/);
  });

  it('creates a checkpoint even if no new changes (always snapshots working tree)', async () => {
    const res = await createCheckpoint(projectDir, 'p1');
    expect(res.success).toBe(true);
    expect(res.checkpointId).toBeDefined();
    expect(res.checkpointId).not.toBe('empty');
    expect(res.checkpointId).toMatch(/^org-checkpoint-p1-\d+$/);
  });

it('undoes the last checkpoint restoring previous state', async () => {
    const { spawnSync } = require('node:child_process');
    // Setup: commit v1
    fs.writeFileSync(path.join(projectDir, 'file1.txt'), 'v1');
    spawnSync('git', ['add', 'file1.txt'], { cwd: projectDir, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'add file1 v1'], { cwd: projectDir, stdio: 'ignore' });
    
    // Before task runs, create checkpoint (saves v1 state)
    const cp = await createCheckpoint(projectDir, 'p1');
    expect(cp.success).toBe(true);
    
    // Task runs and modifies file to v2
    fs.writeFileSync(path.join(projectDir, 'file1.txt'), 'v2');
    expect(fs.readFileSync(path.join(projectDir, 'file1.txt'), 'utf8')).toBe('v2');
    
    // Undo - restores checkpoint state (v1)
    const undo = await undoCheckpoint(projectDir, 'p1');
    expect(undo.success).toBe(true);
    expect(undo.message).toContain('Restored checkpoint');
    
    // File should be back to v1
    expect(fs.readFileSync(path.join(projectDir, 'file1.txt'), 'utf8')).toBe('v1');
  });

  it('undo fails when no checkpoint exists', async () => {
    const undo = await undoCheckpoint(projectDir, 'p1');
    expect(undo.success).toBe(false);
    expect(undo.error).toContain('No org checkpoint found');
  });

it('lists checkpoints for a project', async () => {
    fs.writeFileSync(path.join(projectDir, 'a.txt'), 'a');
    const { spawnSync } = require('node:child_process');
    spawnSync('git', ['add', 'a.txt'], { cwd: projectDir, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'add a'], { cwd: projectDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(projectDir, 'a.txt'), 'a2');
    await createCheckpoint(projectDir, 'p1');
    
    fs.writeFileSync(path.join(projectDir, 'b.txt'), 'b');
    spawnSync('git', ['add', 'b.txt'], { cwd: projectDir, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'add b'], { cwd: projectDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(projectDir, 'b.txt'), 'b2');
    await createCheckpoint(projectDir, 'p1');
    
    const list = await listCheckpoints(projectDir, 'p1');
    expect(list.length).toBe(2);
    expect(list[0]).toContain('org-checkpoint-p1-');
  });

  it('clearCheckpoints removes all org checkpoints for project', async () => {
    fs.writeFileSync(path.join(projectDir, 'a.txt'), 'a');
    const { spawnSync } = require('node:child_process');
    spawnSync('git', ['add', 'a.txt'], { cwd: projectDir, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'add a'], { cwd: projectDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(projectDir, 'a.txt'), 'a2');
    await createCheckpoint(projectDir, 'p1');
    
    fs.writeFileSync(path.join(projectDir, 'b.txt'), 'b');
    spawnSync('git', ['add', 'b.txt'], { cwd: projectDir, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'add b'], { cwd: projectDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(projectDir, 'b.txt'), 'b2');
    await createCheckpoint(projectDir, 'p1');
    
    const cleared = await clearCheckpoints(projectDir, 'p1');
    expect(cleared).toBe(2);
    
    const list = await listCheckpoints(projectDir, 'p1');
    expect(list.length).toBe(0);
  });

  it('works on non-git folders (file-based backup)', async () => {
    const nonGit = path.join(tempDir, 'not-git');
    fs.mkdirSync(nonGit, { recursive: true });
    fs.writeFileSync(path.join(nonGit, 'test.txt'), 'content');
    const res = await createCheckpoint(nonGit, 'p1');
    expect(res.success).toBe(true);
    expect(res.checkpointId).toBeDefined();
  });
});
