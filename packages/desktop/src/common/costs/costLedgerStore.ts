/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { calculateCost } from './priceTable';
import type { BudgetRecord, BudgetScopeType, RunRecord, RunStatus, RunTrigger, UsageLedgerEntry } from './types';

const RUNS_STORAGE_KEY = 'aionui:runs';
const LEDGER_STORAGE_KEY = 'aionui:usage-ledger';
const BUDGETS_STORAGE_KEY = 'aionui:budgets';

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

let inMemoryRuns: Map<string, RunRecord> = new Map();
let inMemoryLedger: Map<string, UsageLedgerEntry> = new Map();
let inMemoryBudgets: Map<string, BudgetRecord> = new Map();
let isInitialized = false;

function initStorage(): void {
  if (isInitialized) return;
  isInitialized = true;

  try {
    if (typeof localStorage !== 'undefined') {
      const runsRaw = localStorage.getItem(RUNS_STORAGE_KEY);
      if (runsRaw) {
        const arr = JSON.parse(runsRaw) as RunRecord[];
        for (const item of arr) inMemoryRuns.set(item.id, item);
      }

      const ledgerRaw = localStorage.getItem(LEDGER_STORAGE_KEY);
      if (ledgerRaw) {
        const arr = JSON.parse(ledgerRaw) as UsageLedgerEntry[];
        for (const item of arr) inMemoryLedger.set(item.id, item);
      }

      const budgetsRaw = localStorage.getItem(BUDGETS_STORAGE_KEY);
      if (budgetsRaw) {
        const arr = JSON.parse(budgetsRaw) as BudgetRecord[];
        for (const item of arr) inMemoryBudgets.set(`${item.scope_type}:${item.scope_id}`, item);
      }
    }
  } catch (err) {
    console.warn('[CostLedgerStore] Failed to initialize storage:', err);
  }
}

function persistRuns(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RUNS_STORAGE_KEY, JSON.stringify(Array.from(inMemoryRuns.values())));
    }
  } catch (err) {
    console.warn('[CostLedgerStore] Failed to persist runs:', err);
  }
}

function persistLedger(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(Array.from(inMemoryLedger.values())));
    }
  } catch (err) {
    console.warn('[CostLedgerStore] Failed to persist ledger:', err);
  }
}

function persistBudgets(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(BUDGETS_STORAGE_KEY, JSON.stringify(Array.from(inMemoryBudgets.values())));
    }
  } catch (err) {
    console.warn('[CostLedgerStore] Failed to persist budgets:', err);
  }
}

// ---------------------------------------------------------------------------
// Run Management
// ---------------------------------------------------------------------------

export function recordRunStart(params: {
  id: string;
  project_id?: string;
  team_id?: string;
  trigger: RunTrigger;
  status?: RunStatus;
  started_at?: number;
}): RunRecord {
  initStorage();
  const existing = inMemoryRuns.get(params.id);
  const run: RunRecord = {
    id: params.id,
    project_id: params.project_id ?? existing?.project_id,
    team_id: params.team_id ?? existing?.team_id,
    trigger: params.trigger,
    started_at: params.started_at ?? existing?.started_at ?? Date.now(),
    status: params.status ?? existing?.status ?? 'running',
    ended_at: existing?.ended_at,
  };

  inMemoryRuns.set(run.id, run);
  persistRuns();
  notify();
  return run;
}

export function updateRunStatus(id: string, status: RunStatus, ended_at?: number): RunRecord | null {
  initStorage();
  const run = inMemoryRuns.get(id);
  if (!run) return null;

  run.status = status;
  if (ended_at !== undefined) {
    run.ended_at = ended_at;
  } else if (status === 'completed' || status === 'failed') {
    run.ended_at = run.ended_at ?? Date.now();
  }

  inMemoryRuns.set(id, run);
  persistRuns();
  notify();
  return run;
}

export function getRun(id: string): RunRecord | undefined {
  initStorage();
  return inMemoryRuns.get(id);
}

export function listRuns(filter?: {
  project_id?: string;
  team_id?: string;
  trigger?: RunTrigger;
  status?: RunStatus;
}): RunRecord[] {
  initStorage();
  const all = Array.from(inMemoryRuns.values()).toSorted((a, b) => b.started_at - a.started_at);
  if (!filter) return all;

  return all.filter((r) => {
    if (filter.project_id && r.project_id !== filter.project_id) return false;
    if (filter.team_id && r.team_id !== filter.team_id) return false;
    if (filter.trigger && r.trigger !== filter.trigger) return false;
    if (filter.status && r.status !== filter.status) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Usage Ledger Management
// ---------------------------------------------------------------------------

export function recordUsage(params: {
  run_id: string;
  agent_role: string;
  provider: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost?: number | null;
  created_at?: number;
}): UsageLedgerEntry {
  initStorage();

  // If cost not provided, calculate it using price table; null if tokens are unknown
  const estimated_cost =
    params.estimated_cost !== undefined
      ? params.estimated_cost
      : calculateCost(params.model, params.input_tokens, params.output_tokens);

  const entry: UsageLedgerEntry = {
    id: `usg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    run_id: params.run_id,
    agent_role: params.agent_role,
    provider: params.provider,
    model: params.model,
    input_tokens: params.input_tokens,
    output_tokens: params.output_tokens,
    estimated_cost,
    created_at: params.created_at ?? Date.now(),
  };

  inMemoryLedger.set(entry.id, entry);
  persistLedger();
  notify();
  return entry;
}

export function getLedgerEntries(run_id?: string): UsageLedgerEntry[] {
  initStorage();
  const all = Array.from(inMemoryLedger.values()).toSorted((a, b) => a.created_at - b.created_at);
  if (!run_id) return all;
  return all.filter((e) => e.run_id === run_id);
}

export function getSpendForRun(run_id: string): {
  totalSpend: number;
  hasUnknown: boolean;
  entryCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
} {
  initStorage();
  const entries = getLedgerEntries(run_id);
  let totalSpend = 0;
  let hasUnknown = false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const e of entries) {
    if (e.estimated_cost === null) {
      hasUnknown = true;
    } else {
      totalSpend += e.estimated_cost;
    }

    if (e.input_tokens !== null) totalInputTokens += e.input_tokens;
    if (e.output_tokens !== null) totalOutputTokens += e.output_tokens;
    if (e.input_tokens === null || e.output_tokens === null) hasUnknown = true;
  }

  return {
    totalSpend: Math.round(totalSpend * 1_000_000) / 1_000_000,
    hasUnknown,
    entryCount: entries.length,
    totalInputTokens,
    totalOutputTokens,
  };
}

export function getSpendForTeam(
  team_id: string,
  sinceTimestamp?: number
): {
  totalSpend: number;
  hasUnknown: boolean;
  runCount: number;
} {
  initStorage();
  const runs = listRuns({ team_id });
  const matchingRuns = sinceTimestamp ? runs.filter((r) => r.started_at >= sinceTimestamp) : runs;
  const runIds = new Set(matchingRuns.map((r) => r.id));

  let totalSpend = 0;
  let hasUnknown = false;

  for (const entry of inMemoryLedger.values()) {
    if (runIds.has(entry.run_id)) {
      if (sinceTimestamp && entry.created_at < sinceTimestamp) continue;
      if (entry.estimated_cost === null) {
        hasUnknown = true;
      } else {
        totalSpend += entry.estimated_cost;
      }
    }
  }

  return {
    totalSpend: Math.round(totalSpend * 1_000_000) / 1_000_000,
    hasUnknown,
    runCount: matchingRuns.length,
  };
}

export function getSpendToday(team_id?: string): {
  totalSpend: number;
  hasUnknown: boolean;
} {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const since = startOfDay.getTime();

  if (team_id) {
    return getSpendForTeam(team_id, since);
  }

  initStorage();
  let totalSpend = 0;
  let hasUnknown = false;

  for (const entry of inMemoryLedger.values()) {
    if (entry.created_at >= since) {
      if (entry.estimated_cost === null) {
        hasUnknown = true;
      } else {
        totalSpend += entry.estimated_cost;
      }
    }
  }

  return {
    totalSpend: Math.round(totalSpend * 1_000_000) / 1_000_000,
    hasUnknown,
  };
}

export function getSpendThisMonthForDepartment(teamIdsInDept: string[]): {
  totalSpend: number;
  hasUnknown: boolean;
} {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const since = startOfMonth.getTime();

  let totalSpend = 0;
  let hasUnknown = false;

  for (const teamId of teamIdsInDept) {
    const teamSpend = getSpendForTeam(teamId, since);
    totalSpend += teamSpend.totalSpend;
    if (teamSpend.hasUnknown) hasUnknown = true;
  }

  return {
    totalSpend: Math.round(totalSpend * 1_000_000) / 1_000_000,
    hasUnknown,
  };
}

export function getSpendByModel(): Record<
  string,
  { totalSpend: number; inputTokens: number; outputTokens: number; unknownCount: number; callCount: number }
> {
  initStorage();
  const map: Record<
    string,
    { totalSpend: number; inputTokens: number; outputTokens: number; unknownCount: number; callCount: number }
  > = {};

  for (const entry of inMemoryLedger.values()) {
    if (!map[entry.model]) {
      map[entry.model] = { totalSpend: 0, inputTokens: 0, outputTokens: 0, unknownCount: 0, callCount: 0 };
    }
    const stat = map[entry.model];
    stat.callCount++;

    if (entry.estimated_cost !== null) {
      stat.totalSpend += entry.estimated_cost;
    } else {
      stat.unknownCount++;
    }

    if (entry.input_tokens !== null) stat.inputTokens += entry.input_tokens;
    if (entry.output_tokens !== null) stat.outputTokens += entry.output_tokens;
  }

  for (const key of Object.keys(map)) {
    map[key].totalSpend = Math.round(map[key].totalSpend * 1_000_000) / 1_000_000;
  }

  return map;
}

// ---------------------------------------------------------------------------
// Budgets Management
// ---------------------------------------------------------------------------

export function setBudget(scope_type: BudgetScopeType, scope_id: string, amount: number): BudgetRecord {
  initStorage();
  const key = `${scope_type}:${scope_id}`;
  const existing = inMemoryBudgets.get(key);
  const budget: BudgetRecord = {
    id: existing?.id ?? `bgt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    scope_type,
    scope_id,
    amount,
    created_at: existing?.created_at ?? Date.now(),
    updated_at: Date.now(),
  };

  inMemoryBudgets.set(key, budget);
  persistBudgets();
  notify();
  return budget;
}

export function getBudget(scope_type: BudgetScopeType, scope_id: string): BudgetRecord | undefined {
  initStorage();
  return inMemoryBudgets.get(`${scope_type}:${scope_id}`);
}

export function listBudgets(): BudgetRecord[] {
  initStorage();
  return Array.from(inMemoryBudgets.values());
}

export function clearCostLedgerForTesting(): void {
  inMemoryRuns.clear();
  inMemoryLedger.clear();
  inMemoryBudgets.clear();
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(RUNS_STORAGE_KEY);
    localStorage.removeItem(LEDGER_STORAGE_KEY);
    localStorage.removeItem(BUDGETS_STORAGE_KEY);
  }
  isInitialized = true;
  notify();
}

// ---------------------------------------------------------------------------
// React Hook
// ---------------------------------------------------------------------------

export function useCostLedger(): {
  runs: RunRecord[];
  budgets: BudgetRecord[];
  todaySpend: { totalSpend: number; hasUnknown: boolean };
  modelSpend: Record<
    string,
    { totalSpend: number; inputTokens: number; outputTokens: number; unknownCount: number; callCount: number }
  >;
  getSpendForRun: typeof getSpendForRun;
  getSpendForTeam: typeof getSpendForTeam;
  setBudget: typeof setBudget;
  updateRunStatus: typeof updateRunStatus;
} {
  const [, setTick] = useState(0);

  useEffect(() => {
    initStorage();
    const listener = () => setTick((prev) => prev + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    runs: listRuns(),
    budgets: listBudgets(),
    todaySpend: getSpendToday(),
    modelSpend: getSpendByModel(),
    getSpendForRun,
    getSpendForTeam,
    setBudget,
    updateRunStatus,
  };
}
