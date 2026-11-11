/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PipelineRepository, PipelineRunService, PublishService } from '@/process/services/pipeline';
import { createInMemoryTestDb } from './testDbHelper';
import type { ISqliteDriver } from '@/process/services/database/drivers/ISqliteDriver';
import type { PublishRequest } from '@/common/types/pipeline/pipelineTypes';

describe('Adversarial & Security Tests for Pipeline & Publishing', () => {
  let db: ISqliteDriver;
  let repo: PipelineRepository;
  let runService: PipelineRunService;
  let publishService: PublishService;
  let tempDir: string;

  beforeEach(() => {
    db = createInMemoryTestDb();
    repo = new PipelineRepository(db);
    runService = new PipelineRunService(repo);
    publishService = new PublishService(repo);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-adv-test-'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ADVERSARIAL TEST 1: Security Bypass Attempt
  // An agent requests publishing with requireApproval: true, which correctly suspends into pending_approval.
  // Then an adversary or rogue subagent attempts to bypass the approval gate by calling publish with requireApproval: false on the pending publication.
  it('ADVERSARIAL 1 (Security Bypass Attempt): unapproved pending request must not be published by a subsequent unflagged request', async () => {
    const mockPublisher = vi.fn().mockResolvedValue({
      postId: 'adversary-post-999',
      url: 'https://youtube.com/watch?v=unauthorized-post',
    });

    const pendingRequest: PublishRequest = {
      projectId: 'sensitive-project',
      platform: 'youtube',
      contentHash: 'hash-leak-sensitive-video-1',
      payload: {
        title: 'Confidential Internal Video',
      },
      requireApproval: true,
    };

    // Step 1: Normal agent submits with approval required
    const gateRes = await publishService.publish(pendingRequest, { publisher: mockPublisher });
    expect(gateRes.success).toBe(false);
    expect(gateRes.status).toBe('pending_approval');
    expect(mockPublisher).not.toHaveBeenCalled();

    // Verify DB state is pending_approval
    const record = repo.getPublishRecord(gateRes.idempotencyKey);
    expect(record?.status).toBe('pending_approval');

    // Step 2: Adversarial bypass attempt - call publish again with requireApproval: false and force: false
    const bypassRequest: PublishRequest = {
      ...pendingRequest,
      requireApproval: false,
      force: false,
    };

    const bypassRes = await publishService.publish(bypassRequest, { publisher: mockPublisher });

    // SKEPTICAL REVIEW EVALUATION:
    // If the system allows publishing here, the human approval gate was bypassed!
    // A secure implementation should reject or block publishing while an approval is pending.
    // We document the actual behavior here.
    if (bypassRes.success) {
      console.warn(
        '[VULNERABILITY DETECTED]: Pending approval was bypassed because subsequent request omitted requireApproval!'
      );
    }
    // We assert that the publisher was NOT called (i.e. security boundary holds)
    expect(mockPublisher).not.toHaveBeenCalled();
  });

  // ADVERSARIAL TEST 2: Delimiter Collision / Key Confusion
  // projectId and platform are concatenated with ':' without delimiter escaping.
  // Craft two different projects/platforms that produce identical raw key strings.
  it('ADVERSARIAL 2 (Edge Case / Collision): delimiter collision between projectId and platform must not cross-contaminate publish records', async () => {
    const mockPublisher = vi.fn().mockImplementation(async (req: PublishRequest) => ({
      postId: `post-${req.projectId}`,
      url: `https://social.com/${req.projectId}`,
    }));

    // Project A: id has colon
    const reqA: PublishRequest = {
      projectId: 'team-video:special',
      platform: 'twitter',
      contentHash: 'hash-collision-xyz',
      payload: { title: 'Project A Announcement' },
    };

    // Project B: platform has colon
    const reqB: PublishRequest = {
      projectId: 'team-video',
      platform: 'special:twitter',
      contentHash: 'hash-collision-xyz',
      payload: { title: 'Project B Announcement' },
    };

    const keyA = publishService.deriveIdempotencyKey(reqA.projectId, reqA.platform, reqA.contentHash);
    const keyB = publishService.deriveIdempotencyKey(reqB.projectId, reqB.platform, reqB.contentHash);

    // If keyA === keyB, Project B will hijack Project A's publication!
    expect(keyA).not.toBe(keyB);
  });

  // ADVERSARIAL TEST 3: Failure Path & Mid-run Artifact Tampering / Replacement
  // An artifact is replaced by a directory, or truncated, or deleted between runs.
  // resumeRun must detect tampering and invalidate the altered step and downstream steps.
  it('ADVERSARIAL 3 (Failure Path): mid-run artifact tampering (replacement with directory or truncation) invalidates step and downstream', () => {
    const run = repo.createRun({ projectId: 'proj-tamper', name: 'Tamper Test Pipeline' });

    const step0File = path.join(tempDir, 'output_step0.json');
    fs.writeFileSync(step0File, JSON.stringify({ valid: true, data: 'original' }), 'utf-8');

    const step1File = path.join(tempDir, 'output_step1.mp4');
    fs.writeFileSync(step1File, 'dummy mp4 bytes original', 'utf-8');

    repo.createStep({ runId: run.id, stepIndex: 0, name: 'data_prep' });
    repo.createStep({ runId: run.id, stepIndex: 1, name: 'render_video' });
    repo.createStep({ runId: run.id, stepIndex: 2, name: 'upload_video' });

    // Complete Step 0 and Step 1
    runService.beginStep(run.id, 0);
    runService.completeStep(run.id, 0, [step0File]);

    runService.beginStep(run.id, 1);
    runService.completeStep(run.id, 1, [step1File]);

    // Verify initial states
    let currentRun = repo.getRun(run.id)!;
    expect(currentRun.steps[0].status).toBe('completed');
    expect(currentRun.steps[1].status).toBe('completed');
    expect(currentRun.steps[2].status).toBe('pending');

    // TAMPERING: An external actor modifies step0 output by truncating / replacing it
    fs.writeFileSync(step0File, 'TAMPERED_CONTENT', 'utf-8');

    // Trigger Resume
    const resumeRes = runService.resumeRun(run.id);

    // Step 0 hash verification MUST fail
    // Therefore, Step 0 must be invalidated, Step 1 (downstream) must be invalidated,
    // and resumeFromStepIndex must be 0
    expect(resumeRes.resumeFromStepIndex).toBe(0);
    expect(resumeRes.invalidatedStepIndices).toContain(0);
    expect(resumeRes.invalidatedStepIndices).toContain(1);
    expect(resumeRes.skippedStepIndices).toHaveLength(0);

    currentRun = repo.getRun(run.id)!;
    expect(currentRun.steps[0].status).toBe('pending');
    expect(currentRun.steps[0].contentHash).toBeUndefined();
    expect(currentRun.steps[1].status).toBe('pending');
  });
});
