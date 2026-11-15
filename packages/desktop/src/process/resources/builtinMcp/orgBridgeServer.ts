/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { BrowserWindow, ipcMain } from 'electron';
import { assertWithinScope } from '@process/services/org/pathGuard';
import { getMasterRoot } from '@process/services/org/orgScope';
import { scanFolderCompact } from '@process/services/org/scanFolder';

export type OrgRole = 'ceo' | 'department_head' | 'project_head';

export interface OrgToolExecutionRequest {
  tool: string;
  args: Record<string, any>;
  role?: OrgRole;
  deptId?: string;
  projectId?: string;
  deptWorkspacePath?: string;
}

export interface OrgToolExecutionResponse {
  success: boolean;
  result?: any;
  error?: string;
}

type ToolExecutor = (
  tool: string,
  args: Record<string, any>,
  meta: { role?: OrgRole; deptId?: string; projectId?: string; deptWorkspacePath?: string }
) => Promise<any>;

type LiveStepListener = (data: { step: string; tool?: string; args?: any }) => void;

let bridgeServer: http.Server | null = null;
let bridgePort: number | null = null;
let bridgeToken: string | null = null;

let customToolExecutor: ToolExecutor | null = null;
const liveStepListeners = new Set<LiveStepListener>();

// Map for tracking pending IPC calls to renderer
const pendingCalls = new Map<
  string,
  {
    resolve: (val: OrgToolExecutionResponse) => void;
    reject: (err: Error) => void;
  }
>();

let ipcRegistered = false;

function ensureIpcRegistered(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  try {
    ipcMain.on(
      'org:execute-tool-response',
      (_event, payload: { callId: string; success: boolean; result?: any; error?: string }) => {
        const pending = pendingCalls.get(payload.callId);
        if (pending) {
          pendingCalls.delete(payload.callId);
          pending.resolve({
            success: payload.success,
            result: payload.result,
            error: payload.error,
          });
        }
      }
    );
  } catch {
    // ipcMain might not be available in non-electron test environments
  }
}

export function setOrgToolExecutor(executor: ToolExecutor | null): void {
  customToolExecutor = executor;
}

export function onOrgLiveStep(listener: LiveStepListener): () => void {
  liveStepListeners.add(listener);
  return () => {
    liveStepListeners.delete(listener);
  };
}

export function broadcastOrgLiveStep(data: { step: string; tool?: string; args?: any }): void {
  for (const listener of liveStepListeners) {
    try {
      listener(data);
    } catch (err) {
      console.error('[OrgBridgeServer] Error in live step listener:', err);
    }
  }

  // Also broadcast to renderer via Electron IPC if available
  try {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('org:live-step', data);
      }
    }
  } catch {}
}

async function forwardToolToRenderer(
  tool: string,
  args: Record<string, any>,
  meta: { role?: OrgRole; deptId?: string; projectId?: string; deptWorkspacePath?: string }
): Promise<OrgToolExecutionResponse> {
  // If custom or in-memory executor is set (e.g. tests or direct bridge), use it
  if (customToolExecutor) {
    try {
      const res = await customToolExecutor(tool, args, meta);
      return { success: true, result: res };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Forward to renderer window via Electron IPC
  ensureIpcRegistered();
  let targetWindow: BrowserWindow | null = null;
  try {
    targetWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
  } catch {
    targetWindow = null;
  }

  if (!targetWindow || targetWindow.isDestroyed()) {
    return {
      success: false,
      error: 'No active application window found to handle organization tool execution.',
    };
  }

  const callId = `tool-call-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  return new Promise<OrgToolExecutionResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCalls.delete(callId);
      resolve({
        success: false,
        error: `Tool execution "${tool}" timed out waiting for renderer response (30s).`,
      });
    }, 30000);

    pendingCalls.set(callId, {
      resolve: (val) => {
        clearTimeout(timeout);
        resolve(val);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    });

    targetWindow.webContents.send('org:execute-tool-call', {
      callId,
      tool,
      args,
      meta,
    });
  });
}

/**
 * Validates role permissions and executes the tool either in process (e.g. scan_folder)
 * or forwards to the renderer store.
 */
export async function handleOrgToolRequest(request: OrgToolExecutionRequest): Promise<OrgToolExecutionResponse> {
  const { tool, args, role = 'ceo', deptId, projectId, deptWorkspacePath } = request;

  // 1. Role-based tool access control
  if (role === 'department_head') {
    const allowed = new Set([
      'scan_folder',
      'create_project',
      'assign_member',
      'assign_task',
      'list_org',
      'get_status',
      'ask_user',
    ]);
    if (!allowed.has(tool)) {
      return {
        success: false,
        error: `Access denied: Department Head role is not permitted to execute "${tool}".`,
      };
    }
  } else if (role === 'project_head') {
    const allowed = new Set(['assign_task', 'get_status', 'list_org', 'ask_user']);
    if (!allowed.has(tool)) {
      return {
        success: false,
        error: `Access denied: Project Head role is not permitted to execute "${tool}".`,
      };
    }
  }

  // 2. Folder boundaries enforcement
  const masterRoot = await getMasterRoot();
  if (!masterRoot && tool !== 'ask_user' && tool !== 'get_status') {
    return {
      success: false,
      error: 'No organization master root is configured. Please configure a master root folder first.',
    };
  }

  if (tool === 'scan_folder') {
    broadcastOrgLiveStep({ step: `Scanning folder: ${args.path || masterRoot || ''}`, tool, args });
    const allowedScope = role === 'department_head' && deptWorkspacePath ? deptWorkspacePath : masterRoot || undefined;
    const scanResult = await scanFolderCompact(args.path, {
      depth: args.depth,
      maxEntries: args.maxEntries,
      allowedScope,
    });
    return {
      success: scanResult.success,
      result: scanResult.success ? scanResult.tree : undefined,
      error: scanResult.error,
    };
  }

  if (tool === 'create_department') {
    if (!args.name || !args.folder) {
      return { success: false, error: 'create_department requires "name" and "folder".' };
    }
    broadcastOrgLiveStep({ step: `Creating department: ${args.name}`, tool, args });
    const check = await assertWithinScope(args.folder, masterRoot!);
    if (!check.allowed) {
      return {
        success: false,
        error: `Access denied: Department folder "${args.folder}" is outside organization master root "${masterRoot}" (${check.reason}).`,
      };
    }
  }

  if (tool === 'create_project') {
    if (!args.departmentId || !args.name || !args.folder) {
      return { success: false, error: 'create_project requires "departmentId", "name", and "folder".' };
    }
    broadcastOrgLiveStep({ step: `Creating project: ${args.name}`, tool, args });
    const effectiveParentRoot = role === 'department_head' && deptWorkspacePath ? deptWorkspacePath : masterRoot!;
    const check = await assertWithinScope(args.folder, effectiveParentRoot);
    if (!check.allowed) {
      return {
        success: false,
        error: `Access denied: Project folder "${args.folder}" is outside authorized boundary "${effectiveParentRoot}" (${check.reason}).`,
      };
    }
  }

  if (tool === 'hire_member') {
    if (!args.name || !args.role) {
      return { success: false, error: 'hire_member requires "name" and "role".' };
    }
    broadcastOrgLiveStep({ step: `Hiring member: ${args.name} (${args.role})`, tool, args });
  }

  if (tool === 'assign_member') {
    if (!args.projectId || !args.memberId) {
      return { success: false, error: 'assign_member requires "projectId" and "memberId".' };
    }
    broadcastOrgLiveStep({ step: `Assigning member ${args.memberId} to project ${args.projectId}`, tool, args });
  }

  if (tool === 'assign_task') {
    if (!args.target || !args.task) {
      return { success: false, error: 'assign_task requires "target" and "task".' };
    }
    broadcastOrgLiveStep({ step: `Delegating task to ${args.target}: ${args.task}`, tool, args });
  }

  if (tool === 'propose_structure') {
    broadcastOrgLiveStep({ step: 'Generating organizational structure proposal for approval', tool, args });
  }

  if (tool === 'ask_user') {
    if (!args.question) {
      return { success: false, error: 'ask_user requires "question".' };
    }
    broadcastOrgLiveStep({ step: `Asking user: ${args.question}`, tool, args });
  }

  // Forward to renderer store
  return await forwardToolToRenderer(tool, args, { role, deptId, projectId, deptWorkspacePath });
}

/**
 * Starts the local HTTP bridge server for Org MCP.
 */
export async function startOrgBridgeServer(): Promise<{ port: number; token: string }> {
  if (bridgeServer && bridgePort && bridgeToken) {
    return { port: bridgePort, token: bridgeToken };
  }

  const token = crypto.randomBytes(24).toString('hex');
  bridgeToken = token;

  const server = http.createServer((req, res) => {
    // Only accept POST /api/org-tool
    if (req.method !== 'POST' || req.url !== '/api/org-tool') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Verify token
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${token}`) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: invalid authorization token' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      // Cap at 5 MB
      if (body.length > 5 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body) as OrgToolExecutionRequest;
        const response = await handleOrgToolRequest(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve(addr.port);
      } else {
        reject(new Error('Could not bind org bridge server'));
      }
    });
  });

  bridgeServer = server;
  bridgePort = port;
  return { port, token };
}

export function getOrgBridgeInfo(): { port: number; token: string } | null {
  if (bridgePort && bridgeToken) {
    return { port: bridgePort, token: bridgeToken };
  }
  return null;
}

export async function stopOrgBridgeServer(): Promise<void> {
  if (bridgeServer) {
    await new Promise<void>((resolve) => {
      bridgeServer?.close(() => resolve());
    });
    bridgeServer = null;
    bridgePort = null;
    bridgeToken = null;
  }
}
