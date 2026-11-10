/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISqliteDriver } from '../database/drivers/ISqliteDriver';
import type { BrowserAuditEntry, BrowserAuditFilter } from '@/common/browser/types';

export class BrowserAuditService {
  private inMemoryLogs: BrowserAuditEntry[] = [];
  private db?: ISqliteDriver;
  private retentionDays: number = 30;

  constructor(options?: { db?: ISqliteDriver; retentionDays?: number }) {
    this.db = options?.db;
    if (options?.retentionDays) {
      this.retentionDays = options.retentionDays;
    }
    this.loadFromDb();
  }

  public setDb(db: ISqliteDriver): void {
    this.db = db;
    this.loadFromDb();
  }

  private loadFromDb(): void {
    if (!this.db) return;
    try {
      const rows = this.db
        .prepare(
          `SELECT id, run_id, agent_id, profile_id, url, action, target_summary,
                  sensitive, approved, screenshot_before, screenshot_after,
                  timestamp, status, error
           FROM browser_audit_logs
           ORDER BY timestamp DESC
           LIMIT 500`
        )
        .all() as Array<{
        id: string;
        run_id: string | null;
        agent_id: string | null;
        profile_id: string;
        url: string;
        action: string;
        target_summary: string | null;
        sensitive: number;
        approved: number;
        screenshot_before: string | null;
        screenshot_after: string | null;
        timestamp: number;
        status: 'success' | 'failed' | 'blocked' | 'pending_approval' | 'paused';
        error: string | null;
      }>;

      this.inMemoryLogs = rows.map((r) => ({
        id: r.id,
        runId: r.run_id || undefined,
        agentId: r.agent_id || undefined,
        profileId: r.profile_id,
        url: r.url,
        action: r.action,
        targetSummary: r.target_summary || undefined,
        sensitive: Boolean(r.sensitive),
        approved: Boolean(r.approved),
        screenshotBefore: r.screenshot_before || undefined,
        screenshotAfter: r.screenshot_after || undefined,
        timestamp: r.timestamp,
        status: r.status,
        error: r.error || undefined,
      }));
    } catch {
      // Table might not be ready yet
    }
  }

  public logAction(entry: Omit<BrowserAuditEntry, 'id' | 'timestamp'> & { timestamp?: number }): BrowserAuditEntry {
    const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const fullEntry: BrowserAuditEntry = {
      id,
      runId: entry.runId,
      agentId: entry.agentId,
      profileId: entry.profileId,
      url: entry.url,
      action: entry.action,
      targetSummary: entry.targetSummary,
      sensitive: entry.sensitive ?? false,
      approved: entry.approved ?? true,
      screenshotBefore: entry.screenshotBefore,
      screenshotAfter: entry.screenshotAfter,
      timestamp: entry.timestamp || Date.now(),
      status: entry.status,
      error: entry.error,
    };

    this.inMemoryLogs.unshift(fullEntry);
    if (this.inMemoryLogs.length > 1000) {
      this.inMemoryLogs.pop();
    }

    if (this.db) {
      try {
        this.db
          .prepare(
            `INSERT INTO browser_audit_logs (
              id, run_id, agent_id, profile_id, url, action, target_summary,
              sensitive, approved, screenshot_before, screenshot_after,
              timestamp, status, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            fullEntry.id,
            fullEntry.runId || null,
            fullEntry.agentId || null,
            fullEntry.profileId,
            fullEntry.url,
            fullEntry.action,
            fullEntry.targetSummary || null,
            fullEntry.sensitive ? 1 : 0,
            fullEntry.approved ? 1 : 0,
            fullEntry.screenshotBefore || null,
            fullEntry.screenshotAfter || null,
            fullEntry.timestamp,
            fullEntry.status,
            fullEntry.error || null
          );
      } catch (err) {
        console.warn('[BrowserAuditService] Failed to persist audit log to DB:', err);
      }
    }

    return fullEntry;
  }

  public getLogs(filter?: BrowserAuditFilter): BrowserAuditEntry[] {
    let results = [...this.inMemoryLogs];

    if (filter?.profileId) {
      results = results.filter((r) => r.profileId === filter.profileId);
    }
    if (filter?.action) {
      results = results.filter((r) => r.action === filter.action);
    }
    if (filter?.sensitiveOnly) {
      results = results.filter((r) => r.sensitive === true);
    }
    if (filter?.agentId) {
      results = results.filter((r) => r.agentId === filter.agentId);
    }
    if (filter?.runId) {
      results = results.filter((r) => r.runId === filter.runId);
    }
    if (filter?.fromTimestamp) {
      results = results.filter((r) => r.timestamp >= filter.fromTimestamp!);
    }
    if (filter?.toTimestamp) {
      results = results.filter((r) => r.timestamp <= filter.toTimestamp!);
    }

    const limit = filter?.limit || 100;
    return results.slice(0, limit);
  }

  public getRetentionDays(): number {
    return this.retentionDays;
  }

  public setRetentionDays(days: number): void {
    if (days < 1) {
      throw new Error('Retention days must be at least 1');
    }
    this.retentionDays = days;
    this.purgeExpiredLogs();
  }

  public purgeExpiredLogs(): number {
    const cutoff = Date.now() - this.retentionDays * 86400000;
    const initialLen = this.inMemoryLogs.length;
    this.inMemoryLogs = this.inMemoryLogs.filter((r) => r.timestamp >= cutoff);
    const purgedInMemory = initialLen - this.inMemoryLogs.length;

    let purgedDb = 0;
    if (this.db) {
      try {
        const info = this.db.prepare('DELETE FROM browser_audit_logs WHERE timestamp < ?').run(cutoff);
        purgedDb = info?.changes || 0;
      } catch (err) {
        console.warn('[BrowserAuditService] Failed to purge expired logs from DB:', err);
      }
    }

    return Math.max(purgedInMemory, purgedDb);
  }

  public clearLogs(): void {
    this.inMemoryLogs = [];
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM browser_audit_logs').run();
      } catch {
        // Ignored
      }
    }
  }
}

let browserAuditServiceInstance: BrowserAuditService | null = null;

export function getBrowserAuditService(): BrowserAuditService {
  if (!browserAuditServiceInstance) {
    browserAuditServiceInstance = new BrowserAuditService();
  }
  return browserAuditServiceInstance;
}
