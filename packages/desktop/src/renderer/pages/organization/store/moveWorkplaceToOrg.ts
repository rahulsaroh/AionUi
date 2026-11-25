/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { memberHandbook } from '@/common/adapter/ipcBridge';
import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import type { TeamAssistant, TTeam } from '@/common/types/team/teamTypes';
import { emitter } from '@/renderer/utils/emitter';
import type {
  OrgAgentMember,
  OrgConversation,
  OrgConversationMessage,
  OrgDepartmentNode,
  OrgProject,
  OrgTeamNode,
} from '@/types/organization';
import { createProjectBackendTeam } from './orgBackendTeam';
import { commitOrganizationImport, getOrgStoreSnapshot } from './useOrgStore';
import { addProjectMemberSource, createDepartmentShell, normalizeOrgProject } from '../utils/orgCoherence';
import { getDefaultDeptPath, joinOrgPath, sanitizeFolderName, validateOrgFolder } from '../utils/orgPathUtils';

export type FileTransferChoice = 'move' | 'copy' | 'none';

export type MoveWorkplaceTeamParams = {
  team: TTeam;
  subTeams?: TTeam[];
  departmentId?: string;
  newDepartmentName?: string;
  targetName?: string;
  description?: string;
  targetWorkspace?: string;
  fileTransferMode?: FileTransferChoice;
  createLinkedProject?: boolean;
};

export type MoveWorkplaceProjectParams = {
  projectName: string;
  sourceWorkspace: string;
  conversations: TChatConversation[];
  departmentId?: string;
  newDepartmentName?: string;
  description?: string;
  targetWorkspace?: string;
  fileTransferMode?: FileTransferChoice;
  removeFromWorkplace?: boolean;
  userId?: string;
};

export type MoveToOrgResult = {
  departmentId: string;
  orgTeamId?: string;
  orgProjectId?: string;
  movedTeamIds: string[];
  movedConversationIds: string[];
  workspacePath?: string | null;
  status: 'active' | 'dormant';
};

function pathsEqual(a: string, b: string): boolean {
  const normA = a
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/');
  const normB = b
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/');
  return normA.toLowerCase() === normB.toLowerCase();
}

function getRelativeSubpath(rootPath: string, childPath: string): string | null {
  const normRoot = rootPath
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/');
  const normChild = childPath
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/');
  if (normChild.toLowerCase() === normRoot.toLowerCase()) return '';
  if (normChild.toLowerCase().startsWith(`${normRoot.toLowerCase()}/`)) {
    return normChild.slice(normRoot.length + 1);
  }
  return null;
}

async function resolveMasterRoot(): Promise<string | null> {
  const snapshot = getOrgStoreSnapshot();
  if (snapshot.hierarchy.rootCeo.workspacePath) {
    return snapshot.hierarchy.rootCeo.workspacePath;
  }
  try {
    return (await ipcBridge.org.getMasterRoot()) || null;
  } catch {
    return null;
  }
}

async function resolveTargetDepartment(params: {
  departmentId?: string;
  newDepartmentName?: string;
  masterRoot: string | null;
}): Promise<{ department: OrgDepartmentNode; isNew: boolean }> {
  const snapshot = getOrgStoreSnapshot();
  if (params.departmentId) {
    const existing = snapshot.hierarchy.departments.find((d) => d.id === params.departmentId);
    if (!existing) {
      throw new Error('Selected department was not found.');
    }
    return { department: existing, isNew: false };
  }

  const trimmedDeptName = params.newDepartmentName?.trim();
  if (!trimmedDeptName) {
    throw new Error('Please select or create a target department.');
  }

  const duplicate = snapshot.hierarchy.departments.find(
    (d) => d.name.trim().toLowerCase() === trimmedDeptName.toLowerCase()
  );
  if (duplicate) {
    return { department: duplicate, isNew: false };
  }

  let dept = createDepartmentShell(trimmedDeptName, snapshot.hierarchy.rootCeo.ceoAgent.model);
  if (params.masterRoot) {
    const candidatePath = getDefaultDeptPath(params.masterRoot, trimmedDeptName);
    const check = await validateOrgFolder(candidatePath, params.masterRoot, 'department');
    if (check.valid && check.resolvedPath) {
      dept = {
        ...dept,
        workspacePath: check.resolvedPath,
        departmentCeoAgent: {
          ...dept.departmentCeoAgent,
          workspacePath: check.resolvedPath,
        },
      };
    }
  }
  return { department: dept, isNew: true };
}

async function resolveAndTransferWorkspace(params: {
  sourceWorkspace?: string | null;
  requestedWorkspace?: string | null;
  department: OrgDepartmentNode;
  masterRoot: string | null;
  fileTransferMode: FileTransferChoice;
}): Promise<{ workspacePath: string | null; status: 'active' | 'dormant'; note?: string }> {
  const source = params.sourceWorkspace?.trim() || '';
  const requested = params.requestedWorkspace?.trim() || '';
  const parentRoot = params.department.workspacePath || params.masterRoot || null;

  if (!requested && !source) {
    return { workspacePath: null, status: 'active' };
  }

  if (!parentRoot) {
    return {
      workspacePath: null,
      status: source ? 'dormant' : 'active',
      note: source ? `Original workplace folder: ${source}` : undefined,
    };
  }

  const targetCandidate = requested || source;
  const validation = await validateOrgFolder(targetCandidate, parentRoot, 'project');
  if (!validation.valid || !validation.resolvedPath) {
    throw new Error(
      validation.error || `Target folder "${targetCandidate}" must be inside the organization root "${parentRoot}".`
    );
  }

  const finalPath = validation.resolvedPath;
  if (source && !pathsEqual(source, finalPath) && params.fileTransferMode !== 'none') {
    await ipcBridge.fs.transferWorkspaceFiles.invoke({
      sourcePath: source,
      targetPath: finalPath,
      operation: params.fileTransferMode === 'move' ? 'move' : 'copy',
    });
  }

  return { workspacePath: finalPath, status: 'active' };
}

function mapTeamAssistantToOrgMember(params: {
  assistant: TeamAssistant;
  orgTeamId: string;
  role: 'team_lead' | 'specialist';
  workspacePath: string | null;
  departmentId: string;
  titleFallback: string;
}): OrgAgentMember {
  const { assistant, orgTeamId, role, workspacePath, departmentId, titleFallback } = params;
  const now = Date.now();
  const id = `agent-slot-${assistant.slot_id || `${orgTeamId}-${Math.random().toString(36).slice(2, 7)}`}`;
  const canonicalBase = assistant.assistant_id || assistant.slot_id || id;
  return {
    id,
    canonicalAgentId: `canonical-${canonicalBase}`,
    name: assistant.assistant_name?.trim() || titleFallback,
    role,
    title: assistant.whenToUseHint?.trim() || titleFallback,
    icon: assistant.icon,
    assistant_backend: assistant.assistant_backend || 'aionrs',
    assignedTeamIds: [orgTeamId],
    backendSlotId: assistant.slot_id || undefined,
    model: assistant.model ? { modelId: assistant.model } : undefined,
    skills: assistant.learnedSkills?.map((skill) => skill.title).filter(Boolean),
    workspacePath,
    departmentId,
    lastActiveAt: now,
    status: 'idle',
  };
}

function buildOrgTeamFromWorkplaceTeam(params: {
  team: TTeam;
  departmentId: string;
  displayName: string;
  description?: string;
  workspacePath: string | null;
}): { orgTeam: OrgTeamNode; members: OrgAgentMember[] } {
  const { team, departmentId, displayName, description, workspacePath } = params;
  const now = Date.now();
  const orgTeamId = `team-${now}-${Math.random().toString(36).slice(2, 6)}`;
  const assistants = team.assistants ?? [];
  const leaderAssistant =
    assistants.find((a) => a.slot_id === team.leader_assistant_id) ||
    assistants.find((a) => a.role === 'leader') ||
    assistants[0];

  const teamLeadAgent: OrgAgentMember = leaderAssistant
    ? mapTeamAssistantToOrgMember({
        assistant: leaderAssistant,
        orgTeamId,
        role: 'team_lead',
        workspacePath,
        departmentId,
        titleFallback: team.departmentRole?.trim() || 'Team Lead',
      })
    : {
        id: `lead-${orgTeamId}`,
        canonicalAgentId: `canonical-lead-${orgTeamId}`,
        name: `${displayName} Lead`,
        role: 'team_lead',
        title: team.departmentRole?.trim() || 'Team Lead',
        assignedTeamIds: [orgTeamId],
        workspacePath,
        departmentId,
        lastActiveAt: now,
        status: 'idle',
        assistant_backend: 'aionrs',
      };

  const specialistMembers: OrgAgentMember[] = assistants
    .filter((a) => a !== leaderAssistant)
    .map((assistant) =>
      mapTeamAssistantToOrgMember({
        assistant,
        orgTeamId,
        role: 'specialist',
        workspacePath,
        departmentId,
        titleFallback: 'Specialist',
      })
    );

  const orgTeam: OrgTeamNode = {
    id: orgTeamId,
    departmentId,
    name: displayName,
    description: description?.trim() || team.description?.trim() || undefined,
    teamLeadAgent,
    specialistMembers,
    members: [teamLeadAgent, ...specialistMembers],
    workspacePath,
    workspacePaths: workspacePath ? [workspacePath] : undefined,
    backendTeamId: team.id,
    lastActiveAt: now,
    status: 'idle',
  };

  return { orgTeam, members: [teamLeadAgent, ...specialistMembers] };
}

function extractMessageText(message: TMessage): string | null {
  if (message.hidden) return null;
  if (message.type === 'text') {
    const raw = (message.content as { content?: unknown } | undefined)?.content;
    if (typeof raw === 'string' && raw.trim()) {
      return raw;
    }
  }
  return null;
}

function mapMessagesToOrgMessages(messages: TMessage[], assistantName: string): OrgConversationMessage[] {
  const mapped: OrgConversationMessage[] = [];
  for (const msg of messages) {
    const text = extractMessageText(msg);
    if (!text) continue;
    const isUser = msg.position === 'right';
    mapped.push({
      id: msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sender: isUser ? 'User' : assistantName,
      role: isUser ? 'user' : 'assistant',
      content: text,
      timestamp: msg.created_at ?? Date.now(),
    });
  }
  return mapped;
}

/**
 * Computes a default folder inside the target department/master root for a moved item.
 */
export function suggestOrgTargetWorkspace(params: {
  itemName: string;
  department?: OrgDepartmentNode | null;
  masterRoot?: string | null;
}): string {
  const parentRoot = params.department?.workspacePath || params.masterRoot || '';
  if (!parentRoot) return '';
  return joinOrgPath(parentRoot, sanitizeFolderName(params.itemName));
}

/**
 * Moves a Workplace Team (and optionally its descendant sub-teams) into an Organization Department.
 * Preserves the underlying AionCore team (`backendTeamId`), its assistants, skills, and workspace.
 */
export async function moveWorkplaceTeamToOrg(params: MoveWorkplaceTeamParams): Promise<MoveToOrgResult> {
  const targetName = (params.targetName ?? params.team.name).trim();
  if (!targetName) {
    throw new Error('Team name cannot be empty.');
  }

  const masterRoot = await resolveMasterRoot();
  const { department, isNew } = await resolveTargetDepartment({
    departmentId: params.departmentId,
    newDepartmentName: params.newDepartmentName,
    masterRoot,
  });

  const fileTransferMode: FileTransferChoice = params.fileTransferMode ?? 'copy';
  const workspaceResult = await resolveAndTransferWorkspace({
    sourceWorkspace: params.team.workspace,
    requestedWorkspace: params.targetWorkspace,
    department,
    masterRoot,
    fileTransferMode,
  });

  const allSourceTeams: Array<{ team: TTeam; isRoot: boolean; resolvedWorkspace: string | null }> = [
    { team: params.team, isRoot: true, resolvedWorkspace: workspaceResult.workspacePath },
  ];

  const parentRoot = department.workspacePath || masterRoot || null;
  for (const subTeam of params.subTeams ?? []) {
    let subWorkspace: string | null = null;
    if (subTeam.workspace?.trim()) {
      const rel =
        params.team.workspace && workspaceResult.workspacePath
          ? getRelativeSubpath(params.team.workspace, subTeam.workspace)
          : null;
      if (rel !== null && workspaceResult.workspacePath) {
        subWorkspace = rel ? joinOrgPath(workspaceResult.workspacePath, rel) : workspaceResult.workspacePath;
      } else if (parentRoot) {
        const subCheck = await validateOrgFolder(subTeam.workspace, parentRoot, 'team');
        if (subCheck.valid && subCheck.resolvedPath) {
          subWorkspace = subCheck.resolvedPath;
        } else {
          const fallbackSubPath = joinOrgPath(
            workspaceResult.workspacePath || parentRoot,
            sanitizeFolderName(subTeam.name)
          );
          if (fileTransferMode !== 'none') {
            await ipcBridge.fs.transferWorkspaceFiles.invoke({
              sourcePath: subTeam.workspace,
              targetPath: fallbackSubPath,
              operation: fileTransferMode === 'move' ? 'move' : 'copy',
            });
          }
          subWorkspace = fallbackSubPath;
        }
      }
    }
    allSourceTeams.push({ team: subTeam, isRoot: false, resolvedWorkspace: subWorkspace });
  }

  const addedTeams: Array<{ departmentId: string; team: OrgTeamNode }> = [];
  const addedMembers: OrgAgentMember[] = [];
  const movedTeamIds: string[] = [];

  for (const entry of allSourceTeams) {
    const displayName = entry.isRoot ? targetName : entry.team.name;
    const desc = entry.isRoot ? (params.description ?? entry.team.description) : entry.team.description;

    // Update the backend team record so it carries the Organization mode and updated workspace/name.
    await ipcBridge.team.updateTeam.invoke({
      id: entry.team.id,
      ...(displayName !== entry.team.name ? { name: displayName } : {}),
      ...(entry.resolvedWorkspace && entry.resolvedWorkspace !== entry.team.workspace
        ? { workspace: entry.resolvedWorkspace }
        : {}),
      ...(desc !== undefined && desc !== entry.team.description ? { description: desc } : {}),
      parent_id: null,
      mode: 'organization',
    });

    const { orgTeam, members } = buildOrgTeamFromWorkplaceTeam({
      team: entry.team,
      departmentId: department.id,
      displayName,
      description: desc,
      workspacePath: entry.resolvedWorkspace,
    });
    addedTeams.push({ departmentId: department.id, team: orgTeam });
    addedMembers.push(...members);
    movedTeamIds.push(entry.team.id);
  }

  const rootOrgTeam = addedTeams[0].team;
  const createLinkedProject = params.createLinkedProject !== false;
  let createdProject: OrgProject | undefined;

  if (createLinkedProject) {
    const now = Date.now();
    const rawProjectId = `proj-${now}-${Math.random().toString(36).slice(2, 6)}`;
    let project: OrgProject = {
      id: rawProjectId,
      name: targetName,
      departmentId: department.id,
      teamIds: [rootOrgTeam.id],
      backendTeamId: params.team.id,
      description: params.description?.trim() || params.team.description?.trim() || undefined,
      goal: params.description?.trim() || params.team.description?.trim() || undefined,
      path: workspaceResult.workspacePath || undefined,
      workspacePath: workspaceResult.workspacePath,
      workspacePaths: workspaceResult.workspacePath ? [workspaceResult.workspacePath] : [],
      context: {
        ...(workspaceResult.workspacePath ? { workspacePaths: [workspaceResult.workspacePath] } : {}),
        ...(workspaceResult.note ? { notes: workspaceResult.note } : {}),
      },
      leadAssistantId: params.team.assistants.find((a) => a.slot_id === params.team.leader_assistant_id)?.assistant_id,
      model: rootOrgTeam.teamLeadAgent.model,
      status: workspaceResult.status,
      mode: 'organization',
      createdAt: now,
      updatedAt: now,
    };
    for (const member of [rootOrgTeam.teamLeadAgent, ...rootOrgTeam.specialistMembers]) {
      project = addProjectMemberSource(project, member.id, rootOrgTeam.id);
    }
    createdProject = normalizeOrgProject(project);
  }

  await commitOrganizationImport({
    newDepartment: isNew ? department : undefined,
    addedTeams,
    addedProjects: createdProject ? [createdProject] : undefined,
    addedMembers,
  });

  // Best-effort handbook creation for moved members so Organization runtime can inject them cleanly.
  for (const member of addedMembers) {
    void memberHandbook
      .create({
        memberKey: `org:${member.id}`,
        memberName: member.name,
        role: member.role,
        seedPrompt: member.systemPrompt,
        model: member.model?.modelId,
      })
      .catch(() => {});
  }

  return {
    departmentId: department.id,
    orgTeamId: rootOrgTeam.id,
    orgProjectId: createdProject?.id,
    movedTeamIds,
    movedConversationIds: [],
    workspacePath: workspaceResult.workspacePath,
    status: workspaceResult.status,
  };
}

/**
 * Moves a Workplace Project (workspace folder + its conversation threads) into an Organization Department.
 */
export async function moveWorkplaceProjectToOrg(params: MoveWorkplaceProjectParams): Promise<MoveToOrgResult> {
  const projectName = params.projectName.trim();
  if (!projectName) {
    throw new Error('Project name cannot be empty.');
  }

  const masterRoot = await resolveMasterRoot();
  const { department, isNew } = await resolveTargetDepartment({
    departmentId: params.departmentId,
    newDepartmentName: params.newDepartmentName,
    masterRoot,
  });

  const fileTransferMode: FileTransferChoice = params.fileTransferMode ?? 'copy';
  const workspaceResult = await resolveAndTransferWorkspace({
    sourceWorkspace: params.sourceWorkspace,
    requestedWorkspace: params.targetWorkspace,
    department,
    masterRoot,
    fileTransferMode,
  });

  let backendTeamId: string | undefined;
  if (workspaceResult.workspacePath && masterRoot) {
    try {
      backendTeamId = await createProjectBackendTeam({
        name: projectName,
        workspacePath: workspaceResult.workspacePath,
        description: params.description?.trim() || undefined,
        masterRoot,
        userId: params.userId ?? 'system_default_user',
      });
    } catch (err) {
      console.warn('[moveWorkplaceProjectToOrg] Backend team initialization skipped:', err);
    }
  }

  const now = Date.now();
  const orgProjectId = `proj-${now}-${Math.random().toString(36).slice(2, 6)}`;
  const orgProject = normalizeOrgProject({
    id: orgProjectId,
    name: projectName,
    departmentId: department.id,
    teamIds: [],
    backendTeamId,
    description: params.description?.trim() || undefined,
    goal: params.description?.trim() || undefined,
    path: workspaceResult.workspacePath || undefined,
    workspacePath: workspaceResult.workspacePath,
    workspacePaths: workspaceResult.workspacePath ? [workspaceResult.workspacePath] : [],
    context: {
      ...(workspaceResult.workspacePath ? { workspacePaths: [workspaceResult.workspacePath] } : {}),
      ...(workspaceResult.note ? { notes: workspaceResult.note } : {}),
    },
    status: workspaceResult.status,
    mode: 'organization',
    createdAt: now,
    updatedAt: now,
  });

  const targetAgent = department.pmAgent || department.departmentCeoAgent;
  const importedConversations: OrgConversation[] = [];
  const movedConversationIds: string[] = [];
  const removeFromWorkplace = params.removeFromWorkplace !== false;

  for (const conv of params.conversations) {
    let messages: OrgConversationMessage[] = [];
    try {
      const page = await ipcBridge.database.getConversationMessages.invoke({
        conversation_id: conv.id,
        limit: 200,
      });
      if (page?.items?.length) {
        messages = mapMessagesToOrgMessages(page.items, targetAgent.name);
      }
    } catch (err) {
      console.warn('[moveWorkplaceProjectToOrg] Failed to load messages for conversation:', conv.id, err);
    }

    const orgConvId = `conv-wp-${conv.id}-${now}`;
    importedConversations.push({
      id: orgConvId,
      title: conv.name || projectName,
      projectId: orgProject.id,
      departmentId: department.id,
      backendConversationId: removeFromWorkplace ? conv.id : undefined,
      type: 'team_execution',
      sourceNodeId: department.id,
      targetNodeId: orgProject.id,
      targetAgentId: targetAgent.id,
      targetAgentName: targetAgent.name,
      targetRole: targetAgent.role,
      targetAgentModel: targetAgent.model,
      timestamp: conv.modified_at || conv.created_at || now,
      summary: '',
      messages,
      mode: 'organization',
      createdAt: conv.created_at || now,
      updatedAt: conv.modified_at || now,
    });

    if (removeFromWorkplace) {
      await ipcBridge.conversation.update.invoke({
        id: conv.id,
        updates: {
          extra: {
            mode: 'organization',
            orgConversationId: orgConvId,
            ...(workspaceResult.workspacePath ? { workspace: workspaceResult.workspacePath } : {}),
          } as Partial<TChatConversation['extra']>,
        } as Partial<TChatConversation>,
        merge_extra: true,
      });
      movedConversationIds.push(conv.id);
    }
  }

  await commitOrganizationImport({
    newDepartment: isNew ? department : undefined,
    addedProjects: [orgProject],
    addedConversations: importedConversations,
  });

  if (removeFromWorkplace && movedConversationIds.length > 0) {
    emitter.emit('chat.history.refresh');
  }

  return {
    departmentId: department.id,
    orgProjectId: orgProject.id,
    movedTeamIds: [],
    movedConversationIds,
    workspacePath: workspaceResult.workspacePath,
    status: workspaceResult.status,
  };
}
