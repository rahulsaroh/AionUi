/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DepartmentHeadAgent, ProjectHeadAgent } from '@/renderer/pages/organization/utils/headAgents';
import { ipcBridge } from '@/common';
import type { OrgDepartmentNode, OrgProject, OrgAgentMember } from '@/types/organization';

describe('DepartmentHead & ProjectHead Agents (Commit 4)', () => {
  const dept: OrgDepartmentNode = {
    id: 'dept-eng',
    name: 'Engineering',
    workspacePath: '/company/engineering',
    parentDepartmentId: null,
    departmentCeoAgent: {
      id: 'head-eng',
      canonicalAgentId: 'c-head-eng',
      name: 'Dr. Marcus Thorne',
      role: 'department_head',
      assignedTeamIds: [],
      lastActiveAt: 1000,
      status: 'idle',
    },
    teams: [],
    linkedProjects: [],
    lastActiveAt: 1000,
    status: 'idle',
  };

  const poolMembers: OrgAgentMember[] = [
    {
      id: 'm-coder',
      canonicalAgentId: 'c-coder',
      name: 'Senior Fullstack Coder',
      role: 'specialist',
      skills: ['typescript', 'react', 'api'],
      assignedTeamIds: [],
      lastActiveAt: null,
      status: 'idle',
    },
    {
      id: 'm-designer',
      canonicalAgentId: 'c-designer',
      name: 'UI Designer',
      role: 'specialist',
      skills: ['ui', 'ux', 'css'],
      assignedTeamIds: [],
      lastActiveAt: null,
      status: 'idle',
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('DepartmentHead analyzes department folder and maps projects with recommended pool members', async () => {
    vi.spyOn(ipcBridge.org, 'scanFolder').mockResolvedValue({
      rootPath: '/company/engineering',
      totalScanned: 3,
      truncated: false,
      summary: 'Scan complete',
      entries: [
        { name: 'api-service', relativePath: 'api-service', isDirectory: true },
        { name: 'web-ui', relativePath: 'web-ui', isDirectory: true },
        { name: 'README.md', relativePath: 'README.md', isDirectory: false },
      ],
    });

    const onCreateProject = vi.fn();
    const deptHead = new DepartmentHeadAgent(dept, [], poolMembers, { onCreateProject });

    const analysis = await deptHead.analyzeFolderAndMapProjects();
    expect(analysis.discovered).toHaveLength(2); // api-service and web-ui

    const apiProj = analysis.discovered.find((p) => p.name === 'api-service');
    expect(apiProj).toBeDefined();
    expect(apiProj!.recommendedMemberIds).toContain('m-coder');

    const uiProj = analysis.discovered.find((p) => p.name === 'web-ui');
    expect(uiProj).toBeDefined();
    expect(uiProj!.recommendedMemberIds).toContain('m-designer');

    // Create project
    const created = deptHead.createProject('api-service', apiProj!.folder, apiProj!.recommendedMemberIds);
    expect(created.name).toBe('api-service');
    expect(onCreateProject).toHaveBeenCalledWith(created);
  });

  it('ProjectHead injects README and constrains tool calls to project folder', async () => {
    const project: OrgProject = {
      id: 'proj-web',
      name: 'Web Portal',
      departmentId: 'dept-eng',
      workspacePath: '/company/engineering/web-portal',
      teamIds: [],
      memberIds: ['m-coder'],
      goal: 'Deliver responsive customer portal',
      status: 'active',
    };

    vi.spyOn(ipcBridge.org, 'readFile').mockResolvedValue({
      content: '# Web Portal\nBuilt with React & Vite',
      size: 35,
      truncated: false,
    });

    const projectHead = new ProjectHeadAgent(project, poolMembers[0]);
    const prompt = await projectHead.getContextualSystemPrompt();

    expect(prompt).toContain('Senior Fullstack Coder');
    expect(prompt).toContain('Web Portal');
    expect(prompt).toContain('/company/engineering/web-portal');
    expect(prompt).toContain('Built with React & Vite');

    // File writing strictly delegates to project workspace
    vi.spyOn(ipcBridge.org, 'writeFile').mockResolvedValue(true);
    const writeResult = await projectHead.writeFile('src/App.tsx', 'export default function App() {}');
    expect(writeResult).toBe(true);
    expect(ipcBridge.org.writeFile).toHaveBeenCalledWith(
      '/company/engineering/web-portal/src/App.tsx',
      'export default function App() {}',
      '/company/engineering/web-portal'
    );

    // Shell execution strictly runs in project folder
    vi.spyOn(ipcBridge.org, 'runShell').mockResolvedValue({ stdout: 'Done', stderr: '', exitCode: 0 });
    const shellResult = await projectHead.runShell('npm test');
    expect(shellResult.stdout).toBe('Done');
    expect(ipcBridge.org.runShell).toHaveBeenCalledWith(
      'npm test',
      '/company/engineering/web-portal',
      '/company/engineering/web-portal'
    );
  });
});
