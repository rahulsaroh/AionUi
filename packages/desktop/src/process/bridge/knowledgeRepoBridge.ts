/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcMain, BrowserWindow, shell } from 'electron';
import { knowledgeRepoService } from '../services/knowledgeRepo';
import type { KnowledgeRepo } from '@/common/types/knowledgeRepo';

export function registerKnowledgeRepoBridge(): void {
  // Ensure the service is initialized
  knowledgeRepoService.initialize().catch((err) => {
    console.error('[KnowledgeRepoBridge] Failed to initialize knowledge repo service:', err);
  });

  // Forward background clone and sync progress to all renderer windows
  knowledgeRepoService.onProgress((progress) => {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('knowledgeRepo:progress', progress);
      }
    }
  });

  ipcMain.handle('knowledgeRepo:list', async () => {
    return knowledgeRepoService.listRepos();
  });

  ipcMain.handle('knowledgeRepo:get', async (_event, id: string) => {
    return knowledgeRepoService.getRepo(id);
  });

  ipcMain.handle(
    'knowledgeRepo:add',
    async (
      _event,
      params: {
        name: string;
        gitUrl: string;
        ref?: string;
        subpath?: string;
        authToken?: string;
        workspacePath?: string;
      }
    ) => {
      return knowledgeRepoService.addRepo(params);
    }
  );

  ipcMain.handle('knowledgeRepo:update', async (_event, id: string) => {
    return knowledgeRepoService.updateRepo(id);
  });

  ipcMain.handle('knowledgeRepo:syncRepo', async (_event, id: string) => {
    return knowledgeRepoService.syncRepo(id);
  });

  ipcMain.handle(
    'knowledgeRepo:syncWorkspace',
    async (_event, params: { workspacePath: string; teammateKey?: string }) => {
      return knowledgeRepoService.syncWorkspace(params.workspacePath, { teammateKey: params.teammateKey });
    }
  );

  ipcMain.handle(
    'knowledgeRepo:syncTeammate',
    async (_event, params: { memberKey: string; workspacePath?: string }) => {
      return knowledgeRepoService.syncTeammate(params.memberKey, params.workspacePath);
    }
  );

  ipcMain.handle('knowledgeRepo:getCacheDir', async () => {
    return knowledgeRepoService.getCacheDir();
  });

  ipcMain.handle('knowledgeRepo:setCacheDir', async (_event, dir: string) => {
    return knowledgeRepoService.setCacheDir(dir);
  });

  ipcMain.handle('knowledgeRepo:openFolder', async () => {
    const dir = knowledgeRepoService.getCacheDir();
    if (shell && shell.openPath) {
      await shell.openPath(dir);
      return true;
    }
    return false;
  });

  ipcMain.handle('knowledgeRepo:isCloudSyncPath', async (_event, targetPath?: string) => {
    return knowledgeRepoService.isCloudSyncPath(targetPath);
  });

  ipcMain.handle('knowledgeRepo:rollback', async (_event, id: string) => {
    return knowledgeRepoService.rollbackRepo(id);
  });

  ipcMain.handle('knowledgeRepo:pin', async (_event, params: { id: string; pin: boolean }) => {
    return knowledgeRepoService.pinRepo(params.id, params.pin);
  });

  ipcMain.handle(
    'knowledgeRepo:setTrust',
    async (_event, params: { id: string; trustStatus: KnowledgeRepo['trustStatus'] }) => {
      return knowledgeRepoService.setTrustStatus(params.id, params.trustStatus);
    }
  );

  ipcMain.handle('knowledgeRepo:remove', async (_event, params: string | { id: string; workspacePath?: string }) => {
    const id = typeof params === 'string' ? params : params.id;
    const workspacePath = typeof params === 'string' ? undefined : params.workspacePath;
    return knowledgeRepoService.removeRepo(id, workspacePath);
  });

  ipcMain.handle(
    'knowledgeRepo:buildInstructions',
    async (
      _event,
      params: {
        memberName: string;
        rolePrompt?: string;
        repoIds: string[];
        whenToUseHint?: string;
        tokenBudget?: number;
        conversationId?: string;
        memberKey?: string;
        forceFullPlaybook?: boolean;
      }
    ) => {
      return knowledgeRepoService.buildEffectiveInstructions(params);
    }
  );

  ipcMain.handle(
    'knowledgeRepo:buildTeamCapabilityCards',
    async (
      _event,
      members: Array<{
        slot_id: string;
        assistant_name: string;
        knowledgeRepoIds?: string[];
        whenToUseHint?: string;
      }>
    ) => {
      return knowledgeRepoService.buildTeamCapabilityCards(members);
    }
  );

  ipcMain.handle('knowledgeRepo:setTaskRunning', async (_event, params: { repoIds: string[]; isRunning: boolean }) => {
    knowledgeRepoService.setAgentTaskRunning(params.repoIds, params.isRunning);
  });

  ipcMain.handle(
    'knowledgeRepo:runSetup',
    async (_event, params: { repoId: string; projectId?: string; command: string }) => {
      return knowledgeRepoService.runSetup(params);
    }
  );

  ipcMain.handle('knowledgeRepo:checkEnvironment', async (_event, repoId: string) => {
    return knowledgeRepoService.checkEnvironment(repoId);
  });

  ipcMain.handle(
    'knowledgeRepo:provisionWorkingCopy',
    async (_event, params: { repoId: string; projectId: string }) => {
      return knowledgeRepoService.provisionWorkingCopy(params.repoId, params.projectId);
    }
  );

  ipcMain.handle(
    'knowledgeRepo:setEnvVars',
    async (_event, params: { id: string; envVars: Record<string, string> }) => {
      return knowledgeRepoService.setRepoEnvVars(params.id, params.envVars);
    }
  );

  ipcMain.handle('knowledgeRepo:getAssignment', async (_event, memberKey: string) => {
    return knowledgeRepoService.getAssignment(memberKey);
  });

  ipcMain.handle(
    'knowledgeRepo:setAssignment',
    async (
      _event,
      params: {
        memberKey: string;
        assignment: { repoIds: string[]; whenToUseHint?: string };
        workspacePath?: string;
      }
    ) => {
      return knowledgeRepoService.setAssignment(params.memberKey, params.assignment, params.workspacePath);
    }
  );

  ipcMain.handle('knowledgeRepo:listAssignments', async () => {
    return knowledgeRepoService.listAssignments();
  });
}
