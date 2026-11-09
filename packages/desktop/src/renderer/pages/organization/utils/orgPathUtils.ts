/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';

/**
 * Normalizes and joins path segments respecting Windows and POSIX separators.
 */
export function joinOrgPath(base: string, ...segments: string[]): string {
  if (!base) return segments.join('/');
  const isWindows = base.includes('\\') || /^[a-zA-Z]:/.test(base);
  const sep = isWindows ? '\\' : '/';

  const cleanBase = base.replace(/[/\\]+$/, '');
  const cleanSegments = segments.map((s) => s.replace(/^[/\\]+|[/\\]+$/g, '')).filter(Boolean);

  if (cleanSegments.length === 0) return cleanBase;
  return `${cleanBase}${sep}${cleanSegments.join(sep)}`;
}

/**
 * Sanitizes a name to be a safe filesystem directory name.
 */
export function sanitizeFolderName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
}

/**
 * Computes default department workspace directory under the organization master root.
 */
export function getDefaultDeptPath(masterRoot: string, deptName: string): string {
  if (!masterRoot) return '';
  return joinOrgPath(masterRoot, 'departments', sanitizeFolderName(deptName));
}

/**
 * Computes default team workspace directory under the department or organization root.
 */
export function getDefaultTeamPath(masterRoot: string, deptName: string, teamName: string): string {
  if (!masterRoot) return '';
  return joinOrgPath(masterRoot, 'departments', sanitizeFolderName(deptName), sanitizeFolderName(teamName));
}

/**
 * Computes default project directory under the organization master root.
 */
export function getDefaultProjectPath(masterRoot: string, projectName: string): string {
  if (!masterRoot) return '';
  return joinOrgPath(masterRoot, 'projects', sanitizeFolderName(projectName));
}

/**
 * Validates that targetPath is inside or equals masterRoot.
 */
export async function validateWithinMaster(
  targetPath: string,
  masterRoot?: string | null
): Promise<{ valid: boolean; error?: string }> {
  if (!masterRoot) {
    return {
      valid: false,
      error: 'Organization master folder is not set. Please set the master folder first.',
    };
  }

  if (!targetPath || !targetPath.trim()) {
    return { valid: true };
  }

  try {
    const res = await ipcBridge.org.assertWithinScope(targetPath.trim(), masterRoot.trim());
    if (!res.allowed) {
      return {
        valid: false,
        error: res.reason || `Folder "${targetPath}" is outside the organization master root "${masterRoot}".`,
      };
    }
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
