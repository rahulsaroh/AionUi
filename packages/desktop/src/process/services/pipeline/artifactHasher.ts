/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import path from 'path';
import type { PublishPayload } from '@/common/types/pipeline/pipelineTypes';

export type HashVerificationResult = {
  matches: boolean;
  computedHash?: string;
  missingFiles: string[];
  fastMatch?: boolean;
  error?: string;
};

/**
 * Computes SHA-256 hash of arbitrary string or Buffer.
 */
export function hashContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Validates that an artifact path resolves strictly inside projectRoot.
 * Rejects path traversal (..) and symlinks escaping projectRoot.
 */
export function validateArtifactPath(
  rawPath: string,
  projectRoot: string
): { valid: boolean; resolvedPath: string; error?: string } {
  const normalizedRoot = path.resolve(projectRoot);
  const resolved = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(normalizedRoot, rawPath);

  // Check prefix match for lexical traversal
  const rel = path.relative(normalizedRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      valid: false,
      resolvedPath: resolved,
      error: `Artifact path '${rawPath}' escapes project root '${normalizedRoot}'`,
    };
  }

  // Check symlink realpath if file or parent exists
  try {
    if (existsSync(resolved)) {
      const real = realpathSync(resolved);
      const realRel = path.relative(normalizedRoot, real);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        return {
          valid: false,
          resolvedPath: resolved,
          error: `Artifact path '${rawPath}' is a symlink escaping project root to '${real}'`,
        };
      }
    } else {
      // Check closest existing ancestor directory for symlink escape
      let curr = path.dirname(resolved);
      while (curr && curr !== path.dirname(curr)) {
        if (existsSync(curr)) {
          const realCurr = realpathSync(curr);
          const realRel = path.relative(normalizedRoot, realCurr);
          if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
            return {
              valid: false,
              resolvedPath: resolved,
              error: `Artifact parent path '${curr}' escapes project root to '${realCurr}'`,
            };
          }
          break;
        }
        curr = path.dirname(curr);
      }
    }
  } catch (err) {
    return {
      valid: false,
      resolvedPath: resolved,
      error: `Failed to inspect artifact path '${rawPath}': ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { valid: true, resolvedPath: resolved };
}

/**
 * Computes fast size + mtime fingerprint for a list of artifact files.
 */
export function computeFastFingerprint(artifactPaths: string[], baseDir?: string): string | null {
  if (artifactPaths.length === 0) return null;
  const parts: string[] = [];
  const sorted = [...artifactPaths].toSorted();

  for (const p of sorted) {
    const fullPath = baseDir && !path.isAbsolute(p) ? path.resolve(baseDir, p) : path.resolve(p);
    if (!existsSync(fullPath)) return null;
    try {
      const st = statSync(fullPath);
      parts.push(`${p}:${st.size}:${Math.floor(st.mtimeMs)}`);
    } catch {
      return null;
    }
  }
  return hashContent(parts.join('|'));
}

/**
 * Computes deterministic SHA-256 hash for a set of file artifact paths.
 * Artifacts are sorted by normalized path to ensure consistent ordering.
 * If any artifact does not exist or escapes project root, returns null.
 */
export function computeArtifactsHash(artifactPaths: string[], baseDir?: string): string | null {
  if (artifactPaths.length === 0) {
    return null;
  }

  const hash = createHash('sha256');
  const sortedPaths = [...artifactPaths].toSorted();

  for (const relOrAbsPath of sortedPaths) {
    if (baseDir) {
      const validation = validateArtifactPath(relOrAbsPath, baseDir);
      if (!validation.valid) {
        return null;
      }
    }

    const fullPath =
      baseDir && !path.isAbsolute(relOrAbsPath) ? path.resolve(baseDir, relOrAbsPath) : path.resolve(relOrAbsPath);

    if (!existsSync(fullPath)) {
      return null;
    }

    try {
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        hash.update(`dir:${relOrAbsPath}`);
      } else {
        const fileBuffer = readFileSync(fullPath);
        hash.update(`file:${relOrAbsPath}:`);
        hash.update(fileBuffer);
      }
    } catch {
      return null;
    }
  }

  return hash.digest('hex');
}

/**
 * Verifies whether all artifact files exist and their combined hash matches expectedHash.
 * Uses fast size+mtime check if expectedHash matches fast fingerprint format, else full SHA-256.
 */
export function verifyArtifacts(
  artifactPaths: string[],
  expectedHash: string | undefined | null,
  baseDir?: string,
  options?: { fastCheckOnly?: boolean }
): HashVerificationResult {
  if (!expectedHash) {
    return { matches: false, missingFiles: [], error: 'No expected content hash provided' };
  }

  const missingFiles: string[] = [];

  for (const relOrAbsPath of artifactPaths) {
    if (baseDir) {
      const val = validateArtifactPath(relOrAbsPath, baseDir);
      if (!val.valid) {
        return { matches: false, missingFiles: [relOrAbsPath], error: val.error };
      }
    }

    const fullPath =
      baseDir && !path.isAbsolute(relOrAbsPath) ? path.resolve(baseDir, relOrAbsPath) : path.resolve(relOrAbsPath);

    if (!existsSync(fullPath)) {
      missingFiles.push(relOrAbsPath);
    }
  }

  if (missingFiles.length > 0) {
    return { matches: false, missingFiles, error: `Missing artifact files: ${missingFiles.join(', ')}` };
  }

  // Fast check optimization
  if (options?.fastCheckOnly) {
    const fastFp = computeFastFingerprint(artifactPaths, baseDir);
    if (fastFp && fastFp === expectedHash) {
      return { matches: true, fastMatch: true, missingFiles: [] };
    }
  }

  const computedHash = computeArtifactsHash(artifactPaths, baseDir);
  if (!computedHash) {
    return { matches: false, missingFiles, error: 'Failed to compute hash for artifacts' };
  }

  return {
    matches: computedHash === expectedHash,
    computedHash,
    missingFiles: [],
  };
}

/**
 * Computes server-side content hash for a publish payload based on actual media files and metadata.
 * Never blindly trusts caller-supplied contentHash.
 */
export function computePublishContentHash(payload: PublishPayload, projectBaseDir?: string): string {
  const normTitle = (payload.title || '').trim();
  const normDesc = (payload.description || '').trim();
  const normCaption = (payload.caption || '').trim();
  const videoUrl = (payload.videoUrl || '').trim();
  const thumbnailUrl = (payload.thumbnailUrl || '').trim();

  let mediaFileHash = '';
  if (payload.mediaPath) {
    const fullMediaPath =
      projectBaseDir && !path.isAbsolute(payload.mediaPath)
        ? path.resolve(projectBaseDir, payload.mediaPath)
        : path.resolve(payload.mediaPath);

    if (existsSync(fullMediaPath)) {
      try {
        const buf = readFileSync(fullMediaPath);
        mediaFileHash = hashContent(buf);
      } catch {
        mediaFileHash = `unreadable:${payload.mediaPath}`;
      }
    } else {
      mediaFileHash = `missing:${payload.mediaPath}`;
    }
  }

  const manifestObject = {
    title: normTitle,
    description: normDesc,
    caption: normCaption,
    videoUrl,
    thumbnailUrl,
    mediaFileHash,
  };

  return hashContent(JSON.stringify(manifestObject));
}

/**
 * Computes deterministic approval binding hash.
 * Any change to title, description, caption, platform, media, etc. voids this hash.
 */
export function computePreviewBindingHash(params: {
  platform: string;
  contentHash: string;
  payload: PublishPayload;
}): string {
  const norm = {
    platform: params.platform.toLowerCase().trim(),
    contentHash: params.contentHash.trim(),
    title: (params.payload.title || '').trim(),
    description: (params.payload.description || '').trim(),
    caption: (params.payload.caption || '').trim(),
    thumbnailUrl: (params.payload.thumbnailUrl || '').trim(),
    videoUrl: (params.payload.videoUrl || '').trim(),
    mediaPath: (params.payload.mediaPath || '').trim(),
  };
  return hashContent(JSON.stringify(norm));
}
