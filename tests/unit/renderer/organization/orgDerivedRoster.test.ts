/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  deriveDepartmentRoster,
  deriveDepartmentRosterWithProjects,
} from '@/renderer/pages/organization/utils/orgRoster';
import type { OrgAgentMember, OrgProject } from '@/types/organization';

describe('Derived Department Roster from Shared Member Pool', () => {
  const members: OrgAgentMember[] = [
    {
      id: 'm-coder',
      canonicalAgentId: 'c-coder',
      name: 'Senior Coder',
      role: 'specialist',
      skills: ['ts', 'react'],
      assignedTeamIds: [],
      lastActiveAt: null,
      status: 'idle',
    },
    {
      id: 'm-designer',
      canonicalAgentId: 'c-designer',
      name: 'UI Designer',
      role: 'specialist',
      skills: ['figma', 'css'],
      assignedTeamIds: [],
      lastActiveAt: null,
      status: 'idle',
    },
    {
      id: 'm-qa',
      canonicalAgentId: 'c-qa',
      name: 'QA Engineer',
      role: 'specialist',
      skills: ['vitest'],
      assignedTeamIds: [],
      lastActiveAt: null,
      status: 'idle',
    },
  ];

  const deptHead: OrgAgentMember = {
    id: 'm-head',
    canonicalAgentId: 'c-head',
    name: 'Eng Head',
    role: 'department_head',
    assignedTeamIds: [],
    lastActiveAt: null,
    status: 'idle',
  };

  const projects: OrgProject[] = [
    {
      id: 'proj-1',
      name: 'Web App',
      departmentId: 'dept-eng',
      teamIds: [],
      memberIds: ['m-coder', 'm-designer'],
      status: 'active',
    },
    {
      id: 'proj-2',
      name: 'API Backend',
      departmentId: 'dept-eng',
      teamIds: [],
      memberIds: ['m-coder', 'm-qa'], // m-coder is in both projects
      status: 'active',
    },
    {
      id: 'proj-other',
      name: 'Marketing Campaign',
      departmentId: 'dept-marketing',
      teamIds: [],
      memberIds: ['m-designer'], // designer in another department project
      status: 'active',
    },
  ];

  it('computes department roster as the deduplicated union of its projects members + head', () => {
    const roster = deriveDepartmentRoster('dept-eng', projects, members, deptHead);

    expect(roster).toHaveLength(4); // head, coder, designer, qa
    const ids = roster.map((m) => m.id);
    expect(ids).toContain('m-head');
    expect(ids).toContain('m-coder');
    expect(ids).toContain('m-designer');
    expect(ids).toContain('m-qa');

    // Confirm no duplicate coder even though assigned to two projects
    const coderCount = ids.filter((id) => id === 'm-coder').length;
    expect(coderCount).toBe(1);
  });

  it('annotates members with all the projects in that department they work on', () => {
    const rosterWithProjects = deriveDepartmentRosterWithProjects('dept-eng', projects, members, deptHead);

    const coderEntry = rosterWithProjects.find((entry) => entry.member.id === 'm-coder');
    expect(coderEntry).toBeDefined();
    expect(coderEntry!.projects).toHaveLength(2);
    expect(coderEntry!.projects.map((p) => p.id)).toEqual(['proj-1', 'proj-2']);

    const designerEntry = rosterWithProjects.find((entry) => entry.member.id === 'm-designer');
    expect(designerEntry).toBeDefined();
    // Only includes projects belonging to dept-eng, not proj-other
    expect(designerEntry!.projects).toHaveLength(1);
    expect(designerEntry!.projects[0].id).toBe('proj-1');
  });

  it('handles empty department projects gracefully', () => {
    const roster = deriveDepartmentRoster('dept-empty', projects, members, deptHead);
    expect(roster).toHaveLength(1);
    expect(roster[0].id).toBe('m-head');
  });
});
