/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { areTeamPropsEqual, type TeamNodeData } from '@/renderer/pages/organization/components/TeamNode';
import { areDepartmentPropsEqual, type DepartmentNodeData } from '@/renderer/pages/organization/components/DepartmentNode';
import type { OrgTeamNode, OrgDepartmentNode } from '@/types/organization';

describe('Org Chart Render Count & Memoization Verification', () => {
  it('confirms areTeamPropsEqual returns true for idle teams and false for working teams', () => {
    const mockTeam1: OrgTeamNode = {
      id: 'team-backend',
      name: 'Backend Core',
      departmentId: 'dept-eng',
      status: 'idle',
      teamLeadAgent: { id: 'lead-1', name: 'Lead Dev', role: 'Team Lead' },
      specialistMembers: [],
    };

    const mockTeam2: OrgTeamNode = {
      id: 'team-design',
      name: 'Design System',
      departmentId: 'dept-prod',
      status: 'idle',
      teamLeadAgent: { id: 'lead-2', name: 'Lead Designer', role: 'Team Lead' },
      specialistMembers: [],
    };

    const initialTeam1Data: TeamNodeData = {
      team: mockTeam1,
      departmentName: 'Engineering',
      isDescendantWorking: false,
    };

    const initialTeam2Data: TeamNodeData = {
      team: mockTeam2,
      departmentName: 'Product',
      isDescendantWorking: false,
    };

    // 1. Unchanged idle team: areTeamPropsEqual returns true (skips re-render)
    const unchangedTeam2Data: TeamNodeData = {
      ...initialTeam2Data,
      isDescendantWorking: false,
    };
    expect(areTeamPropsEqual({ data: initialTeam2Data }, { data: unchangedTeam2Data })).toBe(true);

    // 2. Active working team: areTeamPropsEqual returns false (triggers re-render)
    const updatedTeam1Data: TeamNodeData = {
      ...initialTeam1Data,
      isDescendantWorking: true,
    };
    expect(areTeamPropsEqual({ data: initialTeam1Data }, { data: updatedTeam1Data })).toBe(false);
  });

  it('confirms areDepartmentPropsEqual returns true for idle depts and false for working depts', () => {
    const mockDept1: OrgDepartmentNode = {
      id: 'dept-eng',
      name: 'Engineering',
      color: '#38BDF8',
      status: 'idle',
      departmentCeoAgent: { id: 'ceo-eng', name: 'Eng Head', role: 'Head of Eng' },
      teams: [],
    };

    const mockDept2: OrgDepartmentNode = {
      id: 'dept-sales',
      name: 'Sales & Growth',
      color: '#34D399',
      status: 'idle',
      departmentCeoAgent: { id: 'ceo-sales', name: 'Sales Head', role: 'Head of Sales' },
      teams: [],
    };

    const initialDept1Data: DepartmentNodeData = {
      department: mockDept1,
      deptIndex: 0,
      isDescendantWorking: false,
    };

    const initialDept2Data: DepartmentNodeData = {
      department: mockDept2,
      deptIndex: 1,
      isDescendantWorking: false,
    };

    // Idle department props equality: true (skips re-render)
    expect(
      areDepartmentPropsEqual(
        { data: initialDept2Data },
        { data: { ...initialDept2Data, isDescendantWorking: false } }
      )
    ).toBe(true);

    // Active department props equality: false (triggers re-render)
    expect(
      areDepartmentPropsEqual(
        { data: initialDept1Data },
        { data: { ...initialDept1Data, isDescendantWorking: true } }
      )
    ).toBe(false);
  });
});
