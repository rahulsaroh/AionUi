/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import path from 'path';
import type { HandbookHistoryItem } from '@/common/types/team/handbookTypes';

export const MAX_HISTORY_VERSIONS = 20;
const HISTORY_DIR_NAME = '.history';
const MANIFEST_FILE_NAME = 'manifest.json';

type HistoryManifestEntry = {
  id: string;
  memberKey: string;
  fileName: string;
  timestamp: number;
  historyFileName: string;
  contentPreview: string;
  fileHash?: string;
};

type HistoryManifest = {
  version: 1;
  entries: Record<string, HistoryManifestEntry[]>; // memberKey -> entries
};

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readManifest(historyDir: string): Promise<HistoryManifest> {
  const manifestPath = path.join(historyDir, MANIFEST_FILE_NAME);
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as HistoryManifest;
    if (parsed && typeof parsed.entries === 'object') {
      return parsed;
    }
  } catch {
    // If missing or corrupted, return fresh
  }
  return { version: 1, entries: {} };
}

async function writeManifest(historyDir: string, manifest: HistoryManifest): Promise<void> {
  const manifestPath = path.join(historyDir, MANIFEST_FILE_NAME);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

export class HandbookHistoryManager {
  /**
   * Save a version of the handbook into .history/
   */
  async recordHistory(
    handbookDir: string,
    memberKey: string,
    fileName: string,
    content: string,
    fileHash?: string
  ): Promise<HandbookHistoryItem> {
    const historyDir = path.join(handbookDir, HISTORY_DIR_NAME);
    await ensureDir(historyDir);

    const manifest = await readManifest(historyDir);
    const timestamp = Date.now();
    const id = `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    const historyFileName = `${id}.md`;
    const historyFilePath = path.join(historyDir, historyFileName);

    await fs.writeFile(historyFilePath, content, 'utf-8');

    const preview = content
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('<!--'))
      .slice(0, 3)
      .join(' ')
      .slice(0, 120);

    const newEntry: HistoryManifestEntry = {
      id,
      memberKey,
      fileName,
      timestamp,
      historyFileName,
      contentPreview: preview || 'Empty handbook',
      fileHash,
    };

    const memberEntries = manifest.entries[memberKey] || [];
    memberEntries.unshift(newEntry);

    // Prune versions exceeding MAX_HISTORY_VERSIONS
    if (memberEntries.length > MAX_HISTORY_VERSIONS) {
      const removed = memberEntries.splice(MAX_HISTORY_VERSIONS);
      for (const rem of removed) {
        try {
          await fs.unlink(path.join(historyDir, rem.historyFileName));
        } catch {
          // ignore cleanup failures
        }
      }
    }

    manifest.entries[memberKey] = memberEntries;
    await writeManifest(historyDir, manifest);

    return {
      id: newEntry.id,
      timestamp: newEntry.timestamp,
      fileName: newEntry.fileName,
      contentPreview: newEntry.contentPreview,
      fileHash: newEntry.fileHash,
    };
  }

  /**
   * List history versions for a given member key (most recent first).
   */
  async listHistory(handbookDir: string, memberKey: string): Promise<HandbookHistoryItem[]> {
    const historyDir = path.join(handbookDir, HISTORY_DIR_NAME);
    const manifest = await readManifest(historyDir);
    const entries = manifest.entries[memberKey] || [];
    return entries.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      fileName: e.fileName,
      contentPreview: e.contentPreview,
      fileHash: e.fileHash,
    }));
  }

  /**
   * Read the full markdown content of a specific history version.
   */
  async getHistoryVersion(handbookDir: string, memberKey: string, historyId: string): Promise<string | null> {
    const historyDir = path.join(handbookDir, HISTORY_DIR_NAME);
    const manifest = await readManifest(historyDir);
    const entries = manifest.entries[memberKey] || [];
    const entry = entries.find((e) => e.id === historyId);
    if (!entry) return null;

    try {
      return await fs.readFile(path.join(historyDir, entry.historyFileName), 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Update file name in manifest when a member is renamed.
   */
  async handleMemberRename(handbookDir: string, memberKey: string, newFileName: string): Promise<void> {
    const historyDir = path.join(handbookDir, HISTORY_DIR_NAME);
    const manifest = await readManifest(historyDir);
    const entries = manifest.entries[memberKey];
    if (entries) {
      for (const entry of entries) {
        entry.fileName = newFileName;
      }
      await writeManifest(historyDir, manifest);
    }
  }
}

export const handbookHistoryManager = new HandbookHistoryManager();
