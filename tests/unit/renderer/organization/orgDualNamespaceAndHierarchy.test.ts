/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  createDefaultOrgHierarchy,
  createDefaultOrgProjects,
  createDefaultOrgConversations,
  createDefaultOrgCronJobs,
} from '@/renderer/pages/organization/utils/defaultOrgSeed';
import {
  computeLifecycleStatus,
  ORG_THEME_PALETTE,
  getOrgNodeStyle,
} from '@/renderer/pages/organization/utils/orgTheme';
import { OrgDelegationEngine } from '@/renderer/pages/organization/utils/orgDelegationEngine';
import { createDepartmentShell, createTeamShell } from '@/renderer/pages/organization/utils/orgCoherence';
import { MAX_DELEGATION_DEPTH, type OrgHierarchy } from '@/types/organization';

describe('Corporate Hierarchy Data Model & Clean Slate Pre-Seed', () => {
  const hierarchy = createDefaultOrgHierarchy();

  it('initializes Root CEO at the top level with null parentId', () => {
    expect(hierarchy.rootCeo).toBeDefined();
    expect(hierarchy.rootCeo.parentId).toBeNull();
    expect(hierarchy.rootCeo.ceoAgent.role).toBe('ceo');
    expect(hierarchy.rootCeo.chiefOfStaffAgent).toBeDefined();
    expect(hierarchy.rootCeo.chiefOfStaffAgent?.role).toBe('chief_of_staff');
  });

  it('starts with a clean slate: 0 pre-seeded departments, teams, projects, or cron jobs', () => {
    expect(hierarchy.departments).toHaveLength(0);
    expect(createDefaultOrgProjects()).toHaveLength(0);
    expect(createDefaultOrgConversations()).toHaveLength(0);
    expect(createDefaultOrgCronJobs()).toHaveLength(0);
  });
});

describe('Eye-Friendly Palette & Lifecycle Glow System (Phase 5)', () => {
  it('correctly maps working status to Soft Sage Emerald styling', () => {
    const workingTheme = ORG_THEME_PALETTE.working;
    expect(workingTheme.borderColor).toBe('#34D399');
    expect(workingTheme.backgroundColor).toContain('16, 185, 129');
    expect(workingTheme.boxShadow).toContain('rgba(52, 211, 153');

    const style = getOrgNodeStyle('working');
    expect(style.borderColor).toBe('#34D399');
  });

  it('correctly maps standby status to Warm Muted Amber / Ochre', () => {
    const standbyTheme = ORG_THEME_PALETTE.department_standby;
    expect(standbyTheme.borderColor).toBe('#FBBF24');
    expect(standbyTheme.backgroundColor).toContain('245, 158, 11');
    expect(standbyTheme.boxShadow).toContain('rgba(251, 191, 36');
  });

  it('correctly maps queued next status to Calm Steel Cyan', () => {
    const queuedTheme = ORG_THEME_PALETTE.queued_next;
    expect(queuedTheme.borderColor).toBe('#38BDF8');
    expect(queuedTheme.badgeText).toBe('Next Up');
  });

  it('computes recently_finished for tasks done less than 60 seconds ago', () => {
    const recentTime = Date.now() - 30 * 1000;
    const status = computeLifecycleStatus(recentTime, 'idle');
    expect(status).toBe('recently_finished');
    expect(ORG_THEME_PALETTE.recently_finished.accentColor).toBe('#2DD4BF');
    expect(ORG_THEME_PALETTE.recently_finished.borderColor).toContain('45, 212, 191');
  });

  it('computes dormant for tasks older than 7 days or null', () => {
    const ancientTime = Date.now() - 10 * 24 * 3600 * 1000;
    expect(computeLifecycleStatus(ancientTime, 'idle')).toBe('dormant');
    expect(computeLifecycleStatus(null, 'idle')).toBe('dormant');
  });
});

describe('Root CEO Directives & Interactive Creation Engine', () => {
  const cleanHierarchy = createDefaultOrgHierarchy();

  it('handles executive directives directly at Root CEO level when no departments exist', async () => {
    const engine = new OrgDelegationEngine(cleanHierarchy);
    const result = await engine.executeDirective('Formulate organizational plan for consumer app launch');

    expect(result.success).toBe(true);
    expect(result.finalSynthesis).toContain('Global Organization CEO');
    expect(result.logs.length).toBeGreaterThanOrEqual(1);
    expect(result.logs[0].fromRole).toBe('User');
    expect(result.logs[0].toRole).toBe('Root CEO');
  });

  it('automatically recognizes and instantiates a department from chat directive', async () => {
    const engine = new OrgDelegationEngine(cleanHierarchy);
    const result = await engine.executeDirective('Create department Mobile Development');

    expect(result.success).toBe(true);
    expect(result.createdDepartments).toBeDefined();
    expect(result.createdDepartments).toHaveLength(1);
    expect(result.createdDepartments![0].name).toBe('Mobile Development');
    expect(result.createdDepartments![0].departmentCeoAgent).toBeDefined();
    expect(result.createdDepartments![0].departmentCeoAgent.role).toBe('department_head');
  });

  it('automatically recognizes and instantiates a team under a department from chat directive', async () => {
    const testDept = createDepartmentShell('Engineering');
    const hierarchyWithDept: OrgHierarchy = {
      ...cleanHierarchy,
      departments: [testDept],
    };

    const engine = new OrgDelegationEngine(hierarchyWithDept);
    const result = await engine.executeDirective('Create team iOS in department Engineering');

    expect(result.success).toBe(true);
    expect(result.createdTeams).toBeDefined();
    expect(result.createdTeams).toHaveLength(1);
    expect(result.createdTeams![0].departmentId).toBe(testDept.id);
    expect(result.createdTeams![0].team.name).toBe('iOS');
    expect(result.createdTeams![0].team.teamLeadAgent).toBeDefined();
    expect(result.createdTeams![0].team.hrCoordinatorAgent).toBeDefined();
  });

  it('cascades user directive down from Root CEO to Dept CEO and Team Lead when teams exist', async () => {
    const testDept = createDepartmentShell('Software');
    const testTeam = createTeamShell(testDept.id, 'Frontend');
    testTeam.specialistMembers = [
      {
        id: 'spec-1',
        name: 'UI Specialist',
        role: 'specialist',
        canonicalAgentId: 'canonical-uiux',
        assignedTeamIds: [testTeam.id],
        status: 'idle',
      },
    ];
    testDept.teams = [testTeam];

    const hierarchyWithTeam: OrgHierarchy = {
      ...cleanHierarchy,
      departments: [testDept],
    };

    const engine = new OrgDelegationEngine(hierarchyWithTeam);
    const result = await engine.executeDirective('Implement dark mode across application', testDept.id);

    expect(result.success).toBe(true);
    expect(result.involvedDepartmentIds).toContain(testDept.id);
    expect(result.involvedTeamIds).toContain(testTeam.id);
    expect(result.logs.length).toBeGreaterThanOrEqual(4);

    // Verify chain of command in logs
    expect(result.logs[0].fromRole).toBe('User');
    expect(result.logs[1].toRole).toBe('Department CEO');
    expect(result.logs[2].toRole).toBe('Team CEO / Manager');

    // Verify max depth constraint
    result.logs.forEach((log) => {
      expect(log.depth).toBeLessThanOrEqual(MAX_DELEGATION_DEPTH);
    });
  });
});
