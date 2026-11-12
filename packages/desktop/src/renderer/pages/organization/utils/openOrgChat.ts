/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  OrgAgentMember,
  OrgConversation,
  OrgDepartmentNode,
  OrgHierarchy,
  OrgProject,
  OrgTeamNode,
} from '@/types/organization';
import { createTeamShell } from './orgCoherence';
import type { OrgChatTarget } from './agentTurn';

export interface ResolvedChatTarget {
  agent: OrgAgentMember;
  conversation: OrgConversation;
  departmentId?: string;
  teamId?: string;
  projectId?: string;
  workspacePath?: string;
  mutatedHierarchy?: OrgHierarchy;
  /** If project head was created, project may need teamIds updated */
  updatedProject?: OrgProject;
}

function findLatestThread(
  conversations: OrgConversation[],
  predicate: (c: OrgConversation) => boolean
): OrgConversation | undefined {
  return conversations.filter(predicate).toSorted((a, b) => b.timestamp - a.timestamp)[0];
}

function projectHeadAgent(
  project: OrgProject,
  hierarchy: OrgHierarchy
): { agent: OrgAgentMember | null; team?: OrgTeamNode; dept?: OrgDepartmentNode } {
  const dept = hierarchy.departments.find((d) => d.id === project.departmentId);
  const team = dept?.teams.find((t) => project.teamIds?.includes(t.id));
  if (team?.teamLeadAgent) return { agent: team.teamLeadAgent, team, dept };
  if (dept?.departmentCeoAgent) return { agent: dept.departmentCeoAgent, dept };
  if (dept?.pmAgent) return { agent: dept.pmAgent, dept };
  return { agent: hierarchy.rootCeo.ceoAgent, dept };
}

export function resolveOrgChatTarget(
  target: OrgChatTarget,
  hierarchy: OrgHierarchy,
  projects: OrgProject[],
  conversations: OrgConversation[],
  t: (key: string, opts?: Record<string, unknown>) => string
): ResolvedChatTarget | { error: string } {
  const now = Date.now();

  if (target.type === 'ceo') {
    const agent = hierarchy.rootCeo.ceoAgent;
    const existing = findLatestThread(
      conversations,
      (c) =>
        c.type === 'ceo_directive' && !c.projectId && (c.targetAgentId === agent.id || c.targetNodeId === 'root-ceo')
    );
    const conv: OrgConversation = existing ?? {
      id: `conv-ceo-${now}`,
      title: t('team.organization.newChat', { defaultValue: 'New chat' }),
      type: 'ceo_directive',
      sourceNodeId: 'root-ceo',
      targetNodeId: 'root-ceo',
      targetAgentId: agent.id,
      targetRole: agent.role || 'ceo',
      targetAgentName: agent.name,
      targetAgentModel: agent.model,
      timestamp: now,
      summary: '',
      messages: [],
    };
    return { agent, conversation: conv, workspacePath: hierarchy.rootCeo.workspacePath || undefined };
  }

  if (target.type === 'department_head') {
    const dept = hierarchy.departments.find((d) => d.id === target.id);
    if (!dept) return { error: t('team.organization.agentNotFound', { defaultValue: 'Agent could not be resolved' }) };
    const agent = dept.departmentCeoAgent || dept.pmAgent;
    if (!agent) return { error: t('team.organization.agentNotFound', { defaultValue: 'Agent could not be resolved' }) };
    const existing = findLatestThread(conversations, (c) => c.targetAgentId === agent.id && !c.projectId);
    const conv: OrgConversation = existing ?? {
      id: `conv-dept-${dept.id}-${now}`,
      title: t('team.organization.newChat', { defaultValue: 'New chat' }),
      type: 'agent_direct',
      departmentId: dept.id,
      sourceNodeId: dept.id,
      targetNodeId: dept.id,
      targetAgentId: agent.id,
      targetRole: 'department_head',
      targetAgentName: agent.name,
      targetAgentModel: agent.model,
      timestamp: now,
      summary: '',
      messages: [],
    };
    return {
      agent,
      conversation: conv,
      departmentId: dept.id,
      workspacePath: dept.workspacePath || hierarchy.rootCeo.workspacePath || undefined,
    };
  }

  if (target.type === 'project_head') {
    const project = projects.find((p) => p.id === target.id);
    if (!project)
      return { error: t('team.organization.agentNotFound', { defaultValue: 'Agent could not be resolved' }) };
    let mutatedHierarchy: OrgHierarchy | undefined;
    let hierarchyRef = hierarchy;
    let updatedProject: OrgProject | undefined;
    const dept = hierarchyRef.departments.find((d) => d.id === project.departmentId);
    let team = dept?.teams.find((tm) => project.teamIds?.includes(tm.id));

    if (!team && dept) {
      const newTeam = createTeamShell(dept.id, 'Core', hierarchy.rootCeo.ceoAgent.model);
      newTeam.workspacePath = project.workspacePath || project.path || dept.workspacePath || null;
      hierarchyRef = {
        ...hierarchyRef,
        lastUpdated: Date.now(),
        departments: hierarchyRef.departments.map((d) =>
          d.id === dept.id ? { ...d, teams: [...d.teams, newTeam], lastActiveAt: Date.now() } : d
        ),
      };
      mutatedHierarchy = hierarchyRef;
      team = newTeam;
      updatedProject = { ...project, teamIds: [...(project.teamIds || []), newTeam.id] };
    }

    const { agent } = projectHeadAgent(updatedProject || project, hierarchyRef);
    if (!agent) return { error: t('team.organization.agentNotFound', { defaultValue: 'Agent could not be resolved' }) };

    const existing = findLatestThread(
      conversations,
      (c) => c.projectId === project.id && (c.targetAgentId === agent.id || c.type === 'team_execution')
    );
    const conv: OrgConversation = existing ?? {
      id: `conv-proj-${project.id}-${now}`,
      title: t('team.organization.newChat', { defaultValue: 'New chat' }),
      type: 'team_execution',
      sourceNodeId: team?.id || dept?.id || 'root-ceo',
      targetNodeId: team?.id || dept?.id || 'root-ceo',
      projectId: project.id,
      teamId: team?.id || (updatedProject || project).teamIds?.[0],
      targetAgentId: agent.id,
      targetRole: 'project_head',
      targetAgentName: agent.name,
      targetAgentModel: agent.model,
      timestamp: now,
      summary: '',
      messages: [],
    };
    return {
      agent,
      conversation: conv,
      departmentId: project.departmentId,
      teamId: team?.id || (updatedProject || project).teamIds?.[0],
      projectId: project.id,
      workspacePath:
        (updatedProject || project).workspacePath ||
        (updatedProject || project).path ||
        team?.workspacePath ||
        dept?.workspacePath ||
        hierarchyRef.rootCeo.workspacePath ||
        undefined,
      mutatedHierarchy,
      updatedProject,
    };
  }

  if (target.type === 'member') {
    let found: { agent: OrgAgentMember; dept?: OrgDepartmentNode; team?: OrgTeamNode } | null = null;
    for (const dept of hierarchy.departments) {
      if (dept.departmentCeoAgent.id === target.id) {
        found = { agent: dept.departmentCeoAgent, dept };
        break;
      }
      if (dept.pmAgent?.id === target.id) {
        found = { agent: dept.pmAgent, dept };
        break;
      }
      for (const team of dept.teams) {
        if (team.teamLeadAgent.id === target.id) {
          found = { agent: team.teamLeadAgent, dept, team };
          break;
        }
        if (team.hrCoordinatorAgent?.id === target.id) {
          found = { agent: team.hrCoordinatorAgent, dept, team };
          break;
        }
        const spec = team.specialistMembers.find((m) => m.id === target.id || m.canonicalAgentId === target.id);
        if (spec) {
          found = { agent: spec, dept, team };
          break;
        }
      }
      if (found) break;
    }
    if (!found && hierarchy.rootCeo.chiefOfStaffAgent?.id === target.id) {
      found = { agent: hierarchy.rootCeo.chiefOfStaffAgent };
    }
    if (!found) return { error: t('team.organization.agentNotFound', { defaultValue: 'Agent could not be resolved' }) };

    const project = target.projectId ? projects.find((p) => p.id === target.projectId) : undefined;
    const existing = findLatestThread(
      conversations,
      (c) => c.targetAgentId === found!.agent.id && c.projectId === project?.id && c.type === 'agent_direct'
    );
    const conv: OrgConversation = existing ?? {
      id: `conv-direct-${found.agent.id}-${now}`,
      title: t('team.organization.newChat', { defaultValue: 'New chat' }),
      type: 'agent_direct',
      sourceNodeId: found.team?.id || found.dept?.id || 'root-ceo',
      targetNodeId: found.agent.id,
      projectId: project?.id,
      teamId: found.team?.id || project?.teamIds?.[0],
      targetAgentId: found.agent.id,
      targetRole: found.agent.role,
      targetAgentName: found.agent.name,
      targetAgentModel: found.agent.model,
      timestamp: now,
      summary: '',
      messages: [],
    };
    return {
      agent: found.agent,
      conversation: conv,
      departmentId: found.dept?.id,
      teamId: found.team?.id || project?.teamIds?.[0],
      projectId: project?.id,
      workspacePath:
        project?.workspacePath ||
        project?.path ||
        found.team?.workspacePath ||
        found.dept?.workspacePath ||
        hierarchy.rootCeo.workspacePath ||
        undefined,
    };
  }

  return { error: t('team.organization.agentNotFound', { defaultValue: 'Agent could not be resolved' }) };
}
