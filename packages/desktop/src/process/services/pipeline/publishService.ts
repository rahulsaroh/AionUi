/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import type { IPublishRecord, PublishRequest, PublishResult } from '@/common/types/pipeline/pipelineTypes';
import { hashContent } from './artifactHasher';
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
  payload: PublishRequest['payload'];
}) => Promise<boolean> | boolean;

export class PublishService {
  private approvalListener?: PublishApprovalGateListener;

  constructor(
    private readonly repo: PipelineRepository,
    private readonly defaultPublisher?: PlatformPublisher
  ) {}

  public setApprovalListener(listener: PublishApprovalGateListener): void {
    this.approvalListener = listener;
  }

  /**
   * Generates deterministic idempotency key for project + platform + content_hash
   */
  public deriveIdempotencyKey(projectId: string, platform: string, contentHash: string): string {
    const raw = `${projectId}:${platform.toLowerCase().trim()}:${contentHash.trim()}`;
    return hashContent(raw);
  }

  /**
   * Publish content with strict idempotency and optional human approval gate.
   */
  public async publish(request: PublishRequest, options?: { publisher?: PlatformPublisher }): Promise<PublishResult> {
    const idempotencyKey = this.deriveIdempotencyKey(request.projectId, request.platform, request.contentHash);

    // 1. Idempotency Check: if not forcing, return cached result if already published
    if (!request.force) {
      const existing = this.repo.getPublishRecord(idempotencyKey);
      if (existing && existing.status === 'published' && existing.postId) {
        return {
          success: true,
          status: 'published',
          idempotencyKey,
          postId: existing.postId,
          url: existing.url,
          cached: true,
        };
      }
    }

    // 2. Optional Human Gate: Require approval
    if (request.requireApproval) {
      const approvalId = `approval_${randomUUID()}`;

      // Save pending approval record
      this.repo.savePublishRecord({
        idempotencyKey,
        projectId: request.projectId,
        platform: request.platform,
        contentHash: request.contentHash,
        status: 'pending_approval',
        metadata: {
          approvalId,
          ...request.payload,
        },
      });

      // If approval listener is registered (e.g. connected to Approvals Inbox or modal), await user decision
      if (this.approvalListener) {
        const approved = await this.approvalListener({
          id: approvalId,
          idempotencyKey,
          projectId: request.projectId,
          platform: request.platform,
          contentHash: request.contentHash,
          payload: request.payload,
        });

        if (!approved) {
          this.repo.savePublishRecord({
            idempotencyKey,
            projectId: request.projectId,
            platform: request.platform,
            contentHash: request.contentHash,
            status: 'rejected',
            metadata: { approvalId, rejectedAt: Date.now() },
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
        // Asynchronous inbox gate: returned to caller as pending approval
        return {
          success: false,
          status: 'pending_approval',
          idempotencyKey,
          approvalPending: true,
          approvalId,
        };
      }
    }

    // 3. Perform the actual publish through provided or default publisher
    const publisher = options?.publisher || this.defaultPublisher;
    if (!publisher) {
      throw new Error(`No publisher implementation available for platform: ${request.platform}`);
    }

    try {
      const result = await publisher(request);

      this.repo.savePublishRecord({
        idempotencyKey,
        projectId: request.projectId,
        platform: request.platform,
        contentHash: request.contentHash,
        status: 'published',
        postId: result.postId,
        url: result.url,
        metadata: {
          ...result.metadata,
          ...request.payload,
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
      return {
        success: false,
        status: 'rejected',
        idempotencyKey,
        error: `Publishing failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Explicit approval from UI / Approvals Inbox to execute a pending publication.
   */
  public async approvePublish(
    idempotencyKey: string,
    options?: { publisher?: PlatformPublisher }
  ): Promise<PublishResult> {
    const existing = this.repo.getPublishRecord(idempotencyKey);
    if (!existing) {
      throw new Error(`No publish record found for key: ${idempotencyKey}`);
    }

    const payload = (existing.metadata || {}) as RequestPayload;
    return this.publish(
      {
        projectId: existing.projectId,
        platform: existing.platform,
        contentHash: existing.contentHash,
        payload: {
          title: (payload.title as string) || 'Untitled',
          description: payload.description as string | undefined,
          caption: payload.caption as string | undefined,
          thumbnailUrl: payload.thumbnailUrl as string | undefined,
          videoUrl: payload.videoUrl as string | undefined,
          mediaPath: payload.mediaPath as string | undefined,
        },
        force: true, // Approved explicitly -> bypass cached check
        requireApproval: false,
      },
      options
    );
  }

  public getRecord(idempotencyKey: string): IPublishRecord | null {
    return this.repo.getPublishRecord(idempotencyKey);
  }
}

type RequestPayload = Record<string, unknown>;
