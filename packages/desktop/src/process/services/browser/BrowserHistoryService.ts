/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type BrowserHistoryEntry = {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  timestamp: number;
};

export class BrowserHistoryService {
  private history: BrowserHistoryEntry[] = [];
  private readonly historyFilePath: string;
  private readonly maxEntries: number;

  constructor(options?: { userDataPath?: string; historyFilePath?: string; maxEntries?: number }) {
    const userDataRoot = options?.userDataPath || this.resolveUserDataRoot();
    this.historyFilePath = options?.historyFilePath || path.join(userDataRoot, 'browser_history.json');
    this.maxEntries = options?.maxEntries || 1000;
    this.loadHistory();
  }

  private resolveUserDataRoot(): string {
    try {
      if (app && typeof app.getPath === 'function') {
        return app.getPath('userData');
      }
    } catch {
      // Unit test environment
    }
    return process.cwd();
  }

  private loadHistory(): void {
    try {
      if (fs.existsSync(this.historyFilePath)) {
        const raw = fs.readFileSync(this.historyFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.history = parsed.filter(
            (item): item is BrowserHistoryEntry =>
              item && typeof item.id === 'string' && typeof item.url === 'string' && typeof item.timestamp === 'number'
          );
        }
      }
    } catch (err) {
      console.warn('[BrowserHistoryService] Failed to load history, resetting:', err);
      this.history = [];
    }
  }

  private saveHistory(): void {
    try {
      const dir = path.dirname(this.historyFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.historyFilePath, JSON.stringify(this.history, null, 2), 'utf-8');
    } catch (err) {
      console.error('[BrowserHistoryService] Failed to save history to disk:', err);
    }
  }

  public addEntry(entry: { url: string; title?: string; favicon?: string }): BrowserHistoryEntry | null {
    const rawUrl = (entry.url || '').trim();
    if (!rawUrl || rawUrl === 'about:blank' || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) {
      return null;
    }

    // Do not add duplicate if the most recent entry is the same URL within 5 seconds
    const now = Date.now();
    const last = this.history[0];
    if (last && last.url === rawUrl && now - last.timestamp < 5000) {
      let changed = false;
      if (entry.title && entry.title.trim() && entry.title.trim() !== last.title) {
        last.title = entry.title.trim();
        changed = true;
      }
      if (entry.favicon && entry.favicon !== last.favicon) {
        last.favicon = entry.favicon;
        changed = true;
      }
      if (changed) {
        this.saveHistory();
      }
      return last;
    }

    const title = (entry.title || rawUrl).trim();
    const newEntry: BrowserHistoryEntry = {
      id: `hist_${now}_${Math.random().toString(36).slice(2, 6)}`,
      url: rawUrl,
      title,
      favicon: entry.favicon,
      timestamp: now,
    };

    this.history.unshift(newEntry);
    if (this.history.length > this.maxEntries) {
      this.history = this.history.slice(0, this.maxEntries);
    }

    this.saveHistory();
    return newEntry;
  }

  public getHistory(limit?: number): BrowserHistoryEntry[] {
    if (typeof limit === 'number' && limit > 0) {
      return this.history.slice(0, limit);
    }
    return [...this.history];
  }

  public deleteEntry(id: string): boolean {
    const initialLen = this.history.length;
    this.history = this.history.filter((item) => item.id !== id);
    if (this.history.length !== initialLen) {
      this.saveHistory();
      return true;
    }
    return false;
  }

  public clearHistory(): void {
    this.history = [];
    this.saveHistory();
  }
}

let historyServiceInstance: BrowserHistoryService | null = null;

export function getBrowserHistoryService(): BrowserHistoryService {
  if (!historyServiceInstance) {
    historyServiceInstance = new BrowserHistoryService();
  }
  return historyServiceInstance;
}
