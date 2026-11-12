import path from 'node:path';
import fs from 'node:fs';

export type ScopeCheckResult = { allowed: boolean; reason?: string; resolved: string };

function isWithinRoot(target: string, root: string): boolean {
  const normTarget = process.platform === 'win32' ? target.toLowerCase() : target;
  const normRoot = process.platform === 'win32' ? root.toLowerCase() : root;
  return normTarget === normRoot || normTarget.startsWith(normRoot + path.sep);
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
      return path.resolve(realCurrent, ...tail.reverse());
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

export async function assertWithinScope(targetPath: string, allowedRoot: string): Promise<ScopeCheckResult> {
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
  return { allowed: false, reason: 'path outside allowed root', resolved: realTarget };
}
