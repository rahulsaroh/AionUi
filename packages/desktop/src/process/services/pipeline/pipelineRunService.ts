/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { IPipelineManifest, IPipelineRun, IPipelineStep } from '@/common/types/pipeline/pipelineTypes';
import { computeArtifactsHash, verifyArtifacts } from './artifactHasher';
import type { PipelineRepository } from './pipelineRepository';

export type ResumeResult = {
  run: IPipelineRun;
  resumeFromStepIndex: number;
  skippedStepIndices: number[];
  invalidatedStepIndices: number[];
  canResume: boolean;
};

export class PipelineRunService {
  constructor(private readonly repo: PipelineRepository) {}

  /**
   * Helper to resolve step by either stepIndex (number) or step name/id (string).
   */
  private findStep(runId: string, stepIdentifier: string | number): IPipelineStep | null {
    const steps = this.repo.getStepsByRun(runId);
    if (typeof stepIdentifier === 'number') {
      return steps.find((s) => s.stepIndex === stepIdentifier) || null;
    }
    return steps.find((s) => s.id === stepIdentifier || s.name === stepIdentifier) || null;
  }

  /**
   * Syncs current run and steps to run.json manifest if manifest_path is present.
   */
  public syncManifest(runId: string): void {
    const run = this.repo.getRun(runId);
    if (!run || !run.manifestPath) return;

    try {
      const manifest: IPipelineManifest = {
        runId: run.id,
        projectId: run.projectId,
        name: run.name,
        steps: run.steps.map((s) => ({
          name: s.name,
          status: s.status,
          inputs: s.inputs,
          artifactPaths: s.artifactPaths,
          contentHash: s.contentHash,
          error: s.error,
        })),
      };

      writeFileSync(run.manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[PipelineRunService] Failed to write manifest at ${run.manifestPath}:`, err);
    }
  }

  /**
   * Creates or imports a run from a run.json manifest file.
   */
  public importFromManifest(manifestPath: string, projectId: string): IPipelineRun {
    if (!existsSync(manifestPath)) {
      throw new Error(`Manifest file not found: ${manifestPath}`);
    }

    const content = readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(content) as IPipelineManifest;

    const run = this.repo.createRun({
      id: parsed.runId,
      projectId: parsed.projectId || projectId,
      name: parsed.name || path.basename(path.dirname(manifestPath)),
      manifestPath,
    });

    for (let i = 0; i < (parsed.steps || []).length; i++) {
      const s = parsed.steps[i];
      this.repo.createStep({
        runId: run.id,
        stepIndex: i,
        name: s.name,
        status: s.status || 'pending',
        inputs: s.inputs,
        artifactPaths: s.artifactPaths || [],
        contentHash: s.contentHash,
        error: s.error,
      });
    }

    return this.repo.getRun(run.id)!;
  }

  /**
   * step.begin: marks step as running, records inputs.
   */
  public beginStep(runId: string, stepIdentifier: string | number, inputs?: Record<string, unknown>): IPipelineStep {
    const step = this.findStep(runId, stepIdentifier);
    if (!step) {
      throw new Error(`Step not found: ${stepIdentifier} in run ${runId}`);
    }

    this.repo.updateStep(step.id, {
      status: 'running',
      startedAt: Date.now(),
      inputs: inputs !== undefined ? inputs : step.inputs,
      error: undefined,
    });

    this.repo.updateRunStatus(runId, 'running');
    this.syncManifest(runId);

    return this.repo.getStep(step.id)!;
  }

  /**
   * step.complete: hashes output artifacts, stores content_hash, marks completed.
   */
  public completeStep(
    runId: string,
    stepIdentifier: string | number,
    artifactPaths: string[] = [],
    baseDir?: string
  ): IPipelineStep {
    const step = this.findStep(runId, stepIdentifier);
    if (!step) {
      throw new Error(`Step not found: ${stepIdentifier} in run ${runId}`);
    }

    const contentHash = computeArtifactsHash(artifactPaths, baseDir) || undefined;

    this.repo.updateStep(step.id, {
      status: 'completed',
      completedAt: Date.now(),
      artifactPaths,
      contentHash,
      error: undefined,
    });

    const allSteps = this.repo.getStepsByRun(runId);
    const allCompleted = allSteps.every((s) => s.status === 'completed' || s.status === 'skipped');
    if (allCompleted) {
      this.repo.updateRunStatus(runId, 'completed');
    }

    this.syncManifest(runId);
    return this.repo.getStep(step.id)!;
  }

  /**
   * step.fail: records error and marks step and run as failed.
   */
  public failStep(runId: string, stepIdentifier: string | number, error: string): IPipelineStep {
    const step = this.findStep(runId, stepIdentifier);
    if (!step) {
      throw new Error(`Step not found: ${stepIdentifier} in run ${runId}`);
    }

    this.repo.updateStep(step.id, {
      status: 'failed',
      error,
    });

    this.repo.updateRunStatus(runId, 'failed');
    this.syncManifest(runId);
    return this.repo.getStep(step.id)!;
  }

  /**
   * Resumes a run after crash, restart, or stall:
   * - Validates completed steps: verifies that artifact files exist and hashes match.
   * - If an artifact is missing or altered, invalidates that step and all downstream steps.
   * - If a step was left in 'running', marks it pending (retry) and invalidates downstream.
   * - Skips valid completed steps.
   */
  public resumeRun(runId: string, baseDir?: string): ResumeResult {
    const run = this.repo.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const steps = this.repo.getStepsByRun(runId);
    const skippedStepIndices: number[] = [];
    const invalidatedStepIndices: number[] = [];
    let firstIncompleteIndex = -1;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (step.status === 'completed') {
        // If step declared artifacts, verify they exist and match the recorded content_hash
        if (step.artifactPaths && step.artifactPaths.length > 0) {
          const verification = verifyArtifacts(step.artifactPaths, step.contentHash, baseDir);
          if (!verification.matches) {
            // Artifact missing or modified -> invalidate this step and all downstream steps!
            this.repo.invalidateStepsFrom(runId, step.stepIndex);
            for (let j = i; j < steps.length; j++) {
              invalidatedStepIndices.push(steps[j].stepIndex);
            }
            firstIncompleteIndex = step.stepIndex;
            break;
          }
        }
        skippedStepIndices.push(step.stepIndex);
      } else if (step.status === 'running') {
        // Stalled or mid-step crash -> reset to pending and invalidate downstream
        this.repo.invalidateStepsFrom(runId, step.stepIndex);
        for (let j = i; j < steps.length; j++) {
          invalidatedStepIndices.push(steps[j].stepIndex);
        }
        firstIncompleteIndex = step.stepIndex;
        break;
      } else {
        // First pending or failed step
        firstIncompleteIndex = step.stepIndex;
        break;
      }
    }

    if (firstIncompleteIndex === -1 && skippedStepIndices.length === steps.length) {
      // All steps already validly completed
      this.repo.updateRunStatus(runId, 'completed');
      this.syncManifest(runId);
      return {
        run: this.repo.getRun(runId)!,
        resumeFromStepIndex: steps.length,
        skippedStepIndices,
        invalidatedStepIndices,
        canResume: false,
      };
    }

    this.repo.updateRunStatus(runId, 'running');
    this.syncManifest(runId);

    return {
      run: this.repo.getRun(runId)!,
      resumeFromStepIndex: firstIncompleteIndex >= 0 ? firstIncompleteIndex : 0,
      skippedStepIndices,
      invalidatedStepIndices,
      canResume: true,
    };
  }

  /**
   * Re-run from step X:
   * Invalidates step X and all downstream steps (status -> pending, content_hash cleared).
   */
  public rerunFromStep(runId: string, stepIndex: number): IPipelineRun {
    const run = this.repo.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    this.repo.invalidateStepsFrom(runId, stepIndex);
    this.repo.updateRunStatus(runId, 'running');
    this.syncManifest(runId);

    return this.repo.getRun(runId)!;
  }
}
