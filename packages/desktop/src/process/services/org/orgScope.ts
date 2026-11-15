/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { OrgStorageService } from './orgStorageService';
import { assertWithinScope } from './pathGuard';

export type SetMasterRootResult = {
  success: boolean;
  error?: string;
  masterRoot?: string;
};

let inMemoryMasterRoot: string | null = null;

function getStorage(): OrgStorageService {
  return OrgStorageService.getInstance();
}

function isStorageAvailable(): boolean {
  if (OrgStorageService.hasInstance()) {
    return true;
  }
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

  // Posix system directories (note: /var removed from top-level blocklist; /var/lib, /var/log, /var/run retained)
  dirs.push(
    '/etc',
    '/usr',
    '/bin',
    '/sbin',
    '/lib',
    '/lib64',
    '/var/lib',
    '/var/log',
    '/var/run',
    '/sys',
    '/proc',
    '/dev',
    '/boot',
    '/root'
  );

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
 * user home directory, home parent directory, home dot-directory, or system directory.
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

  // 2. Parent of user home directory (/home, /Users, C:\Users)
  const homeParentDirs = ['/home', '/Users', 'C:\\Users', 'c:\\users'];
  try {
    const parentOfHome = path.dirname(os.homedir());
    if (parentOfHome && parentOfHome !== path.parse(parentOfHome).root) {
      homeParentDirs.push(parentOfHome);
    }
  } catch {
    // Ignore
  }
  for (const hp of homeParentDirs) {
    let canonicalHp: string;
    try {
      canonicalHp = fs.realpathSync(hp);
    } catch {
      canonicalHp = path.resolve(hp);
    }
    const normHp = normalizePathForCompare(canonicalHp);
    if (normCanonical === normHp) {
      return {
        forbidden: true,
        reason: `Cannot set home parent directory "${canonicalPath}" as master organization root`,
      };
    }
  }

  // 3. User home directory itself and protected dot-directories directly under home
  const FORBIDDEN_HOME_DOT_DIRS = ['.ssh', '.aws', '.gnupg', '.config', '.kube', '.docker'];
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

    for (const dotDir of FORBIDDEN_HOME_DOT_DIRS) {
      const dotPath = path.join(canonicalHome, dotDir);
      let canonicalDot: string;
      try {
        canonicalDot = fs.realpathSync(dotPath);
      } catch {
        canonicalDot = path.resolve(dotPath);
      }
      const normDot = normalizePathForCompare(canonicalDot);
      if (normCanonical === normDot || normCanonical.startsWith(normDot + path.sep)) {
        return {
          forbidden: true,
          reason: `Cannot set protected home directory "${dotDir}" as master organization root`,
        };
      }
    }
  } catch {
    // If os.homedir fails, proceed with system directory checks
  }

  // Also catch protected dot directories under mock/test home paths (e.g. /home/user/.ssh)
  const normLower = canonicalPath.toLowerCase().replace(/\\/g, '/');
  for (const dotDir of FORBIDDEN_HOME_DOT_DIRS) {
    if (normLower.includes(`/${dotDir}/`) || normLower.endsWith(`/${dotDir}`)) {
      if (normLower.startsWith('/home/') || normLower.startsWith('/users/') || normLower.startsWith('c:/users/')) {
        return {
          forbidden: true,
          reason: `Cannot set protected home directory "${dotDir}" as master organization root`,
        };
      }
    }
  }

  // 4. System directories (e.g. /etc, /usr, /var/lib, C:\Windows) and any sub-path inside them
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
 * Validates a candidate path for master root (existence, directory, not forbidden).
 */
export function validateCandidateMasterRoot(candidatePath: string): {
  valid: boolean;
  canonical?: string;
  reason?: string;
} {
  if (!candidatePath || typeof candidatePath !== 'string' || !candidatePath.trim()) {
    return { valid: false, reason: 'Master folder path cannot be empty' };
  }

  const resolved = path.resolve(candidatePath.trim());
  if (!fs.existsSync(resolved)) {
    return { valid: false, reason: `Path does not exist: "${candidatePath}"` };
  }

  let canonical: string;
  try {
    canonical = fs.realpathSync(resolved);
  } catch (err) {
    return {
      valid: false,
      reason: `Cannot resolve canonical path for "${candidatePath}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(canonical);
  } catch (err) {
    return {
      valid: false,
      reason: `Cannot inspect path "${canonical}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!stat.isDirectory()) {
    return { valid: false, reason: `Path is a file, not a directory: "${candidatePath}"` };
  }

  const forbiddenCheck = isForbiddenSystemOrRootPath(canonical);
  if (forbiddenCheck.forbidden) {
    return { valid: false, reason: forbiddenCheck.reason };
  }

  return { valid: true, canonical };
}

/**
 * Sets the organization master root after verifying it exists, is a directory,
 * and is not a filesystem root, home directory, or system directory.
 * Persists the validated path in org_state.
 */
export async function setMasterRoot(candidatePath: string): Promise<SetMasterRootResult> {
  const check = validateCandidateMasterRoot(candidatePath);
  if (!check.valid || !check.canonical) {
    return { success: false, error: check.reason };
  }

  const canonical = check.canonical;
  inMemoryMasterRoot = canonical;

  if (isStorageAvailable()) {
    try {
      await getStorage().saveData('master_root', canonical, true);
      await getStorage().saveData('master_root_configured', 'true', true);
    } catch {
      // If storage is not initialized, proceed in-memory
    }
  }

  return { success: true, masterRoot: canonical };
}

/**
 * Explicitly clears the master root and marks it as configured.
 */
export async function clearMasterRoot(): Promise<void> {
  inMemoryMasterRoot = null;
  if (isStorageAvailable()) {
    try {
      await getStorage().saveData('master_root', '', true);
      await getStorage().saveData('master_root_configured', 'true', true);
    } catch {
      // Ignore
    }
  }
}

/**
 * Retrieves the organization master root, re-validating the stored value on every load.
 * If invalid, clears it, returns null (fail closed), and logs a warning.
 * The root_ceo fallback goes through the same validation and will not run if master_root
 * was explicitly set or cleared by the user.
 */
export async function getMasterRoot(): Promise<string | null> {
  // If cached in memory, revalidate it exists and is still valid on disk
  if (inMemoryMasterRoot) {
    const val = validateCandidateMasterRoot(inMemoryMasterRoot);
    if (!val.valid || !val.canonical) {
      console.warn(`[orgScope] Cached master root "${inMemoryMasterRoot}" is invalid (${val.reason}); clearing.`);
      inMemoryMasterRoot = null;
      if (isStorageAvailable()) {
        try {
          await getStorage().saveData('master_root', '', true);
        } catch {}
      }
      return null;
    }
    inMemoryMasterRoot = val.canonical;
    return inMemoryMasterRoot;
  }

  if (!isStorageAvailable()) {
    return null;
  }

  try {
    const configuredFlag = await getStorage().loadData('master_root_configured', true);
    const saved = await getStorage().loadData('master_root', true);
    if (saved && typeof saved === 'string' && saved.trim()) {
      const val = validateCandidateMasterRoot(saved.trim());
      if (val.valid && val.canonical) {
        inMemoryMasterRoot = val.canonical;
        return inMemoryMasterRoot;
      }
      console.warn(`[orgScope] Stored master root "${saved}" is invalid (${val.reason}); clearing and failing closed.`);
      inMemoryMasterRoot = null;
      await getStorage().saveData('master_root', '', true);
      return null;
    }

    // If master_root was explicitly configured or cleared by the user, do not run root_ceo fallback
    if (configuredFlag === 'true') {
      return null;
    }

    // Fallback: check if root_ceo has an existing configured workspace (legacy migration only)
    const rootCeoRaw = await getStorage().loadData('root_ceo');
    if (rootCeoRaw) {
      const parsed = JSON.parse(rootCeoRaw);
      if (parsed?.workspacePath && typeof parsed.workspacePath === 'string') {
        const candidate = parsed.workspacePath.trim();
        const val = validateCandidateMasterRoot(candidate);
        if (val.valid && val.canonical) {
          inMemoryMasterRoot = val.canonical;
          await getStorage().saveData('master_root', val.canonical, true);
          await getStorage().saveData('master_root_configured', 'true', true);
          return inMemoryMasterRoot;
        } else {
          console.warn(`[orgScope] Legacy root_ceo workspacePath "${candidate}" is invalid (${val.reason}); ignoring.`);
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
 * 5. If a renderer-supplied boundary is NOT within the master root, throw (fail closed).
 */
export async function resolveEffectiveScope(clientWorkspace?: string): Promise<string> {
  const masterRoot = await getMasterRoot();
  if (!masterRoot) {
    throw new Error('Access denied: No organization master root is configured (fail closed).');
  }

  if (clientWorkspace && typeof clientWorkspace === 'string' && clientWorkspace.trim()) {
    const narrowingCheck = await assertWithinScope(clientWorkspace.trim(), masterRoot);
    if (narrowingCheck.allowed) {
      // Stricter narrowing requested by caller and verified to be within masterRoot
      return narrowingCheck.resolved;
    }
    throw new Error(
      `Access denied: client workspace "${clientWorkspace}" is not within organization master root "${masterRoot}" (fail closed).`
    );
  }

  return masterRoot;
}
