/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { assertWithinScope } from './pathGuard';
import { getMasterRoot } from './orgScope';

export interface CompactFolderNode {
  name: string;
  path: string;
  typeHint?: string;
  fileCount: number;
  dirCount: number;
  hasReadme: boolean;
  readmeSnippet?: string;
  lastModified?: number;
  children?: CompactFolderNode[];
}

export interface ScanFolderResult {
  success: boolean;
  rootPath?: string;
  totalEntries?: number;
  tree?: CompactFolderNode;
  truncated?: boolean;
  error?: string;
  exists?: boolean;
}

export interface ScanFolderOptions {
  depth?: number;
  maxEntries?: number;
  allowedScope?: string;
}

export const IGNORED_SCAN_DIRS = new Set([
  'node_modules',
  '.git',
  'build',
  'dist',
  'out',
  'target',
  '.dart_tool',
  '.idea',
  '.vscode',
  'coverage',
  '.cache',
  'temp',
  'tmp',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  '.turbo',
]);

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.flv', '.wmv', '.prproj', '.aep']);
const DIGITAL_PRODUCT_EXTENSIONS = new Set(['.pdf', '.epub', '.mobi']);

/**
 * Detects domain and project type hints based on directory contents.
 */
export function detectFolderTypeHint(filenames: string[]): string | undefined {
  const fileSet = new Set(filenames);
  const lowerFiles = new Set(filenames.map((f) => f.toLowerCase()));

  // 1. Flutter app (pubspec.yaml)
  if (fileSet.has('pubspec.yaml') || fileSet.has('pubspec.yml')) {
    return 'Flutter app';
  }

  // 2. YouTube / Video production (script.md or video files)
  const hasScriptMd = lowerFiles.has('script.md') || lowerFiles.has('scripts.md');
  const hasVideoFiles = filenames.some((f) => VIDEO_EXTENSIONS.has(path.extname(f).toLowerCase()));
  if (hasScriptMd || hasVideoFiles) {
    return 'YouTube channel';
  }

  // 3. Digital product (product.json or PDF files)
  const hasProductJson = lowerFiles.has('product.json') || lowerFiles.has('products.json');
  const hasPdfFiles = filenames.some((f) => DIGITAL_PRODUCT_EXTENSIONS.has(path.extname(f).toLowerCase()));
  if (hasProductJson || hasPdfFiles) {
    return 'Digital product';
  }

  // 4. Web app / Node.js
  if (fileSet.has('package.json')) {
    return 'Web app';
  }

  // 5. Python / AI
  if (
    fileSet.has('requirements.txt') ||
    fileSet.has('pyproject.toml') ||
    fileSet.has('Pipfile') ||
    filenames.some((f) => f.endsWith('.py'))
  ) {
    return 'Python project';
  }

  // 6. Rust
  if (fileSet.has('Cargo.toml')) {
    return 'Rust project';
  }

  // 7. Go
  if (fileSet.has('go.mod')) {
    return 'Go project';
  }

  return undefined;
}

/**
 * Scans a folder in the main process and returns a compact tree with project-type hints.
 * Enforces main process master root boundary (fails closed if path is outside root).
 * Caps depth at 3 and maxEntries at 500. Skips node_modules/.git/build dirs.
 */
export async function scanFolderCompact(targetPath?: string, options?: ScanFolderOptions): Promise<ScanFolderResult> {
  const masterRoot = await getMasterRoot();
  if (!masterRoot) {
    return {
      success: false,
      error: 'No organization master root is configured. Please configure a master root folder first.',
    };
  }

  const effectiveScope = options?.allowedScope ? options.allowedScope.trim() : masterRoot;
  const pathToCheck = targetPath && targetPath.trim() ? targetPath.trim() : effectiveScope;

  // Enforce boundary
  const scopeCheck = await assertWithinScope(pathToCheck, effectiveScope);
  if (!scopeCheck.allowed) {
    return {
      success: false,
      error: `Access denied: Path "${pathToCheck}" is outside authorized boundary "${effectiveScope}" (${scopeCheck.reason}).`,
    };
  }

  const resolvedTarget = scopeCheck.resolved;

  if (!fs.existsSync(resolvedTarget)) {
    return {
      success: false,
      exists: false,
      error: `Target folder "${resolvedTarget}" does not exist.`,
    };
  }

  try {
    const stat = fs.statSync(resolvedTarget);
    if (!stat.isDirectory()) {
      return {
        success: false,
        error: `Target path "${resolvedTarget}" is a file, not a directory.`,
      };
    }
  } catch (err) {
    return {
      success: false,
      error: `Failed to stat target path "${resolvedTarget}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const maxDepth = Math.min(Math.max(1, options?.depth ?? 2), 3);
  const maxEntries = Math.min(Math.max(1, options?.maxEntries ?? 100), 500);

  let totalEntries = 0;
  let truncated = false;

  function buildNode(currentPath: string, currentDepth: number): CompactFolderNode | null {
    if (totalEntries >= maxEntries) {
      truncated = true;
      return null;
    }

    totalEntries++;
    const name = path.basename(currentPath) || currentPath;

    let dirents: fs.Dirent[] = [];
    try {
      dirents = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return {
        name,
        path: currentPath,
        fileCount: 0,
        dirCount: 0,
        hasReadme: false,
      };
    }

    const fileNames: string[] = [];
    const subDirs: string[] = [];
    let hasReadme = false;
    let readmeSnippet: string | undefined;
    let maxMtime = 0;

    for (const d of dirents) {
      if (d.isDirectory()) {
        if (!IGNORED_SCAN_DIRS.has(d.name) && !d.name.startsWith('.')) {
          subDirs.push(path.join(currentPath, d.name));
        }
      } else if (d.isFile()) {
        fileNames.push(d.name);
        if (d.name.toLowerCase().startsWith('readme')) {
          hasReadme = true;
          try {
            const readmePath = path.join(currentPath, d.name);
            const content = fs.readFileSync(readmePath, 'utf8');
            readmeSnippet = content.slice(0, 150).replace(/\r?\n/g, ' ').trim();
          } catch {}
        }
        try {
          const s = fs.statSync(path.join(currentPath, d.name));
          if (s.mtimeMs > maxMtime) {
            maxMtime = s.mtimeMs;
          }
        } catch {}
      }
    }

    const typeHint = detectFolderTypeHint(fileNames);
    const node: CompactFolderNode = {
      name,
      path: currentPath,
      typeHint,
      fileCount: fileNames.length,
      dirCount: subDirs.length,
      hasReadme,
      readmeSnippet,
      lastModified: maxMtime > 0 ? Math.round(maxMtime) : undefined,
    };

    if (currentDepth < maxDepth && subDirs.length > 0) {
      const children: CompactFolderNode[] = [];
      for (const subDir of subDirs) {
        if (totalEntries >= maxEntries) {
          truncated = true;
          break;
        }
        const childNode = buildNode(subDir, currentDepth + 1);
        if (childNode) {
          children.push(childNode);
        }
      }
      if (children.length > 0) {
        node.children = children;
      }
    }

    return node;
  }

  const rootTree = buildNode(resolvedTarget, 1);

  return {
    success: true,
    rootPath: resolvedTarget,
    totalEntries,
    tree: rootTree ?? undefined,
    truncated,
  };
}
