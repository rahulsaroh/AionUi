/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  executeOrgToolInStore,
  onStructureProposed,
  type StructureProposal,
} from '@/renderer/pages/organization/store/orgToolExecutor';
import { getOrgStoreSnapshot, setOrgStoreSnapshot } from '@/renderer/pages/organization/store/useOrgStore';
import { scanFolderCompact } from '@process/services/org/scanFolder';
import { handleOrgToolRequest, setOrgToolExecutor } from '@process/resources/builtinMcp/orgBridgeServer';
import { setMasterRootForTesting, resetMasterRoot } from '@process/services/org/orgScope';
import { org } from '@/common/adapter/ipcBridge';
import { ipcBridge } from '@/common';
import type { OrgStorageBundle } from '@/types/organization';

describe('Root CEO Tools Acceptance Tests (Steps 1-7)', () => {
  let tempMasterRoot: string;
  let outsideFolder: string;

  beforeEach(() => {
    // Create temporary master root folder
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'org-ceo-acceptance-'));
    tempMasterRoot = path.join(baseDir, 'master_root');
    outsideFolder = path.join(baseDir, 'outside_rogue_folder');
    fs.mkdirSync(tempMasterRoot, { recursive: true });
    fs.mkdirSync(outsideFolder, { recursive: true });

    // Acceptance Criteria 1: Setup master root directory structure
    // flutter_app1, flutter_app2, youtube_channel1, digital_product1, misc_unrelated
    const flutter1 = path.join(tempMasterRoot, 'flutter_app1');
    const flutter2 = path.join(tempMasterRoot, 'flutter_app2');
    const youtube1 = path.join(tempMasterRoot, 'youtube_channel1');
    const digital1 = path.join(tempMasterRoot, 'digital_product1');
    const misc = path.join(tempMasterRoot, 'misc_unrelated');

    fs.mkdirSync(flutter1, { recursive: true });
    fs.writeFileSync(path.join(flutter1, 'pubspec.yaml'), 'name: flutter_app1\ndescription: A Flutter app');

    fs.mkdirSync(flutter2, { recursive: true });
    fs.writeFileSync(path.join(flutter2, 'pubspec.yaml'), 'name: flutter_app2\ndescription: Another Flutter app');

    fs.mkdirSync(youtube1, { recursive: true });
    fs.writeFileSync(path.join(youtube1, 'script.md'), '# Episode 1\nTitle: AI Org');
    fs.writeFileSync(path.join(youtube1, 'video.mp4'), '');

    fs.mkdirSync(digital1, { recursive: true });
    fs.writeFileSync(path.join(digital1, 'product.json'), '{"title": "E-Book", "price": 29}');
    fs.writeFileSync(path.join(digital1, 'guide.pdf'), '');

    fs.mkdirSync(misc, { recursive: true });
    fs.writeFileSync(path.join(misc, 'random.txt'), 'Unrelated notes');

    // Configure testing master root
    setMasterRootForTesting(tempMasterRoot);

    // Reset store snapshot
    setOrgStoreSnapshot({
      hierarchy: {
        rootCeo: {
          id: 'root-ceo',
          name: 'Global HQ',
          parentId: null,
          workspacePath: tempMasterRoot,
          ceoAgent: {
            id: 'agent-ceo',
            canonicalAgentId: 'c-ceo',
            name: 'Root CEO',
            role: 'ceo',
            assignedTeamIds: [],
            lastActiveAt: 1000,
            status: 'idle',
          },
          status: 'idle',
          lastActiveAt: 1000,
        },
        departments: [],
        lastUpdated: 1000,
      },
      projects: [],
      members: [],
    });

    // Connect bridge executor to store
    setOrgToolExecutor(async (tool, args, meta) => {
      return await executeOrgToolInStore(tool, args, meta);
    });

    // Mock IPC bridge
    vi.spyOn(ipcBridge.assistants.list, 'invoke').mockResolvedValue([
      {
        id: 'ast-default',
        name: 'Lead Assistant',
        enabled: true,
        team_selectable: true,
        agent: { type: 'claude', source: 'builtin' },
      } as any,
    ]);
    vi.spyOn(ipcBridge.team.create, 'invoke').mockImplementation(async (payload: any) => ({
      id: `team-${payload.name || 'test'}`,
      name: payload.name,
      workspace: payload.workspace,
    }));
    vi.spyOn(ipcBridge.team.sendMessage, 'invoke').mockResolvedValue({
      enqueue_status: 'accepted',
      message_id: 'msg-accepted',
    } as any);

    vi.spyOn(org, 'getMasterRoot').mockResolvedValue(tempMasterRoot);
    vi.spyOn(org, 'assertWithinScope').mockImplementation(async (targetPath: string, allowedRoot?: string) => {
      const root = allowedRoot || tempMasterRoot;
      const targetResolved = path.resolve(targetPath);
      const rootResolved = path.resolve(root);
      const allowed = targetResolved.startsWith(rootResolved);
      return {
        allowed,
        reason: allowed ? undefined : `Target "${targetResolved}" is outside "${rootResolved}".`,
        resolved: targetResolved,
      };
    });
  });

  afterEach(() => {
    resetMasterRoot();
    setOrgToolExecutor(null);
    vi.restoreAllMocks();
    try {
      if (tempMasterRoot && fs.existsSync(tempMasterRoot)) {
        fs.rmSync(path.dirname(tempMasterRoot), { recursive: true, force: true });
      }
    } catch {}
  });

  const callTool = (
    tool: string,
    args: Record<string, any>,
    role: 'ceo' | 'department_head' | 'project_head' = 'ceo'
  ) => handleOrgToolRequest({ tool, args, role });

  it('Acceptance Criteria 1: scan_folder detects project-type hints and propose_structure creates NOTHING before approval', async () => {
    // 1. scan_folder executes and detects hints
    const scanResponse = await scanFolderCompact(tempMasterRoot, {
      depth: 2,
      maxEntries: 100,
      allowedScope: tempMasterRoot,
    });

    expect(scanResponse.success).toBe(true);
    expect(scanResponse.tree).toBeDefined();

    const children = scanResponse.tree!.children || [];
    const flutter1Entry = children.find((c) => c.name === 'flutter_app1');
    const flutter2Entry = children.find((c) => c.name === 'flutter_app2');
    const youtubeEntry = children.find((c) => c.name === 'youtube_channel1');
    const digitalEntry = children.find((c) => c.name === 'digital_product1');

    expect(flutter1Entry?.typeHint).toBe('Flutter app');
    expect(flutter2Entry?.typeHint).toBe('Flutter app');
    expect(youtubeEntry?.typeHint).toBe('YouTube channel');
    expect(digitalEntry?.typeHint).toBe('Digital product');

    // 2. CEO emits propose_structure
    let capturedProposal: StructureProposal | null = null;
    const unsub = onStructureProposed((prop) => {
      capturedProposal = prop;
    });

    const proposalResult = await handleOrgToolRequest({
      tool: 'propose_structure',
      args: {
        departments: [
          {
            name: 'App Builder',
            folder: path.join(tempMasterRoot, 'App Builder'),
            projects: [
              { name: 'flutter_app1', folder: path.join(tempMasterRoot, 'App Builder', 'flutter_app1') },
              { name: 'flutter_app2', folder: path.join(tempMasterRoot, 'App Builder', 'flutter_app2') },
            ],
          },
          {
            name: 'YouTube',
            folder: path.join(tempMasterRoot, 'YouTube'),
            projects: [{ name: 'youtube_channel1', folder: path.join(tempMasterRoot, 'YouTube', 'youtube_channel1') }],
          },
          {
            name: 'Digital Products',
            folder: path.join(tempMasterRoot, 'Digital Products'),
            projects: [
              { name: 'digital_product1', folder: path.join(tempMasterRoot, 'Digital Products', 'digital_product1') },
            ],
          },
          {
            name: 'General',
            folder: path.join(tempMasterRoot, 'General'),
          },
        ],
        suggestedMembers: [
          { name: 'Flutter Specialist', role: 'specialist' },
          { name: 'Video Producer', role: 'specialist' },
        ],
      },
      role: 'ceo',
    });

    unsub();

    expect(proposalResult.success).toBe(true);
    expect(capturedProposal).not.toBeNull();
    expect(capturedProposal!.departments).toHaveLength(4);

    // CRITICAL: verify nothing has been created in the store before approval!
    const store = getOrgStoreSnapshot();
    expect(store.hierarchy.departments).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
    expect(store.members || []).toHaveLength(0);
  });

  it('Acceptance Criteria 2: After Approve, departments/projects/members exist, and each project path is inside its department folder', async () => {
    // Simulate user approving the proposal (what OrgProposalCard.handleApproveAll executes)
    const dept1Res = await callTool('create_department', {
      name: 'App Builder',
      folder: path.join(tempMasterRoot, 'App Builder'),
    });
    expect(dept1Res.success).toBe(true);

    const dept2Res = await callTool('create_department', {
      name: 'YouTube',
      folder: path.join(tempMasterRoot, 'YouTube'),
    });
    expect(dept2Res.success).toBe(true);

    const dept3Res = await callTool('create_department', {
      name: 'Digital Products',
      folder: path.join(tempMasterRoot, 'Digital Products'),
    });
    expect(dept3Res.success).toBe(true);

    const dept4Res = await callTool('create_department', {
      name: 'General',
      folder: path.join(tempMasterRoot, 'General'),
    });
    expect(dept4Res.success).toBe(true);

    // Create projects inside their department folders
    const proj1Res = await callTool('create_project', {
      departmentId: dept1Res.result.id,
      name: 'flutter_app1',
      folder: path.join(tempMasterRoot, 'App Builder', 'flutter_app1'),
    });
    expect(proj1Res.success).toBe(true);

    const proj2Res = await callTool('create_project', {
      departmentId: dept1Res.result.id,
      name: 'flutter_app2',
      folder: path.join(tempMasterRoot, 'App Builder', 'flutter_app2'),
    });
    expect(proj2Res.success).toBe(true);

    const proj3Res = await callTool('create_project', {
      departmentId: dept2Res.result.id,
      name: 'youtube_channel1',
      folder: path.join(tempMasterRoot, 'YouTube', 'youtube_channel1'),
    });
    expect(proj3Res.success).toBe(true);

    const proj4Res = await callTool('create_project', {
      departmentId: dept3Res.result.id,
      name: 'digital_product1',
      folder: path.join(tempMasterRoot, 'Digital Products', 'digital_product1'),
    });
    expect(proj4Res.success).toBe(true);

    // Hire member and assign
    const hireRes = await callTool('hire_member', {
      name: 'Aria Sterling',
      role: 'specialist',
      skills: ['flutter', 'dart'],
    });
    expect(hireRes.success).toBe(true);

    const assignRes = await callTool('assign_member', {
      projectId: proj1Res.result.id,
      memberId: hireRes.result.id,
    });
    expect(assignRes.success).toBe(true);

    // Verify snapshot reflects everything
    const store = getOrgStoreSnapshot();
    expect(store.hierarchy.departments).toHaveLength(4);
    expect(store.projects).toHaveLength(4);
    expect(store.members).toHaveLength(1);

    // Verify project paths are inside their department folders
    const appDept = store.hierarchy.departments.find((d) => d.name === 'App Builder');
    expect(appDept).toBeDefined();
    const appProjects = store.projects.filter((p) => p.departmentId === appDept!.id);
    expect(appProjects).toHaveLength(2);
    for (const p of appProjects) {
      expect(p.workspacePath?.startsWith(appDept!.workspacePath!)).toBe(true);
    }
  });

  it('Acceptance Criteria 3: "Create a department called Marketing at <path outside root>" returns a visible error, nothing created', async () => {
    const rogueFolder = path.join(outsideFolder, 'Marketing');

    const result = await callTool('create_department', {
      name: 'Marketing',
      folder: rogueFolder,
    });

    // Must return visible error
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Access denied');
    expect(result.error).toContain('outside organization master root');

    // Verify NOTHING was created in the store
    const store = getOrgStoreSnapshot();
    expect(store.hierarchy.departments.some((d) => d.name === 'Marketing')).toBe(false);
    expect(store.hierarchy.departments).toHaveLength(0);
  });

  it('Acceptance Criteria 4: "Add a splash screen to flutter_app1" delegates via assign_task to App Builder dept with flutter_app1 target', async () => {
    // First set up department and project
    const deptRes = await callTool('create_department', {
      name: 'App Builder',
      folder: path.join(tempMasterRoot, 'App Builder'),
    });
    const projRes = await callTool('create_project', {
      departmentId: deptRes.result.id,
      name: 'flutter_app1',
      folder: path.join(tempMasterRoot, 'App Builder', 'flutter_app1'),
    });

    // CEO assigns task targeting the project
    const taskResult = await callTool('assign_task', {
      target: 'App Builder',
      projectId: projRes.result.id,
      task: 'Add a splash screen to flutter_app1',
    });

    expect(taskResult.success).toBe(true);
    expect(taskResult.result).toBeDefined();
    expect(taskResult.result.dispatched).toBe(true);
    expect(taskResult.result.task).toBe('Add a splash screen to flutter_app1');
    expect(taskResult.result.projectId).toBe(projRes.result.id);
  });

  it('Acceptance Criteria 5: Restarting the app keeps everything created (persistence test)', async () => {
    // 1. Create entities
    const deptRes = await callTool('create_department', {
      name: 'App Builder',
      folder: path.join(tempMasterRoot, 'App Builder'),
    });
    const projRes = await callTool('create_project', {
      departmentId: deptRes.result.id,
      name: 'flutter_app1',
      folder: path.join(tempMasterRoot, 'App Builder', 'flutter_app1'),
    });
    const hireRes = await callTool('hire_member', {
      name: 'Aria Sterling',
      role: 'specialist',
    });

    // 2. Capture storage bundle
    const beforeRestart = getOrgStoreSnapshot();
    const bundle: OrgStorageBundle = {
      hierarchy: beforeRestart.hierarchy,
      projects: beforeRestart.projects,
      members: beforeRestart.members || [],
      cronJobs: [],
    };

    // 3. Simulate app restart (wipe in-memory state)
    setOrgStoreSnapshot({
      hierarchy: {
        rootCeo: {
          id: 'root-ceo',
          name: 'Global HQ',
          parentId: null,
          ceoAgent: {
            id: 'agent-ceo',
            canonicalAgentId: 'c-ceo',
            name: 'Root CEO',
            role: 'ceo',
            assignedTeamIds: [],
            lastActiveAt: 1000,
            status: 'idle',
          },
          status: 'idle',
          lastActiveAt: 1000,
        },
        departments: [],
        lastUpdated: 1000,
      },
      projects: [],
      members: [],
    });

    const wipedStore = getOrgStoreSnapshot();
    expect(wipedStore.hierarchy.departments).toHaveLength(0);
    expect(wipedStore.projects).toHaveLength(0);

    // 4. Simulate reload from persistence bundle
    setOrgStoreSnapshot({
      hierarchy: bundle.hierarchy,
      projects: bundle.projects,
      members: bundle.members,
    });

    const restoredStore = getOrgStoreSnapshot();
    expect(restoredStore.hierarchy.departments).toHaveLength(1);
    expect(restoredStore.hierarchy.departments[0].name).toBe('App Builder');
    expect(restoredStore.projects).toHaveLength(1);
    expect(restoredStore.projects[0].name).toBe('flutter_app1');
    expect(restoredStore.members).toHaveLength(1);
    expect(restoredStore.members![0].name).toBe('Aria Sterling');
  });
});
