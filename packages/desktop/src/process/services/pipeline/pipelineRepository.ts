/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import type { ISqliteDriver } from '../database/drivers/ISqliteDriver';
import type {
  IPipelineRun,
  IPipelineStep,
  IPublishRecord,
  PipelineRunStatus,
  PipelineStepStatus,
  PublishStatus,
} from '@/common/types/pipeline/pipelineTypes';

type RunRow = {
  id: string;
  project_id: string;
  name: string;
  status: string;
  manifest_path: string | null;
  created_at: number;
  updated_at: number;
};

type StepRow = {
  id: string;
  run_id: string;
  step_index: number;
  name: string;
  status: string;
  inputs: string | null;
  artifact_paths: string | null;
  content_hash: string | null;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
};

type PublishRow = {
  id: string;
  idempotency_key: string;
  project_id: string;
  platform: string;
  content_hash: string;
  status: string;
  post_id: string | null;
  url: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
};

export class PipelineRepository {
  constructor(private readonly db: ISqliteDriver) {}

  private mapStepRow(row: StepRow): IPipelineStep {
    return {
      id: row.id,
      runId: row.run_id,
      stepIndex: row.step_index,
      name: row.name,
      status: row.status as PipelineStepStatus,
      inputs: row.inputs ? (JSON.parse(row.inputs) as Record<string, unknown>) : undefined,
      artifactPaths: row.artifact_paths ? (JSON.parse(row.artifact_paths) as string[]) : [],
      contentHash: row.content_hash || undefined,
      error: row.error || undefined,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      updatedAt: row.updated_at,
    };
  }

  public createRun(data: {
    id?: string;
    projectId: string;
    name: string;
    status?: PipelineRunStatus;
    manifestPath?: string;
  }): IPipelineRun {
    const id = data.id || `run_${randomUUID()}`;
    const now = Date.now();
    const status = data.status || 'pending';

    this.db
      .prepare(
        `INSERT INTO pipeline_runs (id, project_id, name, status, manifest_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, data.projectId, data.name, status, data.manifestPath || null, now, now);

    return {
      id,
      projectId: data.projectId,
      name: data.name,
      status,
      manifestPath: data.manifestPath,
      createdAt: now,
      updatedAt: now,
      steps: [],
    };
  }

  public getRun(id: string): IPipelineRun | null {
    const row = this.db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(id) as RunRow | undefined;
    if (!row) return null;

    const steps = this.getStepsByRun(id);
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      status: row.status as PipelineRunStatus,
      manifestPath: row.manifest_path || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      steps,
    };
  }

  public listRuns(projectId?: string): IPipelineRun[] {
    const query = projectId
      ? 'SELECT * FROM pipeline_runs WHERE project_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM pipeline_runs ORDER BY created_at DESC';
    const rows = (projectId ? this.db.prepare(query).all(projectId) : this.db.prepare(query).all()) as RunRow[];

    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      status: row.status as PipelineRunStatus,
      manifestPath: row.manifest_path || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      steps: this.getStepsByRun(row.id),
    }));
  }

  public updateRunStatus(id: string, status: PipelineRunStatus): void {
    const now = Date.now();
    this.db.prepare('UPDATE pipeline_runs SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }

  public createStep(data: {
    id?: string;
    runId: string;
    stepIndex: number;
    name: string;
    status?: PipelineStepStatus;
    inputs?: Record<string, unknown>;
    artifactPaths?: string[];
    contentHash?: string;
    error?: string;
    startedAt?: number;
    completedAt?: number;
  }): IPipelineStep {
    const id = data.id || `step_${randomUUID()}`;
    const now = Date.now();
    const status = data.status || 'pending';

    this.db
      .prepare(
        `INSERT INTO pipeline_steps (id, run_id, step_index, name, status, inputs, artifact_paths, content_hash, error, started_at, completed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        data.runId,
        data.stepIndex,
        data.name,
        status,
        data.inputs ? JSON.stringify(data.inputs) : null,
        data.artifactPaths ? JSON.stringify(data.artifactPaths) : null,
        data.contentHash || null,
        data.error || null,
        data.startedAt ?? null,
        data.completedAt ?? null,
        now
      );

    return {
      id,
      runId: data.runId,
      stepIndex: data.stepIndex,
      name: data.name,
      status,
      inputs: data.inputs,
      artifactPaths: data.artifactPaths || [],
      contentHash: data.contentHash,
      error: data.error,
      startedAt: data.startedAt,
      completedAt: data.completedAt,
      updatedAt: now,
    };
  }

  public getStep(id: string): IPipelineStep | null {
    const row = this.db.prepare('SELECT * FROM pipeline_steps WHERE id = ?').get(id) as StepRow | undefined;
    return row ? this.mapStepRow(row) : null;
  }

  public getStepsByRun(runId: string): IPipelineStep[] {
    const rows = this.db
      .prepare('SELECT * FROM pipeline_steps WHERE run_id = ? ORDER BY step_index ASC')
      .all(runId) as StepRow[];
    return rows.map((r) => this.mapStepRow(r));
  }

  public updateStep(id: string, updates: Partial<IPipelineStep>): void {
    const existing = this.getStep(id);
    if (!existing) return;

    const merged = { ...existing, ...updates, updatedAt: Date.now() };
    this.db
      .prepare(
        `UPDATE pipeline_steps
         SET name = ?, status = ?, inputs = ?, artifact_paths = ?, content_hash = ?, error = ?, started_at = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        merged.name,
        merged.status,
        merged.inputs ? JSON.stringify(merged.inputs) : null,
        merged.artifactPaths ? JSON.stringify(merged.artifactPaths) : null,
        merged.contentHash || null,
        merged.error || null,
        merged.startedAt ?? null,
        merged.completedAt ?? null,
        merged.updatedAt,
        id
      );
  }

  /**
   * Resets step status and clears completed state for step X and all downstream steps (step_index >= fromStepIndex).
   */
  public invalidateStepsFrom(runId: string, fromStepIndex: number): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE pipeline_steps
         SET status = 'pending', content_hash = NULL, error = NULL, completed_at = NULL, updated_at = ?
         WHERE run_id = ? AND step_index >= ?`
      )
      .run(now, runId, fromStepIndex);
  }

  public getPublishRecord(idempotencyKey: string): IPublishRecord | null {
    const row = this.db.prepare('SELECT * FROM publish_records WHERE idempotency_key = ?').get(idempotencyKey) as
      | PublishRow
      | undefined;
    if (!row) return null;

    return {
      id: row.id,
      idempotencyKey: row.idempotency_key,
      projectId: row.project_id,
      platform: row.platform,
      contentHash: row.content_hash,
      status: row.status as PublishStatus,
      postId: row.post_id || undefined,
      url: row.url || undefined,
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public savePublishRecord(data: {
    id?: string;
    idempotencyKey: string;
    projectId: string;
    platform: string;
    contentHash: string;
    status: PublishStatus;
    postId?: string;
    url?: string;
    metadata?: Record<string, unknown>;
  }): IPublishRecord {
    const id = data.id || `pub_${randomUUID()}`;
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO publish_records (id, idempotency_key, project_id, platform, content_hash, status, post_id, url, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO UPDATE SET
           status = excluded.status,
           post_id = excluded.post_id,
           url = excluded.url,
           metadata = excluded.metadata,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        data.idempotencyKey,
        data.projectId,
        data.platform,
        data.contentHash,
        data.status,
        data.postId || null,
        data.url || null,
        data.metadata ? JSON.stringify(data.metadata) : null,
        now,
        now
      );

    return {
      id,
      idempotencyKey: data.idempotencyKey,
      projectId: data.projectId,
      platform: data.platform,
      contentHash: data.contentHash,
      status: data.status,
      postId: data.postId,
      url: data.url,
      metadata: data.metadata,
      createdAt: now,
      updatedAt: now,
    };
  }
}
