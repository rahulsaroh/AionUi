/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type { RememberedRule } from './types';

const STORAGE_KEY = 'aionui:remembered-rules';

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

let inMemoryRules: RememberedRule[] = [];

export function loadRememberedRules(): RememberedRule[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        inMemoryRules = JSON.parse(raw);
        return inMemoryRules;
      }
    }
  } catch (e) {
    console.warn('[rulesStore] Failed to read from localStorage:', e);
  }
  return inMemoryRules;
}

export function saveRememberedRules(rules: RememberedRule[]): void {
  inMemoryRules = rules;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
    }
  } catch (e) {
    console.warn('[rulesStore] Failed to write to localStorage:', e);
  }
  notify();
}

export function getRememberedRules(projectId?: string): RememberedRule[] {
  const all = loadRememberedRules();
  if (projectId) {
    return all.filter((r) => r.projectId === projectId);
  }
  return all;
}

export function addRememberedRule(rule: Omit<RememberedRule, 'id' | 'createdAt'>): RememberedRule {
  const existing = loadRememberedRules();
  const newRule: RememberedRule = {
    ...rule,
    id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  saveRememberedRules([newRule, ...existing]);
  return newRule;
}

export function revokeRememberedRule(ruleId: string): boolean {
  const existing = loadRememberedRules();
  const next = existing.filter((r) => r.id !== ruleId);
  if (next.length !== existing.length) {
    saveRememberedRules(next);
    return true;
  }
  return false;
}

export function clearRememberedRules(): void {
  saveRememberedRules([]);
}

export function useRememberedRules(projectId?: string): {
  rules: RememberedRule[];
  revokeRule: (id: string) => boolean;
  addRule: (rule: Omit<RememberedRule, 'id' | 'createdAt'>) => RememberedRule;
} {
  const [rules, setRules] = useState<RememberedRule[]>(() => getRememberedRules(projectId));

  useEffect(() => {
    const handleUpdate = () => {
      setRules(getRememberedRules(projectId));
    };
    listeners.add(handleUpdate);
    return () => {
      listeners.delete(handleUpdate);
    };
  }, [projectId]);

  return {
    rules,
    revokeRule: revokeRememberedRule,
    addRule: addRememberedRule,
  };
}
