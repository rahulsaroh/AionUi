/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OrgApprovalPolicy } from '@/types/organization';

export type { OrgApprovalPolicy };

/**
 * Per-project approval policy (Codex-style), three levels:
 * - `read_only`  : file reads are free; every file edit and shell command asks.
 * - `auto_edit`  : file edits inside the project folder are free; shell commands ask.
 * - `full_auto`  : shell commands inside the project folder are free; anything that
 *                  reaches outside the folder, deletes outside, installs globally,
 *                  changes registry/system/assistant settings, or runs a downloaded
 *                  executable still asks.
 *
 * Default policy is `auto_edit`.
 */
export const DEFAULT_APPROVAL_POLICY: OrgApprovalPolicy = 'auto_edit';

/** Coarse classification of an agent tool for approval evaluation. */
export type OrgToolKind = 'read' | 'write' | 'shell';

export interface ApprovalContext {
  policy: OrgApprovalPolicy;
  toolKind: OrgToolKind;
  /** Whether the operation's target stays strictly inside the assigned project folder. */
  inFolder: boolean;
  /**
   * When set, the operation must always ask the user regardless of policy level
   * (destructive command outside folder, git push/--force, global install, registry/
   * system/assistant settings change, downloaded executable, etc.).
   */
  alwaysAskReason?: string;
}

export interface ApprovalDecision {
  decision: 'allow' | 'ask' | 'deny';
  reason: string;
}

export function normalizeApprovalPolicy(value: unknown): OrgApprovalPolicy {
  if (value === 'read_only' || value === 'auto_edit' || value === 'full_auto') {
    return value;
  }
  return DEFAULT_APPROVAL_POLICY;
}

/**
 * Pure evaluation of an operation against a project approval policy.
 *
 * Rules:
 * 1. Any `alwaysAskReason` forces `ask` (destructive / system / network / settings).
 * 2. Any operation whose target is outside the folder forces `ask` (the folder jail in
 *    the process layer still hard-denies filesystem escapes; this governs the shell path
 *    and destructive-outside cases which must stop for a human).
 * 3. Otherwise the policy decides:
 *    - read_only : only reads are free.
 *    - auto_edit : reads and in-folder writes are free; shell asks.
 *    - full_auto : reads, writes and in-folder shell are free.
 */
export function evaluateApproval(ctx: ApprovalContext): ApprovalDecision {
  const policy = normalizeApprovalPolicy(ctx.policy);

  if (ctx.alwaysAskReason) {
    return { decision: 'ask', reason: ctx.alwaysAskReason };
  }

  if (!ctx.inFolder) {
    return {
      decision: 'ask',
      reason: 'Operation targets a path outside the assigned project folder',
    };
  }

  if (ctx.toolKind === 'read') {
    return { decision: 'allow', reason: 'Read-only operation' };
  }

  if (policy === 'read_only') {
    return {
      decision: 'ask',
      reason: `Project policy is read_only: ${ctx.toolKind === 'write' ? 'file edits' : 'shell commands'} require approval`,
    };
  }

  if (ctx.toolKind === 'write') {
    // read_only handled above; auto_edit and full_auto both allow in-folder writes.
    return { decision: 'allow', reason: 'In-folder file edit permitted by policy' };
  }

  // toolKind === 'shell'
  if (policy === 'full_auto') {
    return { decision: 'allow', reason: 'In-folder shell permitted by full_auto policy' };
  }

  // auto_edit: shell commands always ask.
  return { decision: 'ask', reason: 'Project policy is auto_edit: shell commands require approval' };
}