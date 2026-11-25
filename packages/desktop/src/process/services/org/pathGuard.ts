import path from 'node:path';
import fs from 'node:fs';
import { getUserDataDir } from '@/common/platform/userDataPath';

export type ScopeCheckResult = { allowed: boolean; reason?: string; resolved: string };

const registeredKnowledgeRoots = new Set<string>();

/** Register a custom cache or worktree directory as read-only knowledge scope. */
export function registerKnowledgeReadOnlyRoot(dir: string): void {
  const trimmed = (dir || '').trim();
  if (!trimmed) return;
  registeredKnowledgeRoots.add(path.resolve(trimmed));
}

/** Clear registered custom knowledge roots (for testing). */
export function clearRegisteredKnowledgeRoots(): void {
  registeredKnowledgeRoots.clear();
}

function isWithinRoot(target: string, root: string): boolean {
  const normTarget = process.platform === 'win32' ? target.toLowerCase() : target;
  const normRoot = process.platform === 'win32' ? root.toLowerCase() : root;
  return normTarget === normRoot || normTarget.startsWith(normRoot + path.sep);
}

function addKnowledgeVariants(paths: string[], baseDir: string): void {
  paths.push(path.join(baseDir, 'knowledge_worktrees'));
  paths.push(path.join(baseDir, 'knowledge_repos'));
  paths.push(path.join(baseDir, 'knowledge-repos'));
}

function getKnowledgeWorktreesDir(): string[] {
  const paths: string[] = [];
  for (const custom of registeredKnowledgeRoots) {
    paths.push(custom);
  }
  try {
    addKnowledgeVariants(paths, getUserDataDir());
  } catch {
    // Ignore when userDataPath cannot resolve in isolated tests
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    if (electron.app?.getPath) {
      addKnowledgeVariants(paths, electron.app.getPath('userData'));
    }
  } catch {
    // Ignore when running outside Electron main process
  }
  addKnowledgeVariants(paths, path.join(process.cwd(), '.cache'));
  return paths;
}

function isKnowledgeWorktreePath(target: string): boolean {
  const dirs = getKnowledgeWorktreesDir();
  for (const d of dirs) {
    let resolvedDir = path.resolve(d);
    try {
      resolvedDir = fs.realpathSync(resolvedDir);
    } catch {
      // Directory may not exist yet
    }
    if (isWithinRoot(target, resolvedDir)) return true;
  }
  return /(?:^|[\\/])(?:knowledge_worktrees|knowledge_repos|knowledge-repos)(?:[\\/]|$)/i.test(target);
}

/**
 * Resolve symlinks for a path that may not exist yet by realpath-ing the nearest
 * existing ancestor and appending the remaining segments. This prevents symlink
 * escapes through non-existent child paths under a symlinked parent.
 */
function resolveWithExistingParent(targetPath: string): string {
  let current = targetPath;
  const tail: string[] = [];
  // Walk up until we find an existing path or hit the filesystem root.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const realCurrent = fs.realpathSync(current);
      if (tail.length === 0) {
        return realCurrent;
      }
      return path.resolve(realCurrent, ...tail.toReversed());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        // Reached filesystem root without finding an existing ancestor.
        return path.resolve(targetPath);
      }
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

export async function assertWithinScope(
  targetPath: string,
  allowedRoot: string,
  options?: { allowReadOnlyKnowledge?: boolean; isReadOnly?: boolean }
): Promise<ScopeCheckResult> {
  if (!targetPath || !allowedRoot) {
    return { allowed: false, reason: 'empty path', resolved: targetPath };
  }

  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(allowedRoot);

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(resolvedRoot);
  } catch {
    realRoot = resolvedRoot;
  }

  let realTarget: string;
  try {
    realTarget = fs.realpathSync(resolvedTarget);
  } catch {
    // Target may not exist yet; resolve symlinks via the nearest existing parent.
    realTarget = resolveWithExistingParent(resolvedTarget);
  }

  if (isWithinRoot(realTarget, realRoot)) {
    return { allowed: true, resolved: realTarget };
  }

  if ((options?.allowReadOnlyKnowledge || options?.isReadOnly) && isKnowledgeWorktreePath(realTarget)) {
    return { allowed: true, resolved: realTarget };
  }

  return { allowed: false, reason: 'path outside allowed root', resolved: realTarget };
}
