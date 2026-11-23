/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { getUserDataDir } from '@/common/platform/userDataPath';
import { ProcessConfig } from '@process/utils/initStorage';
import { copyDirectoryRecursively, getConfigPath, getDataPath, resolveCliSafePath } from '@process/utils/utils';

export interface IBackupResult {
  success: boolean;
  backupPath?: string;
  msg?: string;
}

export interface IRestoreResult {
  success: boolean;
  restoredPath?: string;
  msg?: string;
}

export interface IBackupStatus {
  backupDir?: string;
  autoBackup: boolean;
  autoBackupInterval: number; // in hours
  lastBackupTime?: number; // timestamp in ms
}

let autoBackupTimer: NodeJS.Timeout | null = null;
let isBackingUp = false;

const DEFAULT_CHECK_INTERVAL_MS = 15 * 60 * 1000; // Check every 15 minutes
const STARTUP_DELAY_MS = 30 * 1000; // First check 30s after startup

/**
 * Perform a backup of all chat conversations, database files, and settings.
 * Creates a timestamped directory inside targetDir (or configured backupDir).
 */
export async function performBackup(targetDir?: string): Promise<IBackupResult> {
  if (isBackingUp) {
    return { success: false, msg: 'A backup is already in progress' };
  }

  isBackingUp = true;
  try {
    const defaultBackupDir = path.join(getUserDataDir(), 'backups');
    const configuredBackupDir = (await ProcessConfig.get('system.backupDir')) as string | undefined;
    const chosenTarget = targetDir || configuredBackupDir || defaultBackupDir;
    const safeTarget = resolveCliSafePath(chosenTarget, defaultBackupDir);

    if (!fs.existsSync(safeTarget)) {
      await fs.promises.mkdir(safeTarget, { recursive: true });
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const backupSubdir = path.join(safeTarget, `aionui-backup-${timestamp}`);
    await fs.promises.mkdir(backupSubdir, { recursive: true });

    const backedUpItems: string[] = [];

    // 1. Back up aionui-backend.db (chats, messages, tasks, cron schedules)
    const dbPath = path.join(getDataPath(), 'aionui-backend.db');
    if (fs.existsSync(dbPath)) {
      await fs.promises.copyFile(dbPath, path.join(backupSubdir, 'aionui-backend.db'));
      backedUpItems.push('aionui-backend.db');
      const walPath = `${dbPath}-wal`;
      if (fs.existsSync(walPath)) {
        await fs.promises.copyFile(walPath, path.join(backupSubdir, 'aionui-backend.db-wal'));
      }
      const shmPath = `${dbPath}-shm`;
      if (fs.existsSync(shmPath)) {
        await fs.promises.copyFile(shmPath, path.join(backupSubdir, 'aionui-backend.db-shm'));
      }
    }

    // 2. Back up aionui.db (organization and workplace database)
    const orgDbPath = path.join(getDataPath(), 'aionui.db');
    if (fs.existsSync(orgDbPath)) {
      await fs.promises.copyFile(orgDbPath, path.join(backupSubdir, 'aionui.db'));
      backedUpItems.push('aionui.db');
      const orgWal = `${orgDbPath}-wal`;
      if (fs.existsSync(orgWal)) {
        await fs.promises.copyFile(orgWal, path.join(backupSubdir, 'aionui.db-wal'));
      }
      const orgShm = `${orgDbPath}-shm`;
      if (fs.existsSync(orgShm)) {
        await fs.promises.copyFile(orgShm, path.join(backupSubdir, 'aionui.db-shm'));
      }
    }

    // 3. Back up config directory
    const configDir = getConfigPath();
    if (fs.existsSync(configDir)) {
      await copyDirectoryRecursively(configDir, path.join(backupSubdir, 'config'));
      backedUpItems.push('config');
    }

    // 4. Back up essential authentication and app configuration files
    const userDataDir = getUserDataDir();
    const configFiles = ['auth.enc', 'browser_profiles.json', 'gpu.config.json'];
    for (const file of configFiles) {
      const src = path.join(userDataDir, file);
      if (fs.existsSync(src)) {
        try {
          await fs.promises.copyFile(src, path.join(backupSubdir, file));
          backedUpItems.push(file);
        } catch (err) {
          console.warn(`[AutoBackup] Could not copy ${file}:`, err);
        }
      }
    }

    // 5. Back up knowledge repositories (cloned repos, git data, and metadata) and member handbooks
    const knowledgeReposDir = path.join(userDataDir, 'knowledge-repos');
    let customKnowledgeDir: string | undefined;
    try {
      const { knowledgeRepoService } = await import('@/process/services/knowledgeRepo');
      const activeCacheDir = knowledgeRepoService.getCacheDir();
      if (activeCacheDir && path.resolve(activeCacheDir) !== path.resolve(knowledgeReposDir)) {
        customKnowledgeDir = activeCacheDir;
      }
    } catch {
      // ignore
    }

    const targetSourceDir = fs.existsSync(knowledgeReposDir)
      ? knowledgeReposDir
      : customKnowledgeDir && fs.existsSync(customKnowledgeDir)
        ? customKnowledgeDir
        : undefined;

    if (targetSourceDir) {
      try {
        const destKnowledgeDir = path.join(backupSubdir, 'knowledge-repos');
        await copyDirectoryRecursively(targetSourceDir, destKnowledgeDir);
        backedUpItems.push('knowledge-repos');
      } catch (err) {
        console.warn('[AutoBackup] Could not copy knowledge-repos:', err);
      }
    }

    const legacyKnowledgeDir = path.join(userDataDir, 'knowledge_repos');
    if (fs.existsSync(legacyKnowledgeDir)) {
      try {
        const destLegacyDir = path.join(backupSubdir, 'knowledge_repos');
        await copyDirectoryRecursively(legacyKnowledgeDir, destLegacyDir);
        backedUpItems.push('knowledge_repos');
      } catch (err) {
        console.warn('[AutoBackup] Could not copy knowledge_repos:', err);
      }
    }

    const handbooksDir = path.join(userDataDir, 'member-handbooks');
    if (fs.existsSync(handbooksDir)) {
      try {
        await copyDirectoryRecursively(handbooksDir, path.join(backupSubdir, 'member-handbooks'));
        backedUpItems.push('member-handbooks');
      } catch (err) {
        console.warn('[AutoBackup] Could not copy member-handbooks:', err);
      }
    }

    // 6. Write backup manifest
    const manifest = {
      version: 1,
      createdAt: now.toISOString(),
      timestamp,
      items: backedUpItems,
    };
    await fs.promises.writeFile(
      path.join(backupSubdir, 'backup-manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    // 6. Record last backup timestamp
    const backupTimeMs = Date.now();
    await ProcessConfig.set('system.lastBackupTime', backupTimeMs);

    console.info(`[AutoBackup] Successfully created backup at ${backupSubdir}`);
    return { success: true, backupPath: backupSubdir };
  } catch (err) {
    console.error('[AutoBackup] Backup failed:', err);
    return { success: false, msg: err instanceof Error ? err.message : String(err) };
  } finally {
    isBackingUp = false;
  }
}

/**
 * Restore data from a specified backup directory or snapshot folder.
 */
export async function restoreBackup(backupPath?: string): Promise<IRestoreResult> {
  const configuredBackupDir = (await ProcessConfig.get('system.backupDir')) as string | undefined;
  const target = backupPath || configuredBackupDir;

  if (!target || typeof target !== 'string' || target.trim() === '') {
    return { success: false, msg: 'No backup folder specified' };
  }

  const resolved = path.resolve(target.trim());
  if (!fs.existsSync(resolved)) {
    return { success: false, msg: `Backup directory does not exist: ${resolved}` };
  }

  // Determine actual snapshot directory
  let snapshotDir = resolved;
  const directDb = path.join(resolved, 'aionui-backend.db');
  if (!fs.existsSync(directDb)) {
    // Scan for newest aionui-backup-* subdirectory
    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      let newestDir: string | null = null;
      let newestTime = 0;
      for (const entry of entries) {
        if (entry.isDirectory() && /^(aionui|data)[-_]backup/i.test(entry.name)) {
          const sub = path.join(resolved, entry.name);
          const subDb = path.join(sub, 'aionui-backend.db');
          if (fs.existsSync(subDb) && fs.statSync(subDb).size > 0) {
            const mtime = fs.statSync(subDb).mtimeMs;
            if (mtime > newestTime) {
              newestTime = mtime;
              newestDir = sub;
            }
          }
        }
      }
      if (newestDir) {
        snapshotDir = newestDir;
      } else {
        return { success: false, msg: 'No valid AionUi backup snapshot found in folder' };
      }
    } catch (err) {
      return { success: false, msg: String(err) };
    }
  }

  const srcDb = path.join(snapshotDir, 'aionui-backend.db');
  if (!fs.existsSync(srcDb) || fs.statSync(srcDb).size === 0) {
    return { success: false, msg: 'Backup snapshot does not contain a valid database file' };
  }

  const targetDataDir = getDataPath();
  if (!fs.existsSync(targetDataDir)) {
    await fs.promises.mkdir(targetDataDir, { recursive: true });
  }

  try {
    // 1. Restore aionui-backend.db and clean up/copy WAL & SHM
    const destDb = path.join(targetDataDir, 'aionui-backend.db');
    await fs.promises.copyFile(srcDb, destDb);

    const srcWal = `${srcDb}-wal`;
    const destWal = `${destDb}-wal`;
    if (fs.existsSync(srcWal)) {
      await fs.promises.copyFile(srcWal, destWal);
    } else if (fs.existsSync(destWal)) {
      try {
        await fs.promises.unlink(destWal);
      } catch {
        /* ignore */
      }
    }

    const srcShm = `${srcDb}-shm`;
    const destShm = `${destDb}-shm`;
    if (fs.existsSync(srcShm)) {
      await fs.promises.copyFile(srcShm, destShm);
    } else if (fs.existsSync(destShm)) {
      try {
        await fs.promises.unlink(destShm);
      } catch {
        /* ignore */
      }
    }

    // 2. Restore aionui.db (org database) if present
    const srcOrgDb = path.join(snapshotDir, 'aionui.db');
    if (fs.existsSync(srcOrgDb)) {
      const destOrgDb = path.join(targetDataDir, 'aionui.db');
      await fs.promises.copyFile(srcOrgDb, destOrgDb);
      if (fs.existsSync(`${srcOrgDb}-wal`)) {
        await fs.promises.copyFile(`${srcOrgDb}-wal`, `${destOrgDb}-wal`);
      }
      if (fs.existsSync(`${srcOrgDb}-shm`)) {
        await fs.promises.copyFile(`${srcOrgDb}-shm`, `${destOrgDb}-shm`);
      }
    }

    // 3. Restore config directory
    const srcConfig = path.join(snapshotDir, 'config');
    const destConfig = getConfigPath();
    if (fs.existsSync(srcConfig)) {
      if (!fs.existsSync(destConfig)) {
        await fs.promises.mkdir(destConfig, { recursive: true });
      }
      await copyDirectoryRecursively(srcConfig, destConfig);
    }

    // 4. Restore auth and other config files
    const userDataDir = getUserDataDir();
    const configFiles = ['auth.enc', 'browser_profiles.json', 'gpu.config.json'];
    for (const file of configFiles) {
      const src = path.join(snapshotDir, file);
      if (fs.existsSync(src)) {
        try {
          await fs.promises.copyFile(src, path.join(userDataDir, file));
        } catch {
          /* ignore */
        }
      }
    }

    // 5. Restore knowledge repo metadata and member handbooks if present
    const srcKnowledgeRepos = path.join(snapshotDir, 'knowledge-repos');
    if (fs.existsSync(srcKnowledgeRepos)) {
      try {
        let destKnowledgeDir = path.join(userDataDir, 'knowledge-repos');
        try {
          const { knowledgeRepoService } = await import('@/process/services/knowledgeRepo');
          const activeCache = knowledgeRepoService.getCacheDir();
          if (activeCache) {
            destKnowledgeDir = activeCache;
          }
        } catch {
          // ignore
        }
        await copyDirectoryRecursively(srcKnowledgeRepos, destKnowledgeDir);
        try {
          const { knowledgeRepoService } = await import('@/process/services/knowledgeRepo');
          await knowledgeRepoService.reload();
        } catch {
          // ignore
        }
      } catch (err) {
        console.warn('[AutoBackup] Could not restore knowledge-repos:', err);
      }
    }

    const srcKnowledge = path.join(snapshotDir, 'knowledge_repos', 'repos.json');
    if (fs.existsSync(srcKnowledge)) {
      try {
        const destDir = path.join(userDataDir, 'knowledge_repos');
        await fs.promises.mkdir(destDir, { recursive: true });
        await fs.promises.copyFile(srcKnowledge, path.join(destDir, 'repos.json'));
      } catch {
        /* ignore */
      }
    }

    const srcHandbooks = path.join(snapshotDir, 'member-handbooks');
    if (fs.existsSync(srcHandbooks)) {
      try {
        const destDir = path.join(userDataDir, 'member-handbooks');
        await copyDirectoryRecursively(srcHandbooks, destDir);
      } catch {
        /* ignore */
      }
    }

    console.info(`[AutoBackup] Successfully restored data from ${snapshotDir}`);
    return { success: true, restoredPath: snapshotDir };
  } catch (err) {
    console.error('[AutoBackup] Restore failed:', err);
    return { success: false, msg: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Get current backup configuration status.
 */
export async function getBackupStatus(): Promise<IBackupStatus> {
  const backupDir = (await ProcessConfig.get('system.backupDir')) as string | undefined;
  const autoBackup = ((await ProcessConfig.get('system.autoBackup')) as boolean | undefined) ?? false;
  const autoBackupInterval = ((await ProcessConfig.get('system.autoBackupInterval')) as number | undefined) ?? 24;
  const lastBackupTime = (await ProcessConfig.get('system.lastBackupTime')) as number | undefined;

  return {
    backupDir,
    autoBackup,
    autoBackupInterval,
    lastBackupTime,
  };
}

/**
 * Update auto-backup settings and re-evaluate schedule.
 */
export async function updateAutoBackupConfig(enabled: boolean, interval?: number): Promise<void> {
  await ProcessConfig.set('system.autoBackup', enabled);
  if (interval !== undefined && interval > 0) {
    await ProcessConfig.set('system.autoBackupInterval', interval);
  }
  if (enabled) {
    void checkAndRunAutoBackup();
  }
}

async function checkAndRunAutoBackup(): Promise<void> {
  try {
    const status = await getBackupStatus();
    if (!status.autoBackup || !status.backupDir || status.backupDir.trim() === '') {
      return;
    }

    const intervalMs = (status.autoBackupInterval || 24) * 60 * 60 * 1000;
    const lastTime = status.lastBackupTime || 0;
    const now = Date.now();

    if (now - lastTime >= intervalMs) {
      console.info('[AutoBackup] Scheduled auto-backup triggered.');
      await performBackup(status.backupDir);
    }
  } catch (err) {
    console.warn('[AutoBackup] Error during auto-backup check:', err);
  }
}

/**
 * Initialize background auto-backup daemon.
 */
export function initAutoBackupService(): void {
  if (autoBackupTimer) {
    return;
  }

  // Initial delayed check after app boot
  setTimeout(() => {
    void checkAndRunAutoBackup();
  }, STARTUP_DELAY_MS);

  // Periodic recurring check
  autoBackupTimer = setInterval(() => {
    void checkAndRunAutoBackup();
  }, DEFAULT_CHECK_INTERVAL_MS);
}

/**
 * Stop background auto-backup daemon on application shutdown.
 */
export function stopAutoBackupService(): void {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
}
