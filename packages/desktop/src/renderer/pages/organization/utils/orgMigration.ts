/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One-shot renderer localStorage migration for the Organization sidebar data model
 * (v1 -> v2).
 *
 * The Electron backend database is intentionally NOT touched: Organization state
 * lives in renderer localStorage (`aionui:org-hierarchy`,
 * `aionui:org-projects`, `aionui:org-conversations`).
 *
 * v2 changes:
 * - every department gets a default project manager agent (`pmAgentId`)
 * - each team's node-attached chats are moved into a project named after the team
 * - project `teamId` (single) -> `teamIds` (array)
 *
 * The migration is idempotent: it only runs when the stored version is below 2,
 * and the version flag is persisted immediately after a successful run.
 */

import type {
  OrgAgentMember,
  OrgConversation,
  OrgDepartmentNode,
  OrgHierarchy,
  OrgProject,
  OrgTeamNode,
} from '@/types/organization';
import { normalizeOrgProject } from './orgCoherence';

export const ORG_STORAGE_VERSION = 2;
export const ORG_STORAGE_VERSION_KEY = 'aionui:org-storage-version';

export interface OrgMigrationReport {
  step: 'pm-agent' | 'team-project' | 'reparent-chat' | 'normalize';
  detail: string;
}

export interface OrgMigrationResult {
  hierarchy: OrgHierarchy;
  projects: OrgProject[];
  conversations: OrgConversation[];
  migrated: boolean;
  report: OrgMigrationReport[];
}

export function loadOrgStorageVersion(): number {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(ORG_STORAGE_VERSION_KEY);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export function saveOrgStorageVersion(version: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ORG_STORAGE_VERSION_KEY, String(version));
  } catch {}
}

function ensurePmAgent(department: OrgDepartmentNode, report: OrgMigrationReport[]): OrgDepartmentNode {
  if (department.pmAgentId) {
    return department;
  }
  const id = `agent-pm-${department.id}`;
  const pmAgent: OrgAgentMember = {
    id,
    canonicalAgentId: `canonical-pm-${department.id}`,
    name: `${department.name} PM`,
    title: 'Project Manager',
    role: 'project_manager',
    icon: 'robot',
    assistant_backend: 'acp',
    assignedTeamIds: [],
    lastActiveAt: Date.now(),
    status: 'idle',
    workspacePath: department.workspacePath ?? null,
  };
  report.push({ step: 'pm-agent', detail: `Created default PM for ${department.name} (${id})` });
  return {
    ...department,
    pmAgent,
    pmAgentId: id,
  };
}

function normalizeProjectV2(project: OrgProject): OrgProject {
  const legacyTeamId = (project as { teamId?: string }).teamId;
  return {
    id: project.id.trim(),
    name: project.name.trim(),
    departmentId: project.departmentId.trim(),
    teamIds: Array.from(new Set([...(project.teamIds ?? []), ...(legacyTeamId ? [legacyTeamId] : [])])).filter(Boolean),
    goal: project.goal,
    description: project.description,
    context: project.context,
    status: (project.status ?? 'active') as 'active' | 'dormant' | 'done',
    path: project.path,
    workspacePath: project.workspacePath,
  };
}

/**
 * Migrate v1 organization storage to v2. Existing departments, teams, projects
 * and chats are never deleted: chats are only re-parented onto a project.
 */
export function migrateOrgStorageV2(
  hierarchy: OrgHierarchy,
  projects: OrgProject[],
  conversations: OrgConversation[],
  storedVersion: number
): OrgMigrationResult {
  const report: OrgMigrationReport[] = [];
  if (storedVersion >= ORG_STORAGE_VERSION) {
    return {
      hierarchy,
      projects,
      conversations,
      migrated: false,
      report: [{ step: 'normalize', detail: 'storage already at v2' }],
    };
  }

  let nextHierarchy = {
    ...hierarchy,
    departments: hierarchy.departments.map((department) => ensurePmAgent(department, report)),
  };
  let nextProjects = projects.map(normalizeProjectV2);
  let nextConversations = conversations.map((conversation) => ({ ...conversation }));

  // Index teams by id with their parent department.
  const teamById = new Map<string, { department: OrgDepartmentNode; team: OrgTeamNode }>();
  for (const department of nextHierarchy.departments) {
    for (const team of department.teams) {
      teamById.set(team.id, { department, team });
    }
  }

  // Group node-attached, project-less chats by the team they belong to.
  // A chat is attributed to its target team first, then its source team.
  // Root CEO directives (sourceNodeId === 'root-ceo') stay unattached.
  const chatsByTeam = new Map<string, OrgConversation[]>();
  for (const conversation of nextConversations) {
    if (conversation.projectId) continue;
    const targetTeam = teamById.has(conversation.targetNodeId) ? conversation.targetNodeId : undefined;
    const sourceTeam = teamById.has(conversation.sourceNodeId) ? conversation.sourceNodeId : undefined;
    const teamId = targetTeam ?? sourceTeam;
    if (!teamId) continue;
    const list = chatsByTeam.get(teamId) ?? [];
    list.push(conversation);
    chatsByTeam.set(teamId, list);
  }

  // Ensure at most one team-named project per team; create one when missing.
  for (const [teamId, chats] of chatsByTeam) {
    const { department, team } = teamById.get(teamId)!;
    // Prefer the project already linked to the team, then a same-name project,
    // otherwise create a new project named after the team.
    let projectId =
      nextProjects.find((project) => project.departmentId === department.id && project.id === team.linkedProjectId)
        ?.id ??
      nextProjects.find(
        (project) =>
          project.departmentId === department.id && project.name === team.name && project.teamIds.includes(teamId)
      )?.id;
    if (!projectId) {
      projectId = `proj-team-${team.id}`;
      nextProjects.push({
        id: projectId,
        name: team.name,
        departmentId: department.id,
        teamIds: [teamId],
        goal: team.description,
        workspacePath: team.workspacePath ?? null,
        status: 'active',
      });
      report.push({ step: 'team-project', detail: `Created project "${team.name}" for chats of team ${team.name}` });
    } else if (!nextProjects.find((project) => project.id === projectId)?.teamIds.includes(teamId)) {
      // Make sure the team is recorded on the project it now owns.
      const project = nextProjects.find((project) => project.id === projectId)!;
      project.teamIds = Array.from(new Set([...project.teamIds, teamId]));
    }
    for (const conversation of chats) {
      conversation.projectId = projectId;
      conversation.teamId = teamId;
      report.push({ step: 'reparent-chat', detail: `Moved chat "${conversation.title}" into project "${team.name}"` });
    }
  }

  return {
    hierarchy: nextHierarchy,
    projects: nextProjects,
    conversations: nextConversations,
    migrated: true,
    report,
  };
}

export interface OrgConversationReconciliationResult {
  projects: OrgProject[];
  conversations: OrgConversation[];
  migratedCount: number;
}

/**
 * Assigns projectId to conversations that lack one.
 *
 * Rules:
 * - Root CEO conversations (sourceNodeId or targetNodeId === 'root-ceo') stay without projectId.
 * - Match via team: if sourceNodeId or targetNodeId is a team id, use that team's project.
 * - Fall back to the department's "General" project (created if missing).
 * - When a conversation is assigned to the "General" project, its team is linked to that project.
 */
export function reconcileConversationsWithProjects(
  hierarchy: OrgHierarchy,
  projects: OrgProject[],
  conversations: OrgConversation[]
): OrgConversationReconciliationResult {
  // Normalize legacy teamId -> teamIds
  const normalizedProjects = projects.map(normalizeOrgProject);

  // Build team -> department map
  const teamToDept = new Map<string, OrgDepartmentNode>();
  for (const dept of hierarchy.departments) {
    for (const team of dept.teams) {
      teamToDept.set(team.id, dept);
    }
  }

  // Ensure each department has a "General" project
  let nextProjects = [...normalizedProjects];
  for (const dept of hierarchy.departments) {
    const hasGeneral = nextProjects.some((p) => p.departmentId === dept.id && p.name === 'General');
    if (!hasGeneral) {
      const generalProject: OrgProject = {
        id: `proj-general-${dept.id}`,
        name: 'General',
        departmentId: dept.id,
        teamIds: [],
        description: 'Default project for unassigned conversations',
        status: 'active',
      };
      nextProjects.push(generalProject);
    }
  }

  // Build team -> first project id map
  const teamToProject = new Map<string, string>();
  for (const proj of nextProjects) {
    for (const teamId of proj.teamIds) {
      if (!teamToProject.has(teamId)) {
        teamToProject.set(teamId, proj.id);
      }
    }
  }

  // Assign projectId to conversations lacking it
  let migratedCount = 0;
  const nextConversations = conversations.map((conv) => {
    // Root CEO chats stay under Root CEO (no project)
    if (conv.sourceNodeId === 'root-ceo' || conv.targetNodeId === 'root-ceo') {
      return conv;
    }
    if (conv.projectId) return conv;

    // Try to match via team (sourceNodeId or targetNodeId is a team)
    const teamId = teamToDept.has(conv.sourceNodeId)
      ? conv.sourceNodeId
      : teamToDept.has(conv.targetNodeId)
        ? conv.targetNodeId
        : undefined;

    let projectId: string | undefined;
    if (teamId) {
      projectId = teamToProject.get(teamId);
    }

    // Fall back to department's "General" project
    if (!projectId && teamId) {
      const dept = teamToDept.get(teamId)!;
      const general = nextProjects.find((p) => p.departmentId === dept.id && p.name === 'General');
      if (general) {
        projectId = general.id;
        // Link the team to the General project so it appears under the team
        if (!general.teamIds.includes(teamId)) {
          general.teamIds = [...general.teamIds, teamId];
        }
      }
    }

    if (projectId && projectId !== conv.projectId) {
      migratedCount++;
      return { ...conv, projectId, teamId: teamId ?? conv.teamId };
    }
    return conv;
  });

  return { projects: nextProjects, conversations: nextConversations, migratedCount };
}
