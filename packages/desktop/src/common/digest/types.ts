/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type DigestRunItem = {
  id: string;
  status: string;
  trigger: string;
  team_id?: string;
  project_id?: string;
  durationMs?: number;
  costText: string;
  hasUnknownCost: boolean;
};

export type DigestOutputItem = {
  id: string;
  title: string;
  link: string;
  type: 'conversation' | 'team' | 'artifact';
  timestamp: number;
};

export type DigestApprovalItem = {
  id: string;
  callId: string;
  conversationId: string;
  title: string;
  teamName?: string;
  agentName?: string;
  command?: string;
  createdAt: number;
};

export type DigestSummary = {
  id: string;
  generatedAt: number;
  periodStart: number;
  periodEnd: number;
  dateString: string;
  runs: {
    completed: number;
    failed: number;
    waiting: number;
    paused: number;
    total: number;
    items: DigestRunItem[];
  };
  outputs: DigestOutputItem[];
  spend: {
    totalSpend: number;
    hasUnknown: boolean;
    costText: string;
    todayBudget?: number;
    budgetRatio?: number;
  };
  approvals: DigestApprovalItem[];
  markdown: string;
};

export type DigestConfig = {
  enabled: boolean;
  time: string; // e.g. "08:00"
  timezone: string; // e.g. "America/New_York", "Asia/Shanghai"
  deliveryChannels: string[]; // e.g. ['today_panel', 'telegram']
};
