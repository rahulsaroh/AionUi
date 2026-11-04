/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowserHistoryService } from '@process/services/browser/BrowserHistoryService';

describe('BrowserHistoryService', () => {
  let tempDir: string;
  let historyFile: string;
  let service: BrowserHistoryService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-browser-history-test-'));
    historyFile = path.join(tempDir, 'browser_history.json');
    service = new BrowserHistoryService({
      userDataPath: tempDir,
      historyFilePath: historyFile,
      maxEntries: 10,
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  it('records a new visited URL and persists to JSON file in data directory', () => {
    const entry = service.addEntry({
      url: 'https://example.com/page1',
      title: 'Example Page 1',
    });

    expect(entry).toBeDefined();
    expect(entry?.url).toBe('https://example.com/page1');
    expect(entry?.title).toBe('Example Page 1');
    expect(entry?.timestamp).toBeGreaterThan(0);

    expect(fs.existsSync(historyFile)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    expect(saved).toHaveLength(1);
    expect(saved[0].url).toBe('https://example.com/page1');
  });

  it('ignores about:blank, data: and empty URLs', () => {
    expect(service.addEntry({ url: 'about:blank' })).toBeNull();
    expect(service.addEntry({ url: '' })).toBeNull();
    expect(service.addEntry({ url: 'data:text/html,hello' })).toBeNull();
    expect(service.getHistory()).toHaveLength(0);
  });

  it('updates title instead of duplicating when same URL is visited quickly', () => {
    service.addEntry({ url: 'https://example.com/fast', title: 'Loading...' });
    const updated = service.addEntry({ url: 'https://example.com/fast', title: 'Complete Title' });

    expect(service.getHistory()).toHaveLength(1);
    expect(updated?.title).toBe('Complete Title');
  });

  it('limits total entries to maxEntries', () => {
    for (let i = 0; i < 15; i++) {
      service.addEntry({ url: `https://example.com/test-${i}`, title: `Page ${i}` });
    }

    const history = service.getHistory();
    expect(history).toHaveLength(10);
    expect(history[0].url).toBe('https://example.com/test-14');
  });

  it('deletes specific history entry and clears all history', () => {
    const e1 = service.addEntry({ url: 'https://example.com/one' });
    service.addEntry({ url: 'https://example.com/two' });

    expect(service.getHistory()).toHaveLength(2);

    const deleted = service.deleteEntry(e1!.id);
    expect(deleted).toBe(true);
    expect(service.getHistory()).toHaveLength(1);
    expect(service.getHistory()[0].url).toBe('https://example.com/two');

    service.clearHistory();
    expect(service.getHistory()).toHaveLength(0);
  });
});
