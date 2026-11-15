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
  setMasterRoot,
  getMasterRoot,
  setMasterRootForTesting,
  resetMasterRoot,
  resolveEffectiveScope,
  isForbiddenSystemOrRootPath,
  validateCandidateMasterRoot,
  clearMasterRoot,
} from '@/process/services/org/orgScope';
import {
  OrgStorageService,
  isValidOrgStorageKey,
  MAX_STORAGE_VALUE_BYTES,
} from '@/process/services/org/orgStorageService';
import type { ISqliteDriver } from '@/process/services/database/drivers/ISqliteDriver';

class MockSqliteDriver implements ISqliteDriver {
  private store = new Map<string, { key: string; value: string; updated_at: number }>();

  close(): void {}

  exec(_sql: string): void {}

  prepare(sql: string) {
    const store = this.store;
    return {
      run(...args: any[]) {
        if (sql.includes('INSERT INTO org_state')) {
          const [key, value, updatedAt] = args;
          store.set(key, { key, value, updated_at: updatedAt });
          return { changes: 1 };
        }
        return { changes: 0 };
      },
      get(...args: any[]) {
        if (sql.includes('SELECT value FROM org_state WHERE key = ?')) {
          const [key] = args;
          const row = store.get(key);
          return row ? { value: row.value } : undefined;
        }
        return undefined;
      },
      all(..._args: any[]) {
        return [];
      },
    };
  }
}

describe('Phase 2.5: Main Process Master Root, Key Whitelisting & Path Guards', () => {
  let tempRoot: string;
  let validDir: string;
  let mockDriver: MockSqliteDriver;
  let storageService: OrgStorageService;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'org-phase2-5-'));
    validDir = path.join(tempRoot, 'safe-org');
    fs.mkdirSync(validDir, { recursive: true });

    mockDriver = new MockSqliteDriver();
    storageService = new OrgStorageService(mockDriver);
    OrgStorageService.setInstance(storageService);

    resetMasterRoot();
  });

  afterEach(() => {
    resetMasterRoot();
    OrgStorageService.setInstance(null);
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  });

  describe('Item 1: Storage Key Whitelist and Reserved Keys', () => {
    it('rejects "master_root" and "master_root_configured" for external callers', () => {
      expect(isValidOrgStorageKey('master_root', false)).toBe(false);
      expect(isValidOrgStorageKey('master_root_configured', false)).toBe(false);
      // Allowed for internal orgScope callers
      expect(isValidOrgStorageKey('master_root', true)).toBe(true);
      expect(isValidOrgStorageKey('master_root_configured', true)).toBe(true);
    });

    it('allows whitelisted org keys and aionui:org-* prefixes', () => {
      expect(isValidOrgStorageKey('active_scope', false)).toBe(true);
      expect(isValidOrgStorageKey('root_ceo', false)).toBe(true);
      expect(isValidOrgStorageKey('cron_jobs', false)).toBe(true);
      expect(isValidOrgStorageKey('conversations', false)).toBe(true);
      expect(isValidOrgStorageKey('initialized', false)).toBe(true);
      expect(isValidOrgStorageKey('aionui:active-scope', false)).toBe(true);
      expect(isValidOrgStorageKey('aionui:org-hierarchy', false)).toBe(true);
      expect(isValidOrgStorageKey('aionui:org-projects', false)).toBe(true);
    });

    it('malicious caller: rejects unwhitelisted keys', async () => {
      expect(isValidOrgStorageKey('malicious_key', false)).toBe(false);
      expect(isValidOrgStorageKey('passwords', false)).toBe(false);
      expect(isValidOrgStorageKey('arbitrary_setting', false)).toBe(false);

      const saveRes = await storageService.saveData('malicious_key', 'evil');
      expect(saveRes).toBe(false);

      const loadRes = await storageService.loadData('malicious_key');
      expect(loadRes).toBeNull();
    });

    it('malicious caller: rejects external writes and reads to "master_root"', async () => {
      const saveRes = await storageService.saveData('master_root', '/evil/root', false);
      expect(saveRes).toBe(false);

      const loadRes = await storageService.loadData('master_root', false);
      expect(loadRes).toBeNull();
    });

    it('rejects values larger than 10 MB limit', async () => {
      // 10 MB + 1 byte
      const oversized = 'a'.repeat(MAX_STORAGE_VALUE_BYTES + 1);
      const res = await storageService.saveData('aionui:org-hierarchy', oversized);
      expect(res).toBe(false);
    });
  });

  describe('Item 2: getMasterRoot re-validation & root_ceo fallback protection', () => {
    it('re-validates stored master root on load: fails closed if folder was deleted', async () => {
      const deletedFolder = path.join(tempRoot, 'deleted-folder');
      fs.mkdirSync(deletedFolder, { recursive: true });

      // Save valid path internally
      await storageService.saveData('master_root', deletedFolder, true);

      // Verify it was saved
      const savedRaw = await storageService.loadData('master_root', true);
      expect(savedRaw).toBe(deletedFolder);

      // Now delete folder from disk
      fs.rmSync(deletedFolder, { recursive: true, force: true });

      // getMasterRoot must fail closed and clear invalid value
      resetMasterRoot();
      const current = await getMasterRoot();
      expect(current).toBeNull();

      // Stored value should now be cleared
      const clearedRaw = await storageService.loadData('master_root', true);
      expect(clearedRaw).toBe('');
    });

    it('does NOT run root_ceo fallback if master_root was explicitly set or cleared', async () => {
      // Save root_ceo workspace
      await storageService.saveData('root_ceo', JSON.stringify({ workspacePath: validDir }));

      // Mark master_root as explicitly cleared by user
      await clearMasterRoot();

      resetMasterRoot();
      const current = await getMasterRoot();
      // Should NOT fall back to root_ceo because user explicitly cleared/set it
      expect(current).toBeNull();
    });

    it('runs root_ceo fallback on legacy setups where master_root was never configured', async () => {
      // Storage has root_ceo but master_root_configured was never set
      await storageService.saveData('root_ceo', JSON.stringify({ workspacePath: validDir }));

      resetMasterRoot();
      const current = await getMasterRoot();
      expect(current).toBe(fs.realpathSync(validDir));
    });
  });

  describe('Item 3: resolveEffectiveScope fails closed when client boundary is outside master root', () => {
    it('throws error (fails closed) if clientWorkspace is outside master root', async () => {
      setMasterRootForTesting(validDir);

      const outsideDir = path.join(tempRoot, 'outside-folder');
      fs.mkdirSync(outsideDir, { recursive: true });

      await expect(resolveEffectiveScope(outsideDir)).rejects.toThrow(/is not within organization master root/i);
    });

    it('narrows scope when clientWorkspace is a strict sub-path inside master root', async () => {
      setMasterRootForTesting(validDir);

      const subDir = path.join(validDir, 'frontend');
      fs.mkdirSync(subDir, { recursive: true });

      const effective = await resolveEffectiveScope(subDir);
      expect(effective).toBe(fs.realpathSync(subDir));
    });

    it('returns master root when clientWorkspace is not provided', async () => {
      setMasterRootForTesting(validDir);
      const effective = await resolveEffectiveScope();
      expect(effective).toBe(fs.realpathSync(validDir));
    });
  });

  describe('Item 4: Forbidden paths expansion', () => {
    it('forbids parent of home directory (/home, /Users, C:\\Users)', () => {
      const homeParent = path.dirname(os.homedir());
      const checkHomeParent = isForbiddenSystemOrRootPath(homeParent);
      expect(checkHomeParent.forbidden).toBe(true);
      expect(checkHomeParent.reason).toMatch(/home parent directory/i);

      if (process.platform === 'win32') {
        expect(isForbiddenSystemOrRootPath('C:\\Users').forbidden).toBe(true);
      } else {
        expect(isForbiddenSystemOrRootPath('/home').forbidden).toBe(true);
        expect(isForbiddenSystemOrRootPath('/Users').forbidden).toBe(true);
      }
    });

    it('forbids protected dot-directories under home (.ssh, .aws, .gnupg, .config, .kube, .docker)', () => {
      const home = os.homedir();
      const dotDirs = ['.ssh', '.aws', '.gnupg', '.config', '.kube', '.docker'];

      for (const dot of dotDirs) {
        const dotPath = path.join(home, dot);
        const check = isForbiddenSystemOrRootPath(dotPath);
        expect(check.forbidden).toBe(true);
        expect(check.reason).toMatch(/protected home directory/i);

        const subPath = path.join(home, dot, 'keys');
        const checkSub = isForbiddenSystemOrRootPath(subPath);
        expect(checkSub.forbidden).toBe(true);
      }
    });

    it('allows safe /var subpaths while continuing to block /var/lib, /var/log, /var/run', () => {
      if (process.platform !== 'win32') {
        expect(isForbiddenSystemOrRootPath('/var/lib').forbidden).toBe(true);
        expect(isForbiddenSystemOrRootPath('/var/log').forbidden).toBe(true);
        expect(isForbiddenSystemOrRootPath('/var/run').forbidden).toBe(true);

        // /var top-level itself is no longer wholesale blocked if subpath is safe
        const safeVarSub = '/var/my-org-workspace';
        const checkSafe = isForbiddenSystemOrRootPath(safeVarSub);
        expect(checkSafe.forbidden).toBe(false);
      }
    });
  });
});
