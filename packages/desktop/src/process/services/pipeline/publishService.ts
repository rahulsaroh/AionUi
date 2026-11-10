/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import type {
  IPublishRecord,
  PublishPayload,
  PublishRequest,
  PublishResult,
  PublishStatus,
} from '@/common/types/pipeline/pipelineTypes';
import {
  computePreviewBindingHash,
  computePublishContentHash,
  hashContent,
} from './artifactHasher';
import type { PipelineRepository } from './pipelineRepository';

export type PlatformPublisher = (request: PublishRequest) => Promise<{
  postId: string;
  url: string;
  metadata?: Record<string, unknown>;
}>;

export type PublishApprovalGateListener = (approval: {
  id: string;
  idempotencyKey: string;
  projectId: string;
  platform: string;
  contentHash: string;
  previewBindingHash: string;
  payload: PublishRequest['payload'];
}) => Promise<boolean> | boolean;

export type PublishAuditLogEntry = {
  action: 'publish_approve' | 'publish_reject' | 'publish_force';
  decision: 'approved' | 'rejected' | 'forced';
  decisionBy: string;
  details: Record<string, unknown>;
  createdAt?: number;
};

export class PublishService {
  private approvalListener?: PublishApprovalGateListener;
  private readonly platformApprovalConfigs: Map<string, boolean> = new Map();
  private auditLogCallback?: (entry: PublishAuditLogEntry) => void;

  constructor(
    private readonly repo: PipelineRepository,
    private readonly defaultPublisher?: PlatformPublisher
  ) {
    // Startup recovery: any row stuck in 'publishing' becomes 'unknown'
    this.repo.recoverStuckPublishingRecords();
  }

  public setApprovalListener(listener: PublishApprovalGateListener): void {
    this.approvalListener = listener;
  }

  public setAuditLogCallback(cb: (entry: PublishAuditLogEntry) => void): void {
    this.auditLogCallback = cb;
  }

  public setPlatformApprovalConfig(platform: string, required: boolean): void {
    this.platformApprovalConfigs.set(platform.toLowerCase().trim(), required);
  }

  /**
   * Human-set config per project/platform.
   * Default is true (ON) for all external publishing unless explicitly configured otherwise.
   */
  public isApprovalRequired(_projectId: string, platform: string): boolean {
    const key = platform.toLowerCase().trim();
    if (this.platformApprovalConfigs.has(key)) {
      return this.platformApprovalConfigs.get(key)!;
    }
    // Default ON for all external publishing platforms
    return true;
  }

  /**
   * Deterministic idempotency key: hash of JSON.stringify([projectId, platform, contentHash])
   * with trim + lowercase normalization.
   */
  public deriveIdempotencyKey(projectId: string, platform: string, contentHash: string): string {
    const raw = JSON.stringify([projectId.trim(), platform.toLowerCase().trim(), contentHash.trim()]);
    return hashContent(raw);
  }

  /**
   * Publish content with state machine, race safety, monotonic gating, and payload binding.
   */
  public async publish(
    request: PublishRequest,
    options?: {
      publisher?: PlatformPublisher;
      projectBaseDir?: string;
      isHumanCall?: boolean;
    }
  ): Promise<PublishResult> {
    // 1. Compute contentHash server-side from files + metadata to prevent forged hashes
    const contentHash =
      request.contentHash && request.contentHash.trim() !== ''
        ? request.contentHash.trim()
        : computePublishContentHash(request.payload, options?.projectBaseDir);

    const idempotencyKey = this.deriveIdempotencyKey(request.projectId, request.platform, contentHash);
    const previewBindingHash = computePreviewBindingHash({
      platform: request.platform,
      contentHash,
      payload: request.payload,
    });

    const existing = this.repo.getPublishRecord(idempotencyKey);

    // 2. Existing record state machine
    if (existing) {
      if (existing.status === 'published' && !request.force) {
        return {
          success: true,
          status: 'published',
          idempotencyKey,
          postId: existing.postId,
          url: existing.url,
          cached: true,
        };
      }

      if (existing.status === 'pending_approval' && !request.force) {
        // MONOTONIC: Cannot downgrade requireApproval or bypass while pending approval!
        return {
          success: false,
          status: 'pending_approval',
          idempotencyKey,
          approvalPending: true,
          approvalId: existing.id,
          error: 'Publication is pending human approval',
        };
      }

      if (existing.status === 'publishing' && !request.force) {
        return {
          success: false,
          status: 'publishing',
          idempotencyKey,
          error: 'Publishing already in progress on platform',
        };
      }

      if (existing.status === 'unknown' && !request.force) {
        return {
          success: false,
          status: 'unknown',
          idempotencyKey,
          error: 'Previous publish attempt in unknown state. Verify on platform before retrying.',
        };
      }

      if (existing.status === 'rejected' && !request.force) {
        return {
          success: false,
          status: 'rejected',
          idempotencyKey,
          error: 'Publication was rejected by user approval gate',
        };
      }

      if (existing.status === 'approved') {
        // BINDING CHECK: Any change to payload preview voids the approval!
        if (existing.previewBindingHash && existing.previewBindingHash !== previewBindingHash) {
          this.repo.updatePublishRecord(idempotencyKey, {
            status: 'pending_approval',
            previewBindingHash,
            metadata: {
              ...existing.metadata,
              ...request.payload,
              approvalVoidedAt: Date.now(),
              approvalVoidedReason: 'Payload modified after preview/approval',
            },
          });
          return {
            success: false,
            status: 'pending_approval',
            idempotencyKey,
            approvalPending: true,
            approvalId: existing.id,
            error: 'Payload modified after approval preview. Approval voided; re-approval required.',
          };
        }
      }
    }

    // 3. Human Approval Gate Check (Monotonic)
    const requiresApproval =
      !request.force &&
      (existing?.status === 'approved'
        ? false
        : this.isApprovalRequired(request.projectId, request.platform) || request.requireApproval === true);

    if (requiresApproval) {
      const approvalId = existing?.id || `pub_gate_${randomUUID()}`;

      this.repo.savePublishRecord({
        id: approvalId,
        idempotencyKey,
        projectId: request.projectId,
        platform: request.platform,
        contentHash,
        previewBindingHash,
        status: 'pending_approval',
        metadata: {
          ...request.payload,
          approvalRequestedAt: Date.now(),
        },
      });

      if (this.approvalListener) {
        const approved = await this.approvalListener({
          id: approvalId,
          idempotencyKey,
          projectId: request.projectId,
          platform: request.platform,
          contentHash,
          previewBindingHash,
          payload: request.payload,
        });

        if (approved) {
          this.repo.updatePublishRecord(idempotencyKey, {
            status: 'approved',
            previewBindingHash,
          });
        } else {
          this.repo.updatePublishRecord(idempotencyKey, {
            status: 'rejected',
            metadata: {
              ...existing?.metadata,
              ...request.payload,
              rejectedAt: Date.now(),
            },
          });
          return {
            success: false,
            status: 'rejected',
            idempotencyKey,
            approvalId,
            error: 'Publishing was rejected by user approval gate',
          };
        }
      } else {
        return {
          success: false,
          status: 'pending_approval',
          idempotencyKey,
          approvalPending: true,
          approvalId,
          error: 'Publication requires human approval before publishing',
        };
      }
    }

    // 4. Concurrency lock & Race Safety:
    // Insert/update row to 'publishing' BEFORE calling platform
    const insertResult = this.repo.insertPublishingRecord({
      idempotencyKey,
      projectId: request.projectId,
      platform: request.platform,
      contentHash,
      previewBindingHash,
      status: 'publishing',
      metadata: { ...request.payload, publishingStartedAt: Date.now() },
    });

    if (!insertResult.inserted && insertResult.record.status === 'publishing' && !request.force) {
      return {
        success: false,
        status: 'publishing',
        idempotencyKey,
        error: 'Another process is actively publishing this content',
      };
    }

    this.repo.updatePublishRecord(idempotencyKey, {
      status: 'publishing',
      previewBindingHash,
    });

    // 5. Execute Platform Publisher
    const publisher = options?.publisher || this.defaultPublisher;
    if (!publisher) {
      this.repo.updatePublishRecord(idempotencyKey, {
        status: 'failed',
        metadata: { error: `No publisher available for platform: ${request.platform}` },
      });
      return {
        success: false,
        status: 'failed',
        idempotencyKey,
        error: `No publisher implementation available for platform: ${request.platform}`,
      };
    }

    try {
      const result = await publisher(request);

      this.repo.savePublishRecord({
        idempotencyKey,
        projectId: request.projectId,
        platform: request.platform,
        contentHash,
        previewBindingHash,
        status: 'published',
        postId: result.postId,
        url: result.url,
        metadata: {
          ...result.metadata,
          ...request.payload,
          publishedAt: Date.now(),
        },
      });

      return {
        success: true,
        status: 'published',
        idempotencyKey,
        postId: result.postId,
        url: result.url,
        cached: false,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.repo.updatePublishRecord(idempotencyKey, {
        status: 'failed',
        metadata: {
          error: errorMessage,
          failedAt: Date.now(),
        },
      });

      return {
        success: false,
        status: 'failed',
        idempotencyKey,
        error: `Publishing failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Human-only path (via IPC) to approve publication.
   * Keyed by idempotencyKey. Validates payload preview binding.
   */
  public async approvePublish(
    idempotencyKey: string,
    options?: {
      publisher?: PlatformPublisher;
      auditUser?: string;
      previewPayload?: PublishPayload;
    }
  ): Promise<PublishResult> {
    const existing = this.repo.getPublishRecord(idempotencyKey);
    if (!existing) {
      throw new Error(`No publish record found for key: ${idempotencyKey}`);
    }

    const payload = (existing.metadata || {}) as PublishPayload;

    // Validate preview binding if previewPayload supplied
    if (options?.previewPayload) {
      const currentPreviewHash = computePreviewBindingHash({
        platform: existing.platform,
        contentHash: existing.contentHash,
        payload: options.previewPayload,
      });

      if (existing.previewBindingHash && existing.previewBindingHash !== currentPreviewHash) {
        throw new Error('Approval rejected: Preview payload has been altered since submission.');
      }
    }

    // Mark approved and record audit log
    this.repo.updatePublishRecord(idempotencyKey, {
      status: 'approved',
      previewBindingHash: existing.previewBindingHash,
    });

    this.recordAudit({
      action: 'publish_approve',
      decision: 'approved',
      decisionBy: options?.auditUser || 'human_user',
      details: {
        idempotencyKey,
        platform: existing.platform,
        projectId: existing.projectId,
        title: payload.title,
      },
    });

    return this.publish(
      {
        projectId: existing.projectId,
        platform: existing.platform,
        contentHash: existing.contentHash,
        payload,
        force: true, // Human approved -> proceed to publish
        requireApproval: false,
      },
      {
        publisher: options?.publisher,
        isHumanCall: true,
      }
    );
  }

  /**
   * Human-only path (via IPC) to reject publication.
   */
  public async rejectPublish(
    idempotencyKey: string,
    reason?: string,
    options?: { auditUser?: string }
  ): Promise<IPublishRecord> {
    const existing = this.repo.getPublishRecord(idempotencyKey);
    if (!existing) {
      throw new Error(`No publish record found for key: ${idempotencyKey}`);
    }

    const updated = this.repo.updatePublishRecord(idempotencyKey, {
      status: 'rejected',
      metadata: {
        ...existing.metadata,
        rejectionReason: reason || 'Rejected by human user',
        rejectedAt: Date.now(),
      },
    })!;

    this.recordAudit({
      action: 'publish_reject',
      decision: 'rejected',
      decisionBy: options?.auditUser || 'human_user',
      details: {
        idempotencyKey,
        platform: existing.platform,
        projectId: existing.projectId,
        reason,
      },
    });

    return updated;
  }

  public getRecord(idempotencyKey: string): IPublishRecord | null {
    return this.repo.getPublishRecord(idempotencyKey);
  }

  public listRecords(projectId?: string): IPublishRecord[] {
    return this.repo.listPublishRecords(projectId);
  }

  private recordAudit(entry: PublishAuditLogEntry): void {
    if (this.auditLogCallback) {
      this.auditLogCallback({ ...entry, createdAt: Date.now() });
    }
  }
}
