/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ScheduledTask<T = any> {
  id: string;
  memberId?: string;
  departmentId?: string;
  run: () => Promise<T>;
}

export interface TaskExecutionResult<T = any> {
  id: string;
  result?: T;
  error?: Error;
  durationMs: number;
}

/**
 * Parallel Scheduler:
 * - Runs cross-department tasks in parallel (Promise.all)
 * - Serializes tasks assigned to the same member to avoid workspace/branch race conditions
 */
export class OrgParallelScheduler {
  private memberQueues: Map<string, Promise<any>> = new Map();

  /**
   * Enqueues and executes a task for a specific member sequentially on that member's queue.
   */
  public async executeForMember<T>(memberId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.memberQueues.get(memberId) || Promise.resolve();
    const current = (async () => {
      try {
        await previous;
      } catch {}
      return await fn();
    })();

    this.memberQueues.set(memberId, current);
    return current;
  }

  /**
   * Executes a batch of tasks. Tasks targeting different members/departments run in parallel;
   * tasks targeting the same member are queued sequentially.
   */
  public async executeParallelBatch<T>(tasks: ScheduledTask<T>[]): Promise<TaskExecutionResult<T>[]> {
    const promises = tasks.map(async (task) => {
      const start = Date.now();
      try {
        let res: T;
        if (task.memberId) {
          res = await this.executeForMember(task.memberId, task.run);
        } else {
          res = await task.run();
        }
        return {
          id: task.id,
          result: res,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        return {
          id: task.id,
          error: err instanceof Error ? err : new Error(String(err)),
          durationMs: Date.now() - start,
        };
      }
    });

    return Promise.all(promises);
  }
}
