/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { RootCeoAgent, ROOT_CEO_TOOLS, type ProposalCardData } from '@/renderer/pages/organization/utils/rootCeoAgent';
import type { OrgHierarchy, OrgProject, OrgAgentMember } from '@/types/organization';

describe('RootCeoAgent & Tool Integration (Commit 3)', () => {
  const hierarchy: OrgHierarchy = {
    rootCeo: {
      id: 'root-ceo',
      name: 'Global HQ',
      parentId: null,
      workspacePath: '/company/root',
      ceoAgent: {
        id: 'agent-ceo',
        canonicalAgentId: 'c-ceo',
        name: 'CEO',
        role: 'ceo',
        assignedTeamIds: [],
        lastActiveAt: 1000,
        status: 'idle',
      },
      status: 'idle',
      lastActiveAt: 1000,
    },
    departments: [
      {
        id: 'dept-eng',
        name: 'Engineering',
        workspacePath: '/company/root/engineering',
        parentDepartmentId: null,
        departmentCeoAgent: {
          id: 'head-eng',
          canonicalAgentId: 'c-head-eng',
          name: 'Eng Head',
          role: 'department_head',
          assignedTeamIds: [],
          lastActiveAt: 1000,
          status: 'idle',
        },
        teams: [],
        linkedProjects: [],
        lastActiveAt: 1000,
        status: 'idle',
      },
    ],
    lastUpdated: 1000,
  };

  const projects: OrgProject[] = [
    {
      id: 'proj-gateway',
      name: 'API Gateway',
      departmentId: 'dept-eng',
      teamIds: [],
      memberIds: ['m-coder'],
      workspacePath: '/company/root/engineering/gateway',
      status: 'active',
    },
  ];

  const members: OrgAgentMember[] = [
    {
      id: 'm-coder',
      canonicalAgentId: 'c-coder',
      name: 'Alice',
      role: 'specialist',
      skills: ['react'],
      assignedTeamIds: [],
      lastActiveAt: null,
      status: 'idle',
    },
  ];

  it('exposes standard tool definitions without regex routers', () => {
    const toolNames = ROOT_CEO_TOOLS.map((t) => t.name);
    expect(toolNames).toContain('list_org');
    expect(toolNames).toContain('create_department');
    expect(toolNames).toContain('create_project');
    expect(toolNames).toContain('hire_member');
    expect(toolNames).toContain('assign_member');
    expect(toolNames).toContain('assign_task');
    expect(toolNames).toContain('get_status');
    expect(toolNames).toContain('ask_user');
    expect(toolNames).toContain('propose_bulk_projects');
  });

  it('executes list_org and returns structure summary', async () => {
    const agent = new RootCeoAgent(hierarchy, projects, members, {});
    const { result, formattedSummary } = await agent.executeTool('list_org', {});

    expect((result as any).departmentsCount).toBe(1);
    expect((result as any).projectsCount).toBe(1);
    expect((result as any).membersCount).toBe(1);
    expect(formattedSummary).toContain('1 departments, 1 projects, 1 shared members');
  });

  it('executes create_department and notifies callback', async () => {
    const onCreateDepartment = vi.fn();
    const agent = new RootCeoAgent(hierarchy, projects, members, { onCreateDepartment });

    const { result } = await agent.executeTool('create_department', {
      name: 'Product Design',
      folder: '/company/root/design',
      description: 'Design systems and UX',
    });

    expect(onCreateDepartment).toHaveBeenCalledTimes(1);
    const created = onCreateDepartment.mock.calls[0][0];
    expect(created.name).toBe('Product Design');
    expect(created.workspacePath).toBe('/company/root/design');
    expect(created.departmentCeoAgent.role).toBe('department_head');
  });

  it('executes hire_member and assign_member', async () => {
    const onHireMember = vi.fn();
    const onAssignMember = vi.fn();
    const agent = new RootCeoAgent(hierarchy, projects, members, { onHireMember, onAssignMember });

    await agent.executeTool('hire_member', {
      name: 'Bob Designer',
      role: 'specialist',
      skills: ['figma', 'ui'],
    });

    expect(onHireMember).toHaveBeenCalledTimes(1);
    expect(onHireMember.mock.calls[0][0].name).toBe('Bob Designer');

    await agent.executeTool('assign_member', {
      projectId: 'proj-gateway',
      memberId: 'm-bob',
    });

    expect(onAssignMember).toHaveBeenCalledWith('proj-gateway', 'm-bob');
  });

  it('generates proposal card data on propose_bulk_projects', async () => {
    const onProposalCard = vi.fn();
    const agent = new RootCeoAgent(hierarchy, projects, members, { onProposalCard });

    await agent.executeTool('propose_bulk_projects', {
      departmentId: 'dept-eng',
      proposals: [
        { name: 'App A', folder: '/company/root/engineering/app-a' },
        { name: 'App B', folder: '/company/root/engineering/app-b' },
        { name: 'App C', folder: '/company/root/engineering/app-c' },
      ],
    });

    expect(onProposalCard).toHaveBeenCalledTimes(1);
    const cardData: ProposalCardData = onProposalCard.mock.calls[0][0];
    expect(cardData.departmentName).toBe('Engineering');
    expect(cardData.projects).toHaveLength(3);
  });
});
