/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserWindow, ipcMain } from 'electron';
import type { DesktopControlConfig } from '@/common/desktopControl';
import { getDesktopControlService } from '../services/desktopControl';

function broadcastToWindows(channel: string, payload: unknown): void {
  try {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  } catch {
    // Ignore in headless/test environments
  }
}

export function registerDesktopControlBridge(): void {
  const service = getDesktopControlService();

  service.on('statusChanged', (status) => {
    broadcastToWindows('desktopControl:statusChanged', status);
  });

  service.on('emergencyStopped', (event) => {
    broadcastToWindows('desktopControl:emergencyStopped', event);
  });

  service.on('approvalRequested', (req) => {
    broadcastToWindows('desktopControl:approvalRequested', req);
  });

  ipcMain.handle('desktopControl:getStatus', async () => {
    try {
      return { success: true, data: service.getStatus() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('desktopControl:updateConfig', async (_event, patch: Partial<DesktopControlConfig>) => {
    try {
      const status = service.updateConfig(patch || {});
      return { success: true, data: status };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('desktopControl:emergencyStop', async () => {
    try {
      return { success: true, data: service.triggerEmergencyStop('ui') };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('desktopControl:resume', async () => {
    try {
      return { success: true, data: service.resume() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('desktopControl:getAuditLogs', async (_event, limit?: number) => {
    try {
      return { success: true, data: service.getAuditLogs(limit) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('desktopControl:clearAuditLogs', async () => {
    try {
      service.clearAuditLogs();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('desktopControl:capturePreview', async (_event, displayIndex?: number) => {
    try {
      const data = await service.capturePreviewScreenshot(displayIndex ?? 0);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('desktopControl:respondApproval', async (_event, payload: { id: string; approved: boolean }) => {
    try {
      const resolved = service.respondApproval(payload.id, Boolean(payload.approved));
      return { success: true, data: resolved };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
