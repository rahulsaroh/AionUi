/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { areTeamPropsEqual, type TeamNodeData } from '@/renderer/pages/organization/components/TeamNode';
import {
  areDepartmentPropsEqual,
  type DepartmentNodeData,
} from '@/renderer/pages/organization/components/DepartmentNode';
import { areProjectPropsEqual, type ProjectNodeData } from '@/renderer/pages/organization/components/ProjectNode';
import { areRootCeoPropsEqual, type RootCeoNodeData } from '@/renderer/pages/organization/components/RootCeoNode';
import {
  areSharedMemberPropsEqual,
  type SharedMemberNodeData,
} from '@/renderer/pages/organization/components/SharedMemberNode';
import type { OrgDepartmentNode, OrgTeamNode, OrgProject, OrgAgentMember, OrgHierarchy } from '@/types/organization';

describe('Custom Memo Comparators (re-render protection)', () => {
  describe('areTeamPropsEqual', () => {
    const baseTeam: OrgTeamNode = {
      id: 'team-eng',
      name: 'Core Eng',
      parentId: 'dept-eng',
      color: '#10b981',
      avatar: 'terminal',
      status: 'idle',
      teamLeadAgent: {
        id: 'agent-lead-1',
        canonicalAgentId: 'canon-lead-1',
        name: 'Lead Alice',
        role: 'lead',
        avatar: 'user-lead',
        assistant_backend: 'acp',
        assignedTeamIds: ['team-eng'],
        lastActiveAt: 1000,
        status: 'idle',
      },
      specialistMembers: [
        {
          id: 'spec-1',
          canonicalAgentId: 'canon-spec-1',
          name: 'Bob',
          role: 'specialist',
          avatar: 'avatar-bob',
          assistant_backend: 'acp',
          assignedTeamIds: ['team-eng'],
          lastActiveAt: 1000,
          status: 'idle',
        },
      ],
      lastActiveAt: 1000,
    };

    const baseData: TeamNodeData = {
      team: baseTeam,
      departmentName: 'Engineering',
      orientation: 'TB',
      sharedCountsMap: { 'canon-spec-1': 1 },
      isDescendantWorking: false,
      isDimmed: false,
    };

    it('returns true when props and data are identical', () => {
      expect(areTeamPropsEqual({ data: baseData, selected: false }, { data: baseData, selected: false })).toBe(true);
    });

    it('returns false when selected changes', () => {
      expect(areTeamPropsEqual({ data: baseData, selected: false }, { data: baseData, selected: true })).toBe(false);
    });

    it('returns false when filter dim (isDimmed) changes', () => {
      const nextData: TeamNodeData = { ...baseData, isDimmed: true };
      expect(areTeamPropsEqual({ data: baseData }, { data: nextData })).toBe(false);
    });

    it('returns false when isDescendantWorking changes', () => {
      const nextData: TeamNodeData = { ...baseData, isDescendantWorking: true };
      expect(areTeamPropsEqual({ data: baseData }, { data: nextData })).toBe(false);
    });

    it('returns false when team name changes', () => {
      const nextTeam: OrgTeamNode = { ...baseTeam, name: 'Eng Platform' };
      const nextData: TeamNodeData = { ...baseData, team: nextTeam };
      expect(areTeamPropsEqual({ data: baseData }, { data: nextData })).toBe(false);
    });

    it('returns false when team avatar changes', () => {
      const nextTeam: OrgTeamNode = { ...baseTeam, avatar: 'code' };
      const nextData: TeamNodeData = { ...baseData, team: nextTeam };
      expect(areTeamPropsEqual({ data: baseData }, { data: nextData })).toBe(false);
    });

    it('returns false when team color changes', () => {
      const nextTeam: OrgTeamNode = { ...baseTeam, color: '#3b82f6' };
      const nextData: TeamNodeData = { ...baseData, team: nextTeam };
      expect(areTeamPropsEqual({ data: baseData }, { data: nextData })).toBe(false);
    });

    it('returns false when team status changes', () => {
      const nextTeam: OrgTeamNode = { ...baseTeam, status: 'working' };
      const nextData: TeamNodeData = { ...baseData, team: nextTeam };
      expect(areTeamPropsEqual({ data: baseData }, { data: nextData })).toBe(false);
    });

    it('returns false when specialist members list changes', () => {
      const nextTeam: OrgTeamNode = { ...baseTeam, specialistMembers: [] };
      const nextData: TeamNodeData = { ...baseData, team: nextTeam };
      expect(areTeamPropsEqual({ data: baseData }, { data: nextData })).toBe(false);
    });

    it('returns false when lead agent avatar changes', () => {
      const nextTeam: OrgTeamNode = {
        ...baseTeam,
        teamLeadAgent: { ...baseTeam.teamLeadAgent, avatar: 'avatar-new' },
      };
      const nextData: TeamNodeData = { ...baseData, team: nextTeam };
      expect(areTeamPropsEqual({ data: baseData }, { data: nextData })).toBe(false);
    });

    it('returns false when shared flag/counts map changes', () => {
      const nextData: TeamNodeData = { ...baseData, sharedCountsMap: { 'canon-spec-1': 2 } };
      expect(areTeamPropsEqual({ data: baseData }, { data: nextData })).toBe(false);
    });
  });

  describe('areDepartmentPropsEqual', () => {
    const baseDept: OrgDepartmentNode = {
      id: 'dept-eng',
      name: 'Engineering',
      parentId: 'root-ceo',
      color: '#3b82f6',
      status: 'idle',
      departmentCeoAgent: {
        id: 'agent-dept-eng',
        canonicalAgentId: 'canon-dept-eng',
        name: 'VP Eng',
        role: 'department_head',
        assistant_backend: 'acp',
        assignedTeamIds: [],
        lastActiveAt: 1000,
        status: 'idle',
      },
      teams: [],
      lastActiveAt: 1000,
    };

    const baseData: DepartmentNodeData = {
      department: baseDept,
      deptIndex: 0,
      isCollapsed: false,
      isDescendantWorking: false,
      isDimmed: false,
      orientation: 'TB',
    };

    it('returns true when identical', () => {
      expect(areDepartmentPropsEqual({ data: baseData, selected: false }, { data: baseData, selected: false })).toBe(
        true
      );
    });

    it('returns false on selected change', () => {
      expect(areDepartmentPropsEqual({ data: baseData, selected: false }, { data: baseData, selected: true })).toBe(
        false
      );
    });

    it('returns false on isDimmed change', () => {
      expect(areDepartmentPropsEqual({ data: baseData }, { data: { ...baseData, isDimmed: true } })).toBe(false);
    });

    it('returns false on name change', () => {
      const nextDept: OrgDepartmentNode = { ...baseDept, name: 'R&D Engineering' };
      expect(areDepartmentPropsEqual({ data: baseData }, { data: { ...baseData, department: nextDept } })).toBe(false);
    });

    it('returns false on color change', () => {
      const nextDept: OrgDepartmentNode = { ...baseDept, color: '#ec4899' };
      expect(areDepartmentPropsEqual({ data: baseData }, { data: { ...baseData, department: nextDept } })).toBe(false);
    });

    it('returns false on status change', () => {
      const nextDept: OrgDepartmentNode = { ...baseDept, status: 'working' };
      expect(areDepartmentPropsEqual({ data: baseData }, { data: { ...baseData, department: nextDept } })).toBe(false);
    });

    it('returns false on teams list change', () => {
      const nextDept: OrgDepartmentNode = { ...baseDept, teams: [{} as any] };
      expect(areDepartmentPropsEqual({ data: baseData }, { data: { ...baseData, department: nextDept } })).toBe(false);
    });
  });

  describe('areProjectPropsEqual', () => {
    const baseDept: OrgDepartmentNode = {
      id: 'dept-eng',
      name: 'Engineering',
      parentId: 'root-ceo',
      color: '#3b82f6',
      status: 'idle',
      departmentCeoAgent: {} as any,
      teams: [],
      lastActiveAt: 1000,
    };

    const baseProj: OrgProject = {
      id: 'proj-ai',
      name: 'AI Agent Runtime',
      departmentId: 'dept-eng',
      status: 'active',
      teamIds: ['team-eng'],
      memberIds: ['spec-1'],
    };

    const baseData: ProjectNodeData = {
      project: baseProj,
      department: baseDept,
      isDescendantWorking: false,
      isDimmed: false,
      orientation: 'TB',
    };

    it('returns true when identical', () => {
      expect(areProjectPropsEqual({ data: baseData, selected: false }, { data: baseData, selected: false })).toBe(true);
    });

    it('returns false on selected change', () => {
      expect(areProjectPropsEqual({ data: baseData, selected: false }, { data: baseData, selected: true })).toBe(false);
    });

    it('returns false on isDimmed change', () => {
      expect(areProjectPropsEqual({ data: baseData }, { data: { ...baseData, isDimmed: true } })).toBe(false);
    });

    it('returns false on project name change', () => {
      const nextProj: OrgProject = { ...baseProj, name: 'AI Core Platform' };
      expect(areProjectPropsEqual({ data: baseData }, { data: { ...baseData, project: nextProj } })).toBe(false);
    });

    it('returns false on project status change', () => {
      const nextProj: OrgProject = { ...baseProj, status: 'completed' };
      expect(areProjectPropsEqual({ data: baseData }, { data: { ...baseData, project: nextProj } })).toBe(false);
    });

    it('returns false on teamIds change', () => {
      const nextProj: OrgProject = { ...baseProj, teamIds: ['team-eng', 'team-design'] };
      expect(areProjectPropsEqual({ data: baseData }, { data: { ...baseData, project: nextProj } })).toBe(false);
    });

    it('returns false on memberIds change', () => {
      const nextProj: OrgProject = { ...baseProj, memberIds: ['spec-1', 'spec-2'] };
      expect(areProjectPropsEqual({ data: baseData }, { data: { ...baseData, project: nextProj } })).toBe(false);
    });
  });

  describe('areRootCeoPropsEqual', () => {
    const baseCeo: OrgHierarchy['rootCeo'] = {
      id: 'root-ceo',
      name: 'Global Command',
      parentId: null,
      status: 'idle',
      ceoAgent: {
        id: 'agent-ceo',
        canonicalAgentId: 'canon-ceo',
        name: 'Chief Executive',
        role: 'ceo',
        avatar: 'crown-avatar',
        assistant_backend: 'acp',
        assignedTeamIds: [],
        lastActiveAt: 1000,
        status: 'idle',
      },
      lastActiveAt: 1000,
    };

    const baseData: RootCeoNodeData = {
      rootCeo: baseCeo,
      isDescendantWorking: false,
      isDimmed: false,
      orientation: 'TB',
    };

    it('returns true when identical', () => {
      expect(areRootCeoPropsEqual({ data: baseData, selected: false }, { data: baseData, selected: false })).toBe(true);
    });

    it('returns false on selected change', () => {
      expect(areRootCeoPropsEqual({ data: baseData, selected: false }, { data: baseData, selected: true })).toBe(false);
    });

    it('returns false on isDimmed change', () => {
      expect(areRootCeoPropsEqual({ data: baseData }, { data: { ...baseData, isDimmed: true } })).toBe(false);
    });

    it('returns false on ceo name change', () => {
      const nextCeo: OrgHierarchy['rootCeo'] = { ...baseCeo, name: 'Global Command HQ' };
      expect(areRootCeoPropsEqual({ data: baseData }, { data: { ...baseData, rootCeo: nextCeo } })).toBe(false);
    });

    it('returns false on ceo agent status change', () => {
      const nextCeo: OrgHierarchy['rootCeo'] = {
        ...baseCeo,
        ceoAgent: { ...baseCeo.ceoAgent, status: 'working' },
      };
      expect(areRootCeoPropsEqual({ data: baseData }, { data: { ...baseData, rootCeo: nextCeo } })).toBe(false);
    });

    it('returns false on ceo agent avatar change', () => {
      const nextCeo: OrgHierarchy['rootCeo'] = {
        ...baseCeo,
        ceoAgent: { ...baseCeo.ceoAgent, avatar: 'robot-cyan' },
      };
      expect(areRootCeoPropsEqual({ data: baseData }, { data: { ...baseData, rootCeo: nextCeo } })).toBe(false);
    });
  });

  describe('areSharedMemberPropsEqual', () => {
    const baseMember: OrgAgentMember = {
      id: 'spec-uiux',
      canonicalAgentId: 'canon-uiux',
      name: 'UI/UX Specialist',
      role: 'specialist',
      avatar: 'palette-avatar',
      status: 'idle',
      assistant_backend: 'acp',
      assignedTeamIds: ['team-eng', 'team-design'],
      lastActiveAt: 1000,
    };

    const baseData: SharedMemberNodeData = {
      member: baseMember,
      departmentsServed: ['Engineering', 'Design'],
      sharedCount: 2,
      isDimmed: false,
    };

    it('returns true when identical', () => {
      expect(areSharedMemberPropsEqual({ data: baseData, selected: false }, { data: baseData, selected: false })).toBe(
        true
      );
    });

    it('returns false on selected change', () => {
      expect(areSharedMemberPropsEqual({ data: baseData, selected: false }, { data: baseData, selected: true })).toBe(
        false
      );
    });

    it('returns false on isDimmed change', () => {
      expect(areSharedMemberPropsEqual({ data: baseData }, { data: { ...baseData, isDimmed: true } })).toBe(false);
    });

    it('returns false on member name change', () => {
      const nextMember: OrgAgentMember = { ...baseMember, name: 'Principal UI/UX Specialist' };
      expect(areSharedMemberPropsEqual({ data: baseData }, { data: { ...baseData, member: nextMember } })).toBe(false);
    });

    it('returns false on member avatar change', () => {
      const nextMember: OrgAgentMember = { ...baseMember, avatar: 'brush-avatar' };
      expect(areSharedMemberPropsEqual({ data: baseData }, { data: { ...baseData, member: nextMember } })).toBe(false);
    });

    it('returns false on member status change', () => {
      const nextMember: OrgAgentMember = { ...baseMember, status: 'working' };
      expect(areSharedMemberPropsEqual({ data: baseData }, { data: { ...baseData, member: nextMember } })).toBe(false);
    });

    it('returns false on role change', () => {
      const nextMember: OrgAgentMember = { ...baseMember, role: 'lead' };
      expect(areSharedMemberPropsEqual({ data: baseData }, { data: { ...baseData, member: nextMember } })).toBe(false);
    });

    it('returns false on sharedCount change', () => {
      expect(areSharedMemberPropsEqual({ data: baseData }, { data: { ...baseData, sharedCount: 3 } })).toBe(false);
    });

    it('returns false on departmentsServed change', () => {
      expect(
        areSharedMemberPropsEqual(
          { data: baseData },
          { data: { ...baseData, departmentsServed: ['Engineering', 'Product'] } }
        )
      ).toBe(false);
    });
  });
});
