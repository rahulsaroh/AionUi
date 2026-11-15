/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOrgStore } from '@/renderer/pages/organization/store/useOrgStore';
import { ipcBridge } from '@/common';
import { RootCeoAgent } from '@/renderer/pages/organization/utils/rootCeoAgent';
import { DepartmentHeadAgent, ProjectHeadAgent } from '@/renderer/pages/organization/utils/headAgents';
import { OrgDelegationEngine } from '@/renderer/pages/organization/utils/orgDelegationEngine';
import type { OrgDepartmentNode, OrgProject, OrgAgentMember, OrgHierarchy } from '@/types/organization';

describe('Phase 2.5: Renderer Store Validation, Agent Status Guard & Concurrency', () => {
  const masterRoot = '/org/master/root';

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();

    // Mock ipcBridge.org methods
    vi.spyOn(ipcBridge.org, 'getMasterRoot').mockResolvedValue(masterRoot);
    vi.spyOn(ipcBridge.org, 'assertWithinScope').mockImplementation(async (target, root) => {
      const allowed = target.startsWith(root || masterRoot);
      return {
        allowed,
        reason: allowed ? undefined : `Target "${target}" outside scope "${root || masterRoot}"`,
        resolved: target,
      };
    });
    vi.spyOn(ipcBridge.org, 'saveData').mockResolvedValue(true);
    vi.spyOn(ipcBridge.org, 'loadData').mockResolvedValue(null);
    vi.spyOn(ipcBridge.org, 'saveMembers').mockResolvedValue(true);
    vi.spyOn(ipcBridge.org, 'readFile').mockResolvedValue({ content: 'test content', size: 12, truncated: false });
    vi.spyOn(ipcBridge.org, 'writeFile').mockResolvedValue(true);
    vi.spyOn(ipcBridge.org, 'runShell').mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0, timedOut: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Item 5: Store validates folder with empty renderer master root via IPC fallback', () => {
    it('sets department to status "error" and clears workspacePath when path is outside master root', async () => {
      const { result } = renderHook(() => useOrgStore());

      // Ensure renderer rootCeo workspacePath is empty
      act(() => {
        result.current.updateRootCeo({ workspacePath: '' });
      });

      const evilDept: OrgDepartmentNode = {
        id: 'dept-evil',
        name: 'Malicious Dept',
        workspacePath: '/outside/forbidden/path',
        departmentCeoAgent: {
          id: 'agent-evil-ceo',
          name: 'Evil CEO',
          role: 'head',
          status: 'idle',
        },
        teams: [],
        status: 'active',
      };

      await act(async () => {
        await result.current.addDepartment(evilDept);
      });

      const added = result.current.hierarchy.departments.find((d) => d.id === 'dept-evil');
      expect(added).toBeDefined();
      expect(added?.status).toBe('error');
      expect(added?.workspacePath).toBeUndefined();
      expect(added?.departmentCeoAgent.status).toBe('error');
    });

    it('sets project to status "dormant" and clears workspacePath when path is outside master root', async () => {
      const { result } = renderHook(() => useOrgStore());

      const testDept: OrgDepartmentNode = {
        id: 'dept-general',
        name: 'General Dept',
        workspacePath: `${masterRoot}/general`,
        departmentCeoAgent: { id: 'head-g', name: 'General Head', role: 'head', status: 'idle' },
        teams: [],
        status: 'active',
      };

      await act(async () => {
        await result.current.addDepartment(testDept);
      });

      act(() => {
        result.current.updateRootCeo({ workspacePath: '' });
      });

      const evilProj: OrgProject = {
        id: 'proj-evil',
        name: 'Malicious Project',
        departmentId: 'dept-general',
        workspacePath: '/outside/forbidden/project',
        status: 'active',
        teamIds: [],
        memberIds: [],
      };

      await act(async () => {
        await result.current.addOrgProject(evilProj);
      });

      const added = result.current.projects.find((p) => p.id === 'proj-evil');
      expect(added).toBeDefined();
      expect(added?.status).toBe('dormant');
      expect(added?.workspacePath).toBeUndefined();
    });
  });

  describe('Item 6: Execution blocking for department "error" and project "dormant"', () => {
    it('DepartmentHeadAgent refuses folder scan and project creation when status is "error"', async () => {
      const errorDept: OrgDepartmentNode = {
        id: 'dept-err',
        name: 'Broken Dept',
        workspacePath: '/org/master/root/dept',
        departmentCeoAgent: { id: 'ceo-err', name: 'Broken CEO', role: 'head', status: 'error' },
        teams: [],
        status: 'error',
      };

      const agent = new DepartmentHeadAgent(errorDept, [], [], {});

      await expect(agent.analyzeFolderAndMapProjects()).rejects.toThrow(
        /has error status and cannot perform folder operations/i
      );

      await expect(agent.createProject('New Proj', '/org/master/root/dept/p1', [])).rejects.toThrow(
        /has error status and cannot create projects/i
      );
    });

    it('ProjectHeadAgent refuses readFile, writeFile, and runShell when status is "dormant"', async () => {
      const dormantProj: OrgProject = {
        id: 'proj-dormant',
        name: 'Dormant Project',
        departmentId: 'dept-1',
        workspacePath: '/org/master/root/proj',
        status: 'dormant',
        teamIds: [],
        memberIds: [],
      };

      const headMember: OrgAgentMember = {
        id: 'mem-1',
        name: 'Lead Dev',
        role: 'lead',
        status: 'idle',
      };

      const agent = new ProjectHeadAgent(dormantProj, headMember);

      await expect(agent.readFile('index.ts')).rejects.toThrow(/is dormant and cannot perform file operations/i);

      await expect(agent.writeFile('index.ts', 'code')).rejects.toThrow(
        /is dormant and cannot perform file operations/i
      );

      await expect(agent.runShell('npm test')).rejects.toThrow(/is dormant and cannot execute shell commands/i);
    });

    it('OrgDelegationEngine refuses direct execution on dormant agent or error department', async () => {
      const hierarchy: OrgHierarchy = {
        rootCeo: {
          id: 'root-ceo',
          name: 'CEO',
          workspacePath: masterRoot,
          ceoAgent: { id: 'ceo', name: 'Root CEO', role: 'ceo', status: 'idle' },
        },
        departments: [
          {
            id: 'dept-broken',
            name: 'Broken Dept',
            workspacePath: '/broken',
            status: 'error',
            departmentCeoAgent: { id: 'head-1', name: 'Head', role: 'head', status: 'error' },
            teams: [],
          },
        ],
      };

      const dormantAgent: OrgAgentMember = {
        id: 'agent-dormant',
        name: 'Sleeping Agent',
        role: 'specialist',
        status: 'dormant',
      };

      const engine = new OrgDelegationEngine(hierarchy, vi.fn(), vi.fn(), vi.fn(), {
        projects: [],
        simulationMode: true,
      });

      // Direct message to dormant agent should throw
      await expect(engine.executeDirectMessage(dormantAgent, 'Run task', undefined, false)).rejects.toThrow(
        /agent has dormant status/i
      );

      // Directive to broken department returns error result
      const result = await engine.executeDirective(
        'Perform departmental audit',
        'dept-broken',
        undefined,
        undefined,
        false
      );
      expect(result.success).toBe(false);
      expect(result.finalSynthesis).toMatch(/department has error status/i);
    });
  });

  describe('Item 7: RootCeoAgent propose_bulk_projects returns rejected out-of-scope folders', () => {
    it('collects rejected folders and includes them in tool result and card text', async () => {
      const hierarchy: OrgHierarchy = {
        rootCeo: {
          id: 'root-ceo',
          name: 'CEO',
          workspacePath: masterRoot,
          ceoAgent: { id: 'ceo', name: 'Root CEO', role: 'ceo', status: 'idle' },
        },
        departments: [
          {
            id: 'dept-valid',
            name: 'Engineering',
            workspacePath: `${masterRoot}/engineering`,
            status: 'active',
            departmentCeoAgent: { id: 'head-eng', name: 'Eng Head', role: 'head', status: 'idle' },
            teams: [],
          },
        ],
      };

      let capturedCard: any = null;
      const ceo = new RootCeoAgent(hierarchy, [], [], {
        onProposalCard: (card) => {
          capturedCard = card;
        },
      });

      const response = await ceo.executeTool('propose_bulk_projects', {
        departmentId: 'dept-valid',
        proposals: [
          { name: 'Valid App', folder: `${masterRoot}/engineering/app1` },
          { name: 'Evil System App', folder: '/etc/shadow' },
          { name: 'Parent Dir Escape', folder: `${masterRoot}/../../root-escape` },
        ],
      });

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();

      const result = response.result as { card: any; rejected: Array<{ folder: string; reason: string }> };
      expect(result.card.projects).toHaveLength(1);
      expect(result.card.projects[0].name).toBe('Valid App');

      expect(result.rejected).toHaveLength(2);
      expect(result.rejected[0].folder).toBe('/etc/shadow');
      expect(result.rejected[1].folder).toContain('root-escape');

      expect(capturedCard?.rejected).toHaveLength(2);
      expect(response.formattedSummary).toContain('rejected: outside scope');
    });
  });

  describe('Item 9: 10 parallel project creates keep all 10 projects without race conditions', () => {
    it('executes 10 parallel addOrgProject calls and keeps all 10 in store', async () => {
      const { result } = renderHook(() => useOrgStore());

      const testDept: OrgDepartmentNode = {
        id: 'dept-general',
        name: 'General Dept',
        workspacePath: `${masterRoot}/general`,
        departmentCeoAgent: { id: 'head-g', name: 'General Head', role: 'head', status: 'idle' },
        teams: [],
        status: 'active',
      };

      await act(async () => {
        await result.current.addDepartment(testDept);
      });

      act(() => {
        result.current.updateRootCeo({ workspacePath: masterRoot });
      });

      const projectsToCreate: OrgProject[] = Array.from({ length: 10 }, (_, i) => ({
        id: `proj-parallel-${i}`,
        name: `Parallel Project ${i}`,
        departmentId: 'dept-general',
        workspacePath: `${masterRoot}/project-${i}`,
        status: 'active',
        teamIds: [],
        memberIds: [],
      }));

      // Launch all 10 concurrently
      await act(async () => {
        await Promise.all(projectsToCreate.map((proj) => result.current.addOrgProject(proj)));
      });

      // Verify all 10 are present in global store state
      const createdIds = result.current.projects.filter((p) => p.id.startsWith('proj-parallel-')).map((p) => p.id);

      expect(createdIds).toHaveLength(10);
      for (let i = 0; i < 10; i++) {
        expect(createdIds).toContain(`proj-parallel-${i}`);
      }
    });
  });
});
