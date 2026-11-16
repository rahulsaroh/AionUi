/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { layoutOrgChart } from '@/renderer/pages/organization/utils/layoutOrgChart';
import { computeOrgStatusPropagation } from '@/renderer/pages/organization/utils/orgStatusPropagation';
import type { OrgHierarchy, OrgDepartmentNode, OrgTeamNode, OrgAgentMember, OrgProject } from '@/types/organization';
import type { Node, Edge } from '@xyflow/react';

function seedStressOrg(): {
  hierarchy: OrgHierarchy;
  projects: OrgProject[];
  nodes: Node[];
  edges: Edge[];
} {
  const departmentsCount = 10;
  const projectsCount = 20;
  const teamsCount = 40; // 4 teams per department
  const membersPerTeam = 3;
  const sharedMembersCount = 15;

  const departments: OrgDepartmentNode[] = [];
  const projects: OrgProject[] = [];
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const rootCeo: OrgHierarchy['rootCeo'] = {
    id: 'root-ceo',
    name: 'Executive Global HQ Command',
    parentId: null,
    status: 'idle',
    lastActiveAt: Date.now(),
    ceoAgent: {
      id: 'agent-root-ceo',
      canonicalAgentId: 'canon-root-ceo',
      name: 'CEO Administrator',
      role: 'ceo',
      assignedTeamIds: [],
      status: 'idle',
      lastActiveAt: Date.now(),
    },
  };

  nodes.push({
    id: rootCeo.id,
    type: 'rootCeo',
    position: { x: 0, y: 0 },
    data: { rootCeo },
  });

  let teamCounter = 0;
  let memberCounter = 0;

  for (let d = 0; d < departmentsCount; d++) {
    const deptId = `dept-${d}`;
    const deptTeams: OrgTeamNode[] = [];

    nodes.push({
      id: deptId,
      type: 'department',
      position: { x: 0, y: 0 },
      data: {
        department: { id: deptId, name: `Department ${d}` },
        deptIndex: d,
      },
    });

    edges.push({
      id: `edge-root->${deptId}`,
      source: 'root-ceo',
      target: deptId,
      type: 'delegation',
      data: { deptIndex: d },
    });

    for (let t = 0; t < 4; t++) {
      const teamId = `team-${teamCounter++}`;
      const specs: OrgAgentMember[] = [];

      for (let m = 0; m < membersPerTeam; m++) {
        const memberId = `member-${memberCounter++}`;
        // Designate some as shared
        const isShared = memberCounter % (120 / sharedMembersCount) === 0;
        const canonicalId = isShared
          ? `canon-shared-${memberCounter % sharedMembersCount}`
          : `canon-spec-${memberCounter}`;
        specs.push({
          id: memberId,
          canonicalAgentId: canonicalId,
          name: `Member ${memberCounter}`,
          role: 'specialist',
          assignedTeamIds: [teamId],
          status: 'idle',
          lastActiveAt: Date.now(),
        });
      }

      deptTeams.push({
        id: teamId,
        departmentId: deptId,
        name: `Team ${teamId}`,
        teamLeadAgent: {
          id: `lead-${teamId}`,
          canonicalAgentId: `canon-lead-${teamId}`,
          name: `Lead ${teamId}`,
          role: 'lead',
          assignedTeamIds: [teamId],
          status: 'idle',
          lastActiveAt: Date.now(),
        },
        specialistMembers: specs,
        lastActiveAt: Date.now(),
        status: 'idle',
      });

      nodes.push({
        id: teamId,
        type: 'team',
        position: { x: 0, y: 0 },
        data: { team: deptTeams[deptTeams.length - 1] },
      });
    }

    departments.push({
      id: deptId,
      name: `Department ${d}`,
      parentId: 'root-ceo',
      color: '#3b82f6',
      status: 'idle',
      departmentCeoAgent: {
        id: `agent-dept-${d}`,
        canonicalAgentId: `canon-dept-${d}`,
        name: `Head ${d}`,
        role: 'department_head',
        assignedTeamIds: [],
        status: 'idle',
        lastActiveAt: Date.now(),
      },
      teams: deptTeams,
      lastActiveAt: Date.now(),
    });
  }

  // Create 20 Projects
  for (let p = 0; p < projectsCount; p++) {
    const projId = `proj-${p}`;
    const deptIdx = p % departmentsCount;
    const dept = departments[deptIdx];
    const team = dept.teams[p % dept.teams.length];

    projects.push({
      id: projId,
      departmentId: dept.id,
      name: `Project ${p} Execution Engine`,
      status: 'active',
      teamIds: [team.id],
      memberIds: team.specialistMembers.map((m) => m.id),
    });

    nodes.push({
      id: `project-${projId}`,
      type: 'project',
      position: { x: 0, y: 0 },
      data: { project: projects[projects.length - 1], department: dept },
    });

    edges.push({
      id: `edge-${dept.id}->project-${projId}`,
      source: dept.id,
      target: `project-${projId}`,
      type: 'delegation',
      data: { deptIndex: deptIdx },
    });

    edges.push({
      id: `edge-project-${projId}->${team.id}`,
      source: `project-${projId}`,
      target: team.id,
      type: 'delegation',
      data: { deptIndex: deptIdx },
    });
  }

  // Bottom strip: 15 Shared Members
  nodes.push({
    id: 'shared-member-header',
    type: 'sharedMemberHeader',
    position: { x: 0, y: 0 },
    data: {},
  });

  for (let s = 0; s < sharedMembersCount; s++) {
    const sId = `shared-canon-shared-${s}`;
    nodes.push({
      id: sId,
      type: 'sharedMember',
      position: { x: 0, y: 0 },
      data: {
        member: {
          id: `shared-agent-${s}`,
          canonicalAgentId: `canon-shared-${s}`,
          name: `Shared Member ${s}`,
          role: 'specialist',
          assignedTeamIds: ['team-0', 'team-5'],
          status: 'idle',
          lastActiveAt: Date.now(),
        },
        departmentsServed: ['Department 0', 'Department 1'],
        sharedCount: 2,
      },
    });

    edges.push({
      id: `tether-${sId}->team-0`,
      source: sId,
      target: 'team-0',
      type: 'tether',
      data: { canonicalId: `canon-shared-${s}` },
    });

    edges.push({
      id: `tether-${sId}->team-5`,
      source: sId,
      target: 'team-5',
      type: 'tether',
      data: { canonicalId: `canon-shared-${s}` },
    });
  }

  return {
    hierarchy: { rootCeo, departments, lastUpdated: Date.now() },
    projects,
    nodes,
    edges,
  };
}

describe('Commit E: Performance Stress Test & Layout Robustness', () => {
  it('benchmarks layout calculation and status propagation on a stress org (10 depts, 20 projects, 40 teams, 120 members, 15 shared members)', () => {
    const seed = seedStressOrg();

    // 1. Measure layoutOrgChart execution time
    const t0 = performance.now();
    const layoutResult = layoutOrgChart(seed.nodes, seed.edges, 'TB');
    const layoutDurationMs = performance.now() - t0;

    expect(layoutResult.nodes.length).toBe(seed.nodes.length);
    expect(layoutResult.edges.length).toBe(seed.edges.length);
    expect(layoutDurationMs).toBeLessThan(150); // Fast dagre + manual strip placement

    // Confirm coordinates are all valid non-NaN numbers
    for (const node of layoutResult.nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }

    // 2. Measure status propagation computation time when a leaf member is working
    const leafMemberId = seed.hierarchy.departments[0].teams[0].specialistMembers[0].id;
    const nodeStatuses = { [leafMemberId]: 'working' as const };

    const t1 = performance.now();
    const propagation = computeOrgStatusPropagation(seed.hierarchy, seed.projects, nodeStatuses);
    const propDurationMs = performance.now() - t1;

    expect(propDurationMs).toBeLessThan(50); // Real-time responsive (< 50ms)
    // Upward propagation checks: team, dept, and root-ceo must be in workingNodeIds
    const teamId = seed.hierarchy.departments[0].teams[0].id;
    const deptId = seed.hierarchy.departments[0].id;
    expect(propagation.workingNodeIds.has(leafMemberId)).toBe(true);
    expect(propagation.workingNodeIds.has(teamId)).toBe(true);
    expect(propagation.workingNodeIds.has(deptId)).toBe(true);
    expect(propagation.workingNodeIds.has('root-ceo')).toBe(true);

    // Delegation edges along the upward path must be in workingEdgeIds
    expect(propagation.workingEdgeIds.size).toBeGreaterThan(0);
  });

  describe('Layout robustness edge cases', () => {
    it('handles 1 department and 0 shared members cleanly', () => {
      const nodes: Node[] = [
        { id: 'root-ceo', type: 'rootCeo', position: { x: 0, y: 0 }, data: {} },
        { id: 'dept-solo', type: 'department', position: { x: 0, y: 0 }, data: {} },
      ];
      const edges: Edge[] = [{ id: 'e1', source: 'root-ceo', target: 'dept-solo', type: 'delegation' }];
      const res = layoutOrgChart(nodes, edges, 'TB');
      expect(res.nodes.length).toBe(2);
      expect(Number.isFinite(res.nodes[0].position.y)).toBe(true);
      expect(Number.isFinite(res.nodes[1].position.y)).toBe(true);
      expect(res.nodes[1].position.y).toBeGreaterThan(res.nodes[0].position.y);
    });

    it('handles team with no project', () => {
      const nodes: Node[] = [
        { id: 'root-ceo', type: 'rootCeo', position: { x: 0, y: 0 }, data: {} },
        { id: 'dept-1', type: 'department', position: { x: 0, y: 0 }, data: {} },
        { id: 'team-orphan', type: 'team', position: { x: 0, y: 0 }, data: {} },
      ];
      const edges: Edge[] = [
        { id: 'e1', source: 'root-ceo', target: 'dept-1', type: 'delegation' },
        { id: 'e2', source: 'dept-1', target: 'team-orphan', type: 'delegation' },
      ];
      const res = layoutOrgChart(nodes, edges, 'TB');
      expect(res.nodes.length).toBe(3);
      expect(res.nodes.find((n) => n.id === 'team-orphan')!.position.y).toBeGreaterThan(
        res.nodes.find((n) => n.id === 'dept-1')!.position.y
      );
    });

    it('handles department with no teams', () => {
      const nodes: Node[] = [
        { id: 'root-ceo', type: 'rootCeo', position: { x: 0, y: 0 }, data: {} },
        { id: 'dept-empty', type: 'department', position: { x: 0, y: 0 }, data: {} },
      ];
      const edges: Edge[] = [{ id: 'e1', source: 'root-ceo', target: 'dept-empty', type: 'delegation' }];
      const res = layoutOrgChart(nodes, edges, 'TB');
      expect(res.nodes.length).toBe(2);
    });

    it('handles an empty org (root CEO only)', () => {
      const nodes: Node[] = [{ id: 'root-ceo', type: 'rootCeo', position: { x: 0, y: 0 }, data: {} }];
      const edges: Edge[] = [];
      const res = layoutOrgChart(nodes, edges, 'TB');
      expect(res.nodes.length).toBe(1);
      expect(res.nodes[0].position.x).toBe(0);
      expect(res.nodes[0].position.y).toBe(0);
    });

    it('handles very long names without crash or coordinate corruption', () => {
      const hugeName = 'A'.repeat(250);
      const nodes: Node[] = [
        { id: 'root-ceo', type: 'rootCeo', position: { x: 0, y: 0 }, data: { name: hugeName } },
        { id: 'dept-1', type: 'department', position: { x: 0, y: 0 }, data: { name: hugeName } },
        { id: 'project-1', type: 'project', position: { x: 0, y: 0 }, data: { name: hugeName } },
        { id: 'team-1', type: 'team', position: { x: 0, y: 0 }, data: { name: hugeName } },
      ];
      const edges: Edge[] = [
        { id: 'e1', source: 'root-ceo', target: 'dept-1' },
        { id: 'e2', source: 'dept-1', target: 'project-1' },
        { id: 'e3', source: 'project-1', target: 'team-1' },
      ];
      const res = layoutOrgChart(nodes, edges, 'TB');
      expect(res.nodes.length).toBe(4);
      for (const node of res.nodes) {
        expect(Number.isFinite(node.position.x)).toBe(true);
        expect(Number.isFinite(node.position.y)).toBe(true);
      }
    });
  });
});
