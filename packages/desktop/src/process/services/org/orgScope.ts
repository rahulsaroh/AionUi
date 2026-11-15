/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { orgStorageService } from './orgStorageService';
import { assertWithinScope } from './pathGuard';

export type SetMasterRootResult = {
  success: boolean;
  error?: string;
  masterRoot?: string;
};

let inMemoryMasterRoot: string | null = null;

function isStorageAvailable(): boolean {
  // In unit test runners outside Electron, avoid calling SQLite directly if platform services are uninitialized
  if (process.env.NODE_ENV === 'test' && !process.versions?.electron) {
    return false;
  }
  return true;
}

function normalizePathForCompare(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function getSystemDirectories(): string[] {
  const dirs: string[] = [];

  // Posix system directories
  dirs.push('/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/var', '/sys', '/proc', '/dev', '/boot', '/root');

  // Windows system directories
  if (process.platform === 'win32') {
    const sysRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const progData = process.env.ProgramData || 'C:\\ProgramData';
    dirs.push(sysRoot, progFiles, progFilesX86, progData, 'C:\\Windows', 'C:\\Program Files');
  } else {
    // Also include standard Windows markers in case of cross-platform path checks
    dirs.push('C:\\Windows', 'C:\\Program Files');
  }

  return dirs;
}

/**
 * Checks whether a canonical directory is a filesystem root, drive root,
 * user home directory, or system directory.
 */
export function isForbiddenSystemOrRootPath(canonicalPath: string): { forbidden: boolean; reason?: string } {
  const parsed = path.parse(canonicalPath);
  const normCanonical = normalizePathForCompare(canonicalPath);
  const normRoot = normalizePathForCompare(parsed.root);

  // 1. Filesystem root or Windows drive root (e.g. "/" or "C:\")
  if (normCanonical === normRoot || path.dirname(canonicalPath) === canonicalPath) {
    return {
      forbidden: true,
      reason: `Cannot set filesystem or drive root "${canonicalPath}" as master organization root`,
    };
  }

  // 2. User home directory itself
  try {
    const homeDir = os.homedir();
    let canonicalHome: string;
    try {
      canonicalHome = fs.realpathSync(homeDir);
    } catch {
      canonicalHome = path.resolve(homeDir);
    }
    const normHome = normalizePathForCompare(canonicalHome);
    if (normCanonical === normHome) {
      return {
        forbidden: true,
        reason: `Cannot set user home directory "${canonicalPath}" as master organization root`,
      };
    }
  } catch {
    // If os.homedir fails, proceed with system directory checks
  }

  // 3. System directories (e.g. /etc, /usr, C:\Windows) and any sub-path inside them
  const sysDirs = getSystemDirectories();
  for (const sysDir of sysDirs) {
    let canonicalSys: string;
    try {
      canonicalSys = fs.realpathSync(sysDir);
    } catch {
      canonicalSys = path.resolve(sysDir);
    }
    const normSys = normalizePathForCompare(canonicalSys);
    if (normCanonical === normSys || normCanonical.startsWith(normSys + path.sep)) {
      return {
        forbidden: true,
        reason: `Cannot set system directory "${sysDir}" as master organization root`,
      };
    }
  }

  return { forbidden: false };
}

/**
 * Sets the organization master root after verifying it exists, is a directory,
 * and is not a filesystem root, home directory, or system directory.
 * Persists the validated path in org_state.
 */
export async function setMasterRoot(candidatePath: string): Promise<SetMasterRootResult> {
  if (!candidatePath || typeof candidatePath !== 'string' || !candidatePath.trim()) {
    return { success: false, error: 'Master folder path cannot be empty' };
  }

  const resolved = path.resolve(candidatePath.trim());

  if (!fs.existsSync(resolved)) {
    return { success: false, error: `Path does not exist: "${candidatePath}"` };
  }

  let canonical: string;
  try {
    canonical = fs.realpathSync(resolved);
  } catch (err) {
    return {
      success: false,
      error: `Cannot resolve canonical path for "${candidatePath}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(canonical);
  } catch (err) {
    return {
      success: false,
      error: `Cannot inspect path "${canonical}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!stat.isDirectory()) {
    return { success: false, error: `Path is a file, not a directory: "${candidatePath}"` };
  }

  const forbiddenCheck = isForbiddenSystemOrRootPath(canonical);
  if (forbiddenCheck.forbidden) {
    return { success: false, error: forbiddenCheck.reason };
  }

  inMemoryMasterRoot = canonical;

  if (isStorageAvailable()) {
    try {
      await orgStorageService.saveData('master_root', canonical);
    } catch {
      // If storage is not initialized, proceed in-memory
    }
  }

  return { success: true, masterRoot: canonical };
}

/**
 * Retrieves the organization master root, falling back to org_state storage or root_ceo.
 */
export async function getMasterRoot(): Promise<string | null> {
  if (inMemoryMasterRoot) {
    return inMemoryMasterRoot;
  }

  if (!isStorageAvailable()) {
    return null;
  }

  try {
    const saved = await orgStorageService.loadData('master_root');
    if (saved && typeof saved === 'string' && saved.trim()) {
      inMemoryMasterRoot = saved.trim();
      return inMemoryMasterRoot;
    }

    // Fallback: check if root_ceo has an existing configured workspace
    const rootCeoRaw = await orgStorageService.loadData('root_ceo');
    if (rootCeoRaw) {
      const parsed = JSON.parse(rootCeoRaw);
      if (parsed?.workspacePath && typeof parsed.workspacePath === 'string') {
        const candidate = parsed.workspacePath.trim();
        if (candidate && fs.existsSync(candidate)) {
          const canonical = fs.realpathSync(candidate);
          const stat = fs.statSync(canonical);
          if (stat.isDirectory() && !isForbiddenSystemOrRootPath(canonical).forbidden) {
            inMemoryMasterRoot = canonical;
            await orgStorageService.saveData('master_root', canonical);
            return inMemoryMasterRoot;
          }
        }
      }
    }
  } catch {
    // If storage is unavailable or fails (e.g. unit test runner without DB), proceed with in-memory
  }

  return inMemoryMasterRoot;
}

/**
 * For testing purposes: set the in-memory master root without accessing SQLite.
 */
export function setMasterRootForTesting(root: string | null): void {
  inMemoryMasterRoot = root ? path.resolve(root) : null;
}

/**
 * For testing purposes: reset the in-memory master root.
 */
export function resetMasterRoot(): void {
  inMemoryMasterRoot = null;
}

/**
 * Resolves the effective boundary for an organization file/shell operation.
 *
 * Security Model:
 * 1. The main process master root is the single source of truth.
 * 2. If no master root is set, all file and shell tools fail closed (refuse execution).
 * 3. Renderer-supplied allowedWorkspace/allowedRoot cannot widen this boundary under
 *    any circumstances (e.g. passing "/" or "C:\" is completely ignored).
 * 4. A renderer-supplied value MAY only be used if it is a strict sub-path of the
 *    master root, acting as an additional narrowing constraint.
 */
export async function resolveEffectiveScope(clientWorkspace?: string): Promise<string> {
  const masterRoot = await getMasterRoot();
  if (!masterRoot) {
    throw new Error('Access denied: No organization master root is configured (fail closed).');
  }

  if (clientWorkspace && typeof clientWorkspace === 'string' && clientWorkspace.trim()) {
    try {
      const narrowingCheck = await assertWithinScope(clientWorkspace.trim(), masterRoot);
      if (narrowingCheck.allowed) {
        // Stricter narrowing requested by caller and verified to be within masterRoot
        return narrowingCheck.resolved;
      }
    } catch {
      // Narrowing check threw; ignore clientWorkspace and fall back to masterRoot
    }
  }

  // Client workspace was missing, invalid, or outside/wider than masterRoot (e.g. "/").
  // Never trust the client value to widen scope: enforce masterRoot.
  return masterRoot;
}
