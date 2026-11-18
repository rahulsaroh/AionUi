/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { assertWithinScope, type ScopeCheckResult } from '../services/org/pathGuard';
import { orgStorageService, isValidOrgStorageKey, MAX_STORAGE_VALUE_BYTES } from '../services/org/orgStorageService';
import { discoverProjectsInFolder, type DiscoveredProject } from '../services/org/projectDiscovery';
import { OrgFolderTools, checkRiskyCommand } from '../services/org/folderTools';
import { issueCommandApprovalToken, issueFileApprovalToken } from '../services/org/orgApproval';
import { createCheckpoint, undoCheckpoint, listCheckpoints, clearCheckpoints } from '../services/org/orgCheckpoint';
import {
  trackCommand,
  getRunningCommand,
  listRunningCommands,
  killCommand,
  untrackCommand,
  mapAutoApproveToPolicy,
} from '../services/org/orgRunningCommands';
import {
  buildMemberFinalReport,
  formatReportAsMarkdown,
  type MemberFinalReport,
} from '../services/org/orgReporting';
import {
  setMasterRoot,
  getMasterRoot,
  resolveEffectiveScope,
  type SetMasterRootResult,
} from '../services/org/orgScope';
import { startOrgBridgeServer, handleOrgToolRequest, type OrgRole } from '../resources/builtinMcp/orgBridgeServer';
import { BUILTIN_ORG_MCP_NAME, BUILTIN_ORG_SCRIPT } from '../resources/builtinMcp/constants';
import { getBuiltinMcpScriptPath } from '../utils/initStorage';

export function registerOrgBridge(): void {
  ipcMain.handle(
    'org:assertWithinScope',
    async (
      _event,
      params: { targetPath: string; allowedRoot?: string; isReadOnly?: boolean }
    ): Promise<ScopeCheckResult> => {
      try {
        if (
          !params ||
          typeof params.targetPath !== 'string' ||
          !params.targetPath.trim() ||
          params.targetPath.length > 4096
        ) {
          return { allowed: false, reason: 'Invalid or missing targetPath parameter', resolved: '' };
        }
        if (
          params.allowedRoot !== undefined &&
          (typeof params.allowedRoot !== 'string' || params.allowedRoot.length > 4096)
        ) {
          return { allowed: false, reason: 'Invalid allowedRoot parameter', resolved: params.targetPath };
        }
        // Enforce main-process master root. The allowedRoot parameter is kept for backward
        // compatibility but cannot widen scope; if valid, it may only narrow it.
        const effectiveRoot = await resolveEffectiveScope(params.allowedRoot);
        return await assertWithinScope(params.targetPath, effectiveRoot, { isReadOnly: params.isReadOnly });
      } catch (err) {
        return {
          allowed: false,
          reason: err instanceof Error ? err.message : String(err),
          resolved: params?.targetPath || '',
        };
      }
    }
  );

  ipcMain.handle(
    'org:pickMasterRoot',
    async (): Promise<{ success: boolean; masterRoot?: string; error?: string; cancelled?: boolean }> => {
      try {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        const result = focusedWindow
          ? await dialog.showOpenDialog(focusedWindow, { properties: ['openDirectory', 'createDirectory'] })
          : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });

        if (result.canceled || !result.filePaths || result.filePaths.length === 0 || !result.filePaths[0]) {
          return { success: false, cancelled: true };
        }

        const chosenPath = result.filePaths[0];
        const validation = await setMasterRoot(chosenPath);
        return validation;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );

  ipcMain.handle('org:setMasterRoot', async (_event, params: { masterRoot: string }): Promise<SetMasterRootResult> => {
    try {
      if (process.env.NODE_ENV !== 'test') {
        return {
          success: false,
          error: 'Direct setMasterRoot is only permitted in test environments. Use org:pickMasterRoot in production.',
        };
      }
      if (
        !params ||
        typeof params.masterRoot !== 'string' ||
        !params.masterRoot.trim() ||
        params.masterRoot.length > 4096
      ) {
        return {
          success: false,
          error: 'Invalid or missing masterRoot parameter (must be non-empty string <= 4096 chars)',
        };
      }
      return await setMasterRoot(params.masterRoot);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle('org:getMasterRoot', async (): Promise<string | null> => {
    try {
      return await getMasterRoot();
    } catch {
      return null;
    }
  });

  ipcMain.handle(
    'org:discoverProjects',
    async (_event, params: { folderPath: string; allowedRoot?: string }): Promise<DiscoveredProject[]> => {
      try {
        if (
          !params ||
          typeof params.folderPath !== 'string' ||
          !params.folderPath.trim() ||
          params.folderPath.length > 4096
        ) {
          return [];
        }
        return await discoverProjectsInFolder(params.folderPath, params.allowedRoot);
      } catch (err) {
        console.error('[OrgBridge] discoverProjects failed:', err);
        return [];
      }
    }
  );

  ipcMain.handle('org:saveData', async (_event, params: { key: string; value: string }): Promise<boolean> => {
    try {
      if (!params || typeof params.key !== 'string' || typeof params.value !== 'string') {
        return false;
      }
      if (params.key === 'master_root' || params.key === 'master_root_configured') {
        console.error('[OrgBridge] Rejected reserved key for external saveData:', params.key);
        return false;
      }
      if (!isValidOrgStorageKey(params.key, false)) {
        console.error('[OrgBridge] Rejected unwhitelisted storage key:', params.key);
        return false;
      }
      if (Buffer.byteLength(params.value, 'utf8') > MAX_STORAGE_VALUE_BYTES) {
        console.error('[OrgBridge] Value exceeds 10 MB limit for saveData key:', params.key);
        return false;
      }
      return await orgStorageService.saveData(params.key, params.value, false);
    } catch (err) {
      console.error('[OrgBridge] saveData failed:', err);
      return false;
    }
  });

  ipcMain.handle('org:loadData', async (_event, params: { key: string }): Promise<string | null> => {
    try {
      if (!params || typeof params.key !== 'string') {
        return null;
      }
      if (params.key === 'master_root' || params.key === 'master_root_configured') {
        console.error('[OrgBridge] Rejected reserved key for external loadData:', params.key);
        return null;
      }
      if (!isValidOrgStorageKey(params.key, false)) {
        console.error('[OrgBridge] Rejected unwhitelisted storage key:', params.key);
        return null;
      }
      return await orgStorageService.loadData(params.key, false);
    } catch (err) {
      console.error('[OrgBridge] loadData failed:', err);
      return null;
    }
  });

  ipcMain.handle('org:getFullBundle', async (): Promise<unknown> => {
    try {
      return await orgStorageService.getFullBundle();
    } catch (err) {
      console.error('[OrgBridge] getFullBundle failed:', err);
      return null;
    }
  });

  ipcMain.handle('org:saveFullBundle', async (_event, bundle: any): Promise<boolean> => {
    try {
      if (!bundle || typeof bundle !== 'object') {
        return false;
      }
      return await orgStorageService.saveFullBundle(bundle);
    } catch (err) {
      console.error('[OrgBridge] saveFullBundle failed:', err);
      return false;
    }
  });

  ipcMain.handle('org:getMembers', async (): Promise<unknown[]> => {
    try {
      return await orgStorageService.getMembers();
    } catch (err) {
      console.error('[OrgBridge] getMembers failed:', err);
      return [];
    }
  });

  ipcMain.handle('org:saveMembers', async (_event, members: any[]): Promise<boolean> => {
    try {
      if (!Array.isArray(members)) {
        return false;
      }
      return await orgStorageService.saveMembers(members);
    } catch (err) {
      console.error('[OrgBridge] saveMembers failed:', err);
      return false;
    }
  });

  ipcMain.handle(
    'org:getProjects',
    async (_event, params?: { mode?: 'workplace' | 'organization' }): Promise<unknown[]> => {
      try {
        return await orgStorageService.getProjects(params?.mode);
      } catch (err) {
        console.error('[OrgBridge] getProjects failed:', err);
        return [];
      }
    }
  );

  ipcMain.handle(
    'org:saveProjects',
    async (_event, params: { projects: any[]; mode?: 'workplace' | 'organization' }): Promise<boolean> => {
      try {
        if (!Array.isArray(params.projects)) {
          return false;
        }
        return await orgStorageService.saveProjects(params.projects, params.mode);
      } catch (err) {
        console.error('[OrgBridge] saveProjects failed:', err);
        return false;
      }
    }
  );

  // Folder & Shell execution tools with boundary enforcement
  ipcMain.handle(
    'org:scanFolder',
    async (
      _event,
      params: { targetDir: string; allowedWorkspace: string; options?: { depth?: number; maxEntries?: number } }
    ) => {
      if (
        !params ||
        typeof params.targetDir !== 'string' ||
        typeof params.allowedWorkspace !== 'string' ||
        params.targetDir.length > 4096 ||
        params.allowedWorkspace.length > 4096
      ) {
        throw new Error('Invalid arguments for org:scanFolder');
      }
      return OrgFolderTools.scanFolder(params.targetDir, params.allowedWorkspace, params.options);
    }
  );

  ipcMain.handle(
    'org:readFile',
    async (
      _event,
      params: {
        targetFilePath: string;
        allowedWorkspace: string;
        maxBytes?: number;
        options?: { approvalToken?: string };
      }
    ) => {
      if (
        !params ||
        typeof params.targetFilePath !== 'string' ||
        typeof params.allowedWorkspace !== 'string' ||
        params.targetFilePath.length > 4096 ||
        params.allowedWorkspace.length > 4096
      ) {
        throw new Error('Invalid arguments for org:readFile');
      }
      try {
        return await OrgFolderTools.readFile(
          params.targetFilePath,
          params.allowedWorkspace,
          params.maxBytes,
          params.options
        );
      } catch (err: any) {
        if (err?.needsApproval) {
          return {
            content: '',
            size: 0,
            truncated: false,
            needsApproval: true,
            targetFilePath: params.targetFilePath,
            reason: err.reason,
          };
        }
        throw err;
      }
    }
  );

  ipcMain.handle(
    'org:writeFile',
    async (_event, params: { targetFilePath: string; content: string; allowedWorkspace: string }) => {
      if (
        !params ||
        typeof params.targetFilePath !== 'string' ||
        typeof params.content !== 'string' ||
        typeof params.allowedWorkspace !== 'string' ||
        params.targetFilePath.length > 4096 ||
        params.allowedWorkspace.length > 4096
      ) {
        return false;
      }
      return OrgFolderTools.writeFile(params.targetFilePath, params.content, params.allowedWorkspace);
    }
  );

  ipcMain.handle('org:listDir', async (_event, params: { targetDir: string; allowedWorkspace: string }) => {
    if (
      !params ||
      typeof params.targetDir !== 'string' ||
      typeof params.allowedWorkspace !== 'string' ||
      params.targetDir.length > 4096 ||
      params.allowedWorkspace.length > 4096
    ) {
      return [];
    }
    return OrgFolderTools.listDir(params.targetDir, params.allowedWorkspace);
  });

  ipcMain.handle(
    'org:runShell',
    async (
      _event,
      params: {
        command: string;
        cwd: string;
        allowedWorkspace: string;
        options?: { timeoutMs?: number; requiresApproval?: boolean; approvalToken?: string };
      }
    ) => {
      if (
        !params ||
        typeof params.command !== 'string' ||
        typeof params.cwd !== 'string' ||
        typeof params.allowedWorkspace !== 'string' ||
        params.command.length > 65536 ||
        params.cwd.length > 4096 ||
        params.allowedWorkspace.length > 4096
      ) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'Invalid arguments for org:runShell',
          timedOut: false,
        };
      }
      try {
        return await OrgFolderTools.runShell(params.command, params.cwd, params.allowedWorkspace, params.options);
      } catch (err: any) {
        if (err?.needsApproval) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: err.message,
            timedOut: false,
            needsApproval: true,
            command: params.command,
            reason: err.reason,
          };
        }
        throw err;
      }
    }
  );

  ipcMain.handle('org:approveCommand', async (_event, params: { command: string; cwd: string }) => {
    if (
      !params ||
      typeof params.command !== 'string' ||
      typeof params.cwd !== 'string' ||
      params.command.length > 65536 ||
      params.cwd.length > 4096
    ) {
      throw new Error('Invalid arguments for org:approveCommand');
    }
    const masterRoot = await getMasterRoot();
    if (!masterRoot) {
      throw new Error('No master root configured');
    }
    const check = await assertWithinScope(params.cwd, masterRoot);
    if (!check.allowed) {
      throw new Error(`Cannot approve command outside master root: ${params.cwd}`);
    }
    const token = issueCommandApprovalToken(params.command, params.cwd);
    return { token, command: params.command, cwd: params.cwd, expiresInMs: 60000 };
  });

  ipcMain.handle('org:approveFileRead', async (_event, params: { targetFilePath: string }) => {
    if (
      !params ||
      typeof params.targetFilePath !== 'string' ||
      !params.targetFilePath.trim() ||
      params.targetFilePath.length > 4096
    ) {
      throw new Error('Invalid arguments for org:approveFileRead');
    }
    const masterRoot = await getMasterRoot();
    if (!masterRoot) {
      throw new Error('No master root configured');
    }
    const check = await assertWithinScope(params.targetFilePath, masterRoot, { isReadOnly: true });
    if (!check.allowed) {
      throw new Error(`Cannot approve file read outside master root: ${params.targetFilePath}`);
    }
    const token = issueFileApprovalToken(params.targetFilePath);
    return { token, targetFilePath: params.targetFilePath, expiresInMs: 60000 };
  });

  ipcMain.handle('org:checkRiskyCommand', async (_event, params: { command: string }) => {
    if (!params || typeof params.command !== 'string') {
      return { isRisky: false };
    }
    return checkRiskyCommand(params.command);
  });

  ipcMain.handle(
    'org:getSessionMcpServer',
    async (
      _event,
      params?: {
        role?: OrgRole;
        deptId?: string;
        projectId?: string;
        deptWorkspacePath?: string;
        approvalPolicy?: string;
      }
    ) => {
      try {
        const { port, token } = await startOrgBridgeServer();
        const scriptPath = getBuiltinMcpScriptPath(BUILTIN_ORG_SCRIPT);
        return {
          id: 'builtin-org',
          name: BUILTIN_ORG_MCP_NAME,
          transport: {
            type: 'stdio',
            command: 'node',
            args: [scriptPath],
            env: {
              AIONUI_ORG_BRIDGE_PORT: String(port),
              AIONUI_ORG_BRIDGE_TOKEN: token,
              AIONUI_ORG_ROLE: params?.role || 'ceo',
              ...(params?.deptId ? { AIONUI_ORG_DEPT_ID: params.deptId } : {}),
              ...(params?.projectId ? { AIONUI_ORG_PROJECT_ID: params.projectId } : {}),
              ...(params?.deptWorkspacePath ? { AIONUI_ORG_DEPT_WORKSPACE: params.deptWorkspacePath } : {}),
              ...(params?.deptWorkspacePath ? { AIONUI_ORG_PROJECT_FOLDER: params.deptWorkspacePath } : {}),
              ...(params?.approvalPolicy ? { AIONUI_ORG_APPROVAL_POLICY: params.approvalPolicy } : {}),
            },
          },
        };
      } catch (err) {
        console.error('[OrgBridge] getSessionMcpServer failed:', err);
        throw err;
      }
    }
  );

  ipcMain.handle(
    'org:executeTool',
    async (
      _event,
      params: {
        tool: string;
        args: Record<string, any>;
        role?: OrgRole;
        deptId?: string;
        projectId?: string;
        deptWorkspacePath?: string;
      }
    ) => {
      try {
        return await handleOrgToolRequest(params);
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );

  ipcMain.handle('org:createCheckpoint', async (_event, params: { projectId: string; projectFolder: string }) => {
    if (!params || typeof params.projectId !== 'string' || typeof params.projectFolder !== 'string') {
      throw new Error('Invalid arguments for org:createCheckpoint');
    }
    return createCheckpoint(params.projectFolder, params.projectId);
  });

  ipcMain.handle('org:undoCheckpoint', async (_event, params: { projectId: string; projectFolder: string }) => {
    if (!params || typeof params.projectId !== 'string' || typeof params.projectFolder !== 'string') {
      throw new Error('Invalid arguments for org:undoCheckpoint');
    }
    return undoCheckpoint(params.projectFolder, params.projectId);
  });

  ipcMain.handle('org:clearCheckpoints', async (_event, params: { projectId: string; projectFolder: string }) => {
    if (!params || typeof params.projectId !== 'string' || typeof params.projectFolder !== 'string') {
      throw new Error('Invalid arguments for org:clearCheckpoints');
    }
    const { clearCheckpoints } = await import('../services/org/orgCheckpoint');
    return clearCheckpoints(params.projectFolder, params.projectId);
  });

  ipcMain.handle('org:killCommand', async (_event, params: { commandId: string }) => {
    if (!params || typeof params.commandId !== 'string') {
      throw new Error('Invalid arguments for org:killCommand');
    }
    return killCommand(params.commandId);
  });

  ipcMain.handle('org:listRunningCommands', async (_event, params?: { projectId?: string }) => {
    return listRunningCommands(params?.projectId);
  });

  ipcMain.handle('org:getRunningCommand', async (_event, params: { commandId: string }) => {
    if (!params || typeof params.commandId !== 'string') {
      throw new Error('Invalid arguments for org:getRunningCommand');
    }
    return getRunningCommand(params.commandId);
  });

  ipcMain.handle('org:mapAutoApprove', async (_event, params: { level: 'none' | 'read_only' | 'auto_edit' | 'full_auto' }) => {
    if (!params || typeof params.level !== 'string') {
      throw new Error('Invalid arguments for org:mapAutoApprove');
    }
    return mapAutoApproveToPolicy(params.level);
  });

  ipcMain.handle('org:generateFinalReport', async (_event, params: {
    memberId: string;
    memberName: string;
    role: string;
    projectId: string;
    projectName: string;
    projectFolder: string;
    taskDescription: string;
    startedAt: number;
    toolExecutions: Array<{
      tool: string;
      args: Record<string, any>;
      success: boolean;
      error?: string;
      durationMs?: number;
      timestamp: number;
    }>;
  }) => {
    if (!params || typeof params.memberId !== 'string') {
      throw new Error('Invalid arguments for org:generateFinalReport');
    }
    const report = await buildMemberFinalReport(params);
    return {
      report,
      markdown: formatReportAsMarkdown(report),
    };
  });
}
