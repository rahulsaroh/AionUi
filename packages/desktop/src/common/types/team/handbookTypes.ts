/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type HandbookStatusType = 'created' | 'not_created' | 'error';

export type HandbookStatus = {
  memberKey: string;
  memberName: string;
  exists: boolean;
  status: HandbookStatusType;
  reason?: string;
  filePath?: string;
  fileName?: string;
  updatedAt?: number;
  fileHash?: string;
};

export type HandbookHistoryItem = {
  id: string;
  timestamp: number;
  fileName: string;
  contentPreview: string;
  fileHash?: string;
};

export type HandbookDetail = {
  memberKey: string;
  memberName: string;
  role?: string;
  content: string;
  filePath: string;
  fileName: string;
  fileHash: string;
  updatedAt: number;
  estimatedTokens: number;
  budgetTokens: number;
};

export type HandbookCreateOptions = {
  memberKey: string;
  memberName: string;
  role?: string;
  customContent?: string;
  seedPrompt?: string;
  model?: string;
};

export type HandbookInjectionResult = {
  promptBlock: string;
  isFullBlock: boolean;
  fileHash: string;
  estimatedTokens: number;
};

export type HandbookAssignedRepo = {
  repoName: string;
  ref?: string;
  commit?: string;
};
