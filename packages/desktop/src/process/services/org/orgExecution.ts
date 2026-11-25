/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'node:fs';
import { OrgFolderTools } from './folderTools';
import { evaluateApproval, type OrgApprovalPolicy } from './orgApprovalPolicy';
import { appendAuditEntry, type OrgAuditEntry } from './orgAuditLog';
import { issueCommandApprovalToken, issueFileApprovalToken } from './orgApproval';
import { assertWithinScope } from './pathGuard';

/**
 * Process-side execution of org agent shell/file tools.
 *
 * All operations are jailed to the assigned project folder (enforced by OrgFolderTools /
 * pathGuard, which resolve symlinks and reject "..", absolute and other-drive escapes),
 * gated by the per-project approval policy, and recorded in the per-project audit log.
 *
 * Approval is requested through an injectable broker so this module stays unit-testable and
 * free of Electron imports. In production the broker forwards the request to the renderer,
 * which shows a blocking approval card; when no broker is available the request fails closed.
 */

export type ApprovalKind = 'shell' | 'file_write' | 'file_read';

export interface ApprovalRequest {
  kind: ApprovalKind;
  projectId: string;
  reason: string;
  command?: string;
  cwd?: string;
  filePath?: string;
}

export type ApprovalBroker = (req: ApprovalRequest) => Promise<'allow' | 'deny'>;

let globalBroker: ApprovalBroker | null = null;

/** Register the process-wide approval broker (production: forwards to renderer UI). */
export function setOrgBashApprovalBroker(broker: ApprovalBroker | null): void {
  globalBroker = broker;
}

/** Default fail-closed broker: deny when no UI broker is registered. */
async function defaultBroker(req: ApprovalRequest): Promise<'allow' | 'deny'> {
  console.warn(`[orgExecution] No approval broker registered; denying ${req.kind} for project ${req.projectId}.`);
  return 'deny';
}

export interface OrgCtx {
  projectId: string;
  /** Absolute path to the project folder (the jail root for this operation). */
  projectFolder: string;
  policy: OrgApprovalPolicy;
  /** Optional per-project extra allowed roots (must already be validated within master root). */
  allowlist?: string[];
}

export interface ExecResult {
  success: boolean;
  needsApproval?: boolean;
  denied?: boolean;
  error?: string;
  reason?: string;
  // shell
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  // read
  content?: string;
  size?: number;
  truncated?: boolean;
  // write
  filePath?: string;
  command?: string;
}

function isOutsideRiskReason(reason?: string): boolean {
  if (!reason) return false;
  return /outside|traversal|home directory|system absolute|change directory out|Redirection/i.test(reason);
}

function audit(
  masterRoot: string | null,
  entry: Partial<OrgAuditEntry> & { kind: OrgAuditEntry['kind']; summary: string }
): void {
  appendAuditEntry(masterRoot, {
    id: '',
    timestamp: Date.now(),
    projectId: currentProjectId,
    ...entry,
  } as OrgAuditEntry);
}

// The active project id is threaded through a module-scoped variable so the small audit()
// helper above can attach it without every call site repeating it. Execution is serialized
// per call, so this is safe within a single Node tick boundary.
let currentProjectId = '';

function withProject<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = currentProjectId;
  currentProjectId = projectId;
  return fn().finally(() => {
    currentProjectId = prev;
  });
}

/** Resolve a possibly-relative cwd to an absolute path and verify it is inside the project folder. */
async function resolveCwd(cwdArg: string | undefined, ctx: OrgCtx): Promise<{ cwd: string; inFolder: boolean }> {
  const raw = cwdArg && cwdArg.trim() ? cwdArg.trim() : ctx.projectFolder;
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(ctx.projectFolder, raw);
  const check = await assertWithinScope(resolved, ctx.projectFolder);
  return { cwd: check.allowed ? check.resolved : resolved, inFolder: check.allowed };
}

async function resolveTarget(
  targetArg: string | undefined,
  ctx: OrgCtx,
  options?: { allowReadOnlyKnowledge?: boolean }
): Promise<{ target: string; inFolder: boolean; error?: string }> {
  if (!targetArg || !targetArg.trim()) {
    return { target: '', inFolder: false, error: 'Missing file path' };
  }
  const raw = targetArg.trim();
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(ctx.projectFolder, raw);
  const check = await assertWithinScope(resolved, ctx.projectFolder, {
    allowReadOnlyKnowledge: options?.allowReadOnlyKnowledge,
  });
  return { target: check.allowed ? check.resolved : resolved, inFolder: check.allowed };
}

export async function executeListDir(
  args: { path?: string },
  ctx: OrgCtx,
  _opts: { masterRoot?: string | null; broker?: ApprovalBroker } = {}
): Promise<ExecResult> {
  return withProject(ctx.projectId, async () => {
    const { target, inFolder } = await resolveTarget(args.path ?? ctx.projectFolder, ctx, {
      allowReadOnlyKnowledge: true,
    });
    if (!inFolder) {
      return { success: false, error: `Access denied: "${target}" is outside the project folder` };
    }
    try {
      const entries = await OrgFolderTools.listDir(target, ctx.projectFolder, {
        allowReadOnlyKnowledge: true,
      });
      return { success: true, content: JSON.stringify(entries) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export async function executeReadFile(
  args: { path: string },
  ctx: OrgCtx,
  opts: { masterRoot?: string | null; broker?: ApprovalBroker; approvalToken?: string; maxBytes?: number } = {}
): Promise<ExecResult> {
  return withProject(ctx.projectId, async () => {
    const { target, inFolder } = await resolveTarget(args.path, ctx, {
      allowReadOnlyKnowledge: true,
    });
    if (!inFolder) {
      audit(opts.masterRoot ?? null, {
        kind: 'approval',
        summary: 'Blocked read outside project folder',
        filePath: target,
        decision: 'deny',
        reason: 'outside project folder',
      });
      return { success: false, error: `Access denied: "${target}" is outside the project folder` };
    }

    try {
      const res = await OrgFolderTools.readFile(target, ctx.projectFolder, opts.maxBytes, {
        approvalToken: opts.approvalToken,
        allowReadOnlyKnowledge: true,
      });
      return { success: true, content: res.content, size: res.size, truncated: res.truncated, filePath: target };
    } catch (err) {
      const e = err as { needsApproval?: boolean; reason?: string; message?: string };
      if (e?.needsApproval) {
        // Sensitive file: require approval.
        const broker = opts.broker ?? globalBroker ?? defaultBroker;
        const decision = await broker({
          kind: 'file_read',
          projectId: ctx.projectId,
          reason: e.reason || 'Sensitive file read',
          filePath: target,
        });
        audit(opts.masterRoot ?? null, {
          kind: 'approval',
          summary: `Sensitive file read ${decision === 'allow' ? 'approved' : 'rejected'}`,
          filePath: target,
          decision: decision === 'allow' ? 'approved' : 'rejected',
          reason: e.reason,
        });
        if (decision !== 'allow') {
          return { success: false, needsApproval: true, denied: true, reason: e.reason, error: e.message };
        }
        const token = issueFileApprovalToken(target);
        try {
          const retry = await OrgFolderTools.readFile(target, ctx.projectFolder, opts.maxBytes, {
            approvalToken: token,
            allowReadOnlyKnowledge: true,
          });
          return {
            success: true,
            content: retry.content,
            size: retry.size,
            truncated: retry.truncated,
            filePath: target,
          };
        } catch (retryErr) {
          return { success: false, error: retryErr instanceof Error ? retryErr.message : String(retryErr) };
        }
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export async function executeWriteFile(
  args: { path: string; content: string },
  ctx: OrgCtx,
  opts: { masterRoot?: string | null; broker?: ApprovalBroker } = {}
): Promise<ExecResult> {
  return withProject(ctx.projectId, async () => {
    const { target, inFolder } = await resolveTarget(args.path, ctx);
    if (!inFolder) {
      audit(opts.masterRoot ?? null, {
        kind: 'approval',
        summary: 'Blocked write outside project folder',
        filePath: target,
        decision: 'deny',
        reason: 'outside project folder',
      });
      return { success: false, error: `Access denied: "${target}" is outside the project folder` };
    }

    const decision = evaluateApproval({ policy: ctx.policy, toolKind: 'write', inFolder });
    if (decision.decision === 'ask') {
      const broker = opts.broker ?? globalBroker ?? defaultBroker;
      const appr = await broker({
        kind: 'file_write',
        projectId: ctx.projectId,
        reason: decision.reason,
        filePath: target,
      });
      audit(opts.masterRoot ?? null, {
        kind: 'approval',
        summary: `File write ${appr === 'allow' ? 'approved' : 'rejected'}: ${path.basename(target)}`,
        filePath: target,
        decision: appr === 'allow' ? 'approved' : 'rejected',
        reason: decision.reason,
      });
      if (appr !== 'allow') {
        return { success: false, needsApproval: true, denied: true, reason: decision.reason };
      }
    }

    // Capture previous content for diff (best-effort).
    let oldContent = '';
    try {
      if (fs.existsSync(target)) {
        oldContent = fs.readFileSync(target, 'utf8');
      }
    } catch {
      oldContent = '';
    }

    try {
      await OrgFolderTools.writeFile(target, args.content, ctx.projectFolder);
      const diff = buildSimpleDiff(oldContent, args.content);
      audit(opts.masterRoot ?? null, {
        kind: 'file_change',
        summary: `Wrote ${path.basename(target)}`,
        filePath: target,
        diff,
      });
      return { success: true, filePath: target };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export async function executeRunShell(
  args: { command: string; cwd?: string; timeoutMs?: number },
  ctx: OrgCtx,
  opts: {
    masterRoot?: string | null;
    broker?: ApprovalBroker;
    approvalToken?: string;
    onOutput?: (chunk: string) => void;
    projectId?: string;
  } = {}
): Promise<ExecResult> {
  return withProject(ctx.projectId, async () => {
    if (!args.command || typeof args.command !== 'string') {
      return { success: false, error: 'Missing command' };
    }
    const { cwd, inFolder: cwdInFolder } = await resolveCwd(args.cwd, ctx);
    if (!cwdInFolder) {
      audit(opts.masterRoot ?? null, {
        kind: 'approval',
        summary: 'Blocked shell: working directory outside project folder',
        command: args.command,
        cwd,
        decision: 'deny',
        reason: 'cwd outside project folder',
      });
      return { success: false, error: `Access denied: working directory "${cwd}" is outside the project folder` };
    }

    // Delegate risk classification to the existing denylist, then map to policy.
    const risk = (await import('./folderTools')).checkRiskyCommand(args.command, cwd);
    const outsideRisk = isOutsideRiskReason(risk.reason);
    const alwaysAsk = risk.isRisky && !outsideRisk ? risk.reason : undefined;
    const inFolder = !outsideRisk;

    const decision = evaluateApproval({ policy: ctx.policy, toolKind: 'shell', inFolder, alwaysAskReason: alwaysAsk });

    if (decision.decision === 'ask') {
      const broker = opts.broker ?? globalBroker ?? defaultBroker;
      const appr = await broker({
        kind: 'shell',
        projectId: ctx.projectId,
        reason: decision.reason,
        command: args.command,
        cwd,
      });
      audit(opts.masterRoot ?? null, {
        kind: 'approval',
        summary: `Shell ${appr === 'allow' ? 'approved' : 'rejected'}: ${args.command.slice(0, 120)}`,
        command: args.command,
        cwd,
        decision: appr === 'allow' ? 'approved' : 'rejected',
        reason: decision.reason,
      });
      if (appr !== 'allow') {
        return {
          success: false,
          needsApproval: true,
          denied: true,
          reason: decision.reason,
          error: `Command requires approval: ${decision.reason}`,
          command: args.command,
        };
      }
    }

    // If a risky command was approved by the user, mint a single-use token so the shell
    // layer (which independently rejects risky commands) will execute it exactly once.
    let effectiveToken = opts.approvalToken;
    if (decision.decision === 'allow' && risk.isRisky && !outsideRisk) {
      effectiveToken = issueCommandApprovalToken(args.command, cwd);
    }

    try {
      const res = await OrgFolderTools.runShell(args.command, cwd, ctx.projectFolder, {
        timeoutMs: args.timeoutMs,
        approvalToken: effectiveToken,
        onOutput: opts.onOutput,
        projectId: opts.projectId,
      });
      audit(opts.masterRoot ?? null, {
        kind: 'command',
        summary: `Ran: ${args.command.slice(0, 120)}`,
        command: args.command,
        cwd,
        exitCode: res.exitCode,
        timedOut: res.timedOut,
      });
      return {
        success: true,
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        timedOut: res.timedOut,
        command: args.command,
      };
    } catch (err) {
      const e = err as { needsApproval?: boolean; reason?: string; message?: string };
      if (e?.needsApproval) {
        // Risky command reached the shell layer without a policy approval (e.g. retry path).
        return {
          success: false,
          needsApproval: true,
          reason: e.reason,
          error: e.message,
          command: args.command,
        };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/** Minimal line-based unified-ish diff used for the audit log (no external deps in main process). */
function buildSimpleDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent ? oldContent.split('\n') : [];
  const newLines = newContent ? newContent.split('\n') : [];
  const out: string[] = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) continue;
    if (o !== undefined) out.push(`-${o}`);
    if (n !== undefined) out.push(`+${n}`);
  }
  return out.join('\n');
}
