/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { OrgHierarchy, OrgDepartmentNode, OrgProject, OrgAgentMember } from '@/types/organization';

export interface CeoToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const ROOT_CEO_TOOLS: CeoToolDefinition[] = [
  {
    name: 'list_org',
    description:
      'Lists the full current organization state including departments, projects, and active shared members.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_department',
    description: 'Creates a new department bound to a specific local directory.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the department (e.g. Engineering, Product, Marketing)' },
        folder: { type: 'string', description: 'Absolute path to folder on disk bound to this department' },
        description: { type: 'string', description: 'Department charter and purpose' },
      },
      required: ['name', 'folder'],
    },
  },
  {
    name: 'create_project',
    description: 'Creates a new project under a department, bound to an app or product folder.',
    parameters: {
      type: 'object',
      properties: {
        departmentId: { type: 'string', description: 'ID of the parent department' },
        name: { type: 'string', description: 'Name of the project' },
        folder: { type: 'string', description: 'Absolute path to project directory' },
        goal: { type: 'string', description: 'Primary objective of the project' },
        memberIds: { type: 'array', items: { type: 'string' }, description: 'IDs of shared members assigned' },
      },
      required: ['departmentId', 'name', 'folder'],
    },
  },
  {
    name: 'hire_member',
    description: 'Adds a new agent to the shared member pool.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the member' },
        role: { type: 'string', description: 'Role or specialty (e.g. specialist, coder, designer, editor)' },
        skills: { type: 'array', items: { type: 'string' }, description: 'Technical or creative skills' },
        systemPrompt: { type: 'string', description: 'Custom system prompt for the member' },
      },
      required: ['name', 'role'],
    },
  },
  {
    name: 'assign_member',
    description: 'Assigns an existing member from the shared pool to a project.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID of the project' },
        memberId: { type: 'string', description: 'ID of the member' },
      },
      required: ['projectId', 'memberId'],
    },
  },
  {
    name: 'assign_task',
    description: 'Delegates an execution task to a specific department or project head.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'ID of target department or project' },
        task: { type: 'string', description: 'Clear technical instructions for execution' },
      },
      required: ['target', 'task'],
    },
  },
  {
    name: 'get_status',
    description: 'Retrieves current status, active projects, and telemetry from across the organization.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ask_user',
    description: 'Asks the user a clarifying question when the executive request is ambiguous.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Question to present to the user' },
      },
      required: ['question'],
    },
  },
  {
    name: 'propose_bulk_projects',
    description: 'Proposes multiple projects discovered from scanning for user approval before creating them.',
    parameters: {
      type: 'object',
      properties: {
        departmentId: { type: 'string', description: 'Target department ID' },
        proposals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              folder: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['name', 'folder'],
          },
        },
      },
      required: ['departmentId', 'proposals'],
    },
  },
];

export interface ProposalCardData {
  departmentId: string;
  departmentName: string;
  projects: Array<{ name: string; folder: string; description?: string }>;
}

export class RootCeoAgent {
  constructor(
    private hierarchy: OrgHierarchy,
    private projects: OrgProject[],
    private members: OrgAgentMember[],
    private callbacks: {
      onLiveStep?: (step: string) => void;
      onProposalCard?: (card: ProposalCardData) => void;
      onCreateDepartment?: (dept: OrgDepartmentNode) => void;
      onCreateProject?: (project: OrgProject) => void;
      onHireMember?: (member: OrgAgentMember) => void;
      onAssignMember?: (projectId: string, memberId: string) => void;
    }
  ) {}

  public getSystemPrompt(): string {
    const rootWorkspace = this.hierarchy.rootCeo.workspacePath || 'Unassigned Master Root';
    return `You are the Root CEO of an autonomous, highly structured engineering organization.
Root Organization Workspace: "${rootWorkspace}".

Your core mandate:
1. Drive the organization purely through chat, tools, and delegation.
2. Structure the company into Departments bound to specific folder roots.
3. Each Department has a Department Head who creates Projects for individual applications/channels/product folders.
4. Work with ONE shared global pool of specialized members (coders, designers, QA, editors). Projects reference members by ID; department rosters are derived automatically.
5. If scanning a folder yields multiple projects (e.g. 3+), propose them clearly or use \`propose_bulk_projects\` so the user can approve the creation.
6. When tasks are requested, delegate them to the appropriate Department or Project Head using \`assign_task\`. Cross-department tasks run in parallel.
7. For ambiguous requests, call \`ask_user\` to get clarification.

Always inspect your tools before responding. When a tool call is needed, invoke the tool directly.`;
  }

  /**
   * Executes a CEO tool invocation locally and notifies callbacks.
   */
  public async executeTool(
    name: string,
    args: Record<string, any>
  ): Promise<{ result: unknown; formattedSummary: string }> {
    this.callbacks.onLiveStep?.(`Root CEO executing tool: ${name}`);

    switch (name) {
      case 'list_org': {
        const summary = {
          rootWorkspace: this.hierarchy.rootCeo.workspacePath,
          departmentsCount: this.hierarchy.departments.length,
          departments: this.hierarchy.departments.map((d) => ({
            id: d.id,
            name: d.name,
            folder: d.workspacePath,
            projectsCount: this.projects.filter((p) => p.departmentId === d.id).length,
          })),
          projectsCount: this.projects.length,
          membersCount: this.members.length,
        };
        return {
          result: summary,
          formattedSummary: `Organization Overview: ${summary.departmentsCount} departments, ${summary.projectsCount} projects, ${summary.membersCount} shared members.`,
        };
      }

      case 'create_department': {
        const deptId = `dept-${Date.now()}`;
        const newDept: OrgDepartmentNode = {
          id: deptId,
          name: args.name,
          workspacePath: args.folder,
          description: args.description || '',
          parentDepartmentId: null,
          departmentCeoAgent: {
            id: `head-${deptId}`,
            canonicalAgentId: `head-${deptId}`,
            name: `${args.name} Department Head`,
            role: 'department_head',
            title: `Head of ${args.name}`,
            workspacePath: args.folder,
            assignedTeamIds: [],
            lastActiveAt: Date.now(),
            status: 'idle',
            systemPrompt: `You are the Department Head for ${args.name}. Analyze your workspace (${args.folder}) and manage projects and team execution.`,
          },
          teams: [],
          linkedProjects: [],
          lastActiveAt: Date.now(),
          status: 'idle',
        };
        this.callbacks.onCreateDepartment?.(newDept);
        return {
          result: newDept,
          formattedSummary: `Created department "${newDept.name}" bound to folder: ${newDept.workspacePath}`,
        };
      }

      case 'create_project': {
        const projId = `proj-${Date.now()}`;
        const newProj: OrgProject = {
          id: projId,
          name: args.name,
          departmentId: args.departmentId,
          teamIds: [],
          workspacePath: args.folder,
          goal: args.goal || '',
          memberIds: args.memberIds || [],
          status: 'active',
        };
        this.callbacks.onCreateProject?.(newProj);
        return {
          result: newProj,
          formattedSummary: `Created project "${newProj.name}" in department ${newProj.departmentId} (Path: ${newProj.workspacePath})`,
        };
      }

      case 'hire_member': {
        const memId = `member-${Date.now()}`;
        const newMem: OrgAgentMember = {
          id: memId,
          canonicalAgentId: memId,
          name: args.name,
          role: args.role,
          skills: args.skills || [],
          systemPrompt: args.systemPrompt || '',
          assignedTeamIds: [],
          lastActiveAt: Date.now(),
          status: 'idle',
        };
        this.callbacks.onHireMember?.(newMem);
        return {
          result: newMem,
          formattedSummary: `Hired member "${newMem.name}" (${newMem.role}) with skills: ${(newMem.skills || []).join(', ')}`,
        };
      }

      case 'assign_member': {
        this.callbacks.onAssignMember?.(args.projectId, args.memberId);
        return {
          result: { projectId: args.projectId, memberId: args.memberId },
          formattedSummary: `Assigned member ${args.memberId} to project ${args.projectId}`,
        };
      }

      case 'propose_bulk_projects': {
        const dept = this.hierarchy.departments.find((d) => d.id === args.departmentId);
        const card: ProposalCardData = {
          departmentId: args.departmentId,
          departmentName: dept?.name || 'Department',
          projects: args.proposals || [],
        };
        this.callbacks.onProposalCard?.(card);
        return {
          result: card,
          formattedSummary: `Generated bulk proposal approval card with ${card.projects.length} projects for department "${card.departmentName}".`,
        };
      }

      case 'get_status': {
        return {
          result: {
            departments: this.hierarchy.departments.length,
            projects: this.projects.length,
            members: this.members.length,
            masterRoot: this.hierarchy.rootCeo.workspacePath,
          },
          formattedSummary: `Organization operating normally with ${this.hierarchy.departments.length} departments and ${this.projects.length} projects.`,
        };
      }

      case 'ask_user': {
        return {
          result: { question: args.question },
          formattedSummary: args.question,
        };
      }

      default:
        throw new Error(`Unknown Root CEO tool: ${name}`);
    }
  }
}
