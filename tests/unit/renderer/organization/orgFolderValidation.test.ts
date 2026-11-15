/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateOrgFolder } from '@/renderer/pages/organization/utils/orgPathUtils';
import { RootCeoAgent } from '@/renderer/pages/organization/utils/rootCeoAgent';
import { DepartmentHeadAgent } from '@/renderer/pages/organization/utils/headAgents';
import { revalidateStoredPaths } from '@/renderer/pages/organization/store/useOrgStore';
import { setMasterRootForTesting, resetMasterRoot } from '@/process/services/org/orgScope';
import { assertWithinScope } from '@/process/services/org/pathGuard';
import { ipcBridge } from '@/common';
import type { OrgHierarchy, OrgDepartmentNode, OrgProject } from '@/types/organization';

describe('Phase 2: Validate Every Folder CEO/UI Creates', () => {
  let tempRoot: string;
  let masterRoot: string;
  let outsideDir: string;
  let deptDir: string;
  let projectDir: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'org-phase2-test-'));
    masterRoot = path.join(tempRoot, 'company');
    outsideDir = path.join(tempRoot, 'evil-outside');
    deptDir = path.join(masterRoot, 'engineering');
    projectDir = path.join(deptDir, 'api-gateway');

    fs.mkdirSync(masterRoot, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.mkdirSync(deptDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    setMasterRootForTesting(masterRoot);

    // Mock ipcBridge.org.assertWithinScope to use the real main-process pathGuard
    vi.spyOn(ipcBridge.org, 'assertWithinScope').mockImplementation(
      async (targetPath: string, allowedRoot?: string) => {
        if (!allowedRoot) {
          return { allowed: false, reason: 'No allowed root configured (fail closed)', resolved: targetPath };
        }
        return assertWithinScope(targetPath, allowedRoot);
      }
    );
  });

  afterEach(() => {
    resetMasterRoot();
    vi.restoreAllMocks();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  });

  describe('validateOrgFolder', () => {
    it('rejects empty or whitespace folder path', async () => {
      const res = await validateOrgFolder('', masterRoot, 'department');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('cannot be empty');
    });

    it('fails closed when parent boundary is not configured', async () => {
      const res = await validateOrgFolder(deptDir, '', 'department');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/fail closed/i);
    });

    it('malicious caller: rejects folder "/" or drive root', async () => {
      const rootPath = process.platform === 'win32' ? 'C:\\' : '/';
      const res = await validateOrgFolder(rootPath, masterRoot, 'department');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/outside the organization root/i);
    });

    it('rejects "../x" path traversal attack', async () => {
      const dotDotPath = path.join(masterRoot, '..', 'evil-outside');
      const res = await validateOrgFolder(dotDotPath, masterRoot, 'department');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/outside the organization root/i);
    });

    it('rejects absolute path pointing outside root', async () => {
      const res = await validateOrgFolder(outsideDir, masterRoot, 'department');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/outside the organization root/i);
    });

    it('rejects symlink pointing outside root', () => {
      const symlinkPath = path.join(masterRoot, 'symlink-escape');
      try {
        fs.symlinkSync(outsideDir, symlinkPath, 'junction');
      } catch {
        // Skip on systems where symlink creation requires admin
        return;
      }

      return validateOrgFolder(symlinkPath, masterRoot, 'department').then((res) => {
        expect(res.valid).toBe(false);
        expect(res.error).toMatch(/outside the organization root/i);
      });
    });

    it('accepts valid sub-folder and normalizes resolvedPath', async () => {
      const res = await validateOrgFolder(deptDir, masterRoot, 'department');
      expect(res.valid).toBe(true);
      expect(res.resolvedPath).toBe(fs.realpathSync(deptDir));
    });

    it('rejects project outside its department folder', async () => {
      const otherDeptDir = path.join(masterRoot, 'marketing');
      fs.mkdirSync(otherDeptDir, { recursive: true });
      const outsideProject = path.join(otherDeptDir, 'rogue-proj');
      fs.mkdirSync(outsideProject, { recursive: true });

      // Target project is in marketing, but department is engineering
      const res = await validateOrgFolder(outsideProject, deptDir, 'project');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/outside the organization root/i);
    });
  });

  describe('RootCeoAgent folder validation on creation', () => {
    function createTestHierarchy(): OrgHierarchy {
      return {
        rootCeo: {
          id: 'root-ceo',
          name: 'Executive HQ',
          parentId: null,
          workspacePath: masterRoot,
          ceoAgent: {
            id: 'agent-ceo',
            canonicalAgentId: 'c-ceo',
            name: 'Root CEO',
            role: 'ceo',
            assignedTeamIds: [],
            lastActiveAt: Date.now(),
            status: 'idle',
          },
          status: 'idle',
          lastActiveAt: Date.now(),
        },
        departments: [],
        lastUpdated: Date.now(),
      };
    }

    it('malicious caller: create_department with "/" is rejected and returns error to CEO', async () => {
      const onCreateDept = vi.fn();
      const ceo = new RootCeoAgent(createTestHierarchy(), [], [], { onCreateDepartment: onCreateDept });

      const rootPath = process.platform === 'win32' ? 'C:\\' : '/';
      const out = await ceo.executeTool('create_department', {
        name: 'Malicious Department',
        folder: rootPath,
      });

      expect(out.error).toBeDefined();
      expect(out.error).toMatch(/is outside the organization root/i);
      // Department node must NOT be created
      expect(onCreateDept).not.toHaveBeenCalled();
    });

    it('create_department with outside path is rejected', async () => {
      const onCreateDept = vi.fn();
      const ceo = new RootCeoAgent(createTestHierarchy(), [], [], { onCreateDepartment: onCreateDept });

      const out = await ceo.executeTool('create_department', {
        name: 'Outside Dept',
        folder: outsideDir,
      });

      expect(out.error).toBeDefined();
      expect(out.error).toMatch(/is outside the organization root/i);
      expect(onCreateDept).not.toHaveBeenCalled();
    });

    it('create_department with valid folder succeeds and stores normalized path', async () => {
      const onCreateDept = vi.fn();
      const ceo = new RootCeoAgent(createTestHierarchy(), [], [], { onCreateDepartment: onCreateDept });

      const out = await ceo.executeTool('create_department', {
        name: 'Engineering',
        folder: deptDir,
      });

      expect(out.error).toBeUndefined();
      expect(out.result).toBeDefined();
      expect(onCreateDept).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePath: fs.realpathSync(deptDir),
        })
      );
    });

    it('create_project outside department folder is rejected', async () => {
      const onCreateProj = vi.fn();
      const hierarchy = createTestHierarchy();
      hierarchy.departments.push({
        id: 'dept-eng',
        name: 'Engineering',
        workspacePath: deptDir,
        parentDepartmentId: null,
        departmentCeoAgent: {
          id: 'head-eng',
          canonicalAgentId: 'c-head',
          name: 'Head',
          role: 'department_head',
          assignedTeamIds: [],
          lastActiveAt: 100,
          status: 'idle',
        },
        teams: [],
        linkedProjects: [],
        lastActiveAt: 100,
        status: 'idle',
      });

      const ceo = new RootCeoAgent(hierarchy, [], [], { onCreateProject: onCreateProj });

      const out = await ceo.executeTool('create_project', {
        departmentId: 'dept-eng',
        name: 'Rogue Project',
        folder: outsideDir,
      });

      expect(out.error).toBeDefined();
      expect(out.error).toMatch(/is outside the department root/i);
      expect(onCreateProj).not.toHaveBeenCalled();
    });
  });

  describe('DepartmentHeadAgent createProject validation', () => {
    it('rejects createProject if folder is outside department boundary', async () => {
      const dept: OrgDepartmentNode = {
        id: 'dept-eng',
        name: 'Engineering',
        workspacePath: deptDir,
        parentDepartmentId: null,
        departmentCeoAgent: {
          id: 'head-eng',
          canonicalAgentId: 'c-head',
          name: 'Head',
          role: 'department_head',
          assignedTeamIds: [],
          lastActiveAt: 100,
          status: 'idle',
        },
        teams: [],
        linkedProjects: [],
        lastActiveAt: 100,
        status: 'idle',
      };

      const deptHead = new DepartmentHeadAgent(dept, [], []);
      await expect(deptHead.createProject('evil-proj', outsideDir, [])).rejects.toThrow(
        /is outside the organization root/i
      );
    });
  });

  describe('revalidateStoredPaths', () => {
    it('flags department with status "error" if stored path is outside master root', async () => {
      const hierarchy: OrgHierarchy = {
        rootCeo: {
          id: 'root-ceo',
          name: 'HQ',
          parentId: null,
          workspacePath: masterRoot,
          ceoAgent: {
            id: 'c-ceo',
            canonicalAgentId: 'c-ceo',
            name: 'CEO',
            role: 'ceo',
            assignedTeamIds: [],
            lastActiveAt: 100,
            status: 'idle',
          },
          status: 'idle',
          lastActiveAt: 100,
        },
        departments: [
          {
            id: 'dept-escaped',
            name: 'Escaped Dept',
            workspacePath: outsideDir,
            parentDepartmentId: null,
            departmentCeoAgent: {
              id: 'h-esc',
              canonicalAgentId: 'h-esc',
              name: 'Head',
              role: 'department_head',
              assignedTeamIds: [],
              lastActiveAt: 100,
              status: 'idle',
            },
            teams: [],
            linkedProjects: [],
            lastActiveAt: 100,
            status: 'idle',
          },
        ],
        lastUpdated: 100,
      };

      const projects: OrgProject[] = [];
      const res = await revalidateStoredPaths(hierarchy, projects);

      expect(res.changed).toBe(true);
      expect(res.hierarchy.departments[0].status).toBe('error');
      expect(res.hierarchy.departments[0].departmentCeoAgent.status).toBe('error');
    });
  });
});
