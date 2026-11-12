/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OrgAgentMember, OrgProject } from '@/types/organization';

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
