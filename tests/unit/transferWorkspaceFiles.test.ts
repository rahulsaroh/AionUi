/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyDirectoryRecursively } from '@/process/utils/utils';

describe('transferWorkspaceFiles logic', () => {
  let tempDir: string;
  let sourceDir: string;
  let targetDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aionui-transfer-test-'));
    sourceDir = path.join(tempDir, 'source');
    targetDir = path.join(tempDir, 'target');

    await fs.promises.mkdir(sourceDir, { recursive: true });
    await fs.promises.mkdir(path.join(sourceDir, 'subfolder'), { recursive: true });
    await fs.promises.writeFile(path.join(sourceDir, 'file1.txt'), 'hello from file1', 'utf8');
    await fs.promises.writeFile(path.join(sourceDir, 'subfolder', 'file2.json'), '{"key":"value"}', 'utf8');
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('copies directory recursively from source to target', async () => {
    await fs.promises.mkdir(targetDir, { recursive: true });
    const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcItem = path.join(sourceDir, entry.name);
      const destItem = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        await copyDirectoryRecursively(srcItem, destItem, { overwrite: true });
      } else {
        await fs.promises.copyFile(srcItem, destItem);
      }
    }

    expect(fs.existsSync(path.join(targetDir, 'file1.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, 'file1.txt'), 'utf8')).toBe('hello from file1');
    expect(fs.existsSync(path.join(targetDir, 'subfolder', 'file2.json'))).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, 'subfolder', 'file2.json'), 'utf8')).toBe('{"key":"value"}');

    // Source files should still exist in copy mode
    expect(fs.existsSync(path.join(sourceDir, 'file1.txt'))).toBe(true);
  });

  it('moves files and cleans up source entries', async () => {
    await fs.promises.mkdir(targetDir, { recursive: true });
    const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcItem = path.join(sourceDir, entry.name);
      const destItem = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        await copyDirectoryRecursively(srcItem, destItem, { overwrite: true });
      } else {
        await fs.promises.copyFile(srcItem, destItem);
      }

      await fs.promises.rm(srcItem, { recursive: true, force: true });
    }

    expect(fs.existsSync(path.join(targetDir, 'file1.txt'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'subfolder', 'file2.json'))).toBe(true);

    // Source entries should have been removed
    const remaining = await fs.promises.readdir(sourceDir);
    expect(remaining).toHaveLength(0);
  });
});
