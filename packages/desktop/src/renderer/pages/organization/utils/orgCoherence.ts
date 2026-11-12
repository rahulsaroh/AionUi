/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  OrgAgentModelConfig,
  OrgDepartmentNode,
  OrgHierarchy,
  OrgProject,
  OrgTeamNode,
} from '@/types/organization';

export type OrgProjectPatch = Partial<Omit<OrgProject, 'id'>> & Pick<OrgProject, 'id'>;
export type OrgDepartmentPatch = Partial<Omit<OrgDepartmentNode, 'id'>> & Pick<OrgDepartmentNode, 'id'>;
export type OrgTeamPatch = Partial<Omit<OrgTeamNode, 'id'>> & Pick<OrgTeamNode, 'id'>;

function normalizeText(value: string | undefined | null): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function normalizePath(value: string | undefined | null): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

export function normalizeOrgProject(project: OrgProject): OrgProject {
  // `teamId` (v1 single-team) is normalized into `teamIds` and dropped.
  const { teamId: _legacyTeamId, ...rest } = project as { teamId?: string };
  return {
    ...rest,
    id: project.id.trim(),
    name: project.name.trim(),
    departmentId: project.departmentId.trim(),
    teamIds: Array.from(new Set([...(project.teamIds ?? []), ...(_legacyTeamId ? [_legacyTeamId] : [])])).filter(
      Boolean
    ),
    goal: normalizeText(project.goal ?? project.description),
    description: normalizeText(project.description),
    path: normalizePath(project.path),
    status: (project.status ?? 'active') as 'active' | 'dormant' | 'done',
  };
}

export function findDepartment(hierarchy: OrgHierarchy, departmentId: string): OrgDepartmentNode | undefined {
  return hierarchy.departments.find((department) => department.id === departmentId);
}

export function findTeam(
  hierarchy: OrgHierarchy,
  teamId: string
): { department: OrgDepartmentNode; team: OrgTeamNode } | undefined {
  for (const department of hierarchy.departments) {
    const team = department.teams.find((item) => item.id === teamId);
    if (team) return { department, team };
  }
  return undefined;
}

export function assertProjectAssignment(hierarchy: OrgHierarchy, project: OrgProject): void {
  const normalized = normalizeOrgProject(project);
  if (!normalized.name) {
    throw new Error('Project name is required');
  }
  const department = findDepartment(hierarchy, normalized.departmentId);
  if (!department) {
    throw new Error(`Department not found: ${normalized.departmentId}`);
  }
  const validTeamIds = new Set(department.teams.map((item) => item.id));
  for (const teamId of normalized.teamIds) {
    if (!validTeamIds.has(teamId)) {
      throw new Error(`Team ${teamId} does not belong to department ${normalized.departmentId}`);
    }
  }
}

function toLinkedProject(project: OrgProject): { id: string; name: string; path?: string } {
  return {
    id: project.id,
    name: project.name,
    ...(project.path ? { path: project.path } : {}),
  };
}

function syncDepartmentLinkedProjects(departments: OrgDepartmentNode[], projects: OrgProject[]): OrgDepartmentNode[] {
  const byDepartment = new Map<string, OrgProject[]>();
  for (const project of projects) {
    const list = byDepartment.get(project.departmentId) ?? [];
    list.push(project);
    byDepartment.set(project.departmentId, list);
  }
  return departments.map((department) => ({
    ...department,
    linkedProjects: (byDepartment.get(department.id) ?? []).map(toLinkedProject),
  }));
}

function syncTeamLinkedProjects(departments: OrgDepartmentNode[], projects: OrgProject[]): OrgDepartmentNode[] {
  const projectsByTeam = new Map<string, OrgProject[]>();
  for (const project of projects) {
    for (const teamId of project.teamIds) {
      const list = projectsByTeam.get(teamId) ?? [];
      list.push(project);
      projectsByTeam.set(teamId, list);
    }
  }
  return departments.map((department) => ({
    ...department,
    teams: department.teams.map((team) => {
      const projects = projectsByTeam.get(team.id);
      const linked = projects?.[0];
      if (!linked) {
        if (!team.linkedProjectId && !team.linkedProjectName) return team;
        return { ...team, linkedProjectId: undefined, linkedProjectName: undefined };
      }
      return {
        ...team,
        linkedProjectId: linked.id,
        linkedProjectName: linked.name,
      };
    }),
  }));
}

export function syncHierarchyProjectReferences(hierarchy: OrgHierarchy, projects: OrgProject[]): OrgHierarchy {
  const normalizedProjects = projects.map(normalizeOrgProject);
  const withDepartmentLinks = syncDepartmentLinkedProjects(hierarchy.departments, normalizedProjects);
  const withTeamLinks = syncTeamLinkedProjects(withDepartmentLinks, normalizedProjects);
  return {
    ...hierarchy,
    departments: withTeamLinks,
    lastUpdated: Date.now(),
  };
}

export function upsertProjectInList(projects: OrgProject[], project: OrgProject): OrgProject[] {
  const normalized = normalizeOrgProject(project);
  const index = projects.findIndex((item) => item.id === normalized.id);
  if (index === -1) return [...projects, normalized];
  const next = [...projects];
  next[index] = { ...next[index], ...normalized };
  return next;
}

export function removeProjectFromList(projects: OrgProject[], projectId: string): OrgProject[] {
  return projects.filter((project) => project.id !== projectId);
}

export function applyProjectMutation(
  hierarchy: OrgHierarchy,
  projects: OrgProject[],
  project: OrgProject
): { hierarchy: OrgHierarchy; projects: OrgProject[] } {
  const nextProjects = upsertProjectInList(projects, project);
  const nextHierarchy = syncHierarchyProjectReferences(hierarchy, nextProjects);
  assertProjectAssignment(nextHierarchy, normalizeOrgProject(project));
  return { hierarchy: nextHierarchy, projects: nextProjects };
}

export function applyProjectRemoval(
  hierarchy: OrgHierarchy,
  projects: OrgProject[],
  projectId: string
): { hierarchy: OrgHierarchy; projects: OrgProject[] } {
  const nextProjects = removeProjectFromList(projects, projectId);
  return { hierarchy: syncHierarchyProjectReferences(hierarchy, nextProjects), projects: nextProjects };
}

export function updateDepartmentInHierarchy(
  hierarchy: OrgHierarchy,
  departmentId: string,
  patch: Partial<OrgDepartmentNode>
): OrgHierarchy {
  return {
    ...hierarchy,
    lastUpdated: Date.now(),
    departments: hierarchy.departments.map((department) =>
      department.id === departmentId
        ? {
            ...department,
            ...patch,
            id: department.id,
            teams: patch.teams ?? department.teams,
            departmentCeoAgent: patch.departmentCeoAgent ?? department.departmentCeoAgent,
            linkedProjects: patch.linkedProjects ?? department.linkedProjects,
          }
        : department
    ),
  };
}

export function updateTeamInHierarchy(
  hierarchy: OrgHierarchy,
  teamId: string,
  patch: Partial<OrgTeamNode>
): OrgHierarchy {
  return {
    ...hierarchy,
    lastUpdated: Date.now(),
    departments: hierarchy.departments.map((department) => ({
      ...department,
      teams: department.teams.map((team) =>
        team.id === teamId
          ? {
              ...team,
              ...patch,
              id: team.id,
              departmentId: team.departmentId,
              teamLeadAgent: patch.teamLeadAgent ?? team.teamLeadAgent,
              hrCoordinatorAgent: patch.hrCoordinatorAgent ?? team.hrCoordinatorAgent,
              specialistMembers: patch.specialistMembers ?? team.specialistMembers,
            }
          : team
      ),
    })),
  };
}

export function reconcileProjectsWithHierarchy(
  hierarchy: OrgHierarchy,
  projects: OrgProject[]
): { hierarchy: OrgHierarchy; projects: OrgProject[] } {
  const validDepartmentIds = new Set(hierarchy.departments.map((department) => department.id));
  const normalized = projects
    .map(normalizeOrgProject)
    .filter((project) => validDepartmentIds.has(project.departmentId));
  const reconciled = normalized.map((project) => {
    const department = findDepartment(hierarchy, project.departmentId);
    const validTeamIds = project.teamIds.filter((teamId) => department?.teams.some((team) => team.id === teamId));
    return validTeamIds.length === 0 ? { ...project, teamIds: [] } : { ...project, teamIds: validTeamIds };
  });
  return {
    projects: reconciled,
    hierarchy: syncHierarchyProjectReferences(hierarchy, reconciled),
  };
}

export function createDepartmentShell(name: string, defaultModel?: OrgAgentModelConfig): OrgDepartmentNode {
  const id = `dept-${Date.now()}`;
  const trimmed = name.trim();
  return {
    id,
    name: trimmed,
    parentDepartmentId: 'root-ceo',
    departmentCeoAgent: {
      id: `agent-head-${id}`,
      canonicalAgentId: `canonical-head-${id}`,
      name: `${trimmed} Head`,
      title: 'Department CEO',
      role: 'department_head',
      assignedTeamIds: [],
      lastActiveAt: Date.now(),
      status: 'idle',
      model: defaultModel || {
        modelId: 'claude-3-7-sonnet',
        providerId: 'anthropic',
      },
    },
    teams: [],
    linkedProjects: [],
    lastActiveAt: Date.now(),
    status: 'idle',
  };
}

export function createTeamShell(departmentId: string, name: string, defaultModel?: OrgAgentModelConfig): OrgTeamNode {
  const id = `team-${Date.now()}`;
  return {
    id,
    departmentId,
    name: name.trim(),
    lastActiveAt: Date.now(),
    status: 'idle',
    teamLeadAgent: {
      id: `lead-${id}`,
      canonicalAgentId: `canonical-lead-${id}`,
      name: 'Team Lead',
      title: 'Team CEO / Manager',
      role: 'team_lead',
      assignedTeamIds: [id],
      lastActiveAt: Date.now(),
      status: 'idle',
      model: defaultModel || {
        modelId: 'claude-3-7-sonnet',
        providerId: 'anthropic',
      },
    },
    hrCoordinatorAgent: {
      id: `hr-${id}`,
      canonicalAgentId: `canonical-hr-${id}`,
      name: 'HR Coordinator',
      title: 'HR & Workload Coordinator',
      role: 'hr_coordinator',
      assignedTeamIds: [id],
      lastActiveAt: Date.now(),
      status: 'idle',
      model: {
        modelId: 'claude-3-5-haiku',
        providerId: 'anthropic',
      },
    },
    specialistMembers: [],
  };
}

export function createMemberShell(
  name: string,
  role: string = 'specialist',
  title: string = 'Specialist',
  teamId?: string,
  modelId: string = 'claude-3-7-sonnet'
): import('@/types/organization').OrgAgentMember {
  const id = `agent-spec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    canonicalAgentId: `canonical-${id}`,
    name: name.trim(),
    role,
    title,
    assignedTeamIds: teamId ? [teamId] : [],
    lastActiveAt: Date.now(),
    status: 'idle',
    model: {
      modelId,
      providerId: 'anthropic',
    },
  };
}

export function computeAutoTitle(prompt: string, currentTitle?: string): string | undefined {
  const isNew = !currentTitle || currentTitle.trim() === '' || currentTitle === 'New chat';
  if (!isNew) return undefined;
  return prompt.trim().slice(0, 40);
}
