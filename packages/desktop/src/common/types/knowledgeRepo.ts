/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type KnowledgeRepoSyncStatus = 'idle' | 'ready' | 'syncing' | 'error' | 'failed' | 'needs_attention';

export type WorkspaceKnowledgeRepoEntry = {
  id: string;
  name?: string;
  url: string; // repo URL
  branch?: string; // branch or tag; default = 'main'
  updatePolicy?: 'follow-latest' | 'pinned'; // follow-latest or pinned commit
  followLatest?: boolean;
  pinnedCommit?: string;
  teammates?: string[]; // which teammate uses it (memberSlotId or memberKey)
  assignedTeammates?: string[];
  whenToUseHint?: string;
  subpath?: string;
};

export type WorkspaceKnowledgeManifest = {
  version: number;
  repos: WorkspaceKnowledgeRepoEntry[];
};

export type KnowledgeRepoTrustStatus = 'untrusted' | 'trusted' | 'reapproval_required';

export type KnowledgeRepoProgress = {
  repoId: string;
  phase: 'cloning' | 'scanning' | 'completed' | 'error';
  percent: number; // 0 - 100
  message: string;
  error?: string;
};

export type KnowledgeRepoUpdatePolicy = 'auto' | 'pinned';

export type KnowledgeRuleItem = {
  id: string;
  name: string;
  relativePath: string;
  content: string;
  sizeBytes: number;
  priority: number;
};

export type KnowledgeSkillItem = {
  id: string;
  name: string;
  description: string;
  relativePath: string;
  category?: string;
};

export type KnowledgeSetupFile = {
  relativePath: string;
  type: 'script' | 'makefile' | 'dependency' | 'env_example' | 'tool';
  commands?: string[];
  requiredBinaries?: string[];
};

export type KnowledgeRepoManifest = {
  alwaysOnRules: KnowledgeRuleItem[];
  onDemandSkills: KnowledgeSkillItem[];
  setupFiles: KnowledgeSetupFile[];
  envExampleVars?: string[];
  summary?: string;
  estimatedTokens: number;
};

export type KnowledgeRepoWhatChanged = {
  previousCommitSha: string;
  newCommitSha: string;
  commitMessages: string[];
  addedRules: string[];
  removedRules: string[];
  modifiedRules: string[];
  addedSkills: string[];
  removedSkills: string[];
  modifiedSkills: string[];
  setupFilesChanged: string[];
  requiresReapproval: boolean;
  updatedAt: number;
};

export type KnowledgeRepo = {
  id: string;
  name: string;
  gitUrl: string;
  ref: string; // branch or tag; default = 'main' / default branch
  subpath?: string;
  cachePath: string;
  currentCommitSha?: string;
  previousCommitSha?: string;
  pinnedCommitSha?: string;
  lastCheckedAt?: number;
  lastUpdatedAt?: number;
  syncStatus: KnowledgeRepoSyncStatus;
  syncError?: string;
  updatePolicy: KnowledgeRepoUpdatePolicy;
  trustStatus: KnowledgeRepoTrustStatus;
  manifest: KnowledgeRepoManifest;
  whatChangedSummary?: KnowledgeRepoWhatChanged;
  hasAuthToken?: boolean;
  progress?: KnowledgeRepoProgress;
  envVars?: Record<string, string>; // Securely managed
  createdAt: number;
  updatedAt: number;
};

export type TeammateCapabilityCard = {
  memberSlotId: string;
  memberName: string;
  repos: Array<{
    repoId: string;
    repoName: string;
    whenToUseHint?: string;
    keySkills: string[];
  }>;
};

export type KnowledgeAssignment = {
  repoIds: string[];
  whenToUseHint?: string;
};

export type EffectiveInstructionResult = {
  instructions: string;
  estimatedTokens: number;
  budgetExceeded: boolean;
  budgetLimitTokens: number;
  conflicts: Array<{ ruleA: string; ruleB: string; resolvedInFavorOf: string }>;
};
