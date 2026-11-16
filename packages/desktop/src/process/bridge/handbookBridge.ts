/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcMain } from 'electron';
import { handbookService } from '../services/memberHandbook';
import type {
  HandbookAssignedRepo,
  HandbookCreateOptions,
  HandbookDetail,
  HandbookHistoryItem,
  HandbookInjectionResult,
  HandbookStatus,
} from '@/common/types/team/handbookTypes';

export function registerHandbookBridge(): void {
  ipcMain.handle('memberHandbook:getHandbookDir', async () => {
    return handbookService.getHandbookDir();
  });

  ipcMain.handle('memberHandbook:setHandbookDir', async (_event, dir: string) => {
    handbookService.setHandbookDir(dir);
    return true;
  });

  ipcMain.handle('memberHandbook:openFolder', async () => {
    return handbookService.openFolder();
  });

  ipcMain.handle('memberHandbook:create', async (_event, options: HandbookCreateOptions): Promise<HandbookDetail> => {
    return handbookService.create(options);
  });

  ipcMain.handle('memberHandbook:read', async (_event, memberKey: string, model?: string): Promise<HandbookDetail | null> => {
    return handbookService.read(memberKey, model);
  });

  ipcMain.handle(
    'memberHandbook:update',
    async (_event, params: { memberKey: string; content: string }): Promise<{ success: boolean; fileHash: string }> => {
      return handbookService.update(params);
    }
  );

  ipcMain.handle(
    'memberHandbook:rename',
    async (
      _event,
      params: { memberKey: string; newMemberName: string }
    ): Promise<{ success: boolean; newFileName: string; newFilePath: string }> => {
      return handbookService.rename(params);
    }
  );

  ipcMain.handle(
    'memberHandbook:delete',
    async (_event, params: { memberKey: string; archive?: boolean }): Promise<{ success: boolean }> => {
      return handbookService.delete(params.memberKey, params.archive);
    }
  );

  ipcMain.handle('memberHandbook:list', async (): Promise<HandbookDetail[]> => {
    return handbookService.list();
  });

  ipcMain.handle(
    'memberHandbook:getStatus',
    async (_event, params: { memberKey: string; memberName?: string }): Promise<HandbookStatus> => {
      return handbookService.getStatus(params);
    }
  );

  ipcMain.handle(
    'memberHandbook:revert',
    async (_event, params: { memberKey: string; historyId: string }): Promise<HandbookDetail> => {
      return handbookService.revert(params.memberKey, params.historyId);
    }
  );

  ipcMain.handle('memberHandbook:listHistory', async (_event, memberKey: string): Promise<HandbookHistoryItem[]> => {
    return handbookService.listHistory(memberKey);
  });

  ipcMain.handle(
    'memberHandbook:setKnowledgeSection',
    async (
      _event,
      params: { memberKey: string; repos: HandbookAssignedRepo[]; digest?: string }
    ): Promise<{ success: boolean }> => {
      return handbookService.setKnowledgeSection(params.memberKey, params.repos, params.digest);
    }
  );

  ipcMain.handle(
    'memberHandbook:getInjectedBlock',
    async (
      _event,
      params: {
        memberKey: string;
        conversationId?: string;
        isFirstMessage?: boolean;
        model?: string;
      }
    ): Promise<HandbookInjectionResult | null> => {
      return handbookService.getInjectedBlock(params);
    }
  );
}
