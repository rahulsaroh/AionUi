/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type RunTrigger = 'manual' | 'cron' | 'channel';

export type RunStatus = 'running' | 'completed' | 'failed' | 'paused' | 'waiting';

export type RunRecord = {
  id: string;
  project_id?: string;
  team_id?: string;
  trigger: RunTrigger;
  started_at: number;
  ended_at?: number;
  status: RunStatus;
};

export type UsageLedgerEntry = {
  id: string;
  run_id: string;
  agent_role: string;
  provider: string;
  model: string;
  input_tokens: number | null; // null represents "unknown"
  output_tokens: number | null; // null represents "unknown"
  estimated_cost: number | null; // null represents "unknown"
  created_at: number;
};

export type BudgetScopeType = 'run' | 'team_daily' | 'department_monthly';

export type BudgetRecord = {
  id: string;
  scope_type: BudgetScopeType;
  scope_id: string;
  amount: number;
  created_at: number;
  updated_at: number;
};

export type BudgetEvaluation = {
  allowed: boolean;
  warned: boolean;
  currentSpend: number;
  limit: number;
  ratio: number;
  scopeType: BudgetScopeType;
  scopeId: string;
};

export type PriceEntry = {
  inputPricePerM: number; // USD per 1M tokens
  outputPricePerM: number; // USD per 1M tokens
};

export type PriceTable = Record<string, PriceEntry>;
