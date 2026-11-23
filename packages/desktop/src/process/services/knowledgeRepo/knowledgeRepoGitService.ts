/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execFileAsync = promisify(execFile);
const DEFAULT_GIT_TIMEOUT_MS = 120_000;
const DEFAULT_CLONE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes default for large repos / slow disks

export class GitExecutionError extends Error {
  code?: number | string;
  constructor(message: string, code?: number | string) {
    super(message);
    this.name = 'GitExecutionError';
    this.code = code;
  }
}

export type GitExecResult = {
  stdout: string;
  stderr: string;
};

/**
 * Validate that a URL is a valid https git URL.
 */
export function isValidGitHttpsUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) return false;
  // Disallow shell metacharacters and whitespace in git URL
  if (/[;\s&|`$<>'"\\]/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    // Disallow userinfo in URL for security; tokens are passed separately via headers/credentials
    if (parsed.username || parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize ref name (branch/tag/commit SHA)
 */
export function sanitizeGitRef(ref: string): string {
  const trimmed = (ref || '').trim();
  if (!trimmed) return 'HEAD';
  // Allow only alphanumeric, slashes, dashes, dots, underscores
  if (!/^[a-zA-Z0-9._\-/]+$/.test(trimmed) || trimmed.includes('..')) {
    throw new Error(`Invalid git ref: "${ref}"`);
  }
  return trimmed;
}

/**
 * Parse git progress lines emitted to stderr during clone / checkout.
 */
export function parseGitProgress(line: string): { percent: number; message: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Checkout files: "Updating files:  31% (3356/10705)"
  const updatingMatch = trimmed.match(/Updating files:\s+(\d+)%(?: \(([^)]+)\))?/i);
  if (updatingMatch) {
    const raw = parseInt(updatingMatch[1], 10);
    // Maps to 70% - 98%
    const percent = Math.min(98, Math.max(70, Math.round(70 + raw * 0.28)));
    const details = updatingMatch[2] ? ` (${updatingMatch[2]})` : '';
    return { percent, message: `Checking out files: ${raw}%${details}` };
  }

  // Downloading objects: "Receiving objects:  45% (4817/10705), 12.34 MiB | 2.50 MiB/s"
  const receivingMatch = trimmed.match(/Receiving objects:\s+(\d+)%(?: \(([^)]+)\))?/i);
  if (receivingMatch) {
    const raw = parseInt(receivingMatch[1], 10);
    // Maps to 15% - 65%
    const percent = Math.min(65, Math.max(15, Math.round(15 + raw * 0.5)));
    const details = receivingMatch[2] ? ` (${receivingMatch[2]})` : '';
    return { percent, message: `Downloading repository: ${raw}%${details}` };
  }

  // Resolving deltas: "Resolving deltas:  90% (900/1000)"
  const deltasMatch = trimmed.match(/Resolving deltas:\s+(\d+)%/i);
  if (deltasMatch) {
    const raw = parseInt(deltasMatch[1], 10);
    const percent = Math.min(70, Math.max(65, Math.round(65 + raw * 0.05)));
    return { percent, message: `Resolving deltas: ${raw}%` };
  }

  // Compressing objects: "Compressing objects:  50%"
  const compressingMatch = trimmed.match(/Compressing objects:\s+(\d+)%/i);
  if (compressingMatch) {
    const raw = parseInt(compressingMatch[1], 10);
    const percent = Math.min(15, Math.max(5, Math.round(5 + raw * 0.1)));
    return { percent, message: `Compressing objects: ${raw}%` };
  }

  // Counting objects: "remote: Counting objects: 100%"
  const countingMatch = trimmed.match(/Counting objects:\s+(\d+)%/i);
  if (countingMatch) {
    return { percent: 5, message: 'Counting objects...' };
  }

  // Generic percentage match
  const genericMatch = trimmed.match(/(\d+)%/);
  if (genericMatch) {
    const raw = parseInt(genericMatch[1], 10);
    return { percent: raw, message: trimmed };
  }

  if (trimmed.startsWith('Cloning into')) {
    return { percent: 2, message: 'Connecting to repository...' };
  }

  return null;
}

export class KnowledgeRepoGitService {
  /**
   * Safe git command invocation without shell interpolation.
   */
  async runGit(
    args: string[],
    cwd?: string,
    authToken?: string,
    timeoutMs: number = DEFAULT_GIT_TIMEOUT_MS
  ): Promise<GitExecResult> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_NOSYSTEM: '1',
      // Prevent running hooks from the repo
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: process.platform === 'win32' ? 'NUL' : '/dev/null',
    };

    if (authToken) {
      // Pass auth header strictly via GIT_CONFIG environment variables rather than
      // CLI arguments, ensuring tokens never appear in process argument lists.
      env.GIT_CONFIG_COUNT = '2';
      env.GIT_CONFIG_KEY_1 = 'http.extraHeader';
      env.GIT_CONFIG_VALUE_1 = `Authorization: Bearer ${authToken}`;
    }

    const finalArgs = [...args];

    try {
      const { stdout, stderr } = await execFileAsync('git', finalArgs, {
        cwd,
        env,
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      });
      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err: unknown) {
      const error = err as { code?: number | string; message?: string; stderr?: string; killed?: boolean };
      let errMsg = error.stderr?.trim() || error.message || 'Git execution error';
      if (error.killed || (typeof error.message === 'string' && error.message.includes('timed out'))) {
        const minutes = Math.round(timeoutMs / 60000);
        errMsg = `Git command timed out after ${minutes} minutes. If your data directory is located on a cloud-synced drive (such as Google Drive or OneDrive), disk writes are significantly slower. Consider moving your data directory to a local SSD.`;
      }
      // Redact any potential auth tokens from output
      const sanitized = authToken ? errMsg.replaceAll(authToken, '[REDACTED]') : errMsg;
      throw new GitExecutionError(sanitized, error.code);
    }
  }

  /**
   * Clone a repo shallowly to the target directory with real-time progress.
   */
  async shallowClone(
    gitUrl: string,
    ref: string,
    targetDir: string,
    authToken?: string,
    onProgress?: (percent: number, message: string) => void,
    timeoutMs: number = DEFAULT_CLONE_TIMEOUT_MS
  ): Promise<string> {
    if (!isValidGitHttpsUrl(gitUrl)) {
      const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
      const isLocalPath =
        gitUrl.startsWith('file://') || (isTestEnv && (path.isAbsolute(gitUrl) || gitUrl.endsWith('.git')));
      if (!isLocalPath) {
        throw new Error(`Invalid HTTPS git URL: ${gitUrl}`);
      }
    }
    const safeRef = sanitizeGitRef(ref || 'main');
    await fs.mkdir(path.dirname(targetDir), { recursive: true });

    // Ensure targetDir does not exist or is empty
    await fs.rm(targetDir, { recursive: true, force: true });

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: process.platform === 'win32' ? 'NUL' : '/dev/null',
    };

    if (authToken) {
      env.GIT_CONFIG_COUNT = '2';
      env.GIT_CONFIG_KEY_1 = 'http.extraHeader';
      env.GIT_CONFIG_VALUE_1 = `Authorization: Bearer ${authToken}`;
    }

    const cloneArgs = ['clone', '--progress', '--depth', '1', '--branch', safeRef, '--no-tags', gitUrl, targetDir];

    onProgress?.(2, 'Connecting to remote repository...');

    await new Promise<void>((resolve, reject) => {
      const child = spawn('git', cloneArgs, { env });
      let stderrAccum = '';
      let isTimedOut = false;

      const timer = setTimeout(() => {
        isTimedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      child.stderr.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString();
        stderrAccum += text;
        const lines = text.split(/[\r\n]+/);
        for (const line of lines) {
          const parsed = parseGitProgress(line);
          if (parsed && onProgress) {
            onProgress(parsed.percent, parsed.message);
          }
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        const errMsg = err.message || 'Failed to spawn git process';
        const sanitized = authToken ? errMsg.replaceAll(authToken, '[REDACTED]') : errMsg;
        reject(new GitExecutionError(sanitized));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (isTimedOut) {
          const minutes = Math.round(timeoutMs / 60000);
          reject(
            new GitExecutionError(
              `Git clone timed out after ${minutes} minutes. If your data directory is located on a cloud-synced drive (such as Google Drive or OneDrive), disk writes are significantly slower. Consider moving your data directory to a local SSD.`
            )
          );
          return;
        }

        if (code === 0) {
          onProgress?.(98, 'Checking out working files completed');
          resolve();
        } else {
          const errMsg = stderrAccum.trim() || `Git clone exited with code ${code}`;
          const sanitized = authToken ? errMsg.replaceAll(authToken, '[REDACTED]') : errMsg;
          reject(new GitExecutionError(sanitized, code ?? undefined));
        }
      });
    });

    return this.getHeadSha(targetDir);
  }

  /**
   * Get the current commit SHA of the repository.
   */
  async getHeadSha(repoDir: string): Promise<string> {
    const { stdout } = await this.runGit(['rev-parse', 'HEAD'], repoDir);
    return stdout;
  }

  /**
   * Get the remote SHA for a given ref without modifying working tree.
   */
  async getRemoteRefSha(gitUrl: string, ref: string, authToken?: string): Promise<string> {
    const safeRef = sanitizeGitRef(ref);
    const { stdout } = await this.runGit(
      ['ls-remote', gitUrl, safeRef, `refs/heads/${safeRef}`, `refs/tags/${safeRef}`],
      undefined,
      authToken
    );
    const lines = stdout.split('\n').filter(Boolean);
    if (lines.length === 0) {
      throw new Error(`Ref "${ref}" not found on remote ${gitUrl}`);
    }
    const [sha] = lines[0].split(/\s+/);
    return sha;
  }

  /**
   * Fast-forward fetch and update.
   * Throws if history diverged (force push) or not fast-forwardable.
   */
  async updateFastForward(
    repoDir: string,
    ref: string,
    authToken?: string
  ): Promise<{ oldSha: string; newSha: string }> {
    const oldSha = await this.getHeadSha(repoDir);
    const safeRef = sanitizeGitRef(ref || 'HEAD');

    // 1. Fetch remote commit shallowly
    await this.runGit(['fetch', '--depth', '1', 'origin', safeRef], repoDir, authToken);

    // 2. Check if FETCH_HEAD is fast-forwardable from current HEAD
    const { stdout: fetchHeadSha } = await this.runGit(['rev-parse', 'FETCH_HEAD'], repoDir);

    if (fetchHeadSha === oldSha) {
      return { oldSha, newSha: oldSha };
    }

    // Attempt fast-forward merge
    try {
      await this.runGit(['merge', '--ff-only', 'FETCH_HEAD'], repoDir);
    } catch {
      // Fast-forward failed (e.g. force push)
      throw new GitExecutionError(
        'Remote history was rewritten or cannot be fast-forwarded cleanly',
        'NOT_FAST_FORWARD'
      );
    }

    const newSha = await this.getHeadSha(repoDir);
    return { oldSha, newSha };
  }

  /**
   * Rollback repository to a known good commit SHA.
   */
  async rollback(repoDir: string, targetSha: string): Promise<string> {
    const safeSha = sanitizeGitRef(targetSha);
    await this.runGit(['reset', '--hard', safeSha], repoDir);
    return this.getHeadSha(repoDir);
  }

  /**
   * Get commit log between two commits.
   */
  async getCommitLog(repoDir: string, fromSha: string, toSha: string): Promise<string[]> {
    try {
      const { stdout } = await this.runGit(['log', '--pretty=format:%s', `${fromSha}..${toSha}`], repoDir);
      return stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Create or update a git worktree for a specific working copy.
   */
  async createWorktree(repoDir: string, worktreeDir: string, commitSha?: string): Promise<void> {
    await fs.mkdir(path.dirname(worktreeDir), { recursive: true });
    await fs.rm(worktreeDir, { recursive: true, force: true });
    const args = ['worktree', 'add', '--force', worktreeDir];
    if (commitSha) {
      args.push(sanitizeGitRef(commitSha));
    }
    await this.runGit(args, repoDir);
  }

  /**
   * Remove a git worktree safely.
   */
  async removeWorktree(repoDir: string, worktreeDir: string): Promise<void> {
    try {
      await this.runGit(['worktree', 'remove', '--force', worktreeDir], repoDir);
    } catch {
      await fs.rm(worktreeDir, { recursive: true, force: true });
    }
  }

  /**
   * Clean stale .lock files in the repository's .git directory.
   */
  async cleanStaleLocks(repoDir: string): Promise<string[]> {
    const gitDir = path.join(repoDir, '.git');
    const lockFiles = [
      path.join(gitDir, 'index.lock'),
      path.join(gitDir, 'HEAD.lock'),
      path.join(gitDir, 'shallow.lock'),
      path.join(gitDir, 'config.lock'),
      path.join(gitDir, 'packed-refs.lock'),
    ];
    const removed: string[] = [];
    for (const lockFile of lockFiles) {
      try {
        await fs.unlink(lockFile);
        removed.push(lockFile);
      } catch {
        // File does not exist or already removed
      }
    }
    return removed;
  }

  /**
   * Clone a repo shallowly into a temporary directory and atomically rename it into place.
   */
  async cloneToTempAndAtomicRename(
    gitUrlOrOptions:
      | string
      | {
          gitUrl: string;
          ref: string;
          targetDir: string;
          authToken?: string;
          onProgress?: (percent: number, message: string) => void;
          timeoutMs?: number;
        },
    refArg?: string,
    targetDirArg?: string,
    authTokenArg?: string,
    onProgressArg?: (percent: number, message: string) => void,
    timeoutMsArg: number = DEFAULT_CLONE_TIMEOUT_MS
  ): Promise<string> {
    let gitUrl: string;
    let ref: string;
    let targetDir: string;
    let authToken: string | undefined;
    let onProgress: ((percent: number, message: string) => void) | undefined;
    let timeoutMs: number;

    if (typeof gitUrlOrOptions === 'string') {
      gitUrl = gitUrlOrOptions;
      ref = refArg || 'main';
      targetDir = targetDirArg || '';
      authToken = authTokenArg;
      onProgress = onProgressArg;
      timeoutMs = timeoutMsArg;
    } else {
      gitUrl = gitUrlOrOptions.gitUrl;
      ref = gitUrlOrOptions.ref;
      targetDir = gitUrlOrOptions.targetDir;
      authToken = gitUrlOrOptions.authToken;
      onProgress = gitUrlOrOptions.onProgress;
      timeoutMs = gitUrlOrOptions.timeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS;
    }

    const parentDir = path.dirname(targetDir);
    await fs.mkdir(parentDir, { recursive: true });
    const tempDir = path.join(
      parentDir,
      `.tmp_clone_${path.basename(targetDir)}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    );

    try {
      await this.shallowClone(gitUrl, ref, tempDir, authToken, onProgress, timeoutMs);

      // Remove target directory if it already exists before renaming
      try {
        await fs.rm(targetDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        // Ignore if targetDir doesn't exist
      }

      await fs.rename(tempDir, targetDir);
      return await this.getHeadSha(targetDir);
    } catch (err) {
      // Clean up tempDir on error
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error
      }
      throw err;
    }
  }

  /**
   * Fetch shallowly and reset hard to branch/ref or target commit.
   */
  async fetchAndResetHard(
    repoDirOrOptions:
      | string
      | {
          repoDir: string;
          ref: string;
          targetSha?: string;
          authToken?: string;
        },
    refArg?: string,
    targetShaArg?: string,
    authTokenArg?: string
  ): Promise<string> {
    let repoDir: string;
    let ref: string;
    let targetSha: string | undefined;
    let authToken: string | undefined;

    if (typeof repoDirOrOptions === 'string') {
      repoDir = repoDirOrOptions;
      ref = refArg || 'main';
      targetSha = targetShaArg;
      authToken = authTokenArg;
    } else {
      repoDir = repoDirOrOptions.repoDir;
      ref = repoDirOrOptions.ref;
      targetSha = repoDirOrOptions.targetSha;
      authToken = repoDirOrOptions.authToken;
    }

    await this.cleanStaleLocks(repoDir);
    const safeRef = sanitizeGitRef(ref || 'main');

    await this.runGit(['fetch', '--depth', '1', 'origin', safeRef], repoDir, authToken);

    if (targetSha) {
      const safeSha = sanitizeGitRef(targetSha);
      await this.runGit(['reset', '--hard', safeSha], repoDir);
    } else {
      await this.runGit(['reset', '--hard', 'FETCH_HEAD'], repoDir);
    }

    return await this.getHeadSha(repoDir);
  }

  /**
   * Synchronize repository:
   * - If missing: clone --depth 1 into a temp dir and atomically rename into place.
   * - If present: git fetch --depth 1 and git reset --hard.
   * - Clean stale index.lock files.
   * - Retry up to 3 times with backoff.
   */
  async syncRepoWithRetry(params: {
    gitUrl: string;
    ref: string;
    targetDir: string;
    updatePolicy?: 'auto' | 'pinned' | 'follow-latest';
    pinnedCommitSha?: string;
    authToken?: string;
    onProgress?: (percent: number, message: string) => void;
    maxRetries?: number;
    initialBackoffMs?: number;
  }): Promise<string> {
    const maxRetries = params.maxRetries ?? 3;
    const initialBackoffMs = params.initialBackoffMs ?? 500;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check if repo already exists and has a valid .git folder
        let hasGit = false;
        try {
          const stat = await fs.stat(path.join(params.targetDir, '.git'));
          hasGit = stat.isDirectory() || stat.isFile();
        } catch {
          hasGit = false;
        }

        if (!hasGit) {
          // Missing: clone --depth 1 into a temp dir and atomically rename into place
          return await this.cloneToTempAndAtomicRename(
            params.gitUrl,
            params.ref,
            params.targetDir,
            params.authToken,
            params.onProgress
          );
        } else {
          // Present: clean stale index.lock and fetch + reset --hard
          await this.cleanStaleLocks(params.targetDir);
          const targetSha = params.updatePolicy === 'pinned' ? params.pinnedCommitSha : undefined;
          return await this.fetchAndResetHard(params.targetDir, params.ref, targetSha, params.authToken);
        }
      } catch (err: unknown) {
        lastError = err as Error;

        // Clean stale locks in case a process was killed midway
        try {
          await this.cleanStaleLocks(params.targetDir);
        } catch {
          // ignore
        }

        // If corrupted repo, try removing corrupt targetDir so next retry does clean clone
        if (
          lastError.message.includes('not a git repository') ||
          lastError.message.includes('corrupt') ||
          lastError.message.includes('bad object')
        ) {
          try {
            await fs.rm(params.targetDir, { recursive: true, force: true });
          } catch {
            // ignore
          }
        }

        if (attempt < maxRetries) {
          const delay = initialBackoffMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`Failed to sync repository after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
  }
}

export const knowledgeRepoGitService = new KnowledgeRepoGitService();
