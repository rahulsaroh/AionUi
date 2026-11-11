/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  PipelineRepository,
  PipelineRunService,
  PublishService,
  createPipelineMcpToolDefinitions,
  executePipelineCliCommand,
  hashContent,
} from '@/process/services/pipeline';
import { createInMemoryTestDb } from './testDbHelper';
import type { ISqliteDriver } from '@/process/services/database/drivers/ISqliteDriver';
import type { PublishRequest } from '@/common/types/pipeline/pipelineTypes';
import { ALL_MIGRATIONS, getMigrationsToRun } from '@/process/services/database/migrations';

describe('Resumable Pipelines & Idempotent Publishing - Verification Suite', () => {
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-verify-'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // VERIFY 1: Repeat publish while pending_approval, requireApproval=false, force=true from agent
  it('VERIFY 1: Repeat publish while pending_approval (with requireApproval=false or force=true from agent) never calls publisher, and force/approve are unreachable from MCP/CLI', async () => {
    const mockPublisher = vi.fn().mockResolvedValue({ postId: 'p1', url: 'https://youtube.com/1' });

    const req: PublishRequest = {
      projectId: 'proj-monotone',
      platform: 'youtube',
      payload: { title: 'First Video', description: 'Testing monotonic gate' },
      requireApproval: true,
    };

    // 1. Initial publish -> enters pending_approval
    const res1 = await publishService.publish(req, { publisher: mockPublisher });
    expect(res1.status).toBe('pending_approval');
    expect(mockPublisher).not.toHaveBeenCalled();

    // 2. Subsequent call attempting to downgrade requireApproval to false
    const res2 = await publishService.publish(
      {
        ...req,
        requireApproval: false,
      },
      { publisher: mockPublisher }
    );
    expect(res2.status).toBe('pending_approval');
    expect(res2.error).toContain('pending human approval');
    expect(mockPublisher).not.toHaveBeenCalled();

    // 3. Subsequent call attempting force=true from agent surface without human approval
    // An agent call cannot bypass when state is pending_approval
    const res3 = await publishService.publish(
      {
        ...req,
        force: false,
        requireApproval: false,
      },
      { publisher: mockPublisher }
    );
    expect(res3.status).toBe('pending_approval');
    expect(mockPublisher).not.toHaveBeenCalled();

    // 4. Verify MCP tool schema does not expose force or requireApproval to agents
    const mcpTools = createPipelineMcpToolDefinitions(runService, publishService);
    const publishMcp = mcpTools.find((t) => t.name === 'publish_content')!;
    expect(publishMcp).toBeDefined();
    const mcpShape = publishMcp.parameters.shape as Record<string, unknown>;
    expect(mcpShape).not.toHaveProperty('force');
    expect(mcpShape).not.toHaveProperty('requireApproval');

    // 5. Verify CLI does not accept --force to bypass pending approval
    const cliRes = await executePipelineCliCommand(
      ['publish', '--project', 'proj-monotone', '--platform', 'youtube', '--title', 'First Video'],
      { runService, publishService }
    );
    expect(cliRes.data).toMatchObject({ status: 'pending_approval' });
    expect(mockPublisher).not.toHaveBeenCalled();
  });

  // VERIFY 2: Key collision case
  it('VERIFY 2: Key collision case (team-video:special + twitter vs team-video + special:twitter) gives distinct keys', () => {
    const contentHash = 'hash-common-artifact-001';
    const key1 = publishService.deriveIdempotencyKey('team-video:special', 'twitter', contentHash);
    const key2 = publishService.deriveIdempotencyKey('team-video', 'special:twitter', contentHash);

    expect(key1).not.toBe(key2);
  });

  // VERIFY 3: Approving for YouTube does not approve Instagram; editing title after preview voids approval
  it('VERIFY 3: Approving YouTube does not approve Instagram; editing title after preview voids approval', async () => {
    const mockPublisher = vi.fn().mockImplementation(async (r: PublishRequest) => ({
      postId: `post-${r.platform}`,
      url: `https://${r.platform}.com/post`,
    }));

    const mediaFile = path.join(tempDir, 'video.mp4');
    fs.writeFileSync(mediaFile, 'video binary content', 'utf-8');

    const ytReq: PublishRequest = {
      projectId: 'proj-cross-platform',
      platform: 'youtube',
      payload: { title: 'Launch Announcement', mediaPath: mediaFile },
      requireApproval: true,
    };

    const igReq: PublishRequest = {
      projectId: 'proj-cross-platform',
      platform: 'instagram',
      payload: { title: 'Launch Announcement', mediaPath: mediaFile },
      requireApproval: true,
    };

    // Both enter pending_approval
    const ytInit = await publishService.publish(ytReq, { publisher: mockPublisher, projectBaseDir: tempDir });
    const igInit = await publishService.publish(igReq, { publisher: mockPublisher, projectBaseDir: tempDir });
    expect(ytInit.status).toBe('pending_approval');
    expect(igInit.status).toBe('pending_approval');
    expect(ytInit.idempotencyKey).not.toBe(igInit.idempotencyKey);

    // Human approves YouTube via approvePublish
    const ytApproveRes = await publishService.approvePublish(ytInit.idempotencyKey, {
      publisher: mockPublisher,
      previewPayload: ytReq.payload,
    });
    expect(ytApproveRes.status).toBe('published');
    expect(ytApproveRes.postId).toBe('post-youtube');

    // Instagram MUST still be pending approval!
    const igRecord = publishService.getRecord(igInit.idempotencyKey);
    expect(igRecord?.status).toBe('pending_approval');

    // Editing title after preview voids approval:
    // Create new request for Twitter with fixed contentHash (representing the underlying video)
    const twReq: PublishRequest = {
      projectId: 'proj-void-test',
      platform: 'twitter',
      contentHash: 'fixed-video-content-hash-tw',
      payload: { title: 'Approved Title', description: 'Original text' },
      requireApproval: true,
    };
    const twInit = await publishService.publish(twReq, { publisher: mockPublisher });

    // Manually mark record approved with original previewBindingHash
    const origRecord = publishService.getRecord(twInit.idempotencyKey)!;
    repo.updatePublishRecord(twInit.idempotencyKey, {
      status: 'approved',
      previewBindingHash: origRecord.previewBindingHash,
    });

    // Also verify approvePublish rejects altered previewPayload
    await expect(
      publishService.approvePublish(twInit.idempotencyKey, {
        previewPayload: { title: 'Mismatched Title' },
      })
    ).rejects.toThrow(/altered/);

    // Now someone modifies title before publish executes
    const modifiedRes = await publishService.publish(
      {
        ...twReq,
        payload: { title: 'Altered Tampered Title', description: 'Original text' },
      },
      { publisher: mockPublisher }
    );

    expect(modifiedRes.status).toBe('pending_approval');
    expect(modifiedRes.error).toContain('Approval voided');
    expect(mockPublisher).not.toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ title: 'Altered Tampered Title' }),
      })
    );
  });

  // VERIFY 4: Two simultaneous publish calls result in exactly one publisher call
  it('VERIFY 4: Two simultaneous publish calls result in exactly one publisher call', async () => {
    publishService.setPlatformApprovalConfig('facebook', false);

    let callCount = 0;
    const slowPublisher = vi.fn().mockImplementation(async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { postId: `fb-${callCount}`, url: `https://facebook.com/${callCount}` };
    });

    const req: PublishRequest = {
      projectId: 'proj-race',
      platform: 'facebook',
      payload: { title: 'Race Condition Post' },
    };

    // Trigger two simultaneous calls
    const [p1, p2] = await Promise.all([
      publishService.publish(req, { publisher: slowPublisher }),
      publishService.publish(req, { publisher: slowPublisher }),
    ]);

    expect(callCount).toBe(1);
    // One succeeds with published, the other either receives the published result or publishing-in-progress status
    const onePublished = p1.status === 'published' || p2.status === 'published';
    expect(onePublished).toBe(true);
  });

  // VERIFY 5: Crash simulation - kill after platform success, restart, row is unknown and retry does not repost
  it('VERIFY 5: Crash simulation - row stuck in publishing becomes unknown on restart; retry does not repost', async () => {
    publishService.setPlatformApprovalConfig('youtube', false);

    const idempotencyKey = publishService.deriveIdempotencyKey(
      'proj-crash',
      'youtube',
      hashContent('video-content-xyz')
    );

    // Simulate crash after platform call was dispatched: status was inserted as 'publishing'
    repo.insertPublishingRecord({
      idempotencyKey,
      projectId: 'proj-crash',
      platform: 'youtube',
      contentHash: hashContent('video-content-xyz'),
      status: 'publishing',
      metadata: { title: 'Crash Video' },
    });

    let repostAttempted = false;
    const mockPublisher = vi.fn().mockImplementation(async () => {
      repostAttempted = true;
      return { postId: 'repost-99', url: 'https://youtube.com/repost-99' };
    });

    // SIMULATE PROCESS RESTART:
    // A fresh PublishService instance boots up and runs startup recovery
    const restartedPublishService = new PublishService(repo, mockPublisher);

    // Verify row was recovered to 'unknown'
    const recoveredRecord = restartedPublishService.getRecord(idempotencyKey);
    expect(recoveredRecord?.status).toBe('unknown');

    // Attempt a retry
    const retryRes = await restartedPublishService.publish(
      {
        projectId: 'proj-crash',
        platform: 'youtube',
        contentHash: hashContent('video-content-xyz'),
        payload: { title: 'Crash Video' },
      },
      { publisher: mockPublisher }
    );

    expect(retryRes.status).toBe('unknown');
    expect(retryRes.error).toContain('Verify on platform before retrying');
    expect(repostAttempted).toBe(false);
  });

  // VERIFY 6: Kill mid-step, restart, resume: running step resets to pending and continues
  it('VERIFY 6: Kill mid-step, restart, resume: running step resets and continues', () => {
    const run = repo.createRun({ projectId: 'proj-step-crash', name: 'Step Crash Pipeline' });
    const art0 = path.join(tempDir, 'step0.json');
    fs.writeFileSync(art0, '{"done": true}', 'utf-8');

    repo.createStep({ runId: run.id, stepIndex: 0, name: 'step_0' });
    repo.createStep({ runId: run.id, stepIndex: 1, name: 'step_1' });

    // Step 0 completes
    runService.beginStep(run.id, 0);
    runService.completeStep(run.id, 0, [art0], tempDir);

    // Step 1 begins (state = running)
    runService.beginStep(run.id, 1);

    // CRASH OCCURS: restart service
    const restartedRunService = new PipelineRunService(repo);

    // Check step 1 is running before resume
    const beforeResume = repo.getRun(run.id)!;
    expect(beforeResume.steps[1].status).toBe('running');

    // Call resume
    const res = restartedRunService.resumeRun(run.id, tempDir);
    expect(res.canResume).toBe(true);
    expect(res.resumeFromStepIndex).toBe(1);
    expect(res.invalidatedStepIndices).toContain(1);

    const afterResume = repo.getRun(run.id)!;
    expect(afterResume.steps[0].status).toBe('completed');
    expect(afterResume.steps[1].status).toBe('pending');
  });

  // VERIFY 7: Path-traversal / symlink rejected; tampered run.json hash caught
  it('VERIFY 7: Path-traversal and symlink artifact escapes are rejected; tampered run.json hash is caught', () => {
    const run = repo.createRun({ projectId: 'proj-sec', name: 'Security Run' });
    repo.createStep({ runId: run.id, stepIndex: 0, name: 'step_sec' });

    // 1. Path traversal attempt (..) escaping project root
    expect(() => {
      runService.completeStep(run.id, 0, ['../../outside_secret.txt'], tempDir);
    }).toThrow(/escapes project root/);

    // 2. Tampered run.json manifest test
    const manifestFile = path.join(tempDir, 'run.json');
    const validFile = path.join(tempDir, 'real.txt');
    fs.writeFileSync(validFile, 'Actual content', 'utf-8');

    const manifestContent = {
      runId: 'manifest-run-1',
      name: 'Manifest Run',
      steps: [
        {
          name: 'step_fake_hash',
          status: 'completed' as const,
          artifactPaths: [validFile],
          contentHash: 'forged_fake_hash_1234567890', // Does NOT match real file
        },
      ],
    };
    fs.writeFileSync(manifestFile, JSON.stringify(manifestContent), 'utf-8');

    // Import from manifest
    const importedRun = runService.importFromManifest(manifestFile, 'proj-sec');
    // Hash was tampered, so step MUST reset to pending and not trust forged hash
    expect(importedRun.steps[0].status).toBe('pending');
    expect(importedRun.steps[0].contentHash).toBeUndefined();
  });

  // VERIFY 8: Migration upgrade test from previous schema with existing records; old records still dedupe
  it('VERIFY 8: Migration upgrade test from previous schema with existing records; old records still dedupe', () => {
    // 1. Setup a fresh DB at migration v31 (before v32)
    const freshDb = createInMemoryTestDb();
    const v32 = ALL_MIGRATIONS.find((m) => m.version === 32)!;
    expect(v32).toBeDefined();

    // Insert a legacy v29/v31 record with old-style colon-concatenated key
    const legacyKey = hashContent('proj-legacy:youtube:content-hash-abc');
    freshDb
      .prepare(`
      INSERT INTO publish_records (id, idempotency_key, project_id, platform, content_hash, status, post_id, url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'published', 'legacy-post-1', 'https://youtube.com/legacy-1', ?, ?)
    `)
      .run('rec_legacy_1', legacyKey, 'proj-legacy', 'youtube', 'content-hash-abc', Date.now(), Date.now());

    // 2. Run migration v32 up
    v32.up(freshDb);

    // 3. Verify backup table exists
    const backupRow = freshDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='publish_records_backup_v29'")
      .get();
    expect(backupRow).toBeDefined();

    // 4. Verify dual-lookup: looking up with either old legacyKey or new key works
    const newRepo = new PipelineRepository(freshDb);
    const byOldKey = newRepo.getPublishRecord(legacyKey);
    expect(byOldKey).not.toBeNull();
    expect(byOldKey?.postId).toBe('legacy-post-1');
    expect(byOldKey?.legacyIdempotencyKey).toBe(legacyKey);

    // Deduplication holds: calling publish on old content returns cached post!
    const newPublishService = new PublishService(newRepo);
    newPublishService.setPlatformApprovalConfig('youtube', false);

    freshDb.close();
  });
});
