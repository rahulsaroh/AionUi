/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { assertWithinScope } from './pathGuard';
import { resolveEffectiveScope } from './orgScope';
import { consumeCommandApprovalToken, consumeFileApprovalToken } from './orgApproval';
import { recordShellExecution } from './orgTelemetry';
import { scanFolderCompact, type ScanFolderResult, type ScanFolderOptions } from './scanFolder';

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
  needsApproval?: boolean;
  reason?: string;
  command?: string;
}

/**
 * Checks whether a target file path matches forbidden or sensitive write destinations.
 */
export function isProtectedWriteTarget(targetFilePath: string): { blocked: boolean; reason?: string } {
  const normalized = targetFilePath.replace(/\\/g, '/');
  const base = path.basename(normalized);

  if (/(?:^|\/)\.git(?:\/|$)/i.test(normalized) || /(?:^|\/)node_modules\/\.git(?:\/|$)/i.test(normalized)) {
    return { blocked: true, reason: 'Writing to .git internal directories is strictly forbidden' };
  }
  if (/^\.env/i.test(base)) {
    return { blocked: true, reason: 'Writing to environment configuration files (.env*) is forbidden' };
  }
  if (/\.pem$/i.test(base)) {
    return { blocked: true, reason: 'Writing to certificate files (*.pem) is forbidden' };
  }
  if (/\.key$/i.test(base)) {
    return { blocked: true, reason: 'Writing to private key files (*.key) is forbidden' };
  }
  if (/^id_rsa/i.test(base)) {
    return { blocked: true, reason: 'Writing to SSH identity files (id_rsa*) is forbidden' };
  }
  return { blocked: false };
}

/**
 * Checks whether a target file path contains sensitive credentials or secret configurations.
 */
export function isSensitiveReadTarget(filePath: string): { isSensitive: boolean; reason?: string } {
  const normalized = filePath.replace(/\\/g, '/');
  const base = path.basename(normalized);

  if (
    /^\.env/i.test(base) ||
    /\.pem$/i.test(base) ||
    /\.key$/i.test(base) ||
    /^id_rsa/i.test(base) ||
    /^credentials/i.test(base) ||
    /\.kdbx$/i.test(base)
  ) {
    return { isSensitive: true, reason: `File "${base}" contains sensitive secrets/credentials` };
  }
  return { isSensitive: false };
}

/**
 * Note: A denylist is defense-in-depth, not an OS sandbox.
 * It detects known dangerous primitives, destructive commands, privilege escalation,
 * and directory traversal attempts, but does not provide complete OS-level containerization.
 */
export function checkRiskyCommand(cmd: string, cwd?: string): { isRisky: boolean; reason?: string } {
  if (!cmd || typeof cmd !== 'string') {
    return { isRisky: false };
  }

  // Normalize whitespace and prepare strings for pattern checks
  const normalized = cmd.trim().replace(/\s+/g, ' ');

  // 1. Destructive, privilege escalation, shell injection, or scheduled tasks
  const explicitPatterns: Array<{ regex: RegExp; reason: string }> = [
    {
      regex: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--force)\b/i,
      reason: 'Forced recursive deletion (rm -rf)',
    },
    {
      regex: /\bremove-item\b.*(-recurse.*-force|-force.*-recurse)/i,
      reason: 'PowerShell recursive forced deletion (Remove-Item)',
    },
    {
      regex: /\bdel\b.*\/s\b/i,
      reason: 'Windows recursive delete (del /s)',
    },
    {
      regex: /\brmdir\b.*\/s\b/i,
      reason: 'Windows recursive directory removal (rmdir /s)',
    },
    {
      regex: /\bgit\s+push\s+.*--force\b/i,
      reason: 'Forced git push',
    },
    {
      regex: /\bgit\s+reset\s+--hard\b/i,
      reason: 'Hard git reset',
    },
    {
      regex: /\b(curl|wget)\b.*\|\s*(sh|bash|zsh|powershell|pwsh|cmd)\b/i,
      reason: 'Piping network download directly into a shell interpreter',
    },
    {
      regex: /\bsudo\b/i,
      reason: 'Elevated privileges (sudo)',
    },
    {
      regex: /\b(mkfs|dd|format)\b/i,
      reason: 'Filesystem formatting or raw disk write',
    },
    {
      regex: /\b(npm|pnpm|yarn|bun)\s+(install|add)\s+.*(-g|--global)\b/i,
      reason: 'Global package installation',
    },
    {
      regex: /\b(chmod|chown)\s+(-[a-zA-Z]*r|--recursive)\b/i,
      reason: 'Recursive permission/ownership modification (chmod/chown -R)',
    },
    {
      regex: /\b(powershell|pwsh)\b.*-enc(odedcommand)?\b/i,
      reason: 'Encoded PowerShell execution',
    },
    {
      regex: /\b(invoke-expression|iex)\b/i,
      reason: 'Arbitrary string execution (Invoke-Expression / iex)',
    },
    {
      regex: /\breg\s+(add|delete)\b/i,
      reason: 'Windows Registry modification',
    },
    {
      regex: /\bschtasks\b/i,
      reason: 'Scheduled task manipulation (schtasks)',
    },
    {
      regex: /\bcrontab\b/i,
      reason: 'Cron scheduled task manipulation (crontab)',
    },
    {
      regex: /\b(ssh|scp)\b/i,
      reason: 'Remote network shell/copy tool (ssh/scp)',
    },
  ];

  for (const item of explicitPatterns) {
    if (item.regex.test(normalized)) {
      return { isRisky: true, reason: item.reason };
    }
  }

  // 2. Traversal or paths outside workspace
  // Directory traversal ('..')
  if (/(?:^|[\s"'`=/\\])\.\.(?:[\s"'`=/\\]|$)/.test(normalized)) {
    return {
      isRisky: true,
      reason: 'Command contains parent directory traversal ("..")',
    };
  }

  // User home directory references (~, $HOME, %USERPROFILE%)
  if (
    /(?:^|[\s"'`=])~[/\\]?/.test(normalized) ||
    /\$home\b/i.test(normalized) ||
    /\$\{home\}/i.test(normalized) ||
    /%userprofile%/i.test(normalized)
  ) {
    return {
      isRisky: true,
      reason: 'Command references user home directory (~, $HOME, %USERPROFILE%)',
    };
  }

  // cd out of workspace
  if (/\bcd\s+(\.\.|\/|[a-zA-Z]:|~|\$|%)/i.test(normalized)) {
    return {
      isRisky: true,
      reason: 'Command attempts to change directory out of workspace',
    };
  }

  // Redirection or tee targeting paths outside workspace or system locations
  if (
    /(?:>>?|[|]\s*tee\s+)\s*(\.\.|\/|[a-zA-Z]:|~|\$|%)/i.test(normalized) ||
    />\s*(\/etc|\/boot|\/bin|\/usr|\/var|C:\\Windows|C:\\Program Files)/i.test(normalized)
  ) {
    return {
      isRisky: true,
      reason: 'Redirection or tee targeting paths outside workspace',
    };
  }

  // Absolute paths
  const winAbsMatches = normalized.match(/\b([a-zA-Z]:[/\\][^\s"'`<>|]*)/g);
  if (winAbsMatches) {
    for (const match of winAbsMatches) {
      if (!cwd) {
        return { isRisky: true, reason: `Command contains absolute path: ${match}` };
      }
      const normMatch = path.normalize(match).toLowerCase();
      const normCwd = path.normalize(cwd).toLowerCase();
      if (!normMatch.startsWith(normCwd)) {
        return { isRisky: true, reason: `Command references path outside workspace: ${match}` };
      }
    }
  }

  const unixAbsMatches = normalized.match(
    /(?:^|[\s"'`=])(\/(?:etc|boot|bin|usr|var|tmp|home|root|opt|sbin|dev|sys|proc|windows)[^\s"'`<>|]*)/gi
  );
  if (unixAbsMatches) {
    return {
      isRisky: true,
      reason: `Command references system absolute path: ${unixAbsMatches[0].trim()}`,
    };
  }

  return { isRisky: false };
}

/**
 * Builds a strictly minimal environment for spawned child processes.
 * Drops process.env, confines HOME and USERPROFILE to cwd, and strips all secrets/API keys.
 */
export function getMinimalEnv(cwd: string): NodeJS.ProcessEnv {
  const isWin = process.platform === 'win32';
  const cleanEnv: NodeJS.ProcessEnv = {};

  const safeKeys = isWin
    ? ['PATH', 'Path', 'TEMP', 'TMP', 'SystemRoot', 'windir', 'COMSPEC', 'PATHEXT']
    : ['PATH', 'TEMP', 'TMP', 'LANG', 'LC_ALL'];

  for (const key of safeKeys) {
    if (process.env[key] !== undefined) {
      cleanEnv[key] = process.env[key];
    }
  }

  cleanEnv.HOME = cwd;
  cleanEnv.USERPROFILE = cwd;

  // Never forward any variable matching sensitive patterns
  const secretPattern = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API/i;
  for (const k of Object.keys(cleanEnv)) {
    if (secretPattern.test(k)) {
      delete cleanEnv[k];
    }
  }

  return cleanEnv;
}

/**
 * Kills a child process and its entire sub-process tree.
 */
export function killProcessTree(child: ChildProcess): void {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', () => {
        try {
          child.kill();
        } catch {}
      });
    } catch {
      try {
        child.kill();
      } catch {}
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {}
    }
  }
}

export class OrgFolderTools {
  /**
   * Scans a directory and returns a compact tree with project-type hints.
   */
  public static async scanFolderCompact(targetPath?: string, options?: ScanFolderOptions): Promise<ScanFolderResult> {
    return scanFolderCompact(targetPath, options);
  }

  /**
   * Scans a directory within an allowed workspace up to maxDepth and maxEntries.
   */
  public static async scanFolder(
    targetDir: string,
    allowedWorkspace: string,
    options?: { depth?: number; maxEntries?: number }
  ): Promise<FolderScanResult> {
    // Enforce main-process master root. The allowedWorkspace parameter is kept for
    // backward compatibility, but cannot widen scope; if valid, it may only narrow it.
    const effectiveScope = await resolveEffectiveScope(allowedWorkspace);
    const scopeCheck = await assertWithinScope(targetDir, effectiveScope);
    if (!scopeCheck.allowed) {
      throw new Error(
        `Access denied: Target folder "${targetDir}" is outside workspace "${effectiveScope}" (${scopeCheck.reason})`
      );
    }

    // Cap depth at 6 and maxEntries at 5000 regardless of caller input
    const maxDepth = Math.min(Math.max(1, options?.depth ?? 3), 6);
    const maxEntries = Math.min(Math.max(1, options?.maxEntries ?? 1000), 5000);
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
        // Do not follow symlinked directories
        const isDir = dirent.isDirectory() && !dirent.isSymbolicLink();

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
    maxBytes = 256 * 1024,
    options?: { approvalToken?: string }
  ): Promise<FileReadResult> {
    // Enforce main-process master root. allowedWorkspace can only narrow, never widen.
    const effectiveScope = await resolveEffectiveScope(allowedWorkspace);
    const scopeCheck = await assertWithinScope(targetFilePath, effectiveScope);
    if (!scopeCheck.allowed) {
      throw new Error(`Access denied: File "${targetFilePath}" is outside workspace "${effectiveScope}"`);
    }

    if (!fs.existsSync(targetFilePath)) {
      throw new Error(`File does not exist: ${targetFilePath}`);
    }

    // Check for sensitive files requiring manual approval token
    const sensitive = isSensitiveReadTarget(targetFilePath);
    if (sensitive.isSensitive) {
      const isApproved = consumeFileApprovalToken(options?.approvalToken, targetFilePath);
      if (!isApproved) {
        const err = new Error(`Blocked access to sensitive file requiring approval: ${sensitive.reason}`) as any;
        err.needsApproval = true;
        err.targetFilePath = targetFilePath;
        err.reason = sensitive.reason;
        throw err;
      }
    }

    const stat = fs.statSync(targetFilePath);
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${targetFilePath}`);
    }

    // Keep default maxBytes (256 KB) and cap caller-supplied maxBytes at 1 MB
    const MAX_READ_BYTES = 1024 * 1024;
    const effectiveMaxBytes = Math.min(Math.max(1, maxBytes ?? 256 * 1024), MAX_READ_BYTES);

    let truncated = false;
    let readSize = stat.size;
    if (stat.size > effectiveMaxBytes) {
      readSize = effectiveMaxBytes;
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
   * Writes content to a file with boundary validation, symlink checks, size limits,
   * TOCTOU parent realpath verification, and sensitive path restrictions.
   */
  public static async writeFile(targetFilePath: string, content: string, allowedWorkspace: string): Promise<boolean> {
    // Max content size 5 MB
    const MAX_WRITE_BYTES = 5 * 1024 * 1024;
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
      throw new Error(`Content size exceeds maximum allowed limit (5 MB)`);
    }

    // Protected destination check (.git, .env*, *.pem, *.key, id_rsa*, node_modules/.git)
    const protectedCheck = isProtectedWriteTarget(targetFilePath);
    if (protectedCheck.blocked) {
      throw new Error(`Access denied: ${protectedCheck.reason}`);
    }

    // Enforce main-process master root. allowedWorkspace can only narrow, never widen.
    const effectiveScope = await resolveEffectiveScope(allowedWorkspace);
    const scopeCheck = await assertWithinScope(targetFilePath, effectiveScope);
    if (!scopeCheck.allowed) {
      throw new Error(`Access denied: Target file "${targetFilePath}" is outside workspace "${effectiveScope}"`);
    }

    // Refuse if target path itself exists and is a symbolic link
    if (fs.existsSync(targetFilePath)) {
      const lstat = fs.lstatSync(targetFilePath);
      if (lstat.isSymbolicLink()) {
        throw new Error(`Access denied: Target file "${targetFilePath}" is a symbolic link`);
      }
    }

    const dir = path.dirname(targetFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Re-check scope on the REALPATH of the target's parent after mkdir (close TOCTOU gap)
    const realParent = fs.realpathSync(dir);
    const parentCheck = await assertWithinScope(realParent, effectiveScope);
    if (!parentCheck.allowed) {
      throw new Error(
        `Access denied: Realpath of target directory "${realParent}" is outside workspace "${effectiveScope}"`
      );
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
   * Enforces main process approval for risky commands, strips environment secrets,
   * caps execution duration and output buffers, and logs telemetry.
   */
  public static async runShell(
    command: string,
    cwd: string,
    allowedWorkspace: string,
    options?: {
      timeoutMs?: number;
      approvalToken?: string;
      requiresApproval?: boolean; // deprecated / ignored as bypass
      onOutput?: (chunk: string) => void;
    }
  ): Promise<ShellRunResult> {
    const startTime = Date.now();

    // Enforce main-process master root. allowedWorkspace can only narrow, never widen.
    const effectiveScope = await resolveEffectiveScope(allowedWorkspace);
    const scopeCheck = await assertWithinScope(cwd, effectiveScope);
    if (!scopeCheck.allowed) {
      throw new Error(`Access denied: Shell working directory "${cwd}" is outside workspace "${effectiveScope}"`);
    }

    const risk = checkRiskyCommand(command, cwd);
    if (risk.isRisky) {
      // requiresApproval is completely removed as a bypass. Only a valid token minted by the main process is accepted.
      const isApproved = consumeCommandApprovalToken(options?.approvalToken, command, cwd);
      if (!isApproved) {
        const err = new Error(`Blocked risky command requiring manual approval: ${risk.reason}`) as any;
        err.needsApproval = true;
        err.command = command;
        err.reason = risk.reason;
        throw err;
      }
    }

    // Maximum timeout capped at 5 minutes
    const MAX_TIMEOUT_MS = 5 * 60 * 1000;
    const timeout = Math.min(Math.max(1000, options?.timeoutMs ?? 60000), MAX_TIMEOUT_MS);
    const isWin = process.platform === 'win32';
    const shellExe = isWin ? 'powershell.exe' : '/bin/sh';
    const shellArgs = isWin ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];

    const minimalEnv = getMinimalEnv(cwd);
    const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB cap

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let stdoutTruncated = false;
      let stderrTruncated = false;

      const child = spawn(shellExe, shellArgs, {
        cwd,
        env: minimalEnv,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child);
      }, timeout);

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString('utf8');
        if (stdout.length < MAX_OUTPUT_BYTES) {
          const remaining = MAX_OUTPUT_BYTES - stdout.length;
          if (text.length > remaining) {
            stdout += text.slice(0, remaining) + '\n[TRUNCATED: Output exceeded 1 MB limit]';
            stdoutTruncated = true;
          } else {
            stdout += text;
          }
        } else if (!stdoutTruncated) {
          stdout += '\n[TRUNCATED: Output exceeded 1 MB limit]';
          stdoutTruncated = true;
        }
        if (options?.onOutput) options.onOutput(text);
      });

      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString('utf8');
        if (stderr.length < MAX_OUTPUT_BYTES) {
          const remaining = MAX_OUTPUT_BYTES - stderr.length;
          if (text.length > remaining) {
            stderr += text.slice(0, remaining) + '\n[TRUNCATED: Output exceeded 1 MB limit]';
            stderrTruncated = true;
          } else {
            stderr += text;
          }
        } else if (!stderrTruncated) {
          stderr += '\n[TRUNCATED: Output exceeded 1 MB limit]';
          stderrTruncated = true;
        }
        if (options?.onOutput) options.onOutput(text);
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        recordShellExecution({
          command,
          cwd,
          exitCode: 1,
          durationMs: Date.now() - startTime,
          timedOut,
        });
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const exitCode = code ?? (timedOut ? 124 : 1);
        recordShellExecution({
          command,
          cwd,
          exitCode,
          durationMs: Date.now() - startTime,
          timedOut,
        });
        resolve({
          exitCode,
          stdout,
          stderr,
          timedOut,
        });
      });
    });
  }
}
