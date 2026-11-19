/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Member final report generator.
 * Collects audit entries, tool results, and git diff to produce a structured report.
 */

export interface ToolExecutionSummary {
  tool: string;
  args: Record<string, any>;
  success: boolean;
  error?: string;
  durationMs?: number;
  timestamp: number;
}

export interface GitDiffSummary {
  hasChanges: boolean;
  filesChanged: number;
  additions: number;
  deletions: number;
  diff: string;
}

export interface MemberFinalReport {
  memberId: string;
  memberName: string;
  role: string;
  projectId: string;
  projectName: string;
  taskDescription: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  toolExecutions: ToolExecutionSummary[];
  gitDiff: GitDiffSummary;
  auditEntries: Array<{
    kind: string;
    summary: string;
    timestamp: number;
    command?: string;
    filePath?: string;
    decision?: string;
    reason?: string;
  }>;
  finalStatus: 'success' | 'failed' | 'partial';
  summary: string;
}

/**
 * Generate a git diff for the project folder.
 */
export async function generateGitDiff(projectFolder: string): Promise<GitDiffSummary> {
  if (!fs.existsSync(path.join(projectFolder, '.git'))) {
    return {
      hasChanges: false,
      filesChanged: 0,
      additions: 0,
      deletions: 0,
      diff: 'Not a git repository',
    };
  }

  return new Promise((resolve) => {
    const proc = spawn('git', ['diff', '--stat'], { cwd: projectFolder, windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({
          hasChanges: false,
          filesChanged: 0,
          additions: 0,
          deletions: 0,
          diff: `git diff failed: ${stderr}`,
        });
        return;
      }

      // Parse --stat output: " 3 files changed, 45 insertions(+), 12 deletions(-)"
      const statMatch = stdout.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
      const filesChanged = statMatch ? parseInt(statMatch[1], 10) : 0;
      const additions = statMatch && statMatch[2] ? parseInt(statMatch[2], 10) : 0;
      const deletions = statMatch && statMatch[3] ? parseInt(statMatch[3], 10) : 0;

      // Get full diff
      const diffProc = spawn('git', ['diff'], { cwd: projectFolder, windowsHide: true });
      let diffOut = '';
      let diffErr = '';
      diffProc.stdout.on('data', (d) => (diffOut += d.toString()));
      diffProc.stderr.on('data', (d) => (diffErr += d.toString()));
      diffProc.on('close', (diffCode) => {
        const diff = diffCode === 0 ? diffOut : `git diff failed: ${diffErr}`;
        resolve({
          hasChanges: filesChanged > 0 || additions > 0 || deletions > 0,
          filesChanged,
          additions,
          deletions,
          diff,
        });
      });
    });
  });
}

/**
 * Read audit log entries for a project.
 */
export function readProjectAuditLog(
  projectFolder: string,
  since?: number
): Array<{
  kind: string;
  summary: string;
  timestamp: number;
  command?: string;
  filePath?: string;
  decision?: string;
  reason?: string;
}> {
  const auditDir = path.join(projectFolder, '.aionui-audit');
  if (!fs.existsSync(auditDir)) return [];

  const files = fs
    .readdirSync(auditDir)
    .filter((f) => f.endsWith('.json'))
    .toSorted()
    .toReversed(); // newest first

  const entries: Array<{
    kind: string;
    summary: string;
    timestamp: number;
    command?: string;
    filePath?: string;
    decision?: string;
    reason?: string;
  }> = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(auditDir, file), 'utf8');
      const logEntry = JSON.parse(content);
      if (since && logEntry.timestamp < since) continue;
      entries.push({
        kind: logEntry.kind,
        summary: logEntry.summary,
        timestamp: logEntry.timestamp,
        command: logEntry.command,
        filePath: logEntry.filePath,
        decision: logEntry.decision,
        reason: logEntry.reason,
      });
    } catch {
      // skip malformed entries
    }
  }

  return entries;
}

/**
 * Build a member final report from task context and audit log.
 */
export async function buildMemberFinalReport(params: {
  memberId: string;
  memberName: string;
  role: string;
  projectId: string;
  projectName: string;
  projectFolder: string;
  taskDescription: string;
  startedAt: number;
  toolExecutions: ToolExecutionSummary[];
}): Promise<MemberFinalReport> {
  const completedAt = Date.now();
  const auditEntries = readProjectAuditLog(params.projectFolder, params.startedAt);
  const gitDiff = await generateGitDiff(params.projectFolder);

  // Determine final status
  const failedTools = params.toolExecutions.filter((t) => !t.success).length;
  const totalTools = params.toolExecutions.length;
  let finalStatus: 'success' | 'failed' | 'partial' = 'success';
  if (totalTools > 0 && failedTools === totalTools) finalStatus = 'failed';
  else if (failedTools > 0) finalStatus = 'partial';

  // Build summary
  const successCount = totalTools - failedTools;
  const summary =
    `Task "${params.taskDescription}" completed with ${finalStatus} status. ` +
    `Executed ${totalTools} tool(s) (${successCount} succeeded, ${failedTools} failed). ` +
    `Git: ${gitDiff.filesChanged} files changed, ${gitDiff.additions} additions, ${gitDiff.deletions} deletions.`;

  return {
    memberId: params.memberId,
    memberName: params.memberName,
    role: params.role,
    projectId: params.projectId,
    projectName: params.projectName,
    taskDescription: params.taskDescription,
    startedAt: params.startedAt,
    completedAt,
    durationMs: completedAt - params.startedAt,
    toolExecutions: params.toolExecutions,
    gitDiff,
    auditEntries,
    finalStatus,
    summary,
  };
}

/**
 * Format report as markdown for display.
 */
export function formatReportAsMarkdown(report: MemberFinalReport): string {
  const lines: string[] = [];
  lines.push(`# Final Report: ${report.memberName} (${report.role})`);
  lines.push('');
  lines.push(`**Project:** ${report.projectName} (${report.projectId})`);
  lines.push(`**Task:** ${report.taskDescription}`);
  lines.push(`**Duration:** ${formatDuration(report.durationMs)}`);
  lines.push(`**Status:** ${report.finalStatus.toUpperCase()}`);
  lines.push(`**Started:** ${new Date(report.startedAt).toISOString()}`);
  lines.push(`**Completed:** ${new Date(report.completedAt).toISOString()}`);
  lines.push('');

  lines.push('## Summary');
  lines.push(report.summary);
  lines.push('');

  lines.push('## Tool Executions');
  if (report.toolExecutions.length === 0) {
    lines.push('*No tool executions recorded.*');
  } else {
    lines.push('| Tool | Args | Status | Duration |');
    lines.push('|------|------|--------|----------|');
    for (const t of report.toolExecutions) {
      const argsStr = JSON.stringify(t.args).slice(0, 80);
      const status = t.success ? '✅' : '❌';
      const dur = t.durationMs ? `${t.durationMs}ms` : 'N/A';
      lines.push(`| ${t.tool} | ${argsStr} | ${status} | ${dur} |`);
    }
  }
  lines.push('');

  lines.push('## Git Diff');
  if (report.gitDiff.hasChanges) {
    lines.push('```diff');
    lines.push(report.gitDiff.diff.slice(0, 5000));
    if (report.gitDiff.diff.length > 5000) lines.push('... (truncated)');
    lines.push('```');
  } else {
    lines.push('*No git changes.*');
  }
  lines.push('');

  lines.push('## Audit Log');
  if (report.auditEntries.length === 0) {
    lines.push('*No audit entries.*');
  } else {
    lines.push('| Time | Kind | Summary |');
    lines.push('|------|------|---------|');
    for (const a of report.auditEntries.slice(0, 50)) {
      const time = new Date(a.timestamp).toISOString().slice(11, 23);
      lines.push(`| ${time} | ${a.kind} | ${a.summary} |`);
    }
    if (report.auditEntries.length > 50) {
      lines.push(`| ... | ... | +${report.auditEntries.length - 50} more entries |`);
    }
  }

  return lines.join('\n');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}
