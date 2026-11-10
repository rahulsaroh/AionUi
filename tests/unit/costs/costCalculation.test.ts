/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { calculateCost, formatCost, formatTokens, DEFAULT_PRICE_TABLE } from '@/common/costs/priceTable';
import {
  evaluateBudgetThreshold,
  BUDGET_WARN_THRESHOLD,
  BUDGET_HARD_PAUSE_THRESHOLD,
} from '@/common/costs/budgetEvaluator';

describe('Cost Calculation & Unknown Handling', () => {
  it('calculates cost accurately using standard pricing', () => {
    // claude-3-5-sonnet: $3.00 per 1M input, $15.00 per 1M output
    const cost = calculateCost('claude-3-5-sonnet', 100_000, 10_000);
    // (100000 * 3 + 10000 * 15) / 1000000 = (300000 + 150000) / 1000000 = 0.45
    expect(cost).toBe(0.45);
    expect(formatCost(cost)).toBe('$0.45');
  });

  it('calculates cost using a custom mocked price table', () => {
    const mockTable = {
      'custom-llm': { inputPricePerM: 5.0, outputPricePerM: 20.0 },
      default: { inputPricePerM: 1.0, outputPricePerM: 2.0 },
    };
    const cost = calculateCost('custom-llm', 200_000, 50_000, mockTable);
    // (200000 * 5 + 50000 * 20) / 1000000 = (1000000 + 1000000) / 1000000 = 2.0
    expect(cost).toBe(2.0);
    expect(formatCost(cost)).toBe('$2.00');
  });

  it('records unknown when external CLI agent does not report usage, never inventing numbers', () => {
    expect(calculateCost('external-cli-agent', null, null)).toBeNull();
    expect(calculateCost('external-cli-agent', undefined, undefined)).toBeNull();
    expect(calculateCost('external-cli-agent', 1000, null)).toBeNull();
    expect(calculateCost('external-cli-agent', null, 500)).toBeNull();
  });

  it('displays unknown usage as "unknown", never zero', () => {
    expect(formatCost(null)).toBe('unknown');
    expect(formatCost(undefined)).toBe('unknown');
    expect(formatTokens(null)).toBe('unknown');
    expect(formatTokens(undefined)).toBe('unknown');

    // Make sure real zero is distinct from unknown
    expect(formatCost(0)).toBe('$0.00');
    expect(formatTokens(0)).toBe('0');
  });
});

describe('Budget Thresholds', () => {
  it('allows execution when spend is below 80%', () => {
    const evalResult = evaluateBudgetThreshold('run', 'run_1', 75, 100);
    expect(evalResult.allowed).toBe(true);
    expect(evalResult.warned).toBe(false);
    expect(evalResult.ratio).toBe(0.75);
  });

  it('warns at 80% budget threshold', () => {
    const evalResult = evaluateBudgetThreshold('run', 'run_1', 80, 100);
    expect(evalResult.allowed).toBe(true);
    expect(evalResult.warned).toBe(true);
    expect(evalResult.ratio).toBe(0.8);
  });

  it('warns between 80% and 100%', () => {
    const evalResult = evaluateBudgetThreshold('team_daily', 'team_alpha', 95, 100);
    expect(evalResult.allowed).toBe(true);
    expect(evalResult.warned).toBe(true);
    expect(evalResult.ratio).toBe(0.95);
  });

  it('hard-pauses at exactly 100% budget threshold', () => {
    const evalResult = evaluateBudgetThreshold('team_daily', 'team_alpha', 100, 100);
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.warned).toBe(false);
    expect(evalResult.ratio).toBe(1.0);
  });

  it('hard-pauses when exceeding 100% budget', () => {
    const evalResult = evaluateBudgetThreshold('department_monthly', 'dept_eng', 105, 100);
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.ratio).toBe(1.05);
  });
});
