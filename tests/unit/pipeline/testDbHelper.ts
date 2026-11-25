/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISqliteDriver, IStatement } from '@/process/services/database/drivers/ISqliteDriver';
import { initSchema } from '@/process/services/database/schema';

type RawStmt = {
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
  run: (...args: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint };
};

type RawDb = {
  prepare: (sql: string) => RawStmt;
  exec: (sql: string) => void;
  transaction?: <T>(fn: (...args: unknown[]) => T) => (...args: unknown[]) => T;
  close: () => void;
};

function openInMemoryDb(): RawDb {
  if (typeof process !== 'undefined' && process.versions?.bun) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require('bun:sqlite') as { Database: new (p: string) => RawDb };
    return new Database(':memory:');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => RawDb };
  return new DatabaseSync(':memory:');
}

export function createInMemoryTestDb(): ISqliteDriver {
  const db = openInMemoryDb();

  const driver: ISqliteDriver = {
    prepare(sql: string): IStatement {
      const stmt = db.prepare(sql);
      return {
        get(...args: unknown[]): unknown {
          return stmt.get(...args);
        },
        all(...args: unknown[]): unknown[] {
          return stmt.all(...args);
        },
        run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
          const res = stmt.run(...args);
          return {
            changes: Number(res.changes),
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
      if (typeof db.transaction === 'function') {
        const tx = db.transaction(fn);
        return (...args: unknown[]) => tx(...args);
      }
      return (...args: unknown[]) => {
        db.exec('BEGIN');
        try {
          const result = fn(...args);
          db.exec('COMMIT');
          return result;
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      };
    },
    close(): void {
      db.close();
    },
  };

  initSchema(driver);
  return driver;
}
