/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { assertWithinScope } from './pathGuard';

export interface FolderScanEntry {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  size?: number;
  extension?: string;
}

export interface FolderScanResult {
  rootPath: string;
  entries: FolderScanEntry[];
  totalScanned: number;
  truncated: boolean;
  summary: string;
}

export interface FileReadResult {
  content: string;
  size: number;
  truncated: boolean;
}

export interface ShellRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const RISKY_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--force)\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\b(curl|wget)\b.*\|\s*(sh|bash|zsh|powershell|cmd)/i,
  /\bsudo\b/i,
  /\b(mkfs|dd|format)\b/i,
  /\b(npm|pnpm|yarn|bun)\s+(install|add)\s+.*(-g|--global)\b/i,
  />\s*(\/etc|\/boot|\/bin|\/usr|C:\\Windows|C:\\Program Files)/i,
];

export function checkRiskyCommand(cmd: string): { isRisky: boolean; reason?: string } {
  for (const pattern of RISKY_PATTERNS) {
    if (pattern.test(cmd)) {
      return { isRisky: true, reason: `Command matched potentially destructive pattern: ${pattern.toString()}` };
    }
  }
  return { isRisky: false };
}

export class OrgFolderTools {
  /**
   * Scans a directory within an allowed workspace up to maxDepth and maxEntries.
   */
  public static async scanFolder(
    targetDir: string,
    allowedWorkspace: string,
    options?: { depth?: number; maxEntries?: number }
  ): Promise<FolderScanResult> {
    const scopeCheck = await assertWithinScope(targetDir, allowedWorkspace);
    if (!scopeCheck.allowed) {
      throw new Error(
        `Access denied: Target folder "${targetDir}" is outside workspace "${allowedWorkspace}" (${scopeCheck.reason})`
      );
    }

    const maxDepth = options?.depth ?? 3;
    const maxEntries = options?.maxEntries ?? 1000;
    const entries: FolderScanEntry[] = [];
    let truncated = false;
    let count = 0;

    if (!fs.existsSync(targetDir)) {
      return {
        rootPath: targetDir,
        entries: [],
        totalScanned: 0,
        truncated: false,
        summary: 'Directory does not exist',
      };
    }

    const traverse = (currentDir: string, currentDepth: number) => {
      if (currentDepth > maxDepth || count >= maxEntries) {
        if (count >= maxEntries) truncated = true;
        return;
      }

      let dirents: fs.Dirent[] = [];
      try {
        dirents = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch (err) {
        console.warn(`[OrgFolderTools] Could not read ${currentDir}:`, err);
        return;
      }

      for (const dirent of dirents) {
        if (count >= maxEntries) {
          truncated = true;
          break;
        }

        // Skip heavy directories
        if (
          dirent.name === 'node_modules' ||
          dirent.name === '.git' ||
          dirent.name === 'dist' ||
          dirent.name === 'build'
        ) {
          continue;
        }

        const fullPath = path.join(currentDir, dirent.name);
        const relPath = path.relative(targetDir, fullPath).replace(/\\/g, '/');
        const isDir = dirent.isDirectory();

        count++;
        let size: number | undefined;
        let ext: string | undefined;

        if (!isDir) {
          try {
            const stat = fs.statSync(fullPath);
            size = stat.size;
            ext = path.extname(dirent.name).toLowerCase();
          } catch {}
        }

        entries.push({
          name: dirent.name,
          relativePath: relPath,
          isDirectory: isDir,
          size,
          extension: ext,
        });

        if (isDir) {
          traverse(fullPath, currentDepth + 1);
        }
      }
    };

    traverse(targetDir, 1);

    const summary = `Found ${entries.length} items (${entries.filter((e) => e.isDirectory).length} directories, ${
      entries.filter((e) => !e.isDirectory).length
    } files)${truncated ? ' [TRUNCATED at max entries cap]' : ''}`;

    return {
      rootPath: targetDir,
      entries,
      totalScanned: count,
      truncated,
      summary,
    };
  }

  /**
   * Reads a file with size checks and workspace boundary validation.
   */
  public static async readFile(
    targetFilePath: string,
    allowedWorkspace: string,
    maxBytes = 256 * 1024
  ): Promise<FileReadResult> {
    const scopeCheck = await assertWithinScope(targetFilePath, allowedWorkspace);
    if (!scopeCheck.allowed) {
      throw new Error(`Access denied: File "${targetFilePath}" is outside workspace "${allowedWorkspace}"`);
    }

    if (!fs.existsSync(targetFilePath)) {
      throw new Error(`File does not exist: ${targetFilePath}`);
    }

    const stat = fs.statSync(targetFilePath);
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${targetFilePath}`);
    }

    let truncated = false;
    let readSize = stat.size;
    if (stat.size > maxBytes) {
      readSize = maxBytes;
      truncated = true;
    }

    const buffer = Buffer.alloc(readSize);
    const fd = fs.openSync(targetFilePath, 'r');
    fs.readSync(fd, buffer, 0, readSize, 0);
    fs.closeSync(fd);

    return {
      content: buffer.toString('utf8'),
      size: stat.size,
      truncated,
    };
  }

  /**
   * Writes content to a file with boundary validation and recursive directory creation.
   */
  public static async writeFile(targetFilePath: string, content: string, allowedWorkspace: string): Promise<boolean> {
    const scopeCheck = await assertWithinScope(targetFilePath, allowedWorkspace);
    if (!scopeCheck.allowed) {
      throw new Error(`Access denied: Target file "${targetFilePath}" is outside workspace "${allowedWorkspace}"`);
    }

    const dir = path.dirname(targetFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(targetFilePath, content, 'utf8');
    return true;
  }

  /**
   * Lists immediate directory children.
   */
  public static async listDir(targetDir: string, allowedWorkspace: string): Promise<FolderScanEntry[]> {
    const res = await OrgFolderTools.scanFolder(targetDir, allowedWorkspace, { depth: 1, maxEntries: 500 });
    return res.entries;
  }

  /**
   * Executes a shell command strictly inside the agent's assigned workspace folder.
   * Rejects out-of-bounds working directories and dangerous arguments.
   */
  public static async runShell(
    command: string,
    cwd: string,
    allowedWorkspace: string,
    options?: { timeoutMs?: number; requiresApproval?: boolean; onOutput?: (chunk: string) => void }
  ): Promise<ShellRunResult> {
    const scopeCheck = await assertWithinScope(cwd, allowedWorkspace);
    if (!scopeCheck.allowed) {
      throw new Error(`Access denied: Shell working directory "${cwd}" is outside workspace "${allowedWorkspace}"`);
    }

    const risk = checkRiskyCommand(command);
    if (risk.isRisky && options?.requiresApproval !== false) {
      throw new Error(`Blocked risky command requiring manual approval: ${risk.reason}`);
    }

    const timeout = options?.timeoutMs ?? 60000;
    const isWin = process.platform === 'win32';
    const shellExe = isWin ? 'powershell.exe' : '/bin/sh';
    const shellArgs = isWin ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn(shellExe, shellArgs, {
        cwd,
        env: { ...process.env },
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeout);

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        if (options?.onOutput) options.onOutput(text);
      });

      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        if (options?.onOutput) options.onOutput(text);
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? (timedOut ? 124 : 1),
          stdout,
          stderr,
          timedOut,
        });
      });
    });
  }
}
