/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { loadInboxItems } from '@/common/autonomy/approvalsInboxStore';
import { formatCost } from '../costs/priceTable';
import { getSpendForRun, listRuns } from '../costs/costLedgerStore';
import type { DigestApprovalItem, DigestOutputItem, DigestRunItem, DigestSummary } from './types';

export function generateMorningDigest(options?: {
  now?: number;
  timezone?: string;
  injectedApprovals?: ReturnType<typeof loadInboxItems>;
  injectedRuns?: ReturnType<typeof listRuns>;
}): DigestSummary {
  const periodEnd = options?.now ?? Date.now();
  const periodStart = periodEnd - 24 * 60 * 60 * 1000; // last 24 hours

  const allRuns = options?.injectedRuns ?? listRuns();
  const recentRuns = allRuns.filter((r) => r.started_at >= periodStart && r.started_at <= periodEnd);

  let completedCount = 0;
  let failedCount = 0;
  let waitingCount = 0;
  let pausedCount = 0;
  let totalSpend = 0;
  let hasUnknownSpend = false;

  const runItems: DigestRunItem[] = [];
  const outputs: DigestOutputItem[] = [];

  for (const r of recentRuns) {
    if (r.status === 'completed') completedCount++;
    else if (r.status === 'failed') failedCount++;
    else if (r.status === 'paused') pausedCount++;
    else waitingCount++;

    const spendInfo = getSpendForRun(r.id);
    totalSpend += spendInfo.totalSpend;
    if (spendInfo.hasUnknown) hasUnknownSpend = true;

    const durationMs = r.ended_at ? r.ended_at - r.started_at : undefined;
    const costText = spendInfo.hasUnknown
      ? spendInfo.totalSpend > 0
        ? `~${formatCost(spendInfo.totalSpend)} (est)`
        : 'unknown'
      : formatCost(spendInfo.totalSpend);

    runItems.push({
      id: r.id,
      status: r.status,
      trigger: r.trigger,
      team_id: r.team_id,
      project_id: r.project_id,
      durationMs,
      costText,
      hasUnknownCost: spendInfo.hasUnknown,
    });

    if (r.status === 'completed') {
      const targetLink = r.team_id ? `#/team/${r.team_id}` : `#/conversation/${r.id}`;
      outputs.push({
        id: `out_${r.id}`,
        title: `Run ${r.id} Output (${r.trigger})`,
        link: targetLink,
        type: r.team_id ? 'team' : 'conversation',
        timestamp: r.ended_at ?? r.started_at,
      });
    }
  }

  // Pending items needing approval
  const rawApprovals = options?.injectedApprovals ?? loadInboxItems();
  const approvals: DigestApprovalItem[] = rawApprovals.map((item) => ({
    id: item.id,
    callId: item.callId,
    conversationId: item.conversationId,
    title: item.title,
    teamName: item.teamName,
    agentName: item.agentName,
    command: item.command,
    createdAt: item.createdAt,
  }));

  const dateObj = new Date(periodEnd);
  const dateString = dateObj.toISOString().split('T')[0];

  const totalSpendRounded = Math.round(totalSpend * 1_000_000) / 1_000_000;
  const overallCostText = hasUnknownSpend
    ? totalSpendRounded > 0
      ? `~${formatCost(totalSpendRounded)} (est with unknown CLI usage)`
      : 'unknown'
    : formatCost(totalSpendRounded);

  // Build Markdown digest
  const mdLines: string[] = [
    `# 🌅 Morning Digest — ${dateString}`,
    '',
    '## 📊 24h Executions',
    `- **Completed:** ${completedCount}`,
    `- **Failed:** ${failedCount}`,
    `- **Waiting / In-Progress:** ${waitingCount}`,
    `- **Paused:** ${pausedCount}`,
    `- **Total Runs:** ${recentRuns.length}`,
    '',
    '## 💰 Spend & Budgets',
    `- **24h Spend:** ${overallCostText}`,
    '',
    '## 📁 Outputs Produced',
  ];

  if (outputs.length === 0) {
    mdLines.push('- *No outputs produced in the last 24 hours.*');
  } else {
    for (const out of outputs) {
      mdLines.push(`- [${out.title}](${out.link})`);
    }
  }

  mdLines.push('', `## ⚠️ Items Needing Approval (${approvals.length})`);
  if (approvals.length === 0) {
    mdLines.push('- *No items requiring approval. You are all clear!*');
  } else {
    for (const app of approvals) {
      const teamStr = app.teamName ? ` (Team: ${app.teamName})` : '';
      const cmdStr = app.command ? ` — \`${app.command}\`` : '';
      mdLines.push(`- **${app.title}**${teamStr}${cmdStr}`);
    }
  }

  const markdown = mdLines.join('\n');

  return {
    id: `digest_${dateString}_${periodEnd}`,
    generatedAt: periodEnd,
    periodStart,
    periodEnd,
    dateString,
    runs: {
      completed: completedCount,
      failed: failedCount,
      waiting: waitingCount,
      paused: pausedCount,
      total: recentRuns.length,
      items: runItems,
    },
    outputs,
    spend: {
      totalSpend: totalSpendRounded,
      hasUnknown: hasUnknownSpend,
      costText: overallCostText,
    },
    approvals,
    markdown,
  };
}
