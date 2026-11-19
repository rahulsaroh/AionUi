/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'node:fs';

/**
 * Git checkpoint/undo service for org projects.
 *
 * Uses a file-based backup approach: creates a timestamped backup folder
 * containing a copy of the project's working tree. On undo, restores from backup.
 * This is simpler and more reliable than git stash for our use case.
 */

export interface CheckpointResult {
  success: boolean;
  checkpointId?: string;
  error?: string;
}

export interface UndoResult {
  success: boolean;
  message?: string;
  error?: string;
}

const CHECKPOINT_PREFIX = 'org-checkpoint-';
const CHECKPOINT_DIR_NAME = '.aionui-checkpoints';

function getCheckpointRoot(projectFolder: string): string {
  return path.join(projectFolder, CHECKPOINT_DIR_NAME);
}

function getCheckpointId(projectId: string): string {
  return `${CHECKPOINT_PREFIX}${projectId}-${Date.now()}`;
}

function getCheckpointPath(projectFolder: string, checkpointId: string): string {
  return path.join(getCheckpointRoot(projectFolder), checkpointId);
}

function listCheckpointIds(projectFolder: string, projectId: string): string[] {
  const root = getCheckpointRoot(projectFolder);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => name.startsWith(`${CHECKPOINT_PREFIX}${projectId}-`))
    .toSorted()
    .toReversed(); // most recent first
}

/**
 * Create a checkpoint before a member's task runs.
 * Returns a checkpointId that can be passed to undoCheckpoint.
 */
export async function createCheckpoint(projectFolder: string, projectId: string): Promise<CheckpointResult> {
  try {
    // Quick check: if there are no files to backup (empty project), return empty
    const hasFiles = fs.existsSync(projectFolder) && fs.readdirSync(projectFolder).length > 0;
    if (!hasFiles) {
      return { success: true, checkpointId: 'empty' };
    }

    const checkpointId = getCheckpointId(projectId);
    const checkpointPath = getCheckpointPath(projectFolder, checkpointId);

    // Create checkpoint directory (ensure parent exists)
    const root = getCheckpointRoot(projectFolder);
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
    fs.mkdirSync(checkpointPath, { recursive: true });

    // Copy project folder to checkpoint (excluding .git, .aionui-checkpoints, and build artifacts)
    copyFolderSync(projectFolder, checkpointPath, [
      '.git',
      CHECKPOINT_DIR_NAME,
      'node_modules',
      '.next',
      'dist',
      'build',
    ]);

    return { success: true, checkpointId };
  } catch (err) {
    console.error('[orgCheckpoint] createCheckpoint failed:', err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Undo the last checkpoint for a project.
 * Finds the most recent checkpoint for this project and restores from it.
 */
export async function undoCheckpoint(projectFolder: string, projectId: string): Promise<UndoResult> {
  try {
    const ids = listCheckpointIds(projectFolder, projectId);
    if (ids.length === 0) {
      return { success: false, error: 'No org checkpoint found for this project' };
    }

    const latestId = ids[0];
    const checkpointPath = getCheckpointPath(projectFolder, latestId);

    if (!fs.existsSync(checkpointPath)) {
      return { success: false, error: 'Checkpoint data not found' };
    }

    // Restore from checkpoint (overwrite project files)
    copyFolderSync(checkpointPath, projectFolder, ['.git', CHECKPOINT_DIR_NAME]);

    return { success: true, message: `Restored checkpoint ${latestId}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * List available org checkpoints for a project (for UI display).
 */
export async function listCheckpoints(projectFolder: string, projectId: string): Promise<string[]> {
  return listCheckpointIds(projectFolder, projectId);
}

/**
 * Clear all org checkpoints for a project (admin cleanup).
 */
export async function clearCheckpoints(projectFolder: string, projectId: string): Promise<number> {
  const ids = listCheckpointIds(projectFolder, projectId);
  let cleared = 0;
  for (const id of ids) {
    try {
      const checkpointPath = getCheckpointPath(projectFolder, id);
      fs.rmSync(checkpointPath, { recursive: true, force: true });
      cleared++;
    } catch {
      // ignore individual failures
    }
  }
  return cleared;
}

function copyFolderSync(src: string, dest: string, excludeDirs: string[] = []): void {
  if (!fs.existsSync(src)) return;

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (excludeDirs.includes(entry.name)) continue;
      const srcDir = path.join(src, entry.name);
      const destDir = path.join(dest, entry.name);
      fs.mkdirSync(destDir, { recursive: true });
      copyFolderSync(srcDir, destDir, excludeDirs);
    } else if (entry.isFile()) {
      const srcFile = path.join(src, entry.name);
      const destFile = path.join(dest, entry.name);
      // Overwrite if exists
      if (fs.existsSync(destFile)) {
        fs.unlinkSync(destFile);
      }
      fs.copyFileSync(srcFile, destFile);
    }
    // skip symlinks for simplicity
  }
}
