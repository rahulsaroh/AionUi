/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app, desktopCapturer, globalShortcut, screen } from 'electron';
import {
  DEFAULT_DESKTOP_EMERGENCY_HOTKEY,
  DESKTOP_APPROVAL_TIMEOUT_MS,
  MAX_DESKTOP_AUDIT_ENTRIES,
  type DesktopApprovalRequest,
  type DesktopAuditEntry,
  type DesktopControlConfig,
  type DesktopControlStatus,
  type DesktopDisplayInfo,
  type DesktopMouseButton,
  type DesktopScreenshotResult,
  type DesktopToolExecutionResult,
  type DesktopToolName,
} from '@/common/desktopControl';
import { WindowsDesktopDriver, type IDesktopOsDriver } from './windowsDriver';

const CONFIG_FILE_NAME = 'desktop-control.config.json';

const STATE_CHANGING_TOOLS = new Set<DesktopToolName>([
  'desktop_focus_window',
  'desktop_click',
  'desktop_move',
  'desktop_type',
  'desktop_hotkey',
  'desktop_scroll',
]);

export type DesktopApprovalBroker = (req: DesktopApprovalRequest) => Promise<boolean>;

export type DesktopScreenCaptureProvider = (displayIndex?: number) => Promise<DesktopScreenshotResult>;

export type DesktopHotkeyRegistrar = {
  register: (accelerator: string, callback: () => void) => boolean;
  unregister: (accelerator: string) => void;
};

type PendingApproval = {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
};

const defaultConfig = (): DesktopControlConfig => ({
  enabled: false,
  requireConfirmation: true,
  emergencyHotkey: DEFAULT_DESKTOP_EMERGENCY_HOTKEY,
});

function createElectronScreenCapturer(): DesktopScreenCaptureProvider {
  return async (displayIndex = 0) => {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const displayInfos: DesktopDisplayInfo[] = displays.map((d, idx) => {
      const physical =
        typeof screen.dipToScreenRect === 'function'
          ? screen.dipToScreenRect(null, d.bounds)
          : {
              x: Math.round(d.bounds.x * d.scaleFactor),
              y: Math.round(d.bounds.y * d.scaleFactor),
              width: Math.round(d.bounds.width * d.scaleFactor),
              height: Math.round(d.bounds.height * d.scaleFactor),
            };
      return {
        id: d.id,
        index: idx,
        label: d.label || `Display ${idx + 1}`,
        bounds: physical,
        scaleFactor: d.scaleFactor,
        isPrimary: d.id === primary.id,
      };
    });

    const targetDisplay = displayInfos[displayIndex] ?? displayInfos[0];
    if (!targetDisplay) {
      throw new Error('No active display detected.');
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: targetDisplay.bounds.width,
        height: targetDisplay.bounds.height,
      },
    });

    const matchedSource =
      sources.find((s) => s.display_id === String(targetDisplay.id)) ?? sources[displayIndex] ?? sources[0];

    if (!matchedSource || matchedSource.thumbnail.isEmpty()) {
      throw new Error('Failed to capture screen thumbnail.');
    }

    const size = matchedSource.thumbnail.getSize();
    const pngBuffer = matchedSource.thumbnail.toPNG();
    return {
      base64: pngBuffer.toString('base64'),
      mimeType: 'image/png',
      width: size.width,
      height: size.height,
      scaleFactor: targetDisplay.scaleFactor,
      displayId: targetDisplay.id,
      displayIndex: targetDisplay.index,
      displays: displayInfos,
    };
  };
}

const defaultHotkeyRegistrar: DesktopHotkeyRegistrar = {
  register: (accelerator, callback) => {
    try {
      if (typeof app?.isReady === 'function' && !app.isReady()) {
        return false;
      }
      return globalShortcut.register(accelerator, callback);
    } catch {
      return false;
    }
  },
  unregister: (accelerator) => {
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      // Ignore during shutdown or unit tests
    }
  },
};

export class DesktopControlService extends EventEmitter {
  private readonly configPath: string;
  private readonly platform: string;
  private readonly driver: IDesktopOsDriver | null;
  private readonly captureScreen: DesktopScreenCaptureProvider;
  private readonly hotkeyRegistrar: DesktopHotkeyRegistrar;

  private config: DesktopControlConfig;
  private bridgePort: number | null = null;
  private hotkeyRegistered = false;
  private registeredHotkeyValue: string | null = null;
  private emergencyAborted = false;
  private auditLogs: DesktopAuditEntry[] = [];
  private approvalBroker: DesktopApprovalBroker | null = null;
  private pendingApprovals = new Map<string, PendingApproval>();

  constructor(options?: {
    configPath?: string;
    platform?: string;
    driver?: IDesktopOsDriver | null;
    captureScreen?: DesktopScreenCaptureProvider;
    hotkeyRegistrar?: DesktopHotkeyRegistrar;
  }) {
    super();
    this.platform = options?.platform ?? process.platform;
    this.configPath = options?.configPath ?? this.resolveConfigPath();
    this.driver =
      options?.driver !== undefined ? options.driver : this.platform === 'win32' ? new WindowsDesktopDriver() : null;
    this.captureScreen = options?.captureScreen ?? createElectronScreenCapturer();
    this.hotkeyRegistrar = options?.hotkeyRegistrar ?? defaultHotkeyRegistrar;
    this.config = this.loadConfig();
  }

  private resolveConfigPath(): string {
    try {
      if (app && typeof app.getPath === 'function') {
        return path.join(app.getPath('userData'), CONFIG_FILE_NAME);
      }
    } catch {
      // Unit tests without Electron app
    }
    return path.join(process.cwd(), CONFIG_FILE_NAME);
  }

  private loadConfig(): DesktopControlConfig {
    const base = defaultConfig();
    try {
      if (fs.existsSync(this.configPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as Partial<DesktopControlConfig>;
        return {
          enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : base.enabled,
          requireConfirmation:
            typeof parsed.requireConfirmation === 'boolean' ? parsed.requireConfirmation : base.requireConfirmation,
          emergencyHotkey:
            typeof parsed.emergencyHotkey === 'string' && parsed.emergencyHotkey.trim()
              ? parsed.emergencyHotkey.trim()
              : base.emergencyHotkey,
        };
      }
    } catch {
      // Ignore malformed config and use safe defaults
    }
    return base;
  }

  private saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[DesktopControl] Failed to persist config:', err);
    }
  }

  public isSupported(): boolean {
    return this.driver !== null;
  }

  public setBridgePort(port: number | null): void {
    this.bridgePort = port;
  }

  public setApprovalBroker(broker: DesktopApprovalBroker | null): void {
    this.approvalBroker = broker;
  }

  public getStatus(): DesktopControlStatus {
    return {
      enabled: this.config.enabled,
      requireConfirmation: this.config.requireConfirmation,
      emergencyHotkey: this.config.emergencyHotkey,
      hotkeyRegistered: this.hotkeyRegistered,
      emergencyAborted: this.emergencyAborted,
      supported: this.isSupported(),
      platform: this.platform,
      bridgePort: this.bridgePort,
    };
  }

  public syncEmergencyHotkey(): boolean {
    if (this.registeredHotkeyValue) {
      this.hotkeyRegistrar.unregister(this.registeredHotkeyValue);
      this.registeredHotkeyValue = null;
      this.hotkeyRegistered = false;
    }

    if (!this.config.enabled || !this.config.emergencyHotkey) {
      return false;
    }

    const ok = this.hotkeyRegistrar.register(this.config.emergencyHotkey, () => {
      this.triggerEmergencyStop('hotkey');
    });
    this.hotkeyRegistered = ok;
    if (ok) {
      this.registeredHotkeyValue = this.config.emergencyHotkey;
    }
    this.emit('statusChanged', this.getStatus());
    return ok;
  }

  public disposeHotkeys(): void {
    if (this.registeredHotkeyValue) {
      this.hotkeyRegistrar.unregister(this.registeredHotkeyValue);
      this.registeredHotkeyValue = null;
      this.hotkeyRegistered = false;
    }
  }

  public updateConfig(patch: Partial<DesktopControlConfig>): DesktopControlStatus {
    const next: DesktopControlConfig = {
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : this.config.enabled,
      requireConfirmation:
        typeof patch.requireConfirmation === 'boolean' ? patch.requireConfirmation : this.config.requireConfirmation,
      emergencyHotkey:
        typeof patch.emergencyHotkey === 'string' && patch.emergencyHotkey.trim()
          ? patch.emergencyHotkey.trim()
          : this.config.emergencyHotkey,
    };

    const wasEnabled = this.config.enabled;
    this.config = next;
    if (!next.enabled || (!wasEnabled && next.enabled)) {
      this.emergencyAborted = false;
    }
    this.saveConfig();
    this.syncEmergencyHotkey();
    const status = this.getStatus();
    this.emit('statusChanged', status);
    return status;
  }

  public triggerEmergencyStop(source: 'hotkey' | 'ui' = 'ui'): DesktopControlStatus {
    this.emergencyAborted = true;
    for (const [id, pending] of this.pendingApprovals.entries()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
      this.pendingApprovals.delete(id);
    }
    const status = this.getStatus();
    this.emit('emergencyStopped', { source, status });
    this.emit('statusChanged', status);
    return status;
  }

  public resume(): DesktopControlStatus {
    this.emergencyAborted = false;
    const status = this.getStatus();
    this.emit('statusChanged', status);
    return status;
  }

  public getAuditLogs(limit = 50): DesktopAuditEntry[] {
    return this.auditLogs.slice(0, Math.max(1, limit));
  }

  public clearAuditLogs(): void {
    this.auditLogs = [];
  }

  private recordAudit(entry: Omit<DesktopAuditEntry, 'id' | 'timestamp'>): void {
    const full: DesktopAuditEntry = {
      id: `dc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      timestamp: Date.now(),
      ...entry,
    };
    this.auditLogs.unshift(full);
    if (this.auditLogs.length > MAX_DESKTOP_AUDIT_ENTRIES) {
      this.auditLogs.length = MAX_DESKTOP_AUDIT_ENTRIES;
    }
    this.emit('auditLogged', full);
  }

  public respondApproval(id: string, approved: boolean): boolean {
    const pending = this.pendingApprovals.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingApprovals.delete(id);
    pending.resolve(approved);
    return true;
  }

  private summarizeToolCall(
    tool: DesktopToolName,
    args: Record<string, unknown>
  ): { summary: string; details: string } {
    switch (tool) {
      case 'desktop_click':
        return {
          summary: `Click (${String(args.button || 'left')} x${String(args.clickCount || 1)}) at (${String(args.x)}, ${String(args.y)})`,
          details: `Mouse ${String(args.button || 'left')} click (${String(args.clickCount || 1)}x) at screen coordinates (${String(args.x)}, ${String(args.y)})`,
        };
      case 'desktop_move':
        return {
          summary: args.drag
            ? `Drag from (${String(args.x)}, ${String(args.y)}) to (${String(args.toX)}, ${String(args.toY)})`
            : `Move cursor to (${String(args.x)}, ${String(args.y)})`,
          details: JSON.stringify(args),
        };
      case 'desktop_type': {
        const text = typeof args.text === 'string' ? args.text : '';
        const preview = text.length > 40 ? `${text.slice(0, 40)}...` : text;
        return {
          summary: `Type ${text.length} character(s)`,
          details: `Text preview: "${preview}"`,
        };
      }
      case 'desktop_hotkey':
        return {
          summary: `Press keys: ${Array.isArray(args.keys) ? args.keys.join(' + ') : ''}`,
          details: JSON.stringify(args),
        };
      case 'desktop_scroll':
        return {
          summary: `Scroll (dx=${String(args.deltaX || 0)}, dy=${String(args.deltaY || 0)})`,
          details: JSON.stringify(args),
        };
      case 'desktop_focus_window':
        return {
          summary: `Focus window: ${String(args.title || args.hwnd || args.pid || '')}`,
          details: JSON.stringify(args),
        };
      default:
        return { summary: tool, details: JSON.stringify(args) };
    }
  }

  private async requestConfirmation(tool: DesktopToolName, summary: string, details: string): Promise<boolean> {
    if (!this.config.requireConfirmation) {
      return true;
    }

    const req: DesktopApprovalRequest = {
      id: `dcappr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      tool,
      summary,
      details,
      timestamp: Date.now(),
    };

    if (this.approvalBroker) {
      return await this.approvalBroker(req);
    }

    // Fail closed if no listener is attached to resolve confirmations
    if (this.listenerCount('approvalRequested') === 0) {
      return false;
    }

    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(req.id);
        resolve(false);
      }, DESKTOP_APPROVAL_TIMEOUT_MS);

      this.pendingApprovals.set(req.id, { resolve, timer });
      this.emit('approvalRequested', req);
    });
  }

  public async capturePreviewScreenshot(displayIndex = 0): Promise<DesktopScreenshotResult> {
    if (!this.isSupported()) {
      throw new Error(`OS-level desktop control is currently supported on Windows only (current: ${this.platform}).`);
    }
    return await this.captureScreen(displayIndex);
  }

  public async executeTool(
    tool: DesktopToolName,
    args: Record<string, unknown> = {}
  ): Promise<DesktopToolExecutionResult> {
    const startTime = Date.now();
    const { summary, details } = this.summarizeToolCall(tool, args);

    try {
      if (!this.isSupported() || !this.driver) {
        throw new Error(`OS-level desktop control is not supported on platform "${this.platform}".`);
      }

      if (!this.config.enabled) {
        throw new Error(
          'OS-level Desktop Control is disabled. Ask the user to enable it in Settings > Tools > Desktop Control.'
        );
      }

      if (this.emergencyAborted) {
        throw new Error(
          'Desktop Control is paused by Emergency Stop. Ask the user to click Resume in Settings > Tools > Desktop Control.'
        );
      }

      if (STATE_CHANGING_TOOLS.has(tool)) {
        const approved = await this.requestConfirmation(tool, summary, details);
        if (!approved) {
          this.recordAudit({
            tool,
            summary,
            status: 'blocked',
            error: 'Action denied or timed out waiting for user confirmation.',
            durationMs: Date.now() - startTime,
          });
          return {
            success: false,
            tool,
            error: 'Desktop action was denied or timed out waiting for user confirmation.',
            durationMs: Date.now() - startTime,
          };
        }

        // Re-check abort right after confirmation wait
        if (!this.config.enabled || this.emergencyAborted) {
          throw new Error('Desktop Control was disabled or stopped before executing the action.');
        }
      }

      let data: unknown;
      switch (tool) {
        case 'desktop_screenshot':
          data = await this.captureScreen(typeof args.displayIndex === 'number' ? args.displayIndex : 0);
          break;
        case 'desktop_list_windows':
          data = await this.driver.listWindows();
          break;
        case 'desktop_focus_window':
          data = await this.driver.focusWindow({
            hwnd: typeof args.hwnd === 'string' ? args.hwnd : undefined,
            title: typeof args.title === 'string' ? args.title : undefined,
            pid: typeof args.pid === 'number' ? args.pid : undefined,
          });
          break;
        case 'desktop_ui_tree':
          data = await this.driver.getUiTree({
            hwnd: typeof args.hwnd === 'string' ? args.hwnd : undefined,
            title: typeof args.title === 'string' ? args.title : undefined,
            maxDepth: typeof args.maxDepth === 'number' ? args.maxDepth : 4,
            maxNodes: typeof args.maxNodes === 'number' ? args.maxNodes : 120,
          });
          break;
        case 'desktop_click':
          data = await this.driver.click({
            x: Number(args.x),
            y: Number(args.y),
            button: (args.button as DesktopMouseButton) || 'left',
            clickCount: typeof args.clickCount === 'number' ? args.clickCount : 1,
          });
          break;
        case 'desktop_move':
          data = await this.driver.move({
            x: Number(args.x),
            y: Number(args.y),
            drag: Boolean(args.drag),
            toX: args.toX !== undefined ? Number(args.toX) : undefined,
            toY: args.toY !== undefined ? Number(args.toY) : undefined,
          });
          break;
        case 'desktop_type':
          data = await this.driver.typeText({
            text: String(args.text ?? ''),
          });
          break;
        case 'desktop_hotkey':
          data = await this.driver.hotkey({
            keys: Array.isArray(args.keys) ? args.keys.map((k) => String(k)) : [],
          });
          break;
        case 'desktop_scroll':
          data = await this.driver.scroll({
            x: args.x !== undefined ? Number(args.x) : undefined,
            y: args.y !== undefined ? Number(args.y) : undefined,
            deltaX: typeof args.deltaX === 'number' ? args.deltaX : 0,
            deltaY: typeof args.deltaY === 'number' ? args.deltaY : -360,
          });
          break;
        case 'desktop_get_cursor':
          data = await this.driver.getCursor();
          break;
        default:
          throw new Error(`Unknown desktop control tool: ${String(tool)}`);
      }

      const durationMs = Date.now() - startTime;
      this.recordAudit({
        tool,
        summary,
        status: 'success',
        durationMs,
      });

      return {
        success: true,
        tool,
        data,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.recordAudit({
        tool,
        summary,
        status: 'failed',
        error: errorMsg,
        durationMs,
      });
      return {
        success: false,
        tool,
        error: errorMsg,
        durationMs,
      };
    }
  }
}

let desktopControlServiceInstance: DesktopControlService | null = null;

export function getDesktopControlService(): DesktopControlService {
  if (!desktopControlServiceInstance) {
    desktopControlServiceInstance = new DesktopControlService();
  }
  return desktopControlServiceInstance;
}
