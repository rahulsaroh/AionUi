/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PriceEntry, PriceTable } from './types';

export const PRICE_TABLE_STORAGE_KEY = 'aionui:price-table';

export const DEFAULT_PRICE_TABLE: PriceTable = {
  'gpt-4o': { inputPricePerM: 2.5, outputPricePerM: 10.0 },
  'gpt-4o-mini': { inputPricePerM: 0.15, outputPricePerM: 0.6 },
  'gpt-4-turbo': { inputPricePerM: 10.0, outputPricePerM: 30.0 },
  'claude-3-7-sonnet': { inputPricePerM: 3.0, outputPricePerM: 15.0 },
  'claude-3-5-sonnet': { inputPricePerM: 3.0, outputPricePerM: 15.0 },
  'claude-3-5-haiku': { inputPricePerM: 0.8, outputPricePerM: 4.0 },
  'claude-3-opus': { inputPricePerM: 15.0, outputPricePerM: 75.0 },
  'gemini-1.5-pro': { inputPricePerM: 1.25, outputPricePerM: 5.0 },
  'gemini-1.5-flash': { inputPricePerM: 0.075, outputPricePerM: 0.3 },
  'gemini-2.0-flash': { inputPricePerM: 0.1, outputPricePerM: 0.4 },
  'deepseek-chat': { inputPricePerM: 0.14, outputPricePerM: 0.28 },
  'deepseek-reasoner': { inputPricePerM: 0.55, outputPricePerM: 2.19 },
  default: { inputPricePerM: 1.0, outputPricePerM: 2.0 },
};

let cachedPriceTable: PriceTable | null = null;

export function loadPriceTable(): PriceTable {
  if (cachedPriceTable) {
    return cachedPriceTable;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(PRICE_TABLE_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PriceTable;
        cachedPriceTable = { ...DEFAULT_PRICE_TABLE, ...parsed };
        return cachedPriceTable;
      }
    }
  } catch (err) {
    console.warn('[PriceTable] Failed to load custom price table from storage:', err);
  }
  cachedPriceTable = { ...DEFAULT_PRICE_TABLE };
  return cachedPriceTable;
}

export function savePriceTable(table: PriceTable): void {
  cachedPriceTable = table;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PRICE_TABLE_STORAGE_KEY, JSON.stringify(table));
    }
  } catch (err) {
    console.warn('[PriceTable] Failed to save price table to storage:', err);
  }
}

export function resetPriceTableToDefault(): PriceTable {
  cachedPriceTable = { ...DEFAULT_PRICE_TABLE };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(PRICE_TABLE_STORAGE_KEY);
    }
  } catch (err) {
    console.warn('[PriceTable] Failed to clear custom price table from storage:', err);
  }
  return cachedPriceTable;
}

export function resolvePriceEntry(model: string, table?: PriceTable): PriceEntry {
  const priceTable = table ?? loadPriceTable();
  const lowerModel = model.toLowerCase().trim();

  if (priceTable[lowerModel]) {
    return priceTable[lowerModel];
  }

  // Check prefix or partial match
  for (const [key, entry] of Object.entries(priceTable)) {
    if (key !== 'default' && lowerModel.includes(key.toLowerCase())) {
      return entry;
    }
  }

  return priceTable.default || DEFAULT_PRICE_TABLE.default;
}

/**
 * Calculates estimated cost for a given model and token count.
 * Returns `null` ("unknown") if input or output tokens are null or undefined.
 * Never invents numbers.
 */
export function calculateCost(
  model: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  customTable?: PriceTable
): number | null {
  if (inputTokens === null || inputTokens === undefined || outputTokens === null || outputTokens === undefined) {
    return null;
  }

  if (inputTokens < 0 || outputTokens < 0) {
    return null;
  }

  const entry = resolvePriceEntry(model, customTable);
  const cost = (inputTokens * entry.inputPricePerM + outputTokens * entry.outputPricePerM) / 1_000_000;

  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * Formats cost amount. If null or undefined, returns 'unknown'.
 */
export function formatCost(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) {
    return 'unknown';
  }
  if (amount === 0) {
    return '$0.00';
  }
  if (amount < 0.01) {
    return `$${amount.toFixed(4)}`;
  }
  return `$${amount.toFixed(2)}`;
}

/**
 * Formats token count. If null or undefined, returns 'unknown'.
 */
export function formatTokens(count: number | null | undefined): string {
  if (count === null || count === undefined) {
    return 'unknown';
  }
  return count.toLocaleString();
}
