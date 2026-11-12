/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { OrgParallelScheduler, type ScheduledTask } from '@/renderer/pages/organization/utils/parallelScheduler';

describe('OrgParallelScheduler (Commit 5)', () => {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('runs tasks across different departments/members in parallel', async () => {
    const scheduler = new OrgParallelScheduler();
    const start = Date.now();

    const tasks: ScheduledTask<string>[] = [
      {
        id: 'task-eng',
        memberId: 'member-eng',
        run: async () => {
          await delay(100);
          return 'eng-done';
        },
      },
      {
        id: 'task-prod',
        memberId: 'member-prod',
        run: async () => {
          await delay(100);
          return 'prod-done';
        },
      },
      {
        id: 'task-ops',
        memberId: 'member-ops',
        run: async () => {
          await delay(100);
          return 'ops-done';
        },
      },
    ];

    const results = await scheduler.executeParallelBatch(tasks);
    const elapsed = Date.now() - start;

    expect(results).toHaveLength(3);
    expect(results.every((r) => !r.error)).toBe(true);
    expect(results.map((r) => r.result)).toEqual(['eng-done', 'prod-done', 'ops-done']);

    // Should complete in ~100-180ms total because they ran concurrently, not 300ms
    expect(elapsed).toBeLessThan(250);
  });

  it('serializes tasks sharing the same member to avoid workspace race conditions', async () => {
    const scheduler = new OrgParallelScheduler();
    const executionOrder: string[] = [];

    const tasks: ScheduledTask<string>[] = [
      {
        id: 'job-1',
        memberId: 'shared-coder',
        run: async () => {
          await delay(80);
          executionOrder.push('job-1');
          return '1';
        },
      },
      {
        id: 'job-2',
        memberId: 'shared-coder',
        run: async () => {
          await delay(20);
          executionOrder.push('job-2');
          return '2';
        },
      },
    ];

    const results = await scheduler.executeParallelBatch(tasks);

    expect(results).toHaveLength(2);
    // Job 1 should finish before Job 2 starts despite job 2 having shorter delay
    expect(executionOrder).toEqual(['job-1', 'job-2']);
  });

  it('surfaces task errors cleanly without swallowing them', async () => {
    const scheduler = new OrgParallelScheduler();

    const tasks: ScheduledTask<string>[] = [
      {
        id: 'task-failing',
        memberId: 'dev-1',
        run: async () => {
          throw new Error('Project build failed: Syntax error in file.ts');
        },
      },
      {
        id: 'task-healthy',
        memberId: 'dev-2',
        run: async () => {
          return 'ok';
        },
      },
    ];

    const results = await scheduler.executeParallelBatch(tasks);
    expect(results[0].error).toBeDefined();
    expect(results[0].error?.message).toContain('Syntax error in file.ts');
    expect(results[1].result).toBe('ok');
  });
});
