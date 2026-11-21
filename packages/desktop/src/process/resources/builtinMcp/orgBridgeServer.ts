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
import {
  executeListDir,
  executeReadFile,
  executeWriteFile,
  executeRunShell,
  setOrgBashApprovalBroker,
  type OrgCtx,
  type ApprovalRequest,
} from '@process/services/org/orgExecution';
import { normalizeApprovalPolicy } from '@process/services/org/orgApprovalPolicy';
import { readOrgDirectory } from '@process/services/org/orgDirectory';

const EXECUTION_TOOLS = new Set(['list_dir', 'read_file', 'write_file', 'run_shell']);

const TOOL_REQUIRED_ROLE: Record<string, string> = {
  create_department: 'Root CEO',
  propose_structure: 'Root CEO',
  scan_folder: 'Department Head or Team Lead',
  hire_member: 'Department Head or Team Lead',
  create_team: 'Root CEO, Department Head, or Team Lead',
};

export type OrgRole = 'ceo' | 'department_head' | 'team_lead' | 'project_head';

export interface OrgToolExecutionRequest {
  tool: string;
  args: Record<string, any>;
  role?: OrgRole;
  deptId?: string;
  projectId?: string;
  deptWorkspacePath?: string;
  /** Project folder jail root for execution tools (defaults to deptWorkspacePath). */
  projectFolder?: string;
  /** Per-project approval policy for execution tools. */
  approvalPolicy?: string;
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

// Pending approval requests awaiting a renderer decision (org:approval-decision).
const pendingApprovals = new Map<string, (decision: 'allow' | 'deny') => void>();

/**
 * Approval broker for process-side shell/file execution. Forwards the request to the
 * renderer (which shows a blocking approval card) and resolves with the user's decision.
 * Fails closed (deny) if no window is available or the request times out.
 */
async function rendererApprovalBroker(req: ApprovalRequest): Promise<'allow' | 'deny'> {
  ensureIpcRegistered();
  let targetWindow: BrowserWindow | null = null;
  try {
    targetWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
  } catch {
    targetWindow = null;
  }
  if (!targetWindow || targetWindow.isDestroyed()) {
    return 'deny';
  }

  const requestId = crypto.randomUUID();
  return new Promise<'allow' | 'deny'>((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(requestId);
      resolve('deny');
    }, 120000); // 2 minutes

    pendingApprovals.set(requestId, (decision) => {
      clearTimeout(timer);
      resolve(decision);
    });

    targetWindow!.webContents.send('org:approval-request', { requestId, ...req });
  });
}

setOrgBashApprovalBroker(rendererApprovalBroker);

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

    ipcMain.on('org:approval-decision', (_event, payload: { requestId: string; decision: 'allow' | 'deny' }) => {
      const resolver = pendingApprovals.get(payload.requestId);
      if (resolver) {
        pendingApprovals.delete(payload.requestId);
        resolver(payload.decision === 'allow' ? 'allow' : 'deny');
      }
    });
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
      if (res && typeof res === 'object' && 'success' in res && res.success === false) {
        return {
          success: false,
          error: res.error || 'Tool execution failed.',
          result: res,
        };
      }
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
  const { tool, args, role = 'ceo', deptId, projectId, deptWorkspacePath, projectFolder, approvalPolicy } = request;

  // 1. Role-based tool access control
  if (role === 'department_head') {
    const allowed = new Set([
      'scan_folder',
      'create_project',
      'create_team',
      'hire_member',
      'assign_member',
      'assign_task',
      'list_org',
      'find_owner',
      'get_org_directory',
      'get_status',
      'get_project_status',
      'list_project_tasks',
      'ask_user',
    ]);
    if (!allowed.has(tool)) {
      const requiredRole = TOOL_REQUIRED_ROLE[tool];
      return {
        success: false,
        error: `Access denied: Department Head role is not permitted to execute "${tool}". ${requiredRole ? `Only the ${requiredRole} can do this.` : ''}`,
      };
    }
  } else if (role === 'team_lead') {
    const allowed = new Set([
      'scan_folder',
      'create_project',
      'create_team',
      'hire_member',
      'assign_member',
      'assign_task',
      'list_org',
      'find_owner',
      'get_org_directory',
      'get_status',
      'get_project_status',
      'list_project_tasks',
      'ask_user',
      // File and execution tools (Aion CLI parity)
      'list_dir',
      'read_file',
      'write_file',
      'run_shell',
    ]);
    if (!allowed.has(tool)) {
      const requiredRole = TOOL_REQUIRED_ROLE[tool];
      return {
        success: false,
        error: `Access denied: Team Lead role is not permitted to execute "${tool}". ${requiredRole ? `Only the ${requiredRole} can do this.` : ''}`,
      };
    }
  } else if (role === 'project_head') {
    const allowed = new Set([
      'assign_task',
      'get_status',
      'get_project_status',
      'list_project_tasks',
      'list_org',
      'find_owner',
      'get_org_directory',
      'ask_user',
      // Process-side execution tools (jailed + policy-gated + audited):
      'list_dir',
      'read_file',
      'write_file',
      'run_shell',
    ]);
    if (!allowed.has(tool)) {
      const requiredRole = TOOL_REQUIRED_ROLE[tool];
      return {
        success: false,
        error: `Access denied: Project Head role is not permitted to execute "${tool}". ${requiredRole ? `Only the ${requiredRole} can do this.` : ''}`,
      };
    }
  }

  // Read-only access to the persisted Organization Directory document.
  if (tool === 'get_org_directory') {
    const directory = await readOrgDirectory();
    if (!directory) {
      return {
        success: false,
        error:
          'Organization Directory has not been generated yet. Visit the Organization canvas or refresh the organization to create it.',
      };
    }
    broadcastOrgLiveStep({ step: 'Reading Organization Directory', tool, args });
    return { success: true, result: { content: directory.content, path: directory.path } };
  }

  // 2. Folder boundaries enforcement
  const masterRoot = await getMasterRoot();

  // 2a. Process-side execution tools (shell + file ops) for project heads / members.
  // These run jailed to the assigned project folder, gated by the per-project approval
  // policy, and recorded in the audit log. The Root CEO never reaches this path because
  // these tools are not in the CEO allowlist and EXECUTION_TOOLS are denied for ceo below.
  if (EXECUTION_TOOLS.has(tool)) {
    if (role === 'ceo' || role === 'department_head') {
      return {
        success: false,
        error: `Access denied: role "${role}" is not permitted to execute "${tool}".`,
      };
    }

    // Resolve the jail root: the bound workspace (projectFolder/deptWorkspacePath) MUST be
    // provided and is treated as the project folder for this session.
    const jailFolder = projectFolder || deptWorkspacePath;
    if (!jailFolder) {
      return { success: false, error: `Cannot execute "${tool}": no project folder bound to this session.` };
    }

    const ctx: OrgCtx = {
      projectId: projectId || 'unknown',
      projectFolder: jailFolder,
      policy: normalizeApprovalPolicy(approvalPolicy),
    };

    broadcastOrgLiveStep({
      step: `Executing ${tool} in ${jailFolder}`,
      tool,
      args,
    });

    let result;
    if (tool === 'list_dir') {
      result = await executeListDir({ path: args.path }, ctx, { masterRoot });
    } else if (tool === 'read_file') {
      result = await executeReadFile({ path: args.path }, ctx, { masterRoot, approvalToken: args.approvalToken });
    } else if (tool === 'write_file') {
      result = await executeWriteFile({ path: args.path, content: args.content }, ctx, { masterRoot });
    } else {
      result = await executeRunShell({ command: args.command, cwd: args.cwd, timeoutMs: args.timeoutMs }, ctx, {
        masterRoot,
        approvalToken: args.approvalToken,
        projectId: projectId || 'unknown',
      });
    }

    if (result.success) {
      return { success: true, result: result };
    }
    return {
      success: false,
      error: result.error || 'Execution failed',
      result,
    };
  }

  if (
    !masterRoot &&
    tool !== 'ask_user' &&
    tool !== 'get_status' &&
    tool !== 'get_project_status' &&
    tool !== 'list_project_tasks' &&
    tool !== 'find_owner'
  ) {
    return {
      success: false,
      error: 'No organization master root is configured. Please configure a master root folder first.',
    };
  }

  if (tool === 'scan_folder') {
    broadcastOrgLiveStep({ step: `Scanning folder: ${args.path || masterRoot || ''}`, tool, args });
    const allowedScope =
      (role === 'department_head' || role === 'team_lead') && deptWorkspacePath
        ? deptWorkspacePath
        : masterRoot || undefined;
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

    // Scope check: department_head/team_lead can only create projects in their own department
    let effectiveParentRoot: string;
    if ((role === 'department_head' || role === 'team_lead') && deptWorkspacePath) {
      effectiveParentRoot = deptWorkspacePath;
      if (deptId && args.departmentId !== deptId) {
        return {
          success: false,
          error: `Access denied: ${role} can only create projects in its own department (${deptId}), not "${args.departmentId}".`,
        };
      }
    } else {
      effectiveParentRoot = masterRoot!;
    }
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
    // Scope: department_head/team_lead must have deptId bound
    if ((role === 'department_head' || role === 'team_lead') && !deptId && !deptWorkspacePath) {
      return {
        success: false,
        error: `Access denied: ${role} cannot hire members without a bound department scope.`,
      };
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
    const target = args.project_id || args.target;
    const task = args.text || args.task;
    if (!target || !task) {
      return { success: false, error: 'assign_task requires "project_id" (or "target") and "text" (or "task").' };
    }
    broadcastOrgLiveStep({ step: `Delegating task to ${target}: ${task}`, tool, args });
  }

  if (tool === 'get_project_status') {
    const target = args.project_id || args.projectId || args.target;
    if (!target) {
      return { success: false, error: 'get_project_status requires "project_id".' };
    }
    broadcastOrgLiveStep({ step: `Retrieving project status for ${target}`, tool, args });
  }

  if (tool === 'list_project_tasks') {
    const target = args.project_id || args.projectId || args.target;
    if (!target) {
      return { success: false, error: 'list_project_tasks requires "project_id".' };
    }
    broadcastOrgLiveStep({ step: `Listing project tasks for ${target}`, tool, args });
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
