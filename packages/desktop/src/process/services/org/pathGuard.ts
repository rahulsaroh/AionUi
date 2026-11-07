import path from 'node:path';
import fs from 'node:fs';

export type ScopeCheckResult = { allowed: boolean; reason?: string; resolved: string };

export async function assertWithinScope(targetPath: string, allowedRoot: string): Promise<ScopeCheckResult> {
  if (!targetPath || !allowedRoot) return { allowed: false, reason: 'empty path', resolved: targetPath };
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(allowedRoot);
  // reject traversal segments
  if (targetPath.includes('..')) {
    // still check realpath
  }
  let realTarget: string;
  let realRoot: string;
  try {
    realTarget = fs.realpathSync(resolvedTarget);
  } catch {
    // target may not exist yet; use resolved
    realTarget = resolvedTarget;
  }
  try {
    realRoot = fs.realpathSync(resolvedRoot);
  } catch {
    realRoot = resolvedRoot;
  }
  const normTarget = process.platform === 'win32' ? realTarget.toLowerCase() : realTarget;
  const normRoot = process.platform === 'win32' ? realRoot.toLowerCase() : realRoot;
  if (normTarget === normRoot || normTarget.startsWith(normRoot + path.sep)) {
    return { allowed: true, resolved: realTarget };
  }
  return { allowed: false, reason: 'path outside allowed root', resolved: realTarget };
}
