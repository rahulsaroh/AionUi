/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import fs from 'fs/promises';
import { app } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  KnowledgeRepo,
  KnowledgeRepoSyncStatus,
  EffectiveInstructionResult,
  TeammateCapabilityCard,
  KnowledgeAssignment,
  KnowledgeRepoProgress,
  WorkspaceKnowledgeManifest,
  WorkspaceKnowledgeRepoEntry,
} from '@/common/types/knowledgeRepo';
import { detectCloudSyncPath, type CloudSyncDetection } from '@/common/utils/cloudSyncDetector';
import { getUserDataDir } from '@/common/platform/userDataPath';
import { knowledgeRepoGitService } from './knowledgeRepoGitService';
import { knowledgeRepoScanner } from './knowledgeRepoScanner';
import { knowledgeRepoDiffGenerator } from './knowledgeRepoDiffGenerator';
import { knowledgeRepoPromptBuilder } from './knowledgeRepoPromptBuilder';
import { secureCredentialStore } from './secureCredentialStore';
import { registerKnowledgeReadOnlyRoot } from '../org/pathGuard';

const execFileAsync = promisify(execFile);
const MIN_INTERVAL_MS = 15 * 60 * 1000; // 15 mins minimum
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours default

export class KnowledgeRepoService {
  private repos: Map<string, KnowledgeRepo> = new Map();
  private authTokens: Map<string, string> = new Map(); // Encrypted / session tokens
  private repoEnvVars: Map<string, Record<string, string>> = new Map(); // Encrypted per-repo env vars
  private assignments: Map<string, KnowledgeAssignment> = new Map(); // memberKey -> { repoIds, whenToUseHint }
  private conversationInjectedShas: Map<string, Record<string, string>> = new Map(); // conversationId -> repoId: sha
  private activeAgentsRunning: Set<string> = new Set(); // repoId -> active task
  private pendingUpdates: Map<string, { newSha: string }> = new Map();
  private syncTimer: NodeJS.Timeout | null = null;
  private intervalMs: number = DEFAULT_INTERVAL_MS;
  private isChecking: boolean = false;
  private defaultCacheDir: string = '';
  private customCacheDir: string | null = null;
  private worktreesDir: string = '';
  private progressListeners: Set<(progress: KnowledgeRepoProgress) => void> = new Set();

  constructor() {
    this.initPaths();
  }

  private initPaths(): void {
    this.defaultCacheDir = this.getDefaultCacheDir();
    this.worktreesDir = this.getWorktreesDir();
    registerKnowledgeReadOnlyRoot(this.defaultCacheDir);
    registerKnowledgeReadOnlyRoot(this.worktreesDir);
  }

  getDefaultCacheDir(): string {
    try {
      return path.join(getUserDataDir(), 'knowledge-repos');
    } catch {
      if (typeof app !== 'undefined' && app?.getPath) {
        return path.join(app.getPath('userData'), 'knowledge-repos');
      }
      return path.join(process.cwd(), '.cache', 'knowledge-repos');
    }
  }

  getWorktreesDir(): string {
    try {
      return path.join(getUserDataDir(), 'knowledge_worktrees');
    } catch {
      if (typeof app !== 'undefined' && app?.getPath) {
        return path.join(app.getPath('userData'), 'knowledge_worktrees');
      }
      return path.join(process.cwd(), '.cache', 'knowledge_worktrees');
    }
  }

  get dataDir(): string {
    return this.getCacheDir();
  }

  set dataDir(val: string) {
    this.customCacheDir = val;
  }

  getCacheDir(): string {
    return this.customCacheDir || this.getDefaultCacheDir();
  }

  async resetCacheDir(): Promise<string> {
    this.customCacheDir = null;
    const defaultDir = this.getDefaultCacheDir();
    await fs.mkdir(defaultDir, { recursive: true });
    for (const repo of this.repos.values()) {
      repo.cachePath = this.getRepoCachePath(repo.id);
    }
    await this.persistState();
    return defaultDir;
  }

  async reload(): Promise<void> {
    this.repos.clear();
    this.authTokens.clear();
    this.repoEnvVars.clear();
    this.assignments.clear();
    await this.loadPersistedState();
  }

  async setCacheDir(newDir: string): Promise<string> {
    const trimmed = (newDir || '').trim();
    if (!trimmed) {
      throw new Error('Cache directory cannot be empty');
    }
    this.customCacheDir = trimmed;
    registerKnowledgeReadOnlyRoot(trimmed);
    await fs.mkdir(trimmed, { recursive: true });
    for (const repo of this.repos.values()) {
      repo.cachePath = this.getRepoCachePath(repo.id);
    }
    await this.persistState();
    return trimmed;
  }

  getRepoCachePath(repoId: string): string {
    return path.join(this.getCacheDir(), repoId);
  }

  isCloudSyncPath(targetPath?: string): CloudSyncDetection {
    const dir = targetPath || this.getCacheDir();
    return detectCloudSyncPath(dir);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.getCacheDir(), { recursive: true });
    await fs.mkdir(this.worktreesDir, { recursive: true });
    await this.loadPersistedState();
    this.startAutoUpdateTimer();
    // On startup: background sync for all registered repos
    void this.syncAllOnStartup();
  }

  async syncAllOnStartup(): Promise<void> {
    for (const repo of this.repos.values()) {
      try {
        await this.syncRepo(repo.id);
      } catch (err) {
        console.error(`[KnowledgeRepo] Startup sync failed for ${repo.name}:`, err);
      }
    }
  }

  setAgentTaskRunning(repoIds: string[], isRunning: boolean): void {
    for (const repoId of repoIds) {
      if (isRunning) {
        this.activeAgentsRunning.add(repoId);
      } else {
        this.activeAgentsRunning.delete(repoId);
        if (this.pendingUpdates.has(repoId)) {
          const update = this.pendingUpdates.get(repoId)!;
          this.pendingUpdates.delete(repoId);
          this.applyDeferredUpdate(repoId, update.newSha).catch((err) => {
            console.error(`[KnowledgeRepo] Failed to apply deferred update for ${repoId}:`, err);
          });
        }
      }
    }
  }

  isAgentTaskRunning(repoId: string): boolean {
    return this.activeAgentsRunning.has(repoId);
  }

  setInterval(intervalMinutes: number): void {
    const ms = Math.max(MIN_INTERVAL_MS, intervalMinutes * 60 * 1000);
    this.intervalMs = ms;
    this.startAutoUpdateTimer();
  }

  startAutoUpdateTimer(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
    this.syncTimer = setInterval(() => {
      this.checkAllRepos().catch((err) => {
        console.error('[KnowledgeRepo] Periodic auto-update error:', err);
      });
    }, this.intervalMs);
  }

  stopAutoUpdateTimer(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  listRepos(): KnowledgeRepo[] {
    return Array.from(this.repos.values());
  }

  getRepo(id: string): KnowledgeRepo | undefined {
    return this.repos.get(id);
  }

  getAssignment(memberKey: string): KnowledgeAssignment | undefined {
    const raw = this.assignments.get(memberKey);
    if (!raw) return undefined;
    const validRepoIds = raw.repoIds.filter((id) => this.repos.has(id));
    return {
      repoIds: validRepoIds,
      whenToUseHint: raw.whenToUseHint,
    };
  }

  async setAssignment(memberKey: string, assignment: KnowledgeAssignment, workspacePath?: string): Promise<void> {
    const validRepoIds = (assignment.repoIds || []).filter((id) => this.repos.has(id));
    this.assignments.set(memberKey, {
      repoIds: validRepoIds,
      whenToUseHint: assignment.whenToUseHint,
    });
    await this.persistState();
    if (workspacePath) {
      await this.saveWorkspaceManifest(workspacePath);
    }
  }

  listAssignments(): Record<string, KnowledgeAssignment> {
    const result: Record<string, KnowledgeAssignment> = {};
    for (const [key, value] of this.assignments.entries()) {
      result[key] = {
        repoIds: value.repoIds.filter((id) => this.repos.has(id)),
        whenToUseHint: value.whenToUseHint,
      };
    }
    return result;
  }

  async removeMemberAssignment(memberKey: string, workspacePath?: string): Promise<void> {
    this.assignments.delete(memberKey);
    await this.persistState();
    if (workspacePath) {
      await this.saveWorkspaceManifest(workspacePath);
    }
  }

  onProgress(listener: (progress: KnowledgeRepoProgress) => void): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  private emitProgress(progress: KnowledgeRepoProgress): void {
    for (const listener of this.progressListeners) {
      try {
        listener(progress);
      } catch (err) {
        console.error('[KnowledgeRepo] Progress listener error:', err);
      }
    }
  }

  /**
   * Add and clone a new knowledge repository in the background.
   * Returns the newly created repository record immediately with syncStatus: 'syncing',
   * allowing the UI to remain fully responsive, display a progress bar with percentage,
   * and allow adding multiple repos concurrently.
   */
  async addRepo(params: {
    name: string;
    gitUrl: string;
    ref?: string;
    subpath?: string;
    authToken?: string;
    workspacePath?: string;
  }): Promise<KnowledgeRepo> {
    const id = `k_repo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const cachePath = this.getRepoCachePath(id);
    const ref = params.ref?.trim() || 'auto';

    let hasAuthToken = false;
    if (params.authToken) {
      this.authTokens.set(id, secureCredentialStore.encrypt(params.authToken, id));
      hasAuthToken = true;
    }

    const initialProgress: KnowledgeRepoProgress = {
      repoId: id,
      phase: 'cloning',
      percent: 0,
      message: 'Starting clone...',
    };

    const repo: KnowledgeRepo = {
      id,
      name: params.name,
      gitUrl: params.gitUrl,
      ref,
      subpath: params.subpath,
      cachePath,
      currentCommitSha: '',
      lastCheckedAt: Date.now(),
      lastUpdatedAt: Date.now(),
      syncStatus: 'syncing',
      updatePolicy: 'auto',
      trustStatus: 'trusted',
      manifest: {
        alwaysOnRules: [],
        onDemandSkills: [],
        setupFiles: [],
        estimatedTokens: 0,
      },
      hasAuthToken,
      progress: initialProgress,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.repos.set(id, repo);
    await this.persistState();

    if (params.workspacePath) {
      await this.saveWorkspaceManifest(params.workspacePath);
    }

    // Start background clone execution without blocking caller
    void this.executeBackgroundClone(id, params);

    return repo;
  }

  /**
   * Sync a single repository according to Requirement 3:
   * - If missing: git clone --depth 1 into a temp dir and atomically rename into place.
   * - If present: git fetch --depth 1 and git reset --hard.
   * - Clean stale index.lock files.
   * - Retry up to 3 times with backoff.
   * - Sets per-repo status to 'ready' (idle) or 'failed' with reason.
   */
  async syncRepo(id: string): Promise<KnowledgeRepo> {
    const repo = this.repos.get(id);
    if (!repo) throw new Error(`Repo not found: ${id}`);

    repo.cachePath = this.getRepoCachePath(id);
    repo.syncStatus = 'syncing';
    repo.syncError = undefined;
    repo.lastCheckedAt = Date.now();

    const initialProgress: KnowledgeRepoProgress = {
      repoId: id,
      phase: 'cloning',
      percent: 5,
      message: 'Connecting and syncing repository...',
    };
    repo.progress = initialProgress;
    this.emitProgress(initialProgress);

    const token = this.getDecryptedToken(id);

    try {
      let targetRef = (repo.ref || '').trim();
      if (!targetRef || targetRef.toLowerCase() === 'auto') {
        targetRef = await knowledgeRepoGitService.resolveDefaultBranch(repo.gitUrl, token);
      }

      const currentCommitSha = await knowledgeRepoGitService.syncRepoWithRetry({
        gitUrl: repo.gitUrl,
        ref: targetRef,
        targetDir: repo.cachePath,
        updatePolicy: repo.updatePolicy === 'pinned' ? 'pinned' : 'follow-latest',
        pinnedCommitSha: repo.pinnedCommitSha,
        authToken: token,
        onProgress: (percent, message) => {
          const liveRepo = this.repos.get(id);
          if (liveRepo) {
            const progress: KnowledgeRepoProgress = {
              repoId: id,
              phase: 'cloning',
              percent,
              message,
            };
            liveRepo.progress = progress;
            this.emitProgress(progress);
          }
        },
      });

      if (!repo.ref || repo.ref.toLowerCase() === 'auto') {
        repo.ref =
          targetRef && targetRef.toLowerCase() !== 'auto'
            ? targetRef
            : await knowledgeRepoGitService.getCurrentBranch(repo.cachePath);
      }

      // Scanning phase
      const scanProgress: KnowledgeRepoProgress = {
        repoId: id,
        phase: 'scanning',
        percent: 96,
        message: 'Scanning repository guidelines & skills...',
      };
      repo.progress = scanProgress;
      this.emitProgress(scanProgress);

      const manifest = await knowledgeRepoScanner.scan(repo.cachePath, repo.subpath);

      if (repo.currentCommitSha && repo.currentCommitSha !== currentCommitSha) {
        repo.previousCommitSha = repo.currentCommitSha;
      }
      repo.manifest = manifest;
      repo.currentCommitSha = currentCommitSha;
      repo.syncStatus = 'ready';
      repo.syncError = undefined;
      repo.lastUpdatedAt = Date.now();

      const completedProgress: KnowledgeRepoProgress = {
        repoId: id,
        phase: 'completed',
        percent: 100,
        message: 'Ready',
      };
      repo.progress = completedProgress;
      await this.persistState();
      this.emitProgress(completedProgress);
    } catch (err: unknown) {
      const errorMsg = (err as Error).message || 'Failed to sync repository';
      repo.syncStatus = 'failed';
      repo.syncError = errorMsg;
      const errorProgress: KnowledgeRepoProgress = {
        repoId: id,
        phase: 'error',
        percent: 0,
        message: errorMsg,
        error: errorMsg,
      };
      repo.progress = errorProgress;
      await this.persistState();
      this.emitProgress(errorProgress);
    }

    return repo;
  }

  private async executeBackgroundClone(
    id: string,
    params?: {
      workspacePath?: string;
    }
  ): Promise<void> {
    await this.syncRepo(id);
    if (params?.workspacePath) {
      await this.saveWorkspaceManifest(params.workspacePath);
    }
  }

  /**
   * Load workspace manifest: knowledge-manifest.json
   */
  async loadWorkspaceManifest(workspacePath: string): Promise<WorkspaceKnowledgeManifest | null> {
    if (!workspacePath) return null;
    const manifestPath = path.join(workspacePath, 'knowledge-manifest.json');
    try {
      const data = await fs.readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(data) as WorkspaceKnowledgeManifest;
      if (parsed && Array.isArray(parsed.repos)) {
        return parsed;
      }
    } catch {
      // Manifest does not exist or unreadable
    }
    return null;
  }

  /**
   * Save workspace manifest: knowledge-manifest.json
   * Writes manifest atomically so cloud sync does not write partial files.
   */
  async saveWorkspaceManifest(workspacePath: string, manifest?: WorkspaceKnowledgeManifest): Promise<void> {
    if (!workspacePath) return;
    await fs.mkdir(workspacePath, { recursive: true });
    const manifestPath = path.join(workspacePath, 'knowledge-manifest.json');

    let toSave: WorkspaceKnowledgeManifest;
    if (manifest) {
      toSave = manifest;
    } else {
      const repoEntries: WorkspaceKnowledgeRepoEntry[] = [];
      for (const repo of this.repos.values()) {
        const teammates = Array.from(this.assignments.entries())
          .filter(([_, assign]) => assign.repoIds.includes(repo.id))
          .map(([memberKey]) => memberKey);

        repoEntries.push({
          id: repo.id,
          name: repo.name,
          url: repo.gitUrl,
          branch: repo.ref,
          updatePolicy: repo.updatePolicy === 'pinned' ? 'pinned' : 'follow-latest',
          followLatest: repo.updatePolicy !== 'pinned',
          pinnedCommit: repo.pinnedCommitSha,
          teammates,
          assignedTeammates: teammates,
          subpath: repo.subpath,
        });
      }
      toSave = {
        version: 1,
        repos: repoEntries,
      };
    }

    const tempFile = path.join(
      workspacePath,
      `.knowledge-manifest.tmp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    );
    await fs.writeFile(tempFile, JSON.stringify(toSave, null, 2), 'utf8');
    await fs.rename(tempFile, manifestPath);
  }

  /**
   * Rebuild or sync cache from workspace manifest on any machine.
   */
  async syncWorkspace(workspacePath: string, options?: { teammateKey?: string }): Promise<KnowledgeRepo[]> {
    const manifest = await this.loadWorkspaceManifest(workspacePath);
    if (!manifest) return [];

    const syncedRepos: KnowledgeRepo[] = [];

    for (const entry of manifest.repos) {
      const teammates = entry.teammates || entry.assignedTeammates || [];
      if (options?.teammateKey && teammates.length > 0 && !teammates.includes(options.teammateKey)) {
        continue;
      }

      let repo = this.repos.get(entry.id);
      if (!repo) {
        repo = {
          id: entry.id,
          name: entry.name || path.basename(entry.url, '.git'),
          gitUrl: entry.url,
          ref: entry.branch || 'main',
          subpath: entry.subpath,
          cachePath: this.getRepoCachePath(entry.id),
          syncStatus: 'syncing',
          updatePolicy: entry.updatePolicy === 'pinned' ? 'pinned' : 'auto',
          pinnedCommitSha: entry.pinnedCommit,
          trustStatus: 'trusted',
          manifest: {
            alwaysOnRules: [],
            onDemandSkills: [],
            setupFiles: [],
            estimatedTokens: 0,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        this.repos.set(entry.id, repo);
      } else {
        repo.cachePath = this.getRepoCachePath(entry.id);
        repo.ref = entry.branch || repo.ref || 'main';
        if (entry.updatePolicy === 'pinned') {
          repo.updatePolicy = 'pinned';
          repo.pinnedCommitSha = entry.pinnedCommit;
        } else if (entry.updatePolicy === 'follow-latest') {
          repo.updatePolicy = 'auto';
        }
      }

      if (entry.teammates && entry.teammates.length > 0) {
        for (const tm of entry.teammates) {
          const current = this.assignments.get(tm);
          const repoIds = Array.from(new Set([...(current?.repoIds || []), entry.id]));
          this.assignments.set(tm, {
            repoIds,
            whenToUseHint: entry.whenToUseHint || current?.whenToUseHint,
          });
        }
      }

      const synced = await this.syncRepo(entry.id);
      syncedRepos.push(synced);
    }

    await this.persistState();
    return syncedRepos;
  }

  /**
   * On teammate load, sync each repo assigned to that teammate:
   * Rebuilds from manifest if workspacePath provided, then syncs each assigned repo.
   */
  async syncTeammate(memberKey: string, workspacePath?: string): Promise<KnowledgeRepo[]> {
    if (workspacePath) {
      await this.syncWorkspace(workspacePath, { teammateKey: memberKey });
    }

    const assignment = this.getAssignment(memberKey);
    if (!assignment || assignment.repoIds.length === 0) {
      return [];
    }

    const results: KnowledgeRepo[] = [];
    for (const repoId of assignment.repoIds) {
      try {
        const synced = await this.syncRepo(repoId);
        results.push(synced);
      } catch (err) {
        console.error(`[KnowledgeRepo] Teammate sync error for repo ${repoId}:`, err);
        const existing = this.repos.get(repoId);
        if (existing) results.push(existing);
      }
    }

    return results;
  }

  /**
   * Provision or get a project-isolated working copy for an agent (via git worktree),
   * ensuring the shared cached repo remains read-only and unpolluted by agent outputs.
   */
  async provisionWorkingCopy(repoId: string, projectId: string): Promise<string> {
    const repo = this.repos.get(repoId);
    if (!repo) throw new Error(`Repo not found: ${repoId}`);

    const safeProjectId = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const worktreeDir = path.join(this.worktreesDir, `${repoId}_${safeProjectId}`);

    try {
      const stat = await fs.stat(worktreeDir);
      if (stat.isDirectory()) {
        try {
          const currentSha = await knowledgeRepoGitService.getHeadSha(worktreeDir);
          if (currentSha === repo.currentCommitSha) {
            return worktreeDir;
          }
        } catch {
          // Re-create worktree on commit mismatch or stat error
        }
      }
    } catch {
      // Create worktree
    }

    try {
      await knowledgeRepoGitService.createWorktree(repo.cachePath, worktreeDir, repo.currentCommitSha);
    } catch {
      await fs.mkdir(worktreeDir, { recursive: true });
    }
    return worktreeDir;
  }

  /**
   * Enforces security policy on script, setup, and tool execution in a repository worktree.
   * Blocks silently running newly added/modified scripts while trustStatus is 'reapproval_required'.
   */
  assertRepoExecutionAllowed(repoId: string, commandOrScriptPath?: string): void {
    const repo = this.repos.get(repoId);
    if (!repo) throw new Error(`Repo not found: ${repoId}`);

    if (repo.trustStatus === 'reapproval_required') {
      throw new Error(
        `SECURITY_ERROR: Execution blocked for ${repo.name}! Repository has changed and requires re-approval before running scripts or tools (${commandOrScriptPath || 'action'}).`
      );
    }
    if (repo.trustStatus === 'untrusted') {
      throw new Error(
        `SECURITY_ERROR: Repository ${repo.name} is untrusted. Please approve before executing tools or scripts.`
      );
    }
  }

  /**
   * Run setup command with strict re-approval enforcement in main process.
   */
  async runSetup(params: {
    repoId: string;
    projectId?: string;
    command: string;
    onOutput?: (chunk: string) => void;
  }): Promise<{ success: boolean; output: string }> {
    const repo = this.repos.get(params.repoId);
    if (!repo) throw new Error(`Repo not found: ${params.repoId}`);

    this.assertRepoExecutionAllowed(params.repoId, params.command);

    const workingDir = params.projectId
      ? await this.provisionWorkingCopy(params.repoId, params.projectId)
      : repo.cachePath;

    // Resolve environment variables securely
    const envVars = this.getDecryptedEnvVars(params.repoId);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...envVars,
    };

    try {
      const parts = params.command.split(/\s+/).filter(Boolean);
      const cmd = parts[0];
      const args = parts.slice(1);
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd: workingDir,
        env,
        timeout: 300_000,
      });

      const output = `${stdout}\n${stderr}`.trim();
      params.onOutput?.(output);
      return { success: true, output };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, output: error.message };
    }
  }

  /**
   * Lightweight environment check: check presence of required binaries.
   */
  async checkEnvironment(repoId: string): Promise<Array<{ binary: string; present: boolean }>> {
    const repo = this.repos.get(repoId);
    if (!repo) throw new Error(`Repo not found: ${repoId}`);

    const binaries = new Set<string>();
    for (const sf of repo.manifest.setupFiles) {
      if (sf.requiredBinaries) {
        for (const b of sf.requiredBinaries) binaries.add(b);
      }
    }

    const results: Array<{ binary: string; present: boolean }> = [];
    for (const bin of binaries) {
      try {
        const checkCmd = process.platform === 'win32' ? 'where' : 'which';
        await execFileAsync(checkCmd, [bin]);
        results.push({ binary: bin, present: true });
      } catch {
        results.push({ binary: bin, present: false });
      }
    }
    return results;
  }

  /**
   * Update repository now.
   */
  async updateRepo(id: string): Promise<KnowledgeRepo> {
    const repo = this.repos.get(id);
    if (!repo) throw new Error(`Repo not found: ${id}`);

    if (repo.updatePolicy === 'pinned') {
      const token = this.getDecryptedToken(id);
      try {
        const remoteSha = await knowledgeRepoGitService.getRemoteRefSha(repo.gitUrl, repo.ref, token);
        repo.lastCheckedAt = Date.now();
        if (remoteSha !== repo.currentCommitSha) {
          repo.syncStatus = 'needs_attention';
          repo.syncError = `Update available: ${remoteSha.slice(0, 7)} (Repo is pinned)`;
        } else {
          repo.syncStatus = 'idle';
          repo.syncError = undefined;
        }
      } catch (err: unknown) {
        repo.syncStatus = 'error';
        repo.syncError = (err as Error).message;
      }
      await this.persistState();
      return repo;
    }

    repo.syncStatus = 'syncing';
    repo.lastCheckedAt = Date.now();
    const token = this.getDecryptedToken(id);

    try {
      if (this.isAgentTaskRunning(id)) {
        const remoteSha = await knowledgeRepoGitService.getRemoteRefSha(repo.gitUrl, repo.ref, token);
        if (remoteSha !== repo.currentCommitSha) {
          this.pendingUpdates.set(id, { newSha: remoteSha });
          repo.syncStatus = 'idle';
          repo.syncError = undefined;
          await this.persistState();
          return repo;
        }
      }

      const { oldSha, newSha } = await knowledgeRepoGitService.updateFastForward(repo.cachePath, repo.ref, token);

      if (oldSha !== newSha) {
        const commitMessages = await knowledgeRepoGitService.getCommitLog(repo.cachePath, oldSha, newSha);
        const newManifest = await knowledgeRepoScanner.scan(repo.cachePath, repo.subpath);
        const whatChanged = knowledgeRepoDiffGenerator.generateWhatChanged(repo, newSha, commitMessages, newManifest);

        repo.previousCommitSha = oldSha;
        repo.currentCommitSha = newSha;
        repo.lastUpdatedAt = Date.now();
        repo.manifest = newManifest;
        repo.whatChangedSummary = whatChanged;

        if (whatChanged.requiresReapproval) {
          repo.trustStatus = 'reapproval_required';
        }
      }

      repo.syncStatus = 'idle';
      repo.syncError = undefined;
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('NOT_FAST_FORWARD') || error.message.includes('rewritten')) {
        repo.syncStatus = 'needs_attention';
        repo.syncError = 'Remote history was force-pushed or diverged. Keeping cached version.';
      } else {
        repo.syncStatus = 'error';
        repo.syncError = error.message;
      }
    }

    await this.persistState();
    return repo;
  }

  private async applyDeferredUpdate(id: string, _targetSha: string): Promise<void> {
    const repo = this.repos.get(id);
    if (!repo) return;
    const token = this.getDecryptedToken(id);
    const { oldSha, newSha } = await knowledgeRepoGitService.updateFastForward(repo.cachePath, repo.ref, token);
    if (oldSha !== newSha) {
      const commitMessages = await knowledgeRepoGitService.getCommitLog(repo.cachePath, oldSha, newSha);
      const newManifest = await knowledgeRepoScanner.scan(repo.cachePath, repo.subpath);
      const whatChanged = knowledgeRepoDiffGenerator.generateWhatChanged(repo, newSha, commitMessages, newManifest);

      repo.previousCommitSha = oldSha;
      repo.currentCommitSha = newSha;
      repo.lastUpdatedAt = Date.now();
      repo.manifest = newManifest;
      repo.whatChangedSummary = whatChanged;

      if (whatChanged.requiresReapproval) {
        repo.trustStatus = 'reapproval_required';
      }
    }
    await this.persistState();
  }

  async rollbackRepo(id: string): Promise<KnowledgeRepo> {
    const repo = this.repos.get(id);
    if (!repo) throw new Error(`Repo not found: ${id}`);
    if (!repo.previousCommitSha) throw new Error('No previous commit SHA available for rollback');

    const targetSha = repo.previousCommitSha;
    await knowledgeRepoGitService.rollback(repo.cachePath, targetSha);

    const oldSha = repo.currentCommitSha;
    repo.currentCommitSha = targetSha;
    repo.previousCommitSha = oldSha;
    repo.manifest = await knowledgeRepoScanner.scan(repo.cachePath, repo.subpath);
    repo.syncStatus = 'idle';
    repo.syncError = undefined;
    repo.lastUpdatedAt = Date.now();

    await this.persistState();
    return repo;
  }

  async pinRepo(id: string, pin: boolean): Promise<KnowledgeRepo> {
    const repo = this.repos.get(id);
    if (!repo) throw new Error(`Repo not found: ${id}`);

    repo.updatePolicy = pin ? 'pinned' : 'auto';
    repo.pinnedCommitSha = pin ? repo.currentCommitSha : undefined;
    if (!pin && repo.syncStatus === 'needs_attention') {
      repo.syncStatus = 'idle';
      repo.syncError = undefined;
    }

    await this.persistState();
    return repo;
  }

  async setTrustStatus(id: string, trustStatus: KnowledgeRepo['trustStatus']): Promise<KnowledgeRepo> {
    const repo = this.repos.get(id);
    if (!repo) throw new Error(`Repo not found: ${id}`);
    repo.trustStatus = trustStatus;
    await this.persistState();
    return repo;
  }

  async setRepoEnvVars(id: string, envVars: Record<string, string>): Promise<void> {
    const encryptedMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(envVars)) {
      if (v) {
        encryptedMap[k] = secureCredentialStore.encrypt(v, `${id}_env_${k}`);
      }
    }
    this.repoEnvVars.set(id, encryptedMap);
    await this.persistState();
  }

  getDecryptedEnvVars(id: string): Record<string, string> {
    const enc = this.repoEnvVars.get(id);
    if (!enc) return {};
    const decrypted: Record<string, string> = {};
    for (const [k, v] of Object.entries(enc)) {
      decrypted[k] = secureCredentialStore.decrypt(v);
    }
    return decrypted;
  }

  async removeRepo(id: string, workspacePath?: string): Promise<void> {
    const repo = this.repos.get(id);
    if (!repo) return;
    this.repos.delete(id);
    this.authTokens.delete(id);
    this.repoEnvVars.delete(id);

    // Clean up dangling repo from member assignments
    for (const [key, assign] of this.assignments.entries()) {
      if (assign.repoIds.includes(id)) {
        assign.repoIds = assign.repoIds.filter((rId) => rId !== id);
        this.assignments.set(key, assign);
      }
    }

    try {
      await fs.rm(repo.cachePath, { recursive: true, force: true });
    } catch {
      // Ignore directory removal failure
    }
    await this.persistState();

    if (workspacePath) {
      await this.saveWorkspaceManifest(workspacePath);
    }
  }

  async checkAllRepos(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;
    try {
      for (const repo of this.repos.values()) {
        try {
          await this.updateRepo(repo.id);
        } catch (err) {
          console.error(`[KnowledgeRepo] Update failed for ${repo.name}:`, err);
        }
      }
    } finally {
      this.isChecking = false;
    }
  }

  async buildEffectiveInstructions(params: {
    conversationId?: string;
    memberKey?: string;
    memberName: string;
    rolePrompt?: string;
    repoIds: string[];
    whenToUseHint?: string;
    tokenBudget?: number;
    forceFullPlaybook?: boolean;
  }): Promise<EffectiveInstructionResult> {
    const trustedRepos = params.repoIds
      .map((id) => this.repos.get(id))
      .filter((r): r is KnowledgeRepo => Boolean(r && r.manifest && r.trustStatus === 'trusted'));

    if (trustedRepos.length === 0) {
      return {
        instructions: '',
        estimatedTokens: 0,
        budgetExceeded: false,
        budgetLimitTokens: params.tokenBudget || 8000,
        conflicts: [],
      };
    }

    const convId = params.conversationId;
    let isReminder = false;

    if (convId && !params.forceFullPlaybook) {
      const recorded = this.conversationInjectedShas.get(convId);
      if (recorded) {
        const recordedKeys = Object.keys(recorded);
        const allMatch =
          recordedKeys.length === trustedRepos.length &&
          trustedRepos.every((repo) => repo.currentCommitSha && recorded[repo.id] === repo.currentCommitSha);
        if (allMatch) {
          isReminder = true;
        }
      }
    }

    // Provision project/member isolated read-only working copy for every trusted repository
    const workingCopyPaths: Record<string, string> = {};
    const contextKey = params.memberKey || convId || 'default';
    for (const repo of trustedRepos) {
      try {
        workingCopyPaths[repo.id] = await this.provisionWorkingCopy(repo.id, contextKey);
      } catch {
        workingCopyPaths[repo.id] = repo.cachePath;
      }
    }

    const result = knowledgeRepoPromptBuilder.buildInstructions({
      memberName: params.memberName,
      rolePrompt: params.rolePrompt,
      repos: trustedRepos,
      whenToUseHint: params.whenToUseHint,
      tokenBudget: params.tokenBudget,
      workingCopyPaths,
      isReminder,
    });

    if (convId && !isReminder) {
      const shas: Record<string, string> = {};
      for (const repo of trustedRepos) {
        if (repo.currentCommitSha) {
          shas[repo.id] = repo.currentCommitSha;
        }
      }
      this.conversationInjectedShas.set(convId, shas);
    }

    return result;
  }

  buildEffectiveInstructionsSync(params: {
    memberName: string;
    rolePrompt?: string;
    repoIds: string[];
    whenToUseHint?: string;
    tokenBudget?: number;
    workingCopyPaths?: Record<string, string>;
    isReminder?: boolean;
  }): EffectiveInstructionResult {
    const trustedRepos = params.repoIds
      .map((id) => this.repos.get(id))
      .filter((r): r is KnowledgeRepo => Boolean(r && r.manifest && r.trustStatus === 'trusted'));

    return knowledgeRepoPromptBuilder.buildInstructions({
      memberName: params.memberName,
      rolePrompt: params.rolePrompt,
      repos: trustedRepos,
      whenToUseHint: params.whenToUseHint,
      tokenBudget: params.tokenBudget,
      workingCopyPaths: params.workingCopyPaths,
      isReminder: params.isReminder,
    });
  }

  buildTeamCapabilityCards(
    teamMembers: Array<{
      slot_id: string;
      assistant_name: string;
      knowledgeRepoIds?: string[];
      whenToUseHint?: string;
    }>
  ): TeammateCapabilityCard[] {
    return teamMembers.map((member) => {
      const repos = (member.knowledgeRepoIds || [])
        .map((id) => this.repos.get(id))
        .filter((r): r is KnowledgeRepo => Boolean(r && r.trustStatus === 'trusted'));

      return knowledgeRepoPromptBuilder.buildCapabilityCard({
        memberSlotId: member.slot_id,
        memberName: member.assistant_name,
        repos,
        whenToUseHint: member.whenToUseHint,
      });
    });
  }

  private getDecryptedToken(id: string): string | undefined {
    const enc = this.authTokens.get(id);
    if (!enc) return undefined;
    return secureCredentialStore.decrypt(enc);
  }

  private async loadPersistedState(): Promise<void> {
    const defaultDir = this.getDefaultCacheDir();
    const candidateDirs: string[] = [];
    if (this.customCacheDir) {
      candidateDirs.push(this.customCacheDir);
    } else {
      candidateDirs.push(defaultDir);
      try {
        candidateDirs.push(path.join(getUserDataDir(), 'knowledge_repos'));
      } catch {
        // ignore
      }
      if (typeof app !== 'undefined' && app.getPath) {
        candidateDirs.push(path.join(app.getPath('userData'), 'knowledge_repos'));
      } else {
        candidateDirs.push(path.join(process.cwd(), '.cache', 'knowledge_repos'));
      }
    }

    for (const dir of candidateDirs) {
      const stateFile = path.join(dir, 'repos.json');
      try {
        const data = await fs.readFile(stateFile, 'utf8');
        const parsed = JSON.parse(data) as {
          cacheDir?: string | null;
          repos: KnowledgeRepo[];
          tokens: Record<string, string>;
          envVars: Record<string, Record<string, string>>;
          assignments?: Record<string, KnowledgeAssignment>;
        };
        if (parsed.cacheDir && parsed.cacheDir !== defaultDir) {
          this.customCacheDir = parsed.cacheDir;
          registerKnowledgeReadOnlyRoot(parsed.cacheDir);
        }
        if (Array.isArray(parsed.repos)) {
          for (const r of parsed.repos) {
            r.cachePath = this.getRepoCachePath(r.id);
            this.repos.set(r.id, r);
          }
        }
        if (parsed.tokens) {
          for (const [k, v] of Object.entries(parsed.tokens)) {
            this.authTokens.set(k, v);
          }
        }
        if (parsed.envVars) {
          for (const [k, v] of Object.entries(parsed.envVars)) {
            this.repoEnvVars.set(k, v);
          }
        }
        if (parsed.assignments) {
          for (const [k, v] of Object.entries(parsed.assignments)) {
            this.assignments.set(k, v);
          }
        }
        break; // Loaded successfully
      } catch {
        // Try next candidate
      }
    }
  }

  private async persistState(): Promise<void> {
    const cacheDir = this.getCacheDir();
    await fs.mkdir(cacheDir, { recursive: true });
    const stateFile = path.join(cacheDir, 'repos.json');
    const tokensObj: Record<string, string> = {};
    for (const [k, v] of this.authTokens.entries()) {
      tokensObj[k] = v;
    }
    const envVarsObj: Record<string, Record<string, string>> = {};
    for (const [k, v] of this.repoEnvVars.entries()) {
      envVarsObj[k] = v;
    }
    const assignmentsObj: Record<string, KnowledgeAssignment> = {};
    for (const [k, v] of this.assignments.entries()) {
      assignmentsObj[k] = v;
    }
    const payload = {
      cacheDir: this.customCacheDir,
      repos: Array.from(this.repos.values()),
      tokens: tokensObj,
      envVars: envVarsObj,
      assignments: assignmentsObj,
    };
    await fs.writeFile(stateFile, JSON.stringify(payload, null, 2), 'utf8');
  }
}

export const knowledgeRepoService = new KnowledgeRepoService();
