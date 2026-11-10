/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getBudget,
  getSpendForRun,
  getSpendForTeam,
  getSpendThisMonthForDepartment,
  setBudget,
  updateRunStatus,
} from './costLedgerStore';
import type { BudgetEvaluation, BudgetScopeType } from './types';

export const BUDGET_WARN_THRESHOLD = 0.8;
export const BUDGET_HARD_PAUSE_THRESHOLD = 1.0;

export function evaluateBudgetThreshold(
  scopeType: BudgetScopeType,
  scopeId: string,
  currentSpend: number,
  limitAmount?: number
): BudgetEvaluation {
  const budget = limitAmount !== undefined ? { amount: limitAmount } : getBudget(scopeType, scopeId);
  const limit = budget?.amount ?? Infinity;

  if (limit <= 0 || !isFinite(limit)) {
    return {
      allowed: true,
      warned: false,
      currentSpend,
      limit: 0,
      ratio: 0,
      scopeType,
      scopeId,
    };
  }

  const ratio = currentSpend / limit;
  const warned = ratio >= BUDGET_WARN_THRESHOLD && ratio < BUDGET_HARD_PAUSE_THRESHOLD;
  const allowed = ratio < BUDGET_HARD_PAUSE_THRESHOLD;

  return {
    allowed,
    warned,
    currentSpend,
    limit,
    ratio,
    scopeType,
    scopeId,
  };
}

export function evaluateRunBudgets(params: {
  run_id: string;
  team_id?: string;
  department_id?: string;
  department_team_ids?: string[];
}): {
  allowed: boolean;
  warned: boolean;
  paused: boolean;
  blockingEvaluation?: BudgetEvaluation;
  evaluations: BudgetEvaluation[];
} {
  const evaluations: BudgetEvaluation[] = [];

  // 1. Run scope budget
  const runSpend = getSpendForRun(params.run_id).totalSpend;
  const runEval = evaluateBudgetThreshold('run', params.run_id, runSpend);
  if (runEval.limit > 0) evaluations.push(runEval);

  // 2. Team daily budget
  if (params.team_id) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const teamSpendToday = getSpendForTeam(params.team_id, startOfDay.getTime()).totalSpend;
    const teamEval = evaluateBudgetThreshold('team_daily', params.team_id, teamSpendToday);
    if (teamEval.limit > 0) evaluations.push(teamEval);
  }

  // 3. Department monthly budget
  if (params.department_id && params.department_team_ids && params.department_team_ids.length > 0) {
    const deptSpend = getSpendThisMonthForDepartment(params.department_team_ids).totalSpend;
    const deptEval = evaluateBudgetThreshold('department_monthly', params.department_id, deptSpend);
    if (deptEval.limit > 0) evaluations.push(deptEval);
  }

  const blockingEvaluation = evaluations.find((e) => !e.allowed);
  const warned = evaluations.some((e) => e.warned);
  const allowed = !blockingEvaluation;
  const paused = !allowed;

  if (paused) {
    updateRunStatus(params.run_id, 'paused');
  }

  return {
    allowed,
    warned,
    paused,
    blockingEvaluation,
    evaluations,
  };
}

/**
 * Raises the limiting budget and resumes a paused run.
 */
export function raiseBudgetAndResume(params: {
  run_id: string;
  scope_type: BudgetScopeType;
  scope_id: string;
  new_amount: number;
}): { success: boolean; newBudget: number } {
  // Update the budget with the higher amount
  const updated = setBudget(params.scope_type, params.scope_id, params.new_amount);

  // Update the run status from paused back to running
  updateRunStatus(params.run_id, 'running');

  return {
    success: true,
    newBudget: updated.amount,
  };
}
