/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  OrgAgentMember,
  OrgConversation,
  OrgDepartmentNode,
  OrgProject,
  OrgTeamNode,
} from '@/types/organization';

/**
 * Computes the derived roster for a department as the union of all members
 * assigned to any project in that department, plus the department head.
 * Guarantees no duplicate members.
 */
export function deriveDepartmentRoster(
  departmentId: string,
  projects: OrgProject[],
  allMembers: OrgAgentMember[],
  departmentHead?: OrgAgentMember | null
): OrgAgentMember[] {
  const deptProjects = projects.filter((p) => p.departmentId === departmentId);
  const memberIdSet = new Set<string>();

  for (const proj of deptProjects) {
    if (Array.isArray(proj.memberIds)) {
      for (const mid of proj.memberIds) {
        if (mid) memberIdSet.add(mid);
      }
    }
  }

  const memberMap = new Map<string, OrgAgentMember>();
  for (const m of allMembers) {
    memberMap.set(m.id, m);
  }

  const roster: OrgAgentMember[] = [];
  const addedIds = new Set<string>();

  if (departmentHead && departmentHead.id) {
    roster.push(departmentHead);
    addedIds.add(departmentHead.id);
  }

  for (const mid of memberIdSet) {
    if (!addedIds.has(mid)) {
      const member = memberMap.get(mid);
      if (member) {
        roster.push(member);
        addedIds.add(mid);
      }
    }
  }

  return roster;
}

export interface RosterMemberWithProjects {
  member: OrgAgentMember;
  projects: OrgProject[];
}

/**
 * Derives the department roster annotated with the list of projects each member works on.
 */
export function deriveDepartmentRosterWithProjects(
  departmentId: string,
  projects: OrgProject[],
  allMembers: OrgAgentMember[],
  departmentHead?: OrgAgentMember | null
): RosterMemberWithProjects[] {
  const deptProjects = projects.filter((p) => p.departmentId === departmentId);
  const memberProjectsMap = new Map<string, OrgProject[]>();

  for (const proj of deptProjects) {
    if (Array.isArray(proj.memberIds)) {
      for (const mid of proj.memberIds) {
        if (!memberProjectsMap.has(mid)) {
          memberProjectsMap.set(mid, []);
        }
        memberProjectsMap.get(mid)!.push(proj);
      }
    }
  }

  const roster = deriveDepartmentRoster(departmentId, projects, allMembers, departmentHead);
  return roster.map((member) => ({
    member,
    projects: memberProjectsMap.get(member.id) || [],
  }));
}

/** Lead, coordinator, and specialists on one team, without duplicate ids. */
export function teamRoster(team: OrgTeamNode): OrgAgentMember[] {
  const raw = [
    team.teamLeadAgent,
    team.hrCoordinatorAgent,
    ...(team.specialistMembers ?? []),
    ...(team.members ?? []),
  ];
  const seen = new Set<string>();
  const roster: OrgAgentMember[] = [];
  for (const member of raw) {
    if (!member?.id || seen.has(member.id)) continue;
    seen.add(member.id);
    roster.push(member);
  }
  return roster;
}

/** One row per person in a department, even when they sit on more than one team. */
export function listDepartmentTeamMembers(department: OrgDepartmentNode): OrgAgentMember[] {
  return uniqueMembersByCanonical(department.teams.flatMap((team) => teamRoster(team)));
}

/**
 * People assigned to a project.
 * Explicit `memberIds` win. Otherwise the roster is everyone on the project's teams.
 */
export function listProjectTeamMembers(
  project: OrgProject,
  department: OrgDepartmentNode | undefined,
  allMembers: OrgAgentMember[]
): OrgAgentMember[] {
  const explicitIds = (project.memberIds ?? []).filter((id) => id.length > 0);
  if (explicitIds.length > 0) {
    const wanted = new Set(explicitIds);
    return uniqueMembersByCanonical(
      allMembers.filter((member) => wanted.has(member.id) || wanted.has(member.canonicalAgentId))
    );
  }
  const teamIds = new Set(project.teamIds ?? []);
  const teams = (department?.teams ?? []).filter((team) => teamIds.has(team.id));
  return uniqueMembersByCanonical(teams.flatMap((team) => teamRoster(team)));
}

/**
 * Sessions with this person, newest first.
 * Pass `projectId` to keep only that project's sessions.
 * Team threads that never name a person stay with that team's lead.
 */
export function chatsWithMember(
  conversations: OrgConversation[],
  member: OrgAgentMember,
  allMembers: OrgAgentMember[],
  options?: { projectId?: string; departments?: OrgDepartmentNode[] }
): OrgConversation[] {
  const keys = memberIdentityKeys(member, allMembers);
  const knownMemberIds = new Set<string>();
  for (const candidate of allMembers) {
    if (candidate.id) knownMemberIds.add(candidate.id);
    if (candidate.canonicalAgentId) knownMemberIds.add(candidate.canonicalAgentId);
  }
  const leadTeamIds = new Set(leadTeamIdsFor(member, options?.departments ?? []));

  return conversations
    .filter((conversation) => {
      if (options?.projectId && conversation.projectId !== options.projectId) return false;
      const refs = conversationRefs(conversation);
      if (refs.some((id) => keys.has(id))) return true;
      if (refs.some((id) => knownMemberIds.has(id))) return false;
      return Boolean(conversation.teamId && leadTeamIds.has(conversation.teamId));
    })
    .toSorted((a, b) => b.timestamp - a.timestamp);
}

function uniqueMembersByCanonical(members: OrgAgentMember[]): OrgAgentMember[] {
  const seen = new Set<string>();
  const result: OrgAgentMember[] = [];
  for (const member of members) {
    const key = member.canonicalAgentId || member.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(member);
  }
  return result;
}

function memberIdentityKeys(member: OrgAgentMember, allMembers: OrgAgentMember[]): Set<string> {
  const keys = new Set<string>();
  if (member.id) keys.add(member.id);
  if (member.canonicalAgentId) keys.add(member.canonicalAgentId);
  for (const candidate of allMembers) {
    const samePerson =
      candidate.id === member.id ||
      (Boolean(member.canonicalAgentId) && candidate.canonicalAgentId === member.canonicalAgentId);
    if (!samePerson) continue;
    if (candidate.id) keys.add(candidate.id);
    if (candidate.canonicalAgentId) keys.add(candidate.canonicalAgentId);
  }
  return keys;
}

function conversationRefs(conversation: OrgConversation): string[] {
  return [conversation.targetAgentId, conversation.agentId, conversation.targetNodeId].filter(
    (id): id is string => Boolean(id)
  );
}

function leadTeamIdsFor(member: OrgAgentMember, departments: OrgDepartmentNode[]): string[] {
  const ids: string[] = [];
  for (const department of departments) {
    for (const team of department.teams) {
      const lead = team.teamLeadAgent;
      if (!lead) continue;
      const samePerson =
        lead.id === member.id ||
        (Boolean(member.canonicalAgentId) && lead.canonicalAgentId === member.canonicalAgentId);
      if (samePerson) ids.push(team.id);
    }
  }
  return ids;
}
