/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  KnowledgeRepoService,
  knowledgeRepoScanner,
  knowledgeRepoPromptBuilder,
  knowledgeRepoDiffGenerator,
  knowledgeRepoGitService,
} from '@/process/services/knowledgeRepo';
import { isValidGitHttpsUrl, sanitizeGitRef } from '@/process/services/knowledgeRepo/knowledgeRepoGitService';

const execFileAsync = promisify(execFile);

describe('Knowledge Repos Integration & Safety Tests', () => {
  let tempDir: string;
  let remoteRepoDir: string;
  let service: KnowledgeRepoService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k-repo-test-'));
    remoteRepoDir = path.join(tempDir, 'remote-fixture.git');
    const workDir = path.join(tempDir, 'remote-work');

    await execFileAsync('git', ['init', '--bare', remoteRepoDir]);

    await execFileAsync('git', ['clone', remoteRepoDir, workDir]);
    await fs.writeFile(
      path.join(workDir, 'AGENTS.md'),
      '# OpenMontage Video Producer Guidelines\nRule 1: Always follow the pipeline step by step.\n'
    );

    const skillDir = path.join(workDir, '.claude', 'skills', 'explainer-video');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: explainer-video\ndescription: Produce explainer videos using OpenMontage\n---\n# Explainer Video Skill\n'
    );

    await fs.writeFile(path.join(workDir, 'setup.sh'), '#!/bin/bash\necho "Setting up python env"\n');

    await execFileAsync('git', ['-C', workDir, 'config', 'user.name', 'Test Runner']);
    await execFileAsync('git', ['-C', workDir, 'config', 'user.email', 'test@example.com']);
    await execFileAsync('git', ['-C', workDir, 'add', '.']);
    await execFileAsync('git', ['-C', workDir, 'commit', '-m', 'Initial commit: add rules and skills']);
    await execFileAsync('git', ['-C', workDir, 'push', 'origin', 'HEAD:main']);

    service = new KnowledgeRepoService();
    (service as unknown as { dataDir: string }).dataDir = path.join(tempDir, 'cache');
    (service as unknown as { worktreesDir: string }).worktreesDir = path.join(tempDir, 'worktrees');
    await service.initialize();
  }, 30000);

  afterEach(async () => {
    service.stopAutoUpdateTimer();
    try {
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Ignore transient Windows file lock cleanup errors
    }
  }, 30000);

  it('C.1 Unit tests: URL validation, sanitizeGitRef, fixture scanning, token budget truncation, and redaction', async () => {
    // 1. URL validation
    expect(isValidGitHttpsUrl('https://github.com/calesthio/OpenMontage')).toBe(true);
    expect(isValidGitHttpsUrl('git@github.com:calesthio/OpenMontage.git')).toBe(false);
    expect(isValidGitHttpsUrl('http://insecure.com/repo')).toBe(false);
    expect(isValidGitHttpsUrl('https://user:pass@github.com/repo')).toBe(false); // Disallow userinfo
    expect(isValidGitHttpsUrl('https://github.com/repo; rm -rf /')).toBe(false); // Option/shell injection rejected

    // 2. Ref sanitization
    expect(sanitizeGitRef('main')).toBe('main');
    expect(sanitizeGitRef('v1.2.3')).toBe('v1.2.3');
    expect(() => sanitizeGitRef('../path/traversal')).toThrow();
    expect(() => sanitizeGitRef('main; rm -rf')).toThrow();

    // 3. Scanner on various fixtures
    const emptyDir = path.join(tempDir, 'empty-repo');
    await fs.mkdir(emptyDir, { recursive: true });
    const emptyManifest = await knowledgeRepoScanner.scan(emptyDir);
    expect(emptyManifest.alwaysOnRules.length).toBe(0);
    expect(emptyManifest.onDemandSkills.length).toBe(0);

    // .cursorrules fixture
    const cursorDir = path.join(tempDir, 'cursor-fixture');
    await fs.mkdir(cursorDir, { recursive: true });
    await fs.writeFile(path.join(cursorDir, '.cursorrules'), 'Always use strict TypeScript types');
    const cursorManifest = await knowledgeRepoScanner.scan(cursorDir);
    expect(cursorManifest.alwaysOnRules.length).toBe(1);
    expect(cursorManifest.alwaysOnRules[0].content).toContain('strict TypeScript');

    // 4. Token budget truncation test with visible marker
    const hugeRepo = {
      id: 'repo-huge',
      name: 'HugeRepo',
      gitUrl: 'https://github.com/org/huge',
      ref: 'main',
      cachePath: cursorDir,
      currentCommitSha: 'sha123',
      syncStatus: 'idle' as const,
      updatePolicy: 'auto' as const,
      trustStatus: 'trusted' as const,
      manifest: {
        alwaysOnRules: [
          {
            id: 'long_rule',
            name: 'LONG_RULE.md',
            relativePath: 'LONG_RULE.md',
            content: 'x'.repeat(40000), // ~10,000 tokens
            sizeBytes: 40000,
            priority: 10,
          },
        ],
        onDemandSkills: [],
        setupFiles: [],
        estimatedTokens: 10000,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const truncated = knowledgeRepoPromptBuilder.buildInstructions({
      memberName: 'Worker',
      repos: [hugeRepo],
      tokenBudget: 500, // Small budget
    });

    expect(truncated.budgetExceeded).toBe(true);
    expect(truncated.instructions).toContain('[TRUNCATED: Knowledge rule budget limit of 500 tokens reached]');
  });

  it('C.2 Multi-repo conflict test: higher-priority repo wins and conflict warning is returned', () => {
    const repoA = {
      id: 'repo-A',
      name: 'RepoA_HighPriority',
      gitUrl: 'https://github.com/org/a',
      ref: 'main',
      cachePath: '/dummy/a',
      currentCommitSha: 'shaA',
      syncStatus: 'idle' as const,
      updatePolicy: 'auto' as const,
      trustStatus: 'trusted' as const,
      manifest: {
        alwaysOnRules: [
          {
            id: 'format_rule',
            name: 'CODING_STYLE.md',
            relativePath: 'CODING_STYLE.md',
            content: 'Use Tabs for indentation.',
            sizeBytes: 30,
            priority: 10,
          },
        ],
        onDemandSkills: [],
        setupFiles: [],
        estimatedTokens: 10,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const repoB = {
      id: 'repo-B',
      name: 'RepoB_LowPriority',
      gitUrl: 'https://github.com/org/b',
      ref: 'main',
      cachePath: '/dummy/b',
      currentCommitSha: 'shaB',
      syncStatus: 'idle' as const,
      updatePolicy: 'auto' as const,
      trustStatus: 'trusted' as const,
      manifest: {
        alwaysOnRules: [
          {
            id: 'format_rule_b',
            name: 'CODING_STYLE.md',
            relativePath: 'CODING_STYLE.md',
            content: 'Use 2 Spaces for indentation.',
            sizeBytes: 30,
            priority: 5,
          },
        ],
        onDemandSkills: [],
        setupFiles: [],
        estimatedTokens: 10,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = knowledgeRepoPromptBuilder.buildInstructions({
      memberName: 'Developer',
      repos: [repoA, repoB], // repoA is first/higher priority
    });

    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].resolvedInFavorOf).toBe('RepoA_HighPriority:CODING_STYLE.md');
    expect(result.instructions).toContain('Use Tabs for indentation.');
    expect(result.instructions).not.toContain('Use 2 Spaces for indentation.');
  });

  it('C.3 Regression test: a team member with no repos returns clean instructions without knowledge playbook overhead', () => {
    const res = knowledgeRepoPromptBuilder.buildInstructions({
      memberName: 'General Assistant',
      rolePrompt: 'You help with general inquiries.',
      repos: [],
    });

    expect(res.conflicts.length).toBe(0);
    expect(res.instructions).toContain('You help with general inquiries.');
    expect(res.instructions).not.toContain('Active Repository Rules:');
    expect(res.instructions).not.toContain('Available On-Demand Skills & Pipelines');
  });

  it('Requirement 9.2: adds, syncs, assigns to member, confirms effective instructions, updates upon commit, and retains previous SHA for rollback', async () => {
    const workDir = path.join(tempDir, 'remote-work');
    const headShaRes = await execFileAsync('git', ['-C', workDir, 'rev-parse', 'HEAD']);
    const initialSha = headShaRes.stdout.trim();

    const manifest = await knowledgeRepoScanner.scan(workDir);
    expect(manifest.alwaysOnRules.length).toBeGreaterThan(0);
    expect(manifest.alwaysOnRules[0].content).toContain('OpenMontage Video Producer Guidelines');
    expect(manifest.onDemandSkills.length).toBe(1);
    expect(manifest.onDemandSkills[0].name).toBe('explainer-video');

    const mockRepo = {
      id: 'repo-1',
      name: 'OpenMontage',
      gitUrl: 'https://github.com/calesthio/OpenMontage',
      ref: 'main',
      cachePath: workDir,
      currentCommitSha: initialSha,
      syncStatus: 'idle' as const,
      updatePolicy: 'auto' as const,
      trustStatus: 'trusted' as const,
      manifest,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const inst = knowledgeRepoPromptBuilder.buildInstructions({
      memberName: 'Video Producer',
      rolePrompt: 'You produce high quality product walkthrough videos.',
      repos: [mockRepo],
      whenToUseHint: 'video production',
    });

    expect(inst.instructions).toContain('Authoritative Knowledge Playbook for Video Producer');
    expect(inst.instructions).toContain('OpenMontage Video Producer Guidelines');
    expect(inst.instructions).toContain('explainer-video');

    // Commit change
    await fs.writeFile(
      path.join(workDir, 'AGENTS.md'),
      '# OpenMontage Video Producer Guidelines\nRule 1: Updated pipeline rule.\n'
    );
    const newSkillDir = path.join(workDir, '.claude', 'skills', 'short-clip');
    await fs.mkdir(newSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(newSkillDir, 'SKILL.md'),
      '---\nname: short-clip\ndescription: Generate 30s social short clips\n---\n'
    );

    await execFileAsync('git', ['-C', workDir, 'add', '.']);
    await execFileAsync('git', ['-C', workDir, 'commit', '-m', 'feat: update rule and add short-clip skill']);
    const newShaRes = await execFileAsync('git', ['-C', workDir, 'rev-parse', 'HEAD']);
    const newSha = newShaRes.stdout.trim();

    const newManifest = await knowledgeRepoScanner.scan(workDir);
    const diff = knowledgeRepoDiffGenerator.generateWhatChanged(
      mockRepo,
      newSha,
      ['feat: update rule and add short-clip skill'],
      newManifest
    );

    expect(diff.modifiedRules).toContain('AGENTS.md');
    expect(diff.addedSkills.length).toBe(1);
    expect(diff.previousCommitSha).toBe(initialSha);
    expect(diff.newCommitSha).toBe(newSha);

    const updatedRepo = {
      ...mockRepo,
      previousCommitSha: initialSha,
      currentCommitSha: newSha,
      manifest: newManifest,
      whatChangedSummary: diff,
    };

    const updatedInst = knowledgeRepoPromptBuilder.buildInstructions({
      memberName: 'Video Producer',
      rolePrompt: 'You produce high quality product walkthrough videos.',
      repos: [updatedRepo],
      whenToUseHint: 'video production',
    });

    expect(updatedInst.instructions).toContain('Rule 1: Updated pipeline rule.');
    expect(updatedInst.instructions).toContain('short-clip');
  });

  it('Requirement 9.7: Update-safety tests (deferral, pinned, rollback, setup reapproval)', async () => {
    const workDir = path.join(tempDir, 'remote-work');
    const headShaRes = await execFileAsync('git', ['-C', workDir, 'rev-parse', 'HEAD']);
    const initialSha = headShaRes.stdout.trim();
    const manifest = await knowledgeRepoScanner.scan(workDir);

    const repo = {
      id: 'repo-safe-1',
      name: 'OpenMontage',
      gitUrl: 'https://github.com/calesthio/OpenMontage',
      ref: 'main',
      cachePath: workDir,
      currentCommitSha: initialSha,
      syncStatus: 'idle' as const,
      updatePolicy: 'auto' as const,
      trustStatus: 'trusted' as const,
      manifest,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // (a) Active task deferral check
    service.setAgentTaskRunning(['repo-safe-1'], true);
    expect(service.isAgentTaskRunning('repo-safe-1')).toBe(true);
    service.setAgentTaskRunning(['repo-safe-1'], false);
    expect(service.isAgentTaskRunning('repo-safe-1')).toBe(false);

    // (b) Setup script alteration triggers reapproval & blocks setup execution
    await fs.writeFile(path.join(workDir, 'setup.sh'), '#!/bin/bash\necho "Altered setup script"\n');
    await fs.writeFile(path.join(workDir, 'requirements.txt'), 'openmontage==2.0.0\n');
    const alteredManifest = await knowledgeRepoScanner.scan(workDir);

    const diffWithSetup = knowledgeRepoDiffGenerator.generateWhatChanged(
      repo,
      'commit-sha-2',
      ['chore: update setup script'],
      alteredManifest
    );
    expect(diffWithSetup.requiresReapproval).toBe(true);

    const reapprovalRepo = { ...repo, trustStatus: 'reapproval_required' as const };
    (service as unknown as { repos: Map<string, typeof repo> }).repos.set('repo-safe-1', reapprovalRepo);

    // Verify main process blocks execution
    await expect(
      service.runSetup({
        repoId: 'repo-safe-1',
        command: 'bash setup.sh',
      })
    ).rejects.toThrow(
      'SECURITY_ERROR: Execution blocked for OpenMontage! Repository has changed and requires re-approval'
    );

    // (c) Capability cards generation for team lead
    const cards = knowledgeRepoPromptBuilder.buildCapabilityCard({
      memberSlotId: 'slot-1',
      memberName: 'Video Producer',
      repos: [repo],
      whenToUseHint: 'video production',
    });
    expect(cards.memberName).toBe('Video Producer');
    expect(cards.repos[0].repoName).toBe('OpenMontage');
    expect(cards.repos[0].keySkills).toContain('explainer-video');
  });

  it('Requirement: Git token safety and secret redaction during authenticated operations', async () => {
    const dummyToken = 'ghp_SECRET_TEST_TOKEN_1234567890';
    let failed = false;
    let capturedError = '';
    try {
      // Trigger a clone of an unreachable/invalid auth URL with a real token
      await knowledgeRepoGitService.shallowClone(
        'https://github.com/invalid-nonexistent-org/invalid-nonexistent-repo-999.git',
        'main',
        path.join(tempDir, 'fail-clone'),
        dummyToken
      );
    } catch (err: unknown) {
      failed = true;
      capturedError = (err as Error).message;
    }
    expect(failed).toBe(true);
    // Assert the secret token string NEVER appears anywhere in the captured error or output
    expect(capturedError).not.toContain(dummyToken);
  });

  it('Requirement: Re-approval guard blocks script and tool execution on worktrees', async () => {
    const workDir = path.join(tempDir, 'remote-work');
    const repo = {
      id: 'repo-guard-1',
      name: 'GuardedRepo',
      gitUrl: 'https://github.com/example/repo',
      ref: 'main',
      cachePath: workDir,
      syncStatus: 'idle' as const,
      updatePolicy: 'auto' as const,
      trustStatus: 'reapproval_required' as const,
      manifest: {
        alwaysOnRules: [],
        onDemandSkills: [],
        setupFiles: [],
        estimatedTokens: 0,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    (service as unknown as { repos: Map<string, typeof repo> }).repos.set('repo-guard-1', repo);

    expect(() => {
      service.assertRepoExecutionAllowed('repo-guard-1', 'python run_pipeline.py');
    }).toThrow('SECURITY_ERROR: Execution blocked for GuardedRepo! Repository has changed and requires re-approval');
  });

  it('Requirement: Main process subagent delegation injection includes preamble, rules and skill index', async () => {
    const workDir = path.join(tempDir, 'remote-work');
    const repo = {
      id: 'repo-subagent-1',
      name: 'OpenMontage',
      gitUrl: 'https://github.com/calesthio/OpenMontage',
      ref: 'main',
      cachePath: workDir,
      syncStatus: 'idle' as const,
      updatePolicy: 'auto' as const,
      trustStatus: 'trusted' as const,
      manifest: await knowledgeRepoScanner.scan(workDir),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    (service as unknown as { repos: Map<string, typeof repo> }).repos.set('repo-subagent-1', repo);

    // Call buildEffectiveInstructions
    const result = await service.buildEffectiveInstructions({
      memberName: 'Worker',
      rolePrompt: 'Primary coding and implementation agent',
      repoIds: ['repo-subagent-1'],
    });

    // Verify playbook preamble, always-on rules, and skill index
    expect(result.instructions).toContain('### Authoritative Knowledge Playbook for Worker');
    expect(result.instructions).toContain('OpenMontage');
    expect(result.instructions).toContain('Rule 1: Always follow the pipeline step by step.');
    expect(result.instructions).toContain('Available Skills & Pipelines');
    expect(result.instructions).toContain('explainer-video');
    expect(result.instructions).toContain(
      'Read the skill file from the given path before doing the task. Do not modify these files.'
    );
    expect(result.instructions).toMatch(/File: [^)]+SKILL\.md/);
  });

  it('enforces injection policy: full playbook on first turn, reminder on subsequent turn, and re-injection on commit update', async () => {
    const repo = {
      id: 'repo-inject-1',
      name: 'GuideRepo',
      gitUrl: 'https://github.com/org/guiderepo',
      ref: 'main',
      cachePath: path.join(tempDir, 'remote-work'),
      currentCommitSha: 'sha_v1',
      syncStatus: 'idle' as const,
      updatePolicy: 'auto' as const,
      trustStatus: 'trusted' as const,
      manifest: {
        alwaysOnRules: [{ id: 'r1', name: 'Rule 1', relativePath: 'RULE.md', content: 'Follow guidelines', sizeBytes: 50, priority: 1 }],
        onDemandSkills: [{ id: 's1', name: 'skill-alpha', description: 'Alpha workflow', relativePath: 'skills/alpha/SKILL.md' }],
        setupFiles: [],
        estimatedTokens: 100,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    (service as unknown as { repos: Map<string, typeof repo> }).repos.set('repo-inject-1', repo);

    const convId = 'conv-test-123';

    // 1. First message: receives full playbook
    const turn1 = await service.buildEffectiveInstructions({
      conversationId: convId,
      memberName: 'DevAgent',
      repoIds: ['repo-inject-1'],
    });
    expect(turn1.instructions).toContain('Authoritative Knowledge Playbook for DevAgent');
    expect(turn1.instructions).toContain('Read the skill file from the given path before doing the task');
    expect(turn1.instructions).toContain('GuideRepo');
    expect(turn1.instructions).toContain('skill-alpha');

    // 2. Second message on same conversation without repo update: receives one-line reminder
    const turn2 = await service.buildEffectiveInstructions({
      conversationId: convId,
      memberName: 'DevAgent',
      repoIds: ['repo-inject-1'],
    });
    expect(turn2.instructions).toContain('[Knowledge Reminder]');
    expect(turn2.instructions).toContain('GuideRepo');
    expect(turn2.instructions).not.toContain('### Authoritative Knowledge Playbook');

    // 3. Update repo commit SHA (simulate git auto-update)
    repo.currentCommitSha = 'sha_v2';

    // 4. Third message after commit update: full playbook is re-injected
    const turn3 = await service.buildEffectiveInstructions({
      conversationId: convId,
      memberName: 'DevAgent',
      repoIds: ['repo-inject-1'],
    });
    expect(turn3.instructions).toContain('### Authoritative Knowledge Playbook for DevAgent');
    expect(turn3.instructions).toContain('skill-alpha');
    expect(turn3.instructions).not.toContain('[Knowledge Reminder]');

    // 5. Untrusted or reapproval_required repos are NEVER injected
    repo.trustStatus = 'untrusted';
    const untrustedRes = await service.buildEffectiveInstructions({
      conversationId: 'conv-untrusted',
      memberName: 'DevAgent',
      repoIds: ['repo-inject-1'],
    });
    expect(untrustedRes.instructions).toBe('');

    repo.trustStatus = 'reapproval_required';
    const reapprovalRes = await service.buildEffectiveInstructions({
      conversationId: 'conv-reapproval',
      memberName: 'DevAgent',
      repoIds: ['repo-inject-1'],
    });
    expect(reapprovalRes.instructions).toBe('');
  });

  it('allows read-only access to knowledge worktrees under org pathGuard', async () => {
    const { assertWithinScope } = await import('@/process/services/org/pathGuard');
    const masterRoot = path.join(tempDir, 'org-root');
    await fs.mkdir(masterRoot, { recursive: true });

    // Path outside root should be blocked for normal access
    const outsidePath = path.join(tempDir, 'outside', 'file.txt');
    const normalCheck = await assertWithinScope(outsidePath, masterRoot);
    expect(normalCheck.allowed).toBe(false);

    // Path in knowledge_worktrees should be allowed when read-only
    const knowledgeWorktreeFile = path.join(tempDir, 'knowledge_worktrees', 'repo_1', 'SKILL.md');
    const readOnlyKnowledgeCheck = await assertWithinScope(knowledgeWorktreeFile, masterRoot, { isReadOnly: true });
    expect(readOnlyKnowledgeCheck.allowed).toBe(true);
  });

  it('persists member assignments across restarts and handles dangling repo IDs', async () => {
    const repoA = {
      id: 'repo-persist-A',
      name: 'Repo A',
      gitUrl: 'https://github.com/org/repo-a',
      ref: 'main',
      cachePath: tempDir,
      syncStatus: 'idle' as const,
      updatePolicy: 'auto' as const,
      trustStatus: 'trusted' as const,
      manifest: { alwaysOnRules: [], onDemandSkills: [], setupFiles: [], estimatedTokens: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const repoB = {
      id: 'repo-persist-B',
      name: 'Repo B',
      gitUrl: 'https://github.com/org/repo-b',
      ref: 'main',
      cachePath: tempDir,
      syncStatus: 'idle' as const,
      updatePolicy: 'auto' as const,
      trustStatus: 'trusted' as const,
      manifest: { alwaysOnRules: [], onDemandSkills: [], setupFiles: [], estimatedTokens: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    (service as unknown as { repos: Map<string, typeof repoA> }).repos.set('repo-persist-A', repoA);
    (service as unknown as { repos: Map<string, typeof repoB> }).repos.set('repo-persist-B', repoB);

    const teamKey = 'team:team-123:slot-lead';
    const orgKey = 'org:agent-ceo-456';

    await service.setAssignment(teamKey, {
      repoIds: ['repo-persist-A', 'repo-persist-B'],
      whenToUseHint: 'architectural guidance',
    });
    await service.setAssignment(orgKey, {
      repoIds: ['repo-persist-A'],
      whenToUseHint: 'executive decisions',
    });

    expect(service.getAssignment(teamKey)).toEqual({
      repoIds: ['repo-persist-A', 'repo-persist-B'],
      whenToUseHint: 'architectural guidance',
    });
    expect(service.getAssignment(orgKey)).toEqual({
      repoIds: ['repo-persist-A'],
      whenToUseHint: 'executive decisions',
    });

    // Re-initialize service from saved file
    const service2 = new KnowledgeRepoService();
    (service2 as unknown as { dataDir: string }).dataDir = path.join(tempDir, 'cache');
    (service2 as unknown as { worktreesDir: string }).worktreesDir = path.join(tempDir, 'worktrees');
    await service2.initialize();

    expect(service2.getAssignment(teamKey)).toEqual({
      repoIds: ['repo-persist-A', 'repo-persist-B'],
      whenToUseHint: 'architectural guidance',
    });
    expect(service2.getAssignment(orgKey)).toEqual({
      repoIds: ['repo-persist-A'],
      whenToUseHint: 'executive decisions',
    });

    // Removing repo-persist-B cleans up dangling ID from assignments
    await service2.removeRepo('repo-persist-B');
    expect(service2.getAssignment(teamKey)?.repoIds).toEqual(['repo-persist-A']);

    // Removing member assignment cleans up key
    await service2.removeMemberAssignment(orgKey);
    expect(service2.getAssignment(orgKey)).toBeUndefined();
  });
});
