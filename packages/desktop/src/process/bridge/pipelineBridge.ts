/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcMain } from 'electron';
import type { PublishPayload } from '@/common/types/pipeline/pipelineTypes';
import { getPipelineServices } from '../services/pipeline';

export function registerPipelineBridge(): void {
  ipcMain.handle('pipeline:getRun', async (_event, runId: string) => {
    try {
      const { repo } = await getPipelineServices();
      return repo.getRun(runId);
    } catch (err) {
      console.error('[PipelineBridge] getRun error:', err);
      return null;
    }
  });

  ipcMain.handle('pipeline:listRuns', async (_event, projectId?: string) => {
    try {
      const { repo } = await getPipelineServices();
      return repo.listRuns(projectId);
    } catch (err) {
      console.error('[PipelineBridge] listRuns error:', err);
      return [];
    }
  });

  ipcMain.handle('pipeline:resume', async (_event, params: { runId: string; baseDir?: string }) => {
    const { runService } = await getPipelineServices();
    return runService.resumeRun(params.runId, params.baseDir);
  });

  ipcMain.handle('pipeline:rerun', async (_event, params: { runId: string; stepIndex: number }) => {
    const { runService } = await getPipelineServices();
    return runService.rerunFromStep(params.runId, params.stepIndex);
  });

  ipcMain.handle(
    'publish:approve',
    async (_event, params: { idempotencyKey: string; previewPayload?: PublishPayload }) => {
      const { publishService } = await getPipelineServices();
      return publishService.approvePublish(params.idempotencyKey, {
        previewPayload: params.previewPayload,
        auditUser: 'desktop_user',
      });
    }
  );

  ipcMain.handle('publish:reject', async (_event, params: { idempotencyKey: string; reason?: string }) => {
    const { publishService } = await getPipelineServices();
    return publishService.rejectPublish(params.idempotencyKey, params.reason, {
      auditUser: 'desktop_user',
    });
  });

  ipcMain.handle('publish:listRecords', async (_event, projectId?: string) => {
    try {
      const { publishService } = await getPipelineServices();
      return publishService.listRecords(projectId);
    } catch (err) {
      console.error('[PipelineBridge] listRecords error:', err);
      return [];
    }
  });

  ipcMain.handle('publish:getRecord', async (_event, idempotencyKey: string) => {
    try {
      const { publishService } = await getPipelineServices();
      return publishService.getRecord(idempotencyKey);
    } catch (err) {
      console.error('[PipelineBridge] getRecord error:', err);
      return null;
    }
  });
}
