/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  joinOrgPath,
  sanitizeFolderName,
  getDefaultDeptPath,
  getDefaultTeamPath,
  getDefaultProjectPath,
  validateWithinMaster,
} from '@/renderer/pages/organization/utils/orgPathUtils';
import { OrgDelegationEngine } from '@/renderer/pages/organization/utils/orgDelegationEngine';
import type { OrgHierarchy } from '@/types/organization';

describe('Organization Master Folder Scoping and Utilities', () => {
  describe('Path Joining & Normalization', () => {
    it('correctly joins POSIX path segments without double slashes', () => {
      const result = joinOrgPath('/Users/user/MyCompany', 'departments', 'engineering');
      expect(result).toBe('/Users/user/MyCompany/departments/engineering');
    });

    it('correctly joins Windows path segments with backslashes', () => {
      const result = joinOrgPath('C:\\Users\\user\\MyCompany', 'departments', 'engineering');
      expect(result).toBe('C:\\Users\\user\\MyCompany\\departments\\engineering');
    });

    it('sanitizes strings into safe folder names', () => {
      expect(sanitizeFolderName('Growth & Marketing / PR')).toBe('growth-marketing-pr');
      expect(sanitizeFolderName('iOS App (v2.0)')).toBe('ios-app-v2-0');
      expect(sanitizeFolderName('   ')).toBe('item');
    });

    it('computes default department, team, and project paths', () => {
      const master = '/workspace/myorg';
      expect(getDefaultDeptPath(master, 'Engineering')).toBe('/workspace/myorg/departments/engineering');
      expect(getDefaultTeamPath(master, 'Engineering', 'Mobile')).toBe(
        '/workspace/myorg/departments/engineering/mobile'
      );
      expect(getDefaultProjectPath(master, 'iOS Redesign')).toBe('/workspace/myorg/projects/ios-redesign');
    });
  });

  describe('Validation within Master Root', () => {
    it('returns error when master root is not set', async () => {
      const res = await validateWithinMaster('/workspace/myorg/dept1', null);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Organization master folder is not set');
    });

    it('approves folders located inside the master root', async () => {
      const res = await validateWithinMaster('/workspace/myorg/departments/engineering', '/workspace/myorg');
      expect(res.valid).toBe(true);
    });

    it('approves exact match of master root itself', async () => {
      const res = await validateWithinMaster('/workspace/myorg', '/workspace/myorg');
      expect(res.valid).toBe(true);
    });

    it('rejects folders located outside the master root', async () => {
      const res = await validateWithinMaster('/other/unrelated/directory', '/workspace/myorg');
      expect(res.valid).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('treats empty target path as valid (optional until set)', async () => {
      const res = await validateWithinMaster('', '/workspace/myorg');
      expect(res.valid).toBe(true);
    });
  });

  describe('Automatic Subfolder Scaffolding via Root CEO Directives', () => {
    function createHierarchyWithMaster(masterPath: string): OrgHierarchy {
      const now = Date.now();
      return {
        rootCeo: {
          id: 'root-ceo',
          name: 'Global Executive HQ',
          parentId: null,
          lastActiveAt: now,
          status: 'idle',
          workspacePath: masterPath,
          ceoAgent: {
            id: 'agent-root-ceo',
            canonicalAgentId: 'canonical-root-ceo',
            name: 'Global Organization CEO',
            role: 'ceo',
            title: 'Chief Executive Officer',
            assignedTeamIds: [],
            lastActiveAt: now,
            status: 'idle',
          },
        },
        departments: [
          {
            id: 'dept-eng',
            name: 'Engineering',
            parentDepartmentId: 'root-ceo',
            lastActiveAt: now,
            status: 'idle',
            workspacePath: `${masterPath}/departments/engineering`,
            departmentCeoAgent: {
              id: 'agent-head-eng',
              canonicalAgentId: 'canonical-head-eng',
              name: 'Engineering Head',
              role: 'department_head',
              assignedTeamIds: [],
              lastActiveAt: now,
              status: 'idle',
            },
            teams: [],
            linkedProjects: [],
          },
        ],
        lastUpdated: now,
      };
    }

    it('auto-scaffolds department folder under master root when created via CEO directive', async () => {
      const masterPath = '/home/company';
      const hierarchy = createHierarchyWithMaster(masterPath);
      const engine = new OrgDelegationEngine(hierarchy);

      const result = await engine.executeDirective('Create department Growth Marketing');
      expect(result.success).toBe(true);
      expect(result.createdDepartments).toBeDefined();
      expect(result.createdDepartments?.[0].workspacePath).toBe('/home/company/departments/growth-marketing');
    });

    it('auto-scaffolds team folder under master root when created via CEO directive', async () => {
      const masterPath = '/home/company';
      const hierarchy = createHierarchyWithMaster(masterPath);
      const engine = new OrgDelegationEngine(hierarchy);

      const result = await engine.executeDirective('Create team Frontend under Engineering');
      expect(result.success).toBe(true);
      expect(result.createdTeams).toBeDefined();
      expect(result.createdTeams?.[0].team.workspacePath).toBe('/home/company/departments/engineering/frontend');
    });

    it('auto-scaffolds project folder under master root when created via CEO directive', async () => {
      const masterPath = '/home/company';
      const hierarchy = createHierarchyWithMaster(masterPath);
      const engine = new OrgDelegationEngine(hierarchy);

      const result = await engine.executeDirective('Create project Mobile Dashboard in department Engineering');
      expect(result.success).toBe(true);
      expect(result.createdProjects).toBeDefined();
      expect(result.createdProjects?.[0].path).toBe('/home/company/projects/mobile-dashboard');
    });
  });
});
