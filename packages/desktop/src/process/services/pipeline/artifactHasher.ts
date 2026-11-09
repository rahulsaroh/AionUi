/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';

export type HashVerificationResult = {
  matches: boolean;
  computedHash?: string;
  missingFiles: string[];
  error?: string;
};

/**
 * Computes SHA-256 hash of arbitrary string or Buffer.
 */
export function hashContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Computes deterministic SHA-256 hash for a set of file artifact paths.
 * Artifacts are sorted by normalized path to ensure consistent ordering.
 * If any artifact does not exist, returns null.
 */
export function computeArtifactsHash(artifactPaths: string[], baseDir?: string): string | null {
  if (artifactPaths.length === 0) {
    return null;
  }

  const hash = createHash('sha256');
  const sortedPaths = [...artifactPaths].toSorted();

  for (const relOrAbsPath of sortedPaths) {
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
 */
export function verifyArtifacts(
  artifactPaths: string[],
  expectedHash: string | undefined | null,
  baseDir?: string
): HashVerificationResult {
  if (!expectedHash) {
    return { matches: false, missingFiles: [], error: 'No expected content hash provided' };
  }

  const missingFiles: string[] = [];

  for (const relOrAbsPath of artifactPaths) {
    const fullPath =
      baseDir && !path.isAbsolute(relOrAbsPath) ? path.resolve(baseDir, relOrAbsPath) : path.resolve(relOrAbsPath);

    if (!existsSync(fullPath)) {
      missingFiles.push(relOrAbsPath);
    }
  }

  if (missingFiles.length > 0) {
    return { matches: false, missingFiles, error: `Missing artifact files: ${missingFiles.join(', ')}` };
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
