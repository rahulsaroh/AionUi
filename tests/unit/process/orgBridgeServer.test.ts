/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  startOrgBridgeServer,
  stopOrgBridgeServer,
  setOrgToolExecutor,
  handleOrgToolRequest,
} from '@/process/resources/builtinMcp/orgBridgeServer';
import { setMasterRootForTesting, resetMasterRoot } from '@/process/services/org/orgScope';
import { setOrgBashApprovalBroker } from '@/process/services/org/orgExecution';

describe('orgBridgeServer & Tool Protocol (Step 1 & Step 2)', () => {
  let tempBase: string;
  let masterRoot: string;

  beforeEach(() => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'org-bridge-test-'));
    masterRoot = path.join(tempBase, 'company-hq');
    fs.mkdirSync(masterRoot, { recursive: true });
    setMasterRootForTesting(masterRoot);
  });

  afterEach(async () => {
    await stopOrgBridgeServer();
    setOrgToolExecutor(null);
    setOrgBashApprovalBroker(null);
    resetMasterRoot();
    try {
      fs.rmSync(tempBase, { recursive: true, force: true });
    } catch {}
  });

  it('starts bridge server and accepts authenticated tool requests', async () => {
    const { port, token } = await startOrgBridgeServer();
    expect(port).toBeGreaterThan(0);
    expect(token).toBeDefined();

    // Create a mock flutter project inside masterRoot
    const flutterDir = path.join(masterRoot, 'app1');
    fs.mkdirSync(flutterDir, { recursive: true });
    fs.writeFileSync(path.join(flutterDir, 'pubspec.yaml'), 'name: app1');

    const res = await fetch(`http://127.0.0.1:${port}/api/org-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tool: 'scan_folder',
        args: { path: masterRoot },
        role: 'ceo',
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.result).toBeDefined();
    expect(data.result.children?.some((c: any) => c.name === 'app1')).toBe(true);
  });

  it('rejects requests with invalid or missing authorization token', async () => {
    const { port } = await startOrgBridgeServer();

    const res = await fetch(`http://127.0.0.1:${port}/api/org-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid-token-xyz',
      },
      body: JSON.stringify({
        tool: 'list_org',
        args: {},
      }),
    });

    expect(res.status).toBe(403);
  });

  it('enforces role boundaries: Department Head cannot create departments but CAN hire members', async () => {
    const resDept = await handleOrgToolRequest({
      tool: 'create_department',
      args: { name: 'Illegal Dept', folder: path.join(masterRoot, 'dept') },
      role: 'department_head',
    });
    expect(resDept.success).toBe(false);
    expect(resDept.error).toMatch(/Department Head role is not permitted/);

    // Department Head CAN hire members within their department (but needs dept scope)
    const resHire = await handleOrgToolRequest({
      tool: 'hire_member',
      args: { name: 'Illegal Member', role: 'specialist' },
      role: 'department_head',
    });
    // Without deptId/deptWorkspacePath, should fail with scope error
    expect(resHire.success).toBe(false);
    expect(resHire.error).toMatch(/cannot hire members without a bound department scope/);
  });

  it('enforces role boundaries: Project Head can only assign_task and get_status', async () => {
    const resCreate = await handleOrgToolRequest({
      tool: 'create_project',
      args: { departmentId: 'd1', name: 'p1', folder: masterRoot },
      role: 'project_head',
    });
    expect(resCreate.success).toBe(false);
    expect(resCreate.error).toMatch(/Project Head role is not permitted/);
  });

  it('enforces role boundaries: Team Lead has recruiting powers within own department', async () => {
    const deptFolder = path.join(masterRoot, 'engineering');
    fs.mkdirSync(deptFolder, { recursive: true });

    // Team Lead cannot create_project outside its own department
    const resCreate = await handleOrgToolRequest({
      tool: 'create_project',
      args: { departmentId: 'other-dept', name: 'MyProject', folder: path.join(deptFolder, 'myproj') },
      role: 'team_lead',
      deptId: 'd1',
      deptWorkspacePath: deptFolder,
    });
    expect(resCreate.success).toBe(false);
    expect(resCreate.error).toMatch(/can only create projects in its own department/);

    // Team Lead without dept scope cannot hire
    const resHireNoScope = await handleOrgToolRequest({
      tool: 'hire_member',
      args: { name: 'New Member', role: 'specialist' },
      role: 'team_lead',
    });
    expect(resHireNoScope.success).toBe(false);
    expect(resHireNoScope.error).toMatch(/cannot hire members without a bound department scope/);

    // Team Lead with dept scope can hire
    const resHire = await handleOrgToolRequest({
      tool: 'hire_member',
      args: { name: 'New Member', role: 'specialist' },
      role: 'team_lead',
      deptId: 'd1',
      deptWorkspacePath: deptFolder,
    });
    // This will fail because no tool executor is set up, but should pass role check
    // The error will be from the tool executor, not the role check
    if (!resHire.success) {
      // Either executor error or success - role check should pass
      expect(resHire.error).not.toMatch(/Access denied.*team_lead.*not permitted/);
    }

    // Team Lead cannot create_department
    const resDept = await handleOrgToolRequest({
      tool: 'create_department',
      args: { name: 'Illegal Dept', folder: path.join(masterRoot, 'dept') },
      role: 'team_lead',
      deptId: 'd1',
      deptWorkspacePath: deptFolder,
    });
    expect(resDept.success).toBe(false);
    expect(resDept.error).toMatch(/Only the Root CEO can do this/);
  });

  it('forwards custom tool executions to registered tool executor', async () => {
    setOrgToolExecutor(async (tool, args) => {
      if (tool === 'create_department') {
        return { id: 'dept-123', name: args.name, folder: args.folder };
      }
      return null;
    });

    const validFolder = path.join(masterRoot, 'marketing');
    fs.mkdirSync(validFolder, { recursive: true });

    const res = await handleOrgToolRequest({
      tool: 'create_department',
      args: { name: 'Marketing', folder: validFolder },
      role: 'ceo',
    });

    expect(res.success).toBe(true);
    expect(res.result.id).toBe('dept-123');
    expect(res.result.name).toBe('Marketing');
  });

  it('blocks create_department when target folder is outside master root', async () => {
    const outsideFolder = path.join(tempBase, 'outside_marketing');
    fs.mkdirSync(outsideFolder, { recursive: true });

    const res = await handleOrgToolRequest({
      tool: 'create_department',
      args: { name: 'Marketing', folder: outsideFolder },
      role: 'ceo',
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Access denied.*outside organization master root/);
  });

  it('Root CEO cannot run shell or write files (planning-only)', async () => {
    const shellRes = await handleOrgToolRequest({
      tool: 'run_shell',
      args: { command: 'echo hi' },
      role: 'ceo',
      deptWorkspacePath: path.join(masterRoot, 'app1'),
    });
    expect(shellRes.success).toBe(false);
    expect(shellRes.error).toMatch(/not permitted|Access denied/);

    const writeRes = await handleOrgToolRequest({
      tool: 'write_file',
      args: { path: path.join(masterRoot, 'app1', 'x.txt'), content: 'x' },
      role: 'ceo',
      deptWorkspacePath: path.join(masterRoot, 'app1'),
    });
    expect(writeRes.success).toBe(false);
  });

  it('Project Head can list_dir inside its folder', async () => {
    const appDir = path.join(masterRoot, 'app1');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'hello.txt'), 'hi');

    const res = await handleOrgToolRequest({
      tool: 'list_dir',
      args: { path: appDir },
      role: 'project_head',
      projectId: 'p1',
      projectFolder: appDir,
      approvalPolicy: 'auto_edit',
    });
    expect(res.success).toBe(true);
    const parsed = JSON.parse(res.result.content);
    expect(parsed.some((e: any) => e.name === 'hello.txt')).toBe(true);
  });

  it('Project Head write_file is jailed to its folder (rejects .. escape)', async () => {
    setOrgBashApprovalBroker(async () => 'deny');
    const appDir = path.join(masterRoot, 'app1');
    fs.mkdirSync(appDir, { recursive: true });

    const res = await handleOrgToolRequest({
      tool: 'write_file',
      args: { path: path.join(appDir, '..', 'escape.txt'), content: 'x' },
      role: 'project_head',
      projectId: 'p1',
      projectFolder: appDir,
      approvalPolicy: 'full_auto',
    });
    expect(res.success).toBe(false);
  });
});
