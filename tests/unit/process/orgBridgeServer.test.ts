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

  it('enforces role boundaries: Department Head cannot create departments or hire members', async () => {
    const resDept = await handleOrgToolRequest({
      tool: 'create_department',
      args: { name: 'Illegal Dept', folder: path.join(masterRoot, 'dept') },
      role: 'department_head',
    });
    expect(resDept.success).toBe(false);
    expect(resDept.error).toMatch(/Department Head role is not permitted/);

    const resHire = await handleOrgToolRequest({
      tool: 'hire_member',
      args: { name: 'Illegal Member', role: 'specialist' },
      role: 'department_head',
    });
    expect(resHire.success).toBe(false);
    expect(resHire.error).toMatch(/Department Head role is not permitted/);
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
});
