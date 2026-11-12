/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcMain } from 'electron';
import { assertWithinScope, type ScopeCheckResult } from '../services/org/pathGuard';
import { orgStorageService } from '../services/org/orgStorageService';
import { discoverProjectsInFolder, type DiscoveredProject } from '../services/org/projectDiscovery';

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

  ipcMain.handle(
    'org:discoverProjects',
    async (_event, params: { folderPath: string; allowedRoot?: string }): Promise<DiscoveredProject[]> => {
      try {
        return await discoverProjectsInFolder(params.folderPath, params.allowedRoot);
      } catch (err) {
        console.error('[OrgBridge] discoverProjects failed:', err);
        return [];
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

  ipcMain.handle('org:getFullBundle', async (): Promise<unknown> => {
    try {
      return await orgStorageService.getFullBundle();
    } catch (err) {
      console.error('[OrgBridge] getFullBundle failed:', err);
      return null;
    }
  });

  ipcMain.handle('org:saveFullBundle', async (_event, bundle: any): Promise<boolean> => {
    try {
      return await orgStorageService.saveFullBundle(bundle);
    } catch (err) {
      console.error('[OrgBridge] saveFullBundle failed:', err);
      return false;
    }
  });

  ipcMain.handle('org:getMembers', async (): Promise<unknown[]> => {
    try {
      return await orgStorageService.getMembers();
    } catch (err) {
      console.error('[OrgBridge] getMembers failed:', err);
      return [];
    }
  });

  ipcMain.handle('org:saveMembers', async (_event, members: any[]): Promise<boolean> => {
    try {
      return await orgStorageService.saveMembers(members);
    } catch (err) {
      console.error('[OrgBridge] saveMembers failed:', err);
      return false;
    }
  });

  ipcMain.handle('org:getProjects', async (): Promise<unknown[]> => {
    try {
      return await orgStorageService.getProjects();
    } catch (err) {
      console.error('[OrgBridge] getProjects failed:', err);
      return [];
    }
  });

  ipcMain.handle('org:saveProjects', async (_event, projects: any[]): Promise<boolean> => {
    try {
      return await orgStorageService.saveProjects(projects);
    } catch (err) {
      console.error('[OrgBridge] saveProjects failed:', err);
      return false;
    }
  });
}
