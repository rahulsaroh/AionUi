/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import type {
  IPipelineRun,
  IPipelineStep,
  IPublishRecord,
  PipelineRunStatus,
  PipelineStepStatus,
  PublishStatus,
} from '@/common/types/pipeline/pipelineTypes';
import type { ISqliteDriver } from '../database/drivers/ISqliteDriver';

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
  side_effect_free: number | null;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
};

type PublishRow = {
  id: string;
  idempotency_key: string;
  legacy_idempotency_key: string | null;
  project_id: string;
  platform: string;
  content_hash: string;
  preview_binding_hash: string | null;
  status: string;
  post_id: string | null;
  url: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
};

export class PipelineRepository {
  constructor(private readonly db: ISqliteDriver) {}

  public getDb(): ISqliteDriver {
    return this.db;
  }

  // ==========================================
  // Pipeline Runs
  // ==========================================

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

    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      name: r.name,
      status: r.status as PipelineRunStatus,
      manifestPath: r.manifest_path || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      steps: this.getStepsByRun(r.id),
    }));
  }

  public updateRunStatus(id: string, status: PipelineRunStatus): void {
    this.db.prepare('UPDATE pipeline_runs SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
  }

  public updateRunManifest(id: string, manifestPath: string): void {
    this.db
      .prepare('UPDATE pipeline_runs SET manifest_path = ?, updated_at = ? WHERE id = ?')
      .run(manifestPath, Date.now(), id);
  }

  // ==========================================
  // Pipeline Steps
  // ==========================================

  public createStep(data: {
    id?: string;
    runId: string;
    stepIndex: number;
    name: string;
    status?: PipelineStepStatus;
    inputs?: Record<string, unknown>;
    artifactPaths?: string[];
    contentHash?: string;
    sideEffectFree?: boolean;
    error?: string;
    startedAt?: number;
    completedAt?: number;
  }): IPipelineStep {
    const id = data.id || `step_${randomUUID()}`;
    const now = Date.now();
    const status = data.status || 'pending';

    this.db
      .prepare(
        `INSERT INTO pipeline_steps (id, run_id, step_index, name, status, inputs, artifact_paths, content_hash, side_effect_free, error, started_at, completed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        data.sideEffectFree ? 1 : 0,
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
      sideEffectFree: data.sideEffectFree,
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
         SET name = ?, status = ?, inputs = ?, artifact_paths = ?, content_hash = ?, side_effect_free = ?, error = ?, started_at = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        merged.name,
        merged.status,
        merged.inputs ? JSON.stringify(merged.inputs) : null,
        merged.artifactPaths ? JSON.stringify(merged.artifactPaths) : null,
        merged.contentHash || null,
        merged.sideEffectFree ? 1 : 0,
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

  // ==========================================
  // Publish Records (Dual-Lookup & Transactional)
  // ==========================================

  public getPublishRecord(idempotencyKey: string): IPublishRecord | null {
    const row = this.db
      .prepare('SELECT * FROM publish_records WHERE idempotency_key = ? OR legacy_idempotency_key = ?')
      .get(idempotencyKey, idempotencyKey) as PublishRow | undefined;
    if (!row) return null;

    return this.mapPublishRow(row);
  }

  public listPublishRecords(projectId?: string): IPublishRecord[] {
    const query = projectId
      ? 'SELECT * FROM publish_records WHERE project_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM publish_records ORDER BY created_at DESC';

    const rows = (projectId ? this.db.prepare(query).all(projectId) : this.db.prepare(query).all()) as PublishRow[];

    return rows.map((r) => this.mapPublishRow(r));
  }

  /**
   * Attempts to insert a publishing record inside transaction for race-safety.
   * If record already exists, returns existing without overwriting.
   */
  public insertPublishingRecord(data: {
    id?: string;
    idempotencyKey: string;
    legacyIdempotencyKey?: string;
    projectId: string;
    platform: string;
    contentHash: string;
    previewBindingHash?: string;
    status: PublishStatus;
    metadata?: Record<string, unknown>;
  }): { inserted: boolean; record: IPublishRecord } {
    const existing = this.getPublishRecord(data.idempotencyKey);
    if (existing) {
      return { inserted: false, record: existing };
    }

    const id = data.id || `pub_${randomUUID()}`;
    const now = Date.now();

    try {
      this.db
        .prepare(
          `INSERT INTO publish_records (id, idempotency_key, legacy_idempotency_key, project_id, platform, content_hash, preview_binding_hash, status, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          data.idempotencyKey,
          data.legacyIdempotencyKey || null,
          data.projectId,
          data.platform,
          data.contentHash,
          data.previewBindingHash || null,
          data.status,
          data.metadata ? JSON.stringify(data.metadata) : null,
          now,
          now
        );

      return {
        inserted: true,
        record: {
          id,
          idempotencyKey: data.idempotencyKey,
          legacyIdempotencyKey: data.legacyIdempotencyKey,
          projectId: data.projectId,
          platform: data.platform,
          contentHash: data.contentHash,
          previewBindingHash: data.previewBindingHash,
          status: data.status,
          metadata: data.metadata,
          createdAt: now,
          updatedAt: now,
        },
      };
    } catch {
      // Caught unique constraint collision race
      const raceExisting = this.getPublishRecord(data.idempotencyKey)!;
      return { inserted: false, record: raceExisting };
    }
  }

  public savePublishRecord(data: {
    id?: string;
    idempotencyKey: string;
    legacyIdempotencyKey?: string;
    projectId: string;
    platform: string;
    contentHash: string;
    previewBindingHash?: string;
    status: PublishStatus;
    postId?: string;
    url?: string;
    metadata?: Record<string, unknown>;
  }): IPublishRecord {
    const id = data.id || `pub_${randomUUID()}`;
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO publish_records (id, idempotency_key, legacy_idempotency_key, project_id, platform, content_hash, preview_binding_hash, status, post_id, url, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO UPDATE SET
           legacy_idempotency_key = COALESCE(excluded.legacy_idempotency_key, publish_records.legacy_idempotency_key),
           preview_binding_hash = COALESCE(excluded.preview_binding_hash, publish_records.preview_binding_hash),
           status = excluded.status,
           post_id = excluded.post_id,
           url = excluded.url,
           metadata = excluded.metadata,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        data.idempotencyKey,
        data.legacyIdempotencyKey || null,
        data.projectId,
        data.platform,
        data.contentHash,
        data.previewBindingHash || null,
        data.status,
        data.postId || null,
        data.url || null,
        data.metadata ? JSON.stringify(data.metadata) : null,
        now,
        now
      );

    return this.getPublishRecord(data.idempotencyKey)!;
  }

  public updatePublishRecord(
    idempotencyKey: string,
    updates: Partial<{
      status: PublishStatus;
      postId?: string;
      url?: string;
      previewBindingHash?: string;
      metadata?: Record<string, unknown>;
    }>
  ): IPublishRecord | null {
    const existing = this.getPublishRecord(idempotencyKey);
    if (!existing) return null;

    const merged = { ...existing, ...updates, updatedAt: Date.now() };
    this.db
      .prepare(
        `UPDATE publish_records
         SET status = ?, post_id = ?, url = ?, preview_binding_hash = ?, metadata = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        merged.status,
        merged.postId || null,
        merged.url || null,
        merged.previewBindingHash || null,
        merged.metadata ? JSON.stringify(merged.metadata) : null,
        merged.updatedAt,
        existing.id
      );

    return this.getPublishRecord(idempotencyKey);
  }

  /**
   * On startup, rows stuck in 'publishing' become 'unknown':
   * Shows "verify on platform" in UI and never auto-retries.
   */
  public recoverStuckPublishingRecords(): number {
    const now = Date.now();
    try {
      const result = this.db
        .prepare("UPDATE publish_records SET status = 'unknown', updated_at = ? WHERE status = 'publishing'")
        .run(now);
      return result.changes;
    } catch {
      return 0;
    }
  }

  // ==========================================
  // Helper Mappers
  // ==========================================

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
      sideEffectFree: Boolean(row.side_effect_free),
      error: row.error || undefined,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      updatedAt: row.updated_at,
    };
  }

  private mapPublishRow(row: PublishRow): IPublishRecord {
    return {
      id: row.id,
      idempotencyKey: row.idempotency_key,
      legacyIdempotencyKey: row.legacy_idempotency_key || undefined,
      projectId: row.project_id,
      platform: row.platform,
      contentHash: row.content_hash,
      previewBindingHash: row.preview_binding_hash || undefined,
      status: row.status as PublishStatus,
      postId: row.post_id || undefined,
      url: row.url || undefined,
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
