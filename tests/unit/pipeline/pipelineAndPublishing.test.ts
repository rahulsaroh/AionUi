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
  executePipelineCliCommand,
  createPipelineMcpToolDefinitions,
} from '@/process/services/pipeline';
import { createInMemoryTestDb } from './testDbHelper';
import type { ISqliteDriver } from '@/process/services/database/drivers/ISqliteDriver';
import type { PublishRequest } from '@/common/types/pipeline/pipelineTypes';

describe('Resumable Pipelines & Idempotent Publishing', () => {
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('1. Step Model & Manifest', () => {
    it('creates ordered steps in SQLite and tracks status and artifact hashes', () => {
      const run = repo.createRun({
        projectId: 'proj-1',
        name: 'Video Pipeline',
      });

      const file1 = path.join(tempDir, 'script.md');
      fs.writeFileSync(file1, '# Script content', 'utf-8');

      repo.createStep({
        runId: run.id,
        stepIndex: 0,
        name: 'script_gen',
      });
      repo.createStep({
        runId: run.id,
        stepIndex: 1,
        name: 'audio_gen',
      });

      // Begin step 0
      const step0Running = runService.beginStep(run.id, 0, { prompt: 'Make a video' });
      expect(step0Running.status).toBe('running');
      expect(step0Running.inputs).toEqual({ prompt: 'Make a video' });

      // Complete step 0 with artifact
      const step0Completed = runService.completeStep(run.id, 0, [file1]);
      expect(step0Completed.status).toBe('completed');
      expect(step0Completed.contentHash).toBeTruthy();
      expect(step0Completed.artifactPaths).toEqual([file1]);

      const fetchedRun = repo.getRun(run.id);
      expect(fetchedRun?.steps[0].status).toBe('completed');
      expect(fetchedRun?.steps[1].status).toBe('pending');
    });

    it('supports run.json manifest export and import', () => {
      const manifestPath = path.join(tempDir, 'run.json');
      const manifestData = {
        name: 'Manifest Pipeline',
        steps: [
          { name: 'step_a', inputs: { val: 1 }, artifactPaths: [] },
          { name: 'step_b', inputs: { val: 2 }, artifactPaths: [] },
        ],
      };
      fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), 'utf-8');

      const importedRun = runService.importFromManifest(manifestPath, 'proj-manifest');
      expect(importedRun.name).toBe('Manifest Pipeline');
      expect(importedRun.steps.length).toBe(2);
      expect(importedRun.steps[0].name).toBe('step_a');
      expect(importedRun.steps[1].name).toBe('step_b');
    });
  });

  describe('2. Resume Logic', () => {
    it('VERIFY Scenario 1: kill backend mid-step, restart, resume, and confirm completed steps are skipped', () => {
      // 1. Setup pipeline with 3 steps
      const run = repo.createRun({ projectId: 'proj-kill', name: 'Crash Test Run' });
      const art1 = path.join(tempDir, 'step0.out');
      fs.writeFileSync(art1, 'step 0 output', 'utf-8');

      repo.createStep({ runId: run.id, stepIndex: 0, name: 'step_0' });
      repo.createStep({ runId: run.id, stepIndex: 1, name: 'step_1' });
      repo.createStep({ runId: run.id, stepIndex: 2, name: 'step_2' });

      // Step 0 finishes successfully
      runService.beginStep(run.id, 0);
      runService.completeStep(run.id, 0, [art1]);

      // Step 1 begins (state = 'running')
      runService.beginStep(run.id, 1, { param: 'in_progress' });

      // SIMULATE BACKEND KILL / RESTART:
      // The process terminated while step 1 was running.
      // A new service instance boots up with the persistent repository.
      const restartedRunService = new PipelineRunService(repo);

      // Verify state before resume: step 0 completed, step 1 running
      const stateBeforeResume = repo.getRun(run.id)!;
      expect(stateBeforeResume.steps[0].status).toBe('completed');
      expect(stateBeforeResume.steps[1].status).toBe('running');

      // Call Resume
      const resumeResult = restartedRunService.resumeRun(run.id);

      // Step 0 was validly completed and should be SKIPPED
      expect(resumeResult.skippedStepIndices).toContain(0);
      // Resume resumes from Step 1 (which was interrupted/killed mid-step)
      expect(resumeResult.resumeFromStepIndex).toBe(1);
      expect(resumeResult.canResume).toBe(true);

      const stateAfterResume = repo.getRun(run.id)!;
      // Step 0 remains completed
      expect(stateAfterResume.steps[0].status).toBe('completed');
      // Step 1 was reset to pending to be retried
      expect(stateAfterResume.steps[1].status).toBe('pending');
      // Run status is 'running'
      expect(stateAfterResume.status).toBe('running');
    });

    it('VERIFY Scenario 2: modify an artifact so its hash changes and confirm downstream steps are invalidated', () => {
      const run = repo.createRun({ projectId: 'proj-tamper', name: 'Artifact Modified Run' });
      const art0 = path.join(tempDir, 'art0.txt');
      const art1 = path.join(tempDir, 'art1.txt');
      fs.writeFileSync(art0, 'original-art0', 'utf-8');
      fs.writeFileSync(art1, 'original-art1', 'utf-8');

      repo.createStep({ runId: run.id, stepIndex: 0, name: 'step_0' });
      repo.createStep({ runId: run.id, stepIndex: 1, name: 'step_1' });
      repo.createStep({ runId: run.id, stepIndex: 2, name: 'step_2' });

      // Complete step 0 and step 1
      runService.beginStep(run.id, 0);
      runService.completeStep(run.id, 0, [art0]);

      runService.beginStep(run.id, 1);
      runService.completeStep(run.id, 1, [art1]);

      const runBeforeTamper = repo.getRun(run.id)!;
      expect(runBeforeTamper.steps[0].status).toBe('completed');
      expect(runBeforeTamper.steps[1].status).toBe('completed');
      expect(runBeforeTamper.steps[2].status).toBe('pending');

      // TAMPER / MODIFY ARTIFACT 0:
      fs.writeFileSync(art0, 'MODIFIED-TAMPERED-CONTENT', 'utf-8');

      // Resume the run
      const resumeResult = runService.resumeRun(run.id);

      // Hash mismatch on step 0 must invalidate step 0 and all downstream steps (step 1, step 2)
      expect(resumeResult.invalidatedStepIndices).toEqual([0, 1, 2]);
      expect(resumeResult.resumeFromStepIndex).toBe(0);

      const runAfterTamper = repo.getRun(run.id)!;
      expect(runAfterTamper.steps[0].status).toBe('pending');
      expect(runAfterTamper.steps[0].contentHash).toBeUndefined();
      expect(runAfterTamper.steps[1].status).toBe('pending');
      expect(runAfterTamper.steps[1].contentHash).toBeUndefined();
      expect(runAfterTamper.steps[2].status).toBe('pending');
    });

    it('Re-run from step X invalidates all downstream steps', () => {
      const run = repo.createRun({ projectId: 'proj-rerun', name: 'Rerun Test' });
      repo.createStep({ runId: run.id, stepIndex: 0, name: 'step_0', status: 'completed' });
      repo.createStep({ runId: run.id, stepIndex: 1, name: 'step_1', status: 'completed' });
      repo.createStep({ runId: run.id, stepIndex: 2, name: 'step_2', status: 'completed' });

      // Re-run from step 1
      const updatedRun = runService.rerunFromStep(run.id, 1);

      expect(updatedRun.steps[0].status).toBe('completed'); // Preserved
      expect(updatedRun.steps[1].status).toBe('pending'); // Invalidated
      expect(updatedRun.steps[2].status).toBe('pending'); // Invalidated
    });
  });

  describe('3. Idempotent Publishing', () => {
    it('VERIFY Scenario 3: call publish twice with mock platform, confirm only one post is created; force creates a second', async () => {
      let publishCount = 0;
      const mockPublisher = vi.fn().mockImplementation(async (req: PublishRequest) => {
        publishCount++;
        return {
          postId: `yt-post-${publishCount}`,
          url: `https://youtube.com/watch?v=yt-${publishCount}`,
          metadata: { viewCount: 0 },
        };
      });

      const publishReq: PublishRequest = {
        projectId: 'proj-video-1',
        platform: 'youtube',
        contentHash: 'hash-abc-123456789',
        payload: {
          title: 'My First AI Video',
          description: 'A great video generated by pipeline',
        },
      };

      // 1. First Publish Call
      const res1 = await publishService.publish(publishReq, { publisher: mockPublisher });
      expect(res1.success).toBe(true);
      expect(res1.status).toBe('published');
      expect(res1.postId).toBe('yt-post-1');
      expect(res1.cached).toBe(false);
      expect(publishCount).toBe(1);

      // 2. Second Publish Call with identical project + platform + contentHash
      const res2 = await publishService.publish(publishReq, { publisher: mockPublisher });
      expect(res2.success).toBe(true);
      expect(res2.status).toBe('published');
      expect(res2.cached).toBe(true); // Returned stored result!
      expect(res2.postId).toBe('yt-post-1');
      expect(res2.url).toBe('https://youtube.com/watch?v=yt-1');
      expect(publishCount).toBe(1); // MOCK PUBLISHER WAS NOT CALLED AGAIN

      // 3. Third Call with explicit FORCE = true
      const res3 = await publishService.publish({ ...publishReq, force: true }, { publisher: mockPublisher });
      expect(res3.success).toBe(true);
      expect(res3.status).toBe('published');
      expect(res3.cached).toBe(false);
      expect(res3.postId).toBe('yt-post-2'); // New post created
      expect(publishCount).toBe(2); // MOCK PUBLISHER WAS CALLED FORCED
    });
  });

  describe('4. Optional Human Gate', () => {
    it('VERIFY Scenario 4: publish with require-approval waits until approved', async () => {
      let published = false;
      const mockPublisher = vi.fn().mockImplementation(async () => {
        published = true;
        return {
          postId: 'approved-post-99',
          url: 'https://instagram.com/p/approved-post-99',
        };
      });

      let gateDecisionResolver: (approved: boolean) => void = () => {};
      publishService.setApprovalListener(async (_approval) => {
        return new Promise<boolean>((resolve) => {
          gateDecisionResolver = resolve;
        });
      });

      const publishPromise = publishService.publish(
        {
          projectId: 'proj-gate-test',
          platform: 'instagram',
          contentHash: 'insta-hash-777',
          payload: {
            title: 'Instagram Photo',
            caption: 'Approved post',
          },
          requireApproval: true,
        },
        { publisher: mockPublisher }
      );

      // Verify that publisher is not immediately called
      expect(published).toBe(false);

      // Simulate user approving in Approvals Inbox / modal
      gateDecisionResolver(true);

      const result = await publishPromise;
      expect(result.success).toBe(true);
      expect(result.status).toBe('published');
      expect(result.postId).toBe('approved-post-99');
      expect(published).toBe(true);
    });

    it('rejects publication when approval gate is denied', async () => {
      let published = false;
      const mockPublisher = vi.fn().mockImplementation(async () => {
        published = true;
        return { postId: 'never', url: 'never' };
      });

      publishService.setApprovalListener(async () => false); // Denied

      const result = await publishService.publish(
        {
          projectId: 'proj-gate-deny',
          platform: 'facebook',
          contentHash: 'fb-hash-888',
          payload: { title: 'Denied post' },
          requireApproval: true,
        },
        { publisher: mockPublisher }
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('rejected');
      expect(published).toBe(false);
    });
  });

  describe('5. CLI & MCP Interfaces', () => {
    it('executes step.begin, step.complete, step.fail via CLI command runner', async () => {
      const run = repo.createRun({ projectId: 'cli-proj', name: 'CLI Run' });
      repo.createStep({ runId: run.id, stepIndex: 0, name: 'cli_step_0' });

      const art = path.join(tempDir, 'cli.txt');
      fs.writeFileSync(art, 'cli artifact', 'utf-8');

      // step.begin
      const resBegin = await executePipelineCliCommand(
        ['step.begin', '--run', run.id, '--step', '0', '--inputs', '{"key":"val"}'],
        { runService, publishService }
      );
      expect(resBegin.success).toBe(true);

      // step.complete
      const resComplete = await executePipelineCliCommand(
        ['step.complete', '--run', run.id, '--step', '0', '--artifacts', art],
        { runService, publishService }
      );
      expect(resComplete.success).toBe(true);

      const step = repo.getStep(run.steps[0]?.id || '') || repo.getStepsByRun(run.id)[0];
      expect(step.status).toBe('completed');
      expect(step.contentHash).toBeTruthy();
    });

    it('executes MCP tool definitions correctly', async () => {
      const tools = createPipelineMcpToolDefinitions(runService, publishService);
      const stepBeginTool = tools.find((t) => t.name === 'step_begin');
      expect(stepBeginTool).toBeDefined();

      const run = repo.createRun({ projectId: 'mcp-proj', name: 'MCP Run' });
      repo.createStep({ runId: run.id, stepIndex: 0, name: 'mcp_step' });

      const result = await stepBeginTool!.execute({
        runId: run.id,
        step: 0,
        inputs: { mcp: true },
      });

      expect(result.content[0].text).toContain('mcp_step');
      expect(repo.getStepsByRun(run.id)[0].status).toBe('running');
    });
  });
});
