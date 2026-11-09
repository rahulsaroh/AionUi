/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Database } from 'bun:sqlite';
import type { ISqliteDriver, IStatement } from '@/process/services/database/drivers/ISqliteDriver';
import { initSchema } from '@/process/services/database/schema';

export function createInMemoryTestDb(): ISqliteDriver {
  const db = new Database(':memory:');

  const driver: ISqliteDriver = {
    prepare(sql: string): IStatement {
      const stmt = db.prepare(sql);
      return {
        get(...args: unknown[]): unknown {
          return (stmt.get as (...params: unknown[]) => unknown)(...args);
        },
        all(...args: unknown[]): unknown[] {
          return (stmt.all as (...params: unknown[]) => unknown[])(...args);
        },
        run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
          const res = (stmt.run as (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint })(
            ...args
          );
          return {
            changes: res.changes,
            lastInsertRowid: res.lastInsertRowid,
          };
        },
      };
    },
    exec(sql: string): void {
      db.exec(sql);
    },
    pragma(sql: string, options?: { simple?: boolean }): unknown {
      if (options?.simple) {
        const stmt = db.prepare(`PRAGMA ${sql}`);
        const res = stmt.get() as Record<string, unknown> | undefined;
        if (res) {
          const firstKey = Object.keys(res)[0];
          return res[firstKey];
        }
        return undefined;
      }
      return db.prepare(`PRAGMA ${sql}`).all();
    },
    transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
      const tx = db.transaction(fn);
      return (...args: unknown[]) => tx(...args);
    },
    close(): void {
      db.close();
    },
  };

  initSchema(driver);
  return driver;
}
