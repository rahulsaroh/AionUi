/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopControlService } from '@process/services/desktopControl/DesktopControlService';
import type { IDesktopOsDriver } from '@process/services/desktopControl/windowsDriver';
import type { DesktopScreenshotResult } from '@/common/desktopControl';

function createTempConfigPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-dc-test-'));
  return path.join(dir, 'desktop-control.config.json');
}

function createMockDriver(): IDesktopOsDriver {
  return {
    click: vi.fn(async () => ({ clicked: true })),
    move: vi.fn(async () => ({ moved: true })),
    scroll: vi.fn(async () => ({ scrolled: true })),
    typeText: vi.fn(async () => ({ typed: true })),
    hotkey: vi.fn(async () => ({ pressed: true })),
    getCursor: vi.fn(async () => ({ x: 10, y: 20 })),
    listWindows: vi.fn(async () => []),
    focusWindow: vi.fn(async () => ({ focused: true })),
    getUiTree: vi.fn(async () => ({
      name: 'Window',
      controlType: 'Window',
      isEnabled: true,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      center: { x: 50, y: 50 },
    })),
  };
}

const mockScreenshot: DesktopScreenshotResult = {
  base64: 'ZmFrZQ==',
  mimeType: 'image/png',
  width: 1920,
  height: 1080,
  scaleFactor: 1,
  displayId: 1,
  displayIndex: 0,
  displays: [
    {
      id: 1,
      index: 0,
      label: 'Display 1',
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
      isPrimary: true,
    },
  ],
};

describe('DesktopControlService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeService(overrides?: { platform?: string; driver?: IDesktopOsDriver | null; registerSuccess?: boolean }) {
    const configPath = createTempConfigPath();
    tempDirs.push(path.dirname(configPath));
    let registeredCallback: (() => void) | null = null;
    const hotkeyRegistrar = {
      register: vi.fn((_accel: string, cb: () => void) => {
        registeredCallback = cb;
        return overrides?.registerSuccess ?? true;
      }),
      unregister: vi.fn(),
    };
    const driver = overrides?.driver !== undefined ? overrides.driver : createMockDriver();
    const service = new DesktopControlService({
      configPath,
      platform: overrides?.platform ?? 'win32',
      driver,
      captureScreen: vi.fn(async () => mockScreenshot),
      hotkeyRegistrar,
    });
    return {
      service,
      driver,
      hotkeyRegistrar,
      configPath,
      fireHotkey: () => registeredCallback?.(),
    };
  }

  it('fails closed by default when Desktop Control is disabled', async () => {
    const { service, driver } = makeService();
    const res = await service.executeTool('desktop_screenshot', {});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/disabled/i);
    expect(driver?.listWindows).not.toHaveBeenCalled();
  });

  it('fails closed on unsupported non-Windows platforms', async () => {
    const { service } = makeService({ platform: 'linux', driver: null });
    service.updateConfig({ enabled: true });
    const res = await service.executeTool('desktop_list_windows', {});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not supported/i);
  });

  it('executes read-only tools without confirmation once enabled', async () => {
    const { service, driver } = makeService();
    service.updateConfig({ enabled: true, requireConfirmation: true });

    const shot = await service.executeTool('desktop_screenshot', {});
    const wins = await service.executeTool('desktop_list_windows', {});
    expect(shot.success).toBe(true);
    expect(wins.success).toBe(true);
    expect(driver?.listWindows).toHaveBeenCalledTimes(1);
  });

  it('requires and honors user confirmation for input actions when requireConfirmation is true', async () => {
    const { service, driver } = makeService();
    service.updateConfig({ enabled: true, requireConfirmation: true });

    // No broker/listener attached -> fails closed
    const deniedNoBroker = await service.executeTool('desktop_click', { x: 10, y: 20 });
    expect(deniedNoBroker.success).toBe(false);

    // Explicit approval via listener
    service.on('approvalRequested', (req: { id: string }) => {
      service.respondApproval(req.id, true);
    });
    const allowed = await service.executeTool('desktop_click', { x: 10, y: 20 });
    expect(allowed.success).toBe(true);
    expect(driver?.click).toHaveBeenCalledTimes(1);
  });

  it('blocks input actions when confirmation is explicitly denied', async () => {
    const { service, driver } = makeService();
    service.updateConfig({ enabled: true, requireConfirmation: true });
    service.setApprovalBroker(async () => false);

    const res = await service.executeTool('desktop_type', { text: 'hello' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/denied/i);
    expect(driver?.typeText).not.toHaveBeenCalled();
  });

  it('pauses immediately on emergency hotkey and resumes when cleared', async () => {
    const { service, driver, fireHotkey } = makeService();
    service.updateConfig({ enabled: true, requireConfirmation: false });

    fireHotkey();
    expect(service.getStatus().emergencyAborted).toBe(true);

    const blocked = await service.executeTool('desktop_click', { x: 5, y: 5 });
    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/Emergency Stop/i);

    service.resume();
    const resumed = await service.executeTool('desktop_click', { x: 5, y: 5 });
    expect(resumed.success).toBe(true);
    expect(driver?.click).toHaveBeenCalledTimes(1);
  });

  it('persists configuration updates across service restarts and records audit logs', async () => {
    const { service, configPath, hotkeyRegistrar } = makeService();
    service.updateConfig({
      enabled: true,
      requireConfirmation: false,
      emergencyHotkey: 'CommandOrControl+Alt+K',
    });

    await service.executeTool('desktop_get_cursor', {});
    expect(service.getAuditLogs(10)).toHaveLength(1);
    expect(hotkeyRegistrar.register).toHaveBeenCalledWith('CommandOrControl+Alt+K', expect.any(Function));

    const reloaded = new DesktopControlService({
      configPath,
      platform: 'win32',
      driver: createMockDriver(),
      captureScreen: vi.fn(async () => mockScreenshot),
    });
    expect(reloaded.getStatus().enabled).toBe(true);
    expect(reloaded.getStatus().emergencyHotkey).toBe('CommandOrControl+Alt+K');
  });
});
