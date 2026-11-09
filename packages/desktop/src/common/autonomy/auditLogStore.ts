/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type { ApprovalAuditLog } from './types';

const STORAGE_KEY = 'aionui:approval-audit-logs';
const MAX_LOGS = 500;

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

let inMemoryLogs: ApprovalAuditLog[] = [];

export function loadAuditLogs(): ApprovalAuditLog[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        inMemoryLogs = JSON.parse(raw);
        return inMemoryLogs;
      }
    }
  } catch (e) {
    console.warn('[auditLogStore] Failed to read from localStorage:', e);
  }
  return inMemoryLogs;
}

export function saveAuditLogs(logs: ApprovalAuditLog[]): void {
  inMemoryLogs = logs.slice(0, MAX_LOGS);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inMemoryLogs));
    }
  } catch (e) {
    console.warn('[auditLogStore] Failed to write to localStorage:', e);
  }
  notify();
}

export function getAuditLogs(): ApprovalAuditLog[] {
  return loadAuditLogs();
}

export function recordAuditLog(entry: Omit<ApprovalAuditLog, 'id' | 'createdAt'>): ApprovalAuditLog {
  const existing = loadAuditLogs();
  const log: ApprovalAuditLog = {
    ...entry,
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  saveAuditLogs([log, ...existing]);
  return log;
}

export function clearAuditLogs(): void {
  saveAuditLogs([]);
}

export function useAuditLogs(): ApprovalAuditLog[] {
  const [logs, setLogs] = useState<ApprovalAuditLog[]>(() => getAuditLogs());

  useEffect(() => {
    const handleUpdate = () => {
      setLogs(getAuditLogs());
    };
    listeners.add(handleUpdate);
    return () => {
      listeners.delete(handleUpdate);
    };
  }, []);

  return logs;
}
