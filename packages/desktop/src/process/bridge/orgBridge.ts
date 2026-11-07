/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcMain } from 'electron';
import { assertWithinScope, type ScopeCheckResult } from '../services/org/pathGuard';
import { orgStorageService } from '../services/org/orgStorageService';

export function registerOrgBridge(): void {
  ipcMain.handle(
    'org:assertWithinScope',
    async (_event, params: { targetPath: string; allowedRoot: string }): Promise<ScopeCheckResult> => {
      try {
        return await assertWithinScope(params.targetPath, params.allowedRoot);
      } catch (err) {
        return {
          allowed: false,
          reason: err instanceof Error ? err.message : String(err),
          resolved: params.targetPath,
        };
      }
    }
  );

  ipcMain.handle('org:saveData', async (_event, params: { key: string; value: string }): Promise<boolean> => {
    try {
      return await orgStorageService.saveData(params.key, params.value);
    } catch (err) {
      console.error('[OrgBridge] saveData failed:', err);
      return false;
    }
  });

  ipcMain.handle('org:loadData', async (_event, params: { key: string }): Promise<string | null> => {
    try {
      return await orgStorageService.loadData(params.key);
    } catch (err) {
      console.error('[OrgBridge] loadData failed:', err);
      return null;
    }
  });
}
