/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type PipelineStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type PipelineRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type IPipelineStep = {
  id: string;
  runId: string;
  stepIndex: number;
  name: string;
  status: PipelineStepStatus;
  inputs?: Record<string, unknown>;
  artifactPaths: string[];
  contentHash?: string;
  sideEffectFree?: boolean;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
};

export type IPipelineRun = {
  id: string;
  projectId: string;
  name: string;
  status: PipelineRunStatus;
  manifestPath?: string;
  createdAt: number;
  updatedAt: number;
  steps: IPipelineStep[];
};

export type IPipelineManifestStep = {
  name: string;
  status?: PipelineStepStatus;
  inputs?: Record<string, unknown>;
  artifactPaths?: string[];
  contentHash?: string;
  sideEffectFree?: boolean;
  error?: string;
};

export type IPipelineManifest = {
  runId?: string;
  projectId?: string;
  name?: string;
  steps: IPipelineManifestStep[];
};

export type PublishStatus =
  | 'pending_approval'
  | 'approved'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'unknown'
  | 'rejected';

export type IPublishRecord = {
  id: string;
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
  createdAt: number;
  updatedAt: number;
};

export type PublishPayload = {
  title: string;
  description?: string;
  caption?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  mediaPath?: string;
  [key: string]: unknown;
};

export type PublishRequest = {
  projectId: string;
  platform: string;
  contentHash?: string;
  payload: PublishPayload;
  force?: boolean;
  requireApproval?: boolean;
};

export type PublishResult = {
  success: boolean;
  status: PublishStatus;
  idempotencyKey: string;
  postId?: string;
  url?: string;
  cached?: boolean;
  approvalPending?: boolean;
  approvalId?: string;
  error?: string;
};
