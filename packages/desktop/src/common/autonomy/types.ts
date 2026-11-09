/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type AutonomyProfile = 'ask' | 'trusted_workspace' | 'autopilot';

export type ActionCategory =
  | 'file_read'
  | 'file_write'
  | 'file_delete'
  | 'shell_exec'
  | 'network'
  | 'publish'
  | 'spend'
  | 'credentials'
  | 'other';

export interface ActionContext {
  category: ActionCategory;
  /** Target file/dir path if applicable */
  targetPath?: string;
  /** Workspace/project root folder path */
  projectPath?: string;
  /** Shell command if applicable */
  command?: string;
  /** Target host or domain if network call */
  domain?: string;
  /** Financial spend amount */
  amount?: number;
  /** Explicit override for workspace boundary if already determined */
  isOutsideWorkspace?: boolean;
  /** Tool name / action identifier */
  tool?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface RememberedRule {
  id: string;
  projectId: string;
  tool: string;
  pattern: string; // e.g. glob for path, command prefix, or regex
  actionType?: string;
  createdAt: number;
}

export interface AutonomyConfig {
  profile: AutonomyProfile;
  /** Maximum tool calls per run before autopilot drops to requiring approval (default 50) */
  maxToolCallsPerRun?: number;
  /** Allowlisted shell command prefixes or patterns */
  allowlistedCommands?: string[];
  /** Allowlisted network domains */
  allowlistedDomains?: string[];
  /** Spend cap in dollars/units if cost-ledger is active */
  spendCap?: number;
  /** Headless gate timeout in hours (default 12) */
  timeoutHours?: number;
}

export interface RunState {
  toolCallsCount: number;
  currentSpend?: number;
  isHeadless?: boolean;
}

export interface PolicyEvaluationResult {
  allowed: boolean; // true = auto-approve, false = must ask human
  reason: string;
  requiresHuman: boolean; // true if unconditionally blocked from auto-approval
  ruleMatched?: string;
}

export type HeadlessGateStatus = 'waiting_for_approval' | 'approved' | 'denied' | 'expired';

export interface HeadlessGateItem {
  id: string;
  jobId?: string;
  conversationId: string;
  callId: string;
  status: HeadlessGateStatus;
  actionTitle?: string;
  actionDescription?: string;
  commandType?: string;
  teamId?: string;
  projectId?: string;
  agentName?: string;
  diffPreview?: string;
  commandPreview?: string;
  expiresAt: number;
  createdAt: number;
  resolvedAt?: number;
}

export type AuditDecision = 'approved' | 'denied' | 'auto_approved' | 'expired';

export type AuditChannel = 'inbox' | 'chat' | 'web_remote' | 'telegram' | 'autopilot_policy' | 'system_timeout';

export interface ApprovalAuditLog {
  id: string;
  confirmationId?: string;
  conversationId: string;
  projectId?: string;
  teamId?: string;
  action: string;
  actionType?: string;
  decision: AuditDecision;
  decisionBy: string;
  channel: AuditChannel;
  details?: string;
  createdAt: number;
}
