/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { testDirs } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('path') as typeof import('path');
  const root = nodePath.join(process.cwd(), 'temp', 'auto-backup-test-' + Date.now());
  return {
    testDirs: {
      tempDir: root,
      dataDir: nodePath.join(root, 'data'),
      configDir: nodePath.join(root, 'config'),
      userDataDir: nodePath.join(root, 'userData'),
      backupTargetDir: nodePath.join(root, 'external-drive-backups'),
    },
  };
});

vi.mock('@process/utils/utils', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    getDataPath: () => testDirs.dataDir,
    getConfigPath: () => testDirs.configDir,
  };
});

vi.mock('@/common/platform/userDataPath', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    getUserDataDir: () => testDirs.userDataDir,
  };
});

import { performBackup, restoreBackup } from '@/process/services/backup/autoBackupService';

describe('autoBackupService', () => {
  beforeEach(() => {
    fs.mkdirSync(testDirs.dataDir, { recursive: true });
    fs.mkdirSync(testDirs.configDir, { recursive: true });
    fs.mkdirSync(testDirs.userDataDir, { recursive: true });
    fs.mkdirSync(testDirs.backupTargetDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testDirs.tempDir)) {
        fs.rmSync(testDirs.tempDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it('performs complete backup of database, org database, config, auth files, and knowledge repos', async () => {
    // Setup test data
    fs.writeFileSync(path.join(testDirs.dataDir, 'aionui-backend.db'), 'chat-database-content');
    fs.writeFileSync(path.join(testDirs.dataDir, 'aionui-backend.db-wal'), 'wal-content');
    fs.writeFileSync(path.join(testDirs.dataDir, 'aionui.db'), 'org-database-content');
    fs.writeFileSync(path.join(testDirs.configDir, 'config.json'), '{"theme":"dark"}');
    fs.writeFileSync(path.join(testDirs.userDataDir, 'auth.enc'), 'secret-tokens');

    // Setup knowledge repos in app data directory
    const repoDir = path.join(testDirs.userDataDir, 'knowledge-repos', 'test-repo');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'AGENTS.md'), '# Knowledge Rules');
    fs.writeFileSync(path.join(testDirs.userDataDir, 'knowledge-repos', 'repos.json'), '{"repos":[]}');

    const result = await performBackup(testDirs.backupTargetDir);
    expect(result.success).toBe(true);
    expect(result.backupPath).toBeDefined();

    const backupDir = result.backupPath!;
    expect(fs.existsSync(backupDir)).toBe(true);
    expect(fs.readFileSync(path.join(backupDir, 'aionui-backend.db'), 'utf8')).toBe('chat-database-content');
    expect(fs.readFileSync(path.join(backupDir, 'aionui-backend.db-wal'), 'utf8')).toBe('wal-content');
    expect(fs.readFileSync(path.join(backupDir, 'aionui.db'), 'utf8')).toBe('org-database-content');
    expect(fs.readFileSync(path.join(backupDir, 'config', 'config.json'), 'utf8')).toBe('{"theme":"dark"}');
    expect(fs.readFileSync(path.join(backupDir, 'auth.enc'), 'utf8')).toBe('secret-tokens');
    expect(fs.readFileSync(path.join(backupDir, 'knowledge-repos', 'test-repo', 'AGENTS.md'), 'utf8')).toBe(
      '# Knowledge Rules'
    );
    expect(fs.readFileSync(path.join(backupDir, 'knowledge-repos', 'repos.json'), 'utf8')).toBe('{"repos":[]}');

    const manifestRaw = fs.readFileSync(path.join(backupDir, 'backup-manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.version).toBe(1);
    expect(manifest.items).toContain('aionui-backend.db');
    expect(manifest.items).toContain('aionui.db');
    expect(manifest.items).toContain('knowledge-repos');
  });

  it('restores database, settings, and knowledge repos from a backup snapshot folder', async () => {
    // 1. Create a backup snapshot folder
    const snapshotDir = path.join(testDirs.backupTargetDir, 'aionui-backup-20261122_120000');
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.mkdirSync(path.join(snapshotDir, 'config'), { recursive: true });
    const snapshotKnowledgeRepo = path.join(snapshotDir, 'knowledge-repos', 'restored-repo');
    fs.mkdirSync(snapshotKnowledgeRepo, { recursive: true });

    fs.writeFileSync(path.join(snapshotDir, 'aionui-backend.db'), 'restored-chat-content');
    fs.writeFileSync(path.join(snapshotDir, 'aionui.db'), 'restored-org-content');
    fs.writeFileSync(path.join(snapshotDir, 'config', 'config.json'), '{"restored":true}');
    fs.writeFileSync(path.join(snapshotDir, 'auth.enc'), 'restored-auth');
    fs.writeFileSync(path.join(snapshotKnowledgeRepo, 'AGENTS.md'), '# Restored Knowledge');
    fs.writeFileSync(path.join(snapshotDir, 'knowledge-repos', 'repos.json'), '{"repos":[{"id":"restored-repo"}]}');

    // 2. Perform restore
    const res = await restoreBackup(snapshotDir);
    expect(res.success).toBe(true);
    expect(res.restoredPath).toBe(snapshotDir);

    expect(fs.readFileSync(path.join(testDirs.dataDir, 'aionui-backend.db'), 'utf8')).toBe('restored-chat-content');
    expect(fs.readFileSync(path.join(testDirs.dataDir, 'aionui.db'), 'utf8')).toBe('restored-org-content');
    expect(fs.readFileSync(path.join(testDirs.configDir, 'config.json'), 'utf8')).toBe('{"restored":true}');
    expect(fs.readFileSync(path.join(testDirs.userDataDir, 'auth.enc'), 'utf8')).toBe('restored-auth');
    expect(
      fs.readFileSync(path.join(testDirs.userDataDir, 'knowledge-repos', 'restored-repo', 'AGENTS.md'), 'utf8')
    ).toBe('# Restored Knowledge');
    expect(fs.readFileSync(path.join(testDirs.userDataDir, 'knowledge-repos', 'repos.json'), 'utf8')).toBe(
      '{"repos":[{"id":"restored-repo"}]}'
    );
  });

  it('restores from a parent directory by finding the newest backup snapshot', async () => {
    const olderSnapshot = path.join(testDirs.backupTargetDir, 'aionui-backup-20261120_100000');
    const newerSnapshot = path.join(testDirs.backupTargetDir, 'aionui-backup-20261122_150000');
    fs.mkdirSync(olderSnapshot, { recursive: true });
    fs.mkdirSync(newerSnapshot, { recursive: true });

    fs.writeFileSync(path.join(olderSnapshot, 'aionui-backend.db'), 'old-content');
    fs.writeFileSync(path.join(newerSnapshot, 'aionui-backend.db'), 'new-content');

    // Give newerSnapshot a newer mtime
    const future = new Date(Date.now() + 10000);
    fs.utimesSync(path.join(newerSnapshot, 'aionui-backend.db'), future, future);

    const res = await restoreBackup(testDirs.backupTargetDir);
    expect(res.success).toBe(true);
    expect(res.restoredPath).toBe(newerSnapshot);
    expect(fs.readFileSync(path.join(testDirs.dataDir, 'aionui-backend.db'), 'utf8')).toBe('new-content');
  });
});
