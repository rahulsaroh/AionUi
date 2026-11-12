/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcMain } from 'electron';
import { assertWithinScope, type ScopeCheckResult } from '../services/org/pathGuard';
import { orgStorageService } from '../services/org/orgStorageService';
import { discoverProjectsInFolder, type DiscoveredProject } from '../services/org/projectDiscovery';
import { OrgFolderTools, checkRiskyCommand } from '../services/org/folderTools';

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

  // Folder & Shell execution tools with boundary enforcement
  ipcMain.handle(
    'org:scanFolder',
    async (
      _event,
      params: { targetDir: string; allowedWorkspace: string; options?: { depth?: number; maxEntries?: number } }
    ) => {
      return OrgFolderTools.scanFolder(params.targetDir, params.allowedWorkspace, params.options);
    }
  );

  ipcMain.handle(
    'org:readFile',
    async (_event, params: { targetFilePath: string; allowedWorkspace: string; maxBytes?: number }) => {
      return OrgFolderTools.readFile(params.targetFilePath, params.allowedWorkspace, params.maxBytes);
    }
  );

  ipcMain.handle(
    'org:writeFile',
    async (_event, params: { targetFilePath: string; content: string; allowedWorkspace: string }) => {
      return OrgFolderTools.writeFile(params.targetFilePath, params.content, params.allowedWorkspace);
    }
  );

  ipcMain.handle('org:listDir', async (_event, params: { targetDir: string; allowedWorkspace: string }) => {
    return OrgFolderTools.listDir(params.targetDir, params.allowedWorkspace);
  });

  ipcMain.handle(
    'org:runShell',
    async (
      _event,
      params: {
        command: string;
        cwd: string;
        allowedWorkspace: string;
        options?: { timeoutMs?: number; requiresApproval?: boolean };
      }
    ) => {
      return OrgFolderTools.runShell(params.command, params.cwd, params.allowedWorkspace, params.options);
    }
  );

  ipcMain.handle('org:checkRiskyCommand', async (_event, params: { command: string }) => {
    return checkRiskyCommand(params.command);
  });
}
