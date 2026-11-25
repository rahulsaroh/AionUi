/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  WindowsDesktopDriver,
  parseJsonStdout,
  resolveHotkeyCodes,
  resolveVirtualKeyCode,
  validateCoordinates,
} from '@process/services/desktopControl/windowsDriver';

describe('windowsDriver helpers', () => {
  it('resolves modifier, navigation, function, and alphanumeric virtual key codes', () => {
    expect(resolveHotkeyCodes(['Ctrl', 'Shift', 'a'])).toEqual([0x11, 0x10, 0x41]);
    expect(resolveVirtualKeyCode('Enter')).toBe(0x0d);
    expect(resolveVirtualKeyCode('f5')).toBe(0x74);
  });

  it('rejects empty or unsupported key names', () => {
    expect(() => resolveVirtualKeyCode('   ')).toThrow(/cannot be empty/i);
    expect(() => resolveHotkeyCodes([])).toThrow(/at least one key/i);
    expect(() => resolveVirtualKeyCode('UnknownKeyXYZ')).toThrow(/Unsupported key name/i);
  });

  it('rounds finite screen coordinates and rejects non-finite coordinates', () => {
    expect(validateCoordinates(100.6, 200.2)).toEqual({ x: 101, y: 200 });
    expect(() => validateCoordinates(Number.NaN, 10)).toThrow(/Invalid screen coordinates/i);
    expect(() => validateCoordinates(10, Number.POSITIVE_INFINITY)).toThrow(/Invalid screen coordinates/i);
  });

  it('parses valid JSON stdout and rejects empty or malformed output', () => {
    expect(parseJsonStdout<{ ok: boolean }>('  {"ok":true}\r\n')).toEqual({ ok: true });
    expect(() => parseJsonStdout('   ')).toThrow(/empty output/i);
    expect(() => parseJsonStdout('not-json')).toThrow();
  });
});

describe('WindowsDesktopDriver', () => {
  it('passes rounded coordinates and clamped clickCount for click', async () => {
    const runner = vi.fn(async () => '{"clicked":true,"x":50,"y":75,"button":"right","clickCount":2}');
    const driver = new WindowsDesktopDriver(runner);

    const res = await driver.click({ x: 50.4, y: 74.9, button: 'right', clickCount: 2 });
    expect(res).toEqual({ clicked: true, x: 50, y: 75, button: 'right', clickCount: 2 });
    expect(runner).toHaveBeenCalledWith(expect.stringContaining('SetCursorPos'), {
      x: 50,
      y: 75,
      button: 'right',
      clickCount: 2,
    });
  });

  it('normalizes single window object from ConvertTo-Json into an array', async () => {
    const singleWindow = {
      hwnd: '0x123',
      title: 'Notepad',
      processName: 'notepad',
      pid: 4242,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      isMinimized: false,
      isForeground: true,
    };
    const runner = vi.fn(async () => JSON.stringify(singleWindow));
    const driver = new WindowsDesktopDriver(runner);

    const windows = await driver.listWindows();
    expect(windows).toEqual([singleWindow]);
  });

  it('rejects empty text, missing window target, and runner failures', async () => {
    const failingRunner = vi.fn(async () => {
      throw new Error('Access denied');
    });
    const driver = new WindowsDesktopDriver(failingRunner);

    await expect(driver.typeText({ text: '' })).rejects.toThrow(/cannot be empty/i);
    await expect(driver.focusWindow({})).rejects.toThrow(/at least one of hwnd, title, or pid/i);
    await expect(driver.hotkey({ keys: ['Ctrl', 'c'] })).rejects.toThrow(/Access denied/);
  });
});
