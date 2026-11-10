/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordRunStart,
  getRun,
  recordUsage,
  setBudget,
  clearCostLedgerForTesting,
} from '@/common/costs/costLedgerStore';
import { evaluateRunBudgets, raiseBudgetAndResume } from '@/common/costs/budgetEvaluator';

describe('Budget Hard-Pause & Resume Workflow', () => {
  beforeEach(() => {
    clearCostLedgerForTesting();
  });

  it('hard-pauses the run when budget is exceeded and resumes when raised', () => {
    const runId = 'test_run_101';
    const teamId = 'team_dev';

    // 1. Start a run
    const run = recordRunStart({
      id: runId,
      team_id: teamId,
      trigger: 'manual',
    });
    expect(run.status).toBe('running');

    // 2. Set run budget of $1.00
    setBudget('run', runId, 1.0);

    // 3. Record an LLM call costing $0.50 (below 80%)
    recordUsage({
      run_id: runId,
      agent_role: 'developer',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      input_tokens: 100_000,
      output_tokens: 13_333,
      estimated_cost: 0.5,
    });

    let evalState = evaluateRunBudgets({ run_id: runId, team_id: teamId });
    expect(evalState.allowed).toBe(true);
    expect(evalState.warned).toBe(false);
    expect(evalState.paused).toBe(false);
    expect(getRun(runId)?.status).toBe('running');

    // 4. Record another LLM call pushing cost to $0.85 (>= 80% warn threshold)
    recordUsage({
      run_id: runId,
      agent_role: 'developer',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      input_tokens: 70_000,
      output_tokens: 9_333,
      estimated_cost: 0.35,
    });

    evalState = evaluateRunBudgets({ run_id: runId, team_id: teamId });
    expect(evalState.allowed).toBe(true);
    expect(evalState.warned).toBe(true);
    expect(evalState.paused).toBe(false);
    expect(getRun(runId)?.status).toBe('running');

    // 5. Record another LLM call pushing total cost to $1.10 (exceeds $1.00 hard budget)
    recordUsage({
      run_id: runId,
      agent_role: 'developer',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      input_tokens: 50_000,
      output_tokens: 6_667,
      estimated_cost: 0.25,
    });

    evalState = evaluateRunBudgets({ run_id: runId, team_id: teamId });
    expect(evalState.allowed).toBe(false);
    expect(evalState.paused).toBe(true);
    expect(evalState.blockingEvaluation?.scopeType).toBe('run');
    expect(getRun(runId)?.status).toBe('paused');

    // 6. Raise budget and resume
    const resumeResult = raiseBudgetAndResume({
      run_id: runId,
      scope_type: 'run',
      scope_id: runId,
      new_amount: 3.0,
    });

    expect(resumeResult.success).toBe(true);
    expect(resumeResult.newBudget).toBe(3.0);
    expect(getRun(runId)?.status).toBe('running');

    // Re-evaluating now passes since spend ($1.10) < new budget ($3.00)
    const reEval = evaluateRunBudgets({ run_id: runId, team_id: teamId });
    expect(reEval.allowed).toBe(true);
    expect(reEval.paused).toBe(false);
  });
});
