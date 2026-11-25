/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type DesktopToolName =
  | 'desktop_screenshot'
  | 'desktop_list_windows'
  | 'desktop_focus_window'
  | 'desktop_ui_tree'
  | 'desktop_click'
  | 'desktop_move'
  | 'desktop_type'
  | 'desktop_hotkey'
  | 'desktop_scroll'
  | 'desktop_get_cursor';

export type DesktopMouseButton = 'left' | 'right' | 'middle';

export type DesktopControlConfig = {
  /** Master switch for OS-level GUI control (off by default). */
  enabled: boolean;
  /** Require interactive user confirmation before each state-changing GUI input action. */
  requireConfirmation: boolean;
  /** Global emergency abort accelerator (Electron Accelerator syntax). */
  emergencyHotkey: string;
};

export type DesktopControlStatus = {
  enabled: boolean;
  requireConfirmation: boolean;
  emergencyHotkey: string;
  hotkeyRegistered: boolean;
  emergencyAborted: boolean;
  supported: boolean;
  platform: string;
  bridgePort: number | null;
};

export type DesktopDisplayInfo = {
  id: number;
  index: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
};

export type DesktopWindowInfo = {
  hwnd: string;
  title: string;
  processName: string;
  pid: number;
  bounds: { x: number; y: number; width: number; height: number };
  isMinimized: boolean;
  isForeground: boolean;
};

export type DesktopUiElement = {
  name: string;
  controlType: string;
  automationId?: string;
  className?: string;
  isEnabled: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  value?: string;
  children?: DesktopUiElement[];
};

export type DesktopScreenshotResult = {
  base64: string;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  scaleFactor: number;
  displayId: number;
  displayIndex: number;
  displays: DesktopDisplayInfo[];
};

export type DesktopAuditEntry = {
  id: string;
  timestamp: number;
  tool: DesktopToolName;
  summary: string;
  status: 'success' | 'failed' | 'blocked';
  error?: string;
  durationMs: number;
};

export type DesktopApprovalRequest = {
  id: string;
  tool: DesktopToolName;
  summary: string;
  details: string;
  timestamp: number;
};

export type DesktopToolExecutionResult = {
  success: boolean;
  tool: DesktopToolName;
  data?: unknown;
  error?: string;
  durationMs: number;
};
