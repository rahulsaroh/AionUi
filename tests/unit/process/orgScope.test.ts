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
  setMasterRoot,
  getMasterRoot,
  setMasterRootForTesting,
  resetMasterRoot,
  resolveEffectiveScope,
  isForbiddenSystemOrRootPath,
} from '@/process/services/org/orgScope';
import { org as rendererOrgBridge } from '@/common/adapter/ipcBridge';

describe('Phase 1: OrgScope & Master Root Hardening', () => {
  let tempRoot: string;
  let validDir: string;
  let testFile: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'org-scope-test-'));
    validDir = path.join(tempRoot, 'my-company');
    fs.mkdirSync(validDir, { recursive: true });

    testFile = path.join(tempRoot, 'not-a-dir.txt');
    fs.writeFileSync(testFile, 'hello');

    resetMasterRoot();
  });

  afterEach(() => {
    resetMasterRoot();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  });

  describe('setMasterRoot validations', () => {
    it('rejects empty or whitespace paths', async () => {
      const res1 = await setMasterRoot('');
      expect(res1.success).toBe(false);
      expect(res1.error).toContain('cannot be empty');

      const res2 = await setMasterRoot('   ');
      expect(res2.success).toBe(false);
    });

    it('rejects non-existent path', async () => {
      const nonExistent = path.join(tempRoot, 'does-not-exist');
      const res = await setMasterRoot(nonExistent);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Path does not exist');
    });

    it('rejects file path (not a directory)', async () => {
      const res = await setMasterRoot(testFile);
      expect(res.success).toBe(false);
      expect(res.error).toContain('is a file, not a directory');
    });

    it('rejects filesystem root or drive root ("/" or "C:\\")', async () => {
      const rootPath = process.platform === 'win32' ? 'C:\\' : '/';
      const res = await setMasterRoot(rootPath);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/filesystem or drive root/i);
    });

    it('rejects user home directory itself', async () => {
      const home = os.homedir();
      const res = await setMasterRoot(home);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/user home directory/i);
    });

    it('rejects system directories like /etc, /usr, or C:\\Windows', async () => {
      if (process.platform === 'win32') {
        const sysDir = process.env.SystemRoot || 'C:\\Windows';
        if (fs.existsSync(sysDir)) {
          const res = await setMasterRoot(sysDir);
          expect(res.success).toBe(false);
          expect(res.error).toMatch(/system directory/i);
        }
      } else {
        const resEtc = await setMasterRoot('/etc');
        expect(resEtc.success).toBe(false);
        expect(resEtc.error).toMatch(/system directory/i);

        const resUsr = await setMasterRoot('/usr');
        expect(resUsr.success).toBe(false);
        expect(resUsr.error).toMatch(/system directory/i);
      }
    });

    it('accepts a valid folder inside the workspace', async () => {
      const res = await setMasterRoot(validDir);
      expect(res.success).toBe(true);
      expect(res.masterRoot).toBe(fs.realpathSync(validDir));

      // getMasterRoot now returns this master root
      const current = await getMasterRoot();
      expect(current).toBe(fs.realpathSync(validDir));
    });
  });

  describe('resolveEffectiveScope enforcement', () => {
    it('fails closed when no master root is configured', async () => {
      resetMasterRoot();
      await expect(resolveEffectiveScope(validDir)).rejects.toThrow(
        /No organization master root is configured \(fail closed\)/
      );
    });

    it('malicious caller: client supplies root "/" to widen boundary -> ignored, enforces master root', async () => {
      setMasterRootForTesting(validDir);
      const evilWorkspace = process.platform === 'win32' ? 'C:\\' : '/';

      const effective = await resolveEffectiveScope(evilWorkspace);
      // Scope must remain the master root, NOT the root folder!
      expect(effective).toBe(path.resolve(validDir));
    });

    it('accepts narrower sub-path of master root as an additional restriction', async () => {
      setMasterRootForTesting(validDir);
      const subDept = path.join(validDir, 'engineering');
      fs.mkdirSync(subDept, { recursive: true });

      const effective = await resolveEffectiveScope(subDept);
      expect(effective).toBe(fs.realpathSync(subDept));
    });
  });

  describe('Renderer Fallback fail-closed behavior (ipcBridge.ts)', () => {
    it('renderer fallback fails closed when no allowedRoot or targetPath provided', async () => {
      const res = await rendererOrgBridge.assertWithinScope('/some/path');
      expect(res.allowed).toBe(false);
      expect(res.reason).toMatch(/fail closed/i);
    });

    it('renderer fallback fails closed even if allowedRoot is passed when native IPC is unavailable', async () => {
      const res = await rendererOrgBridge.assertWithinScope('/some/target', '/some/root');
      expect(res.allowed).toBe(false);
      expect(res.reason).toMatch(/fail closed/i);
    });

    it('renderer setMasterRoot fails closed when desktop IPC is unavailable', async () => {
      const res = await rendererOrgBridge.setMasterRoot('/some/path');
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/fail closed/i);
    });
  });
});
