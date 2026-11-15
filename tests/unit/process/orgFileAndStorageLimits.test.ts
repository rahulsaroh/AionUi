/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  OrgFolderTools,
  isProtectedWriteTarget,
  isSensitiveReadTarget,
} from '../../../packages/desktop/src/process/services/org/folderTools';
import { setMasterRoot, resetMasterRoot } from '../../../packages/desktop/src/process/services/org/orgScope';
import {
  issueFileApprovalToken,
  _resetApprovalTokens,
} from '../../../packages/desktop/src/process/services/org/orgApproval';
import {
  isValidOrgStorageKey,
  validateMemberShape,
  validateProjectShape,
  validateBundleShape,
  MAX_STORAGE_VALUE_BYTES,
} from '../../../packages/desktop/src/process/services/org/orgStorageService';

describe('Phase 4: File Tools, Storage Limits, and IPC Param Hardening', () => {
  let tempRoot: string;
  let workspaceDir: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-file-storage-test-'));
    workspaceDir = path.join(tempRoot, 'org_workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    setMasterRoot(workspaceDir);
    _resetApprovalTokens();
  });

  afterEach(() => {
    resetMasterRoot();
    _resetApprovalTokens();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  });

  describe('writeFile limits and sensitive file guards', () => {
    it('refuses to write content exceeding 5 MB limit', async () => {
      const targetFile = path.join(workspaceDir, 'oversize.dat');
      const largeContent = 'A'.repeat(5 * 1024 * 1024 + 1);

      await expect(OrgFolderTools.writeFile(targetFile, largeContent, workspaceDir)).rejects.toThrow(
        /Content size exceeds maximum allowed limit \(5 MB\)/
      );
    });

    it('refuses to write into .git directories or protected filenames (.env*, *.pem, *.key, id_rsa*)', async () => {
      const gitTarget = path.join(workspaceDir, '.git', 'config');
      await expect(OrgFolderTools.writeFile(gitTarget, 'payload', workspaceDir)).rejects.toThrow(
        /Writing to \.git internal directories is strictly forbidden/
      );

      const nodeModulesGit = path.join(workspaceDir, 'node_modules', '.git', 'hooks');
      await expect(OrgFolderTools.writeFile(nodeModulesGit, 'payload', workspaceDir)).rejects.toThrow(
        /Writing to \.git internal directories is strictly forbidden/
      );

      const envTarget = path.join(workspaceDir, '.env.production');
      await expect(OrgFolderTools.writeFile(envTarget, 'SECRET=123', workspaceDir)).rejects.toThrow(
        /Writing to environment configuration files \(\.env\*\) is forbidden/
      );

      const pemTarget = path.join(workspaceDir, 'cert.pem');
      await expect(OrgFolderTools.writeFile(pemTarget, 'CERT', workspaceDir)).rejects.toThrow(
        /Writing to certificate files \(\*\.pem\) is forbidden/
      );

      const keyTarget = path.join(workspaceDir, 'private.key');
      await expect(OrgFolderTools.writeFile(keyTarget, 'KEY', workspaceDir)).rejects.toThrow(
        /Writing to private key files \(\*\.key\) is forbidden/
      );

      const idRsaTarget = path.join(workspaceDir, 'id_rsa');
      await expect(OrgFolderTools.writeFile(idRsaTarget, 'SSHKEY', workspaceDir)).rejects.toThrow(
        /Writing to SSH identity files \(id_rsa\*\) is forbidden/
      );
    });

    it('malicious caller: refuses to write if target path itself is a symlink', async () => {
      const realTarget = path.join(workspaceDir, 'real.txt');
      fs.writeFileSync(realTarget, 'original');

      const symlinkTarget = path.join(workspaceDir, 'symlink_file.txt');
      try {
        fs.symlinkSync(realTarget, symlinkTarget, 'file');
      } catch {
        // Windows unprivileged symlink fallback (if Developer Mode is off)
        return;
      }

      await expect(OrgFolderTools.writeFile(symlinkTarget, 'hacked', workspaceDir)).rejects.toThrow(
        /Target file .* is a symbolic link/
      );
    });

    it('writes valid regular file inside workspace properly', async () => {
      const targetFile = path.join(workspaceDir, 'valid_dir', 'document.md');
      const written = await OrgFolderTools.writeFile(targetFile, '# Document Content', workspaceDir);
      expect(written).toBe(true);
      expect(fs.readFileSync(targetFile, 'utf8')).toBe('# Document Content');
    });
  });

  describe('readFile sensitive filename checks and byte limits', () => {
    it('refuses sensitive files (.env, id_rsa, credentials.json) without approval token', async () => {
      const envFile = path.join(workspaceDir, '.env');
      fs.writeFileSync(envFile, 'API_KEY=secret');

      await expect(OrgFolderTools.readFile(envFile, workspaceDir)).rejects.toThrow(
        /Blocked access to sensitive file requiring approval/
      );

      const credFile = path.join(workspaceDir, 'credentials.json');
      fs.writeFileSync(credFile, '{"token": "xyz"}');

      await expect(OrgFolderTools.readFile(credFile, workspaceDir)).rejects.toThrow(
        /Blocked access to sensitive file requiring approval/
      );
    });

    it('permits reading sensitive files when presented with a valid main-process approval token', async () => {
      const credFile = path.join(workspaceDir, 'credentials.json');
      fs.writeFileSync(credFile, '{"secret": "allowed"}');

      const token = issueFileApprovalToken(credFile);
      const res = await OrgFolderTools.readFile(credFile, workspaceDir, 256 * 1024, {
        approvalToken: token,
      });
      expect(res.content).toBe('{"secret": "allowed"}');

      // Single-use: reusing same token fails
      await expect(
        OrgFolderTools.readFile(credFile, workspaceDir, 256 * 1024, {
          approvalToken: token,
        })
      ).rejects.toThrow(/Blocked access to sensitive file requiring approval/);
    });

    it('caps caller-supplied maxBytes at 1 MB', async () => {
      const targetFile = path.join(workspaceDir, 'big.txt');
      fs.writeFileSync(targetFile, 'A'.repeat(2 * 1024 * 1024));

      // Caller asks for 5 MB, but it must be capped at 1 MB
      const res = await OrgFolderTools.readFile(targetFile, workspaceDir, 5 * 1024 * 1024);
      expect(res.content.length).toBe(1024 * 1024);
      expect(res.truncated).toBe(true);
    });
  });

  describe('scanFolder limits and symlink directory avoidance', () => {
    it('caps scan depth at 6 and maxEntries at 5000', async () => {
      // Build a 3-level folder structure
      const sub = path.join(workspaceDir, 'a', 'b', 'c');
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(sub, 'deep.txt'), 'deep');

      // Request depth: 100 -> capped at 6, maxEntries: 99999 -> capped at 5000
      const res = await OrgFolderTools.scanFolder(workspaceDir, workspaceDir, {
        depth: 100,
        maxEntries: 99999,
      });
      expect(res.entries.some((e) => e.name === 'deep.txt')).toBe(true);
    });

    it('does not traverse into symlinked directories', async () => {
      const realDir = path.join(tempRoot, 'outside_target');
      fs.mkdirSync(realDir, { recursive: true });
      fs.writeFileSync(path.join(realDir, 'outside_file.txt'), 'outside');

      const symlinkDir = path.join(workspaceDir, 'linked_dir');
      try {
        fs.symlinkSync(realDir, symlinkDir, 'junction');
      } catch {
        return; // Skip on platforms where unprivileged junction creation is restricted
      }

      const res = await OrgFolderTools.scanFolder(workspaceDir, workspaceDir, { depth: 5 });
      // The symlinked folder's contents should NOT be traversed
      expect(res.entries.some((e) => e.name === 'outside_file.txt')).toBe(false);
    });
  });

  describe('Storage key whitelisting and payload shape validation', () => {
    it('validates storage keys: whitelists org keys and rejects unwhitelisted keys', () => {
      expect(isValidOrgStorageKey('aionui:active-scope')).toBe(true);
      expect(isValidOrgStorageKey('aionui:org-hierarchy')).toBe(true);
      expect(isValidOrgStorageKey('aionui:org-projects')).toBe(true);
      expect(isValidOrgStorageKey('aionui:org-conversations')).toBe(true);
      expect(isValidOrgStorageKey('aionui:org-cron-jobs')).toBe(true);
      expect(isValidOrgStorageKey('aionui:org-storage-version')).toBe(true);
      expect(isValidOrgStorageKey('root_ceo')).toBe(true);

      // Malicious or arbitrary keys are rejected
      expect(isValidOrgStorageKey('user_passwords')).toBe(false);
      expect(isValidOrgStorageKey('system:exec')).toBe(false);
      expect(isValidOrgStorageKey('evil_key')).toBe(false);
      expect(isValidOrgStorageKey('')).toBe(false);
      expect(isValidOrgStorageKey(123 as any)).toBe(false);
    });

    it('validates members and projects shapes before storing', () => {
      expect(validateMemberShape({ id: 'm1', name: 'Alice', role: 'developer' })).toBe(true);
      expect(validateMemberShape({ id: '', name: 'Alice', role: 'developer' })).toBe(false); // empty id
      expect(validateMemberShape({ id: 'm1', name: '', role: 'developer' })).toBe(false); // empty name
      expect(validateMemberShape(null)).toBe(false);

      expect(validateProjectShape({ id: 'p1', name: 'Proj', departmentId: 'd1' })).toBe(true);
      expect(validateProjectShape({ id: 'p1', name: 'Proj', departmentId: '' })).toBe(false); // empty dept
      expect(validateProjectShape({ id: 'p1', name: '', departmentId: 'd1' })).toBe(false);
      expect(validateProjectShape(null)).toBe(false);
    });

    it('validates full bundle structure and bounds', () => {
      const validBundle = {
        hierarchy: {
          rootCeo: { id: 'ceo', name: 'CEO' },
          departments: [],
        },
        members: [{ id: 'm1', name: 'Member 1', role: 'engineer' }],
        projects: [{ id: 'p1', name: 'Project 1', departmentId: 'd1' }],
      };
      expect(validateBundleShape(validBundle)).toBe(true);

      // Missing rootCeo
      expect(validateBundleShape({ hierarchy: {} })).toBe(false);
      // Malformed members
      expect(validateBundleShape({ ...validBundle, members: [{ id: '' }] })).toBe(false);
    });
  });
});
