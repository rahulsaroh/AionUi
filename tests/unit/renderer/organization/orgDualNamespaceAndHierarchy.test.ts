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
import {
  OrgDelegationEngine,
} from '@/renderer/pages/organization/utils/orgDelegationEngine';
import { MAX_DELEGATION_DEPTH } from '@/types/organization';

describe('Corporate Hierarchy Data Model & Pre-Seed (Phase 2 & Phase 7)', () => {
  const hierarchy = createDefaultOrgHierarchy();

  it('initializes Root CEO at the top level with null parentId', () => {
    expect(hierarchy.rootCeo).toBeDefined();
    expect(hierarchy.rootCeo.parentId).toBeNull();
    expect(hierarchy.rootCeo.ceoAgent.role).toBe('ceo');
    expect(hierarchy.rootCeo.chiefOfStaffAgent).toBeDefined();
    expect(hierarchy.rootCeo.chiefOfStaffAgent?.role).toBe('chief_of_staff');
  });

  it('pre-populates all 5 mandatory corporate departments with dedicated leaders', () => {
    expect(hierarchy.departments.length).toBe(5);

    const deptNames = hierarchy.departments.map((d) => d.name);
    expect(deptNames).toContain('App Builder Department');
    expect(deptNames).toContain('YouTube Automation Department');
    expect(deptNames).toContain('Digital Product Department');
    expect(deptNames).toContain('Personal & Life Coaches Department');
    expect(deptNames).toContain('Social Media Department');

    hierarchy.departments.forEach((dept) => {
      expect(dept.departmentCeoAgent).toBeDefined();
      expect(dept.departmentCeoAgent.role).toBe('department_head');
      expect(dept.parentDepartmentId).toBe('root-ceo');
    });
  });

  it('pre-populates App Builder Department teams and specialist roles', () => {
    const appDept = hierarchy.departments.find((d) => d.id === 'dept-app-builder')!;
    const teamNames = appDept.teams.map((t) => t.name);
    expect(teamNames).toContain('AionUi Core Team');
    expect(teamNames).toContain('Gym Mentor App Team');
    expect(teamNames).toContain('Finance Management App Team');
    expect(teamNames).toContain('Time Management App Team');

    const aionUiTeam = appDept.teams.find((t) => t.id === 'team-aionui')!;
    expect(aionUiTeam.teamLeadAgent).toBeDefined();
    expect(aionUiTeam.hrCoordinatorAgent).toBeDefined();
    expect(aionUiTeam.specialistMembers.some((s) => s.name === 'UI/UX Specialist')).toBe(true);
    expect(aionUiTeam.specialistMembers.some((s) => s.name === 'Backend Integration')).toBe(true);
    expect(aionUiTeam.specialistMembers.some((s) => s.name === 'QA Tester')).toBe(true);
  });

  it('pre-populates YouTube Automation Department teams and specialist roles', () => {
    const ytDept = hierarchy.departments.find((d) => d.id === 'dept-youtube')!;
    const teamNames = ytDept.teams.map((t) => t.name);
    expect(teamNames).toContain('Weekly Tech News Team');
    expect(teamNames).toContain('Stoic Channel Team');
    expect(teamNames).toContain('Child Animated Videos Team');
  });

  it('tracks shared cross-department specialists by canonicalAgentId (Phase 6)', () => {
    const allSpecialists = hierarchy.departments.flatMap((d) =>
      d.teams.flatMap((t) => t.specialistMembers)
    );

    const visualDesigners = allSpecialists.filter(
      (s) => s.canonicalAgentId === 'canonical-visual-designer'
    );
    expect(visualDesigners.length).toBeGreaterThanOrEqual(2);

    const financeManagers = allSpecialists.filter(
      (s) => s.canonicalAgentId === 'canonical-finance-mgr'
    );
    expect(financeManagers.length).toBeGreaterThanOrEqual(2);

    const physicalCoaches = allSpecialists.filter(
      (s) => s.canonicalAgentId === 'canonical-physical-coach'
    );
    expect(physicalCoaches.length).toBeGreaterThanOrEqual(2);
  });

  it('includes a dormant branch unused for > 7 days (Phase 5 & 7)', () => {
    const coachesDept = hierarchy.departments.find((d) => d.id === 'dept-coaches')!;
    const dormantTeam = coachesDept.teams.find((t) => t.id === 'team-dormant-vitality')!;
    expect(dormantTeam).toBeDefined();
    expect(dormantTeam.status).toBe('dormant');
    expect(dormantTeam.lastActiveAt).not.toBeNull();
    const elapsed = Date.now() - (dormantTeam.lastActiveAt || 0);
    expect(elapsed).toBeGreaterThan(7 * 24 * 3600 * 1000);
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

describe('Cascading Top-Down Delegation Engine (Phase 3)', () => {
  const hierarchy = createDefaultOrgHierarchy();

  it('cascades user directive down from Root CEO to Dept CEO to Team Manager and Specialists', async () => {
    const engine = new OrgDelegationEngine(hierarchy);
    const result = await engine.executeDirective('Deploy biometric authentication for mobile app', 'dept-app-builder');

    expect(result.success).toBe(true);
    expect(result.involvedDepartmentIds).toContain('dept-app-builder');
    expect(result.logs.length).toBeGreaterThanOrEqual(5);

    // Verify chain of command in logs
    expect(result.logs[0].fromRole).toBe('User');
    expect(result.logs[1].toRole).toBe('Department CEO');
    expect(result.logs[2].toRole).toBe('Team CEO / Manager');
    expect(result.logs[result.logs.length - 1].toRole).toBe('Root CEO');

    // Verify max depth constraint
    result.logs.forEach((log) => {
      expect(log.depth).toBeLessThanOrEqual(MAX_DELEGATION_DEPTH);
    });
  });

  it('automatically routes specialized YouTube keywords to YouTube Automation Department', async () => {
    const engine = new OrgDelegationEngine(hierarchy);
    const result = await engine.executeDirective('Produce a stoic channel philosophical video about Marcus Aurelius');

    expect(result.success).toBe(true);
    expect(result.involvedDepartmentIds).toContain('dept-youtube');
  });
});

describe('Isolated Projects & Automations Pre-Seed', () => {
  it('creates default org projects with proper department links', () => {
    const projects = createDefaultOrgProjects();
    expect(projects.length).toBe(7);
    const projectNames = projects.map((p) => p.name);
    expect(projectNames).toContain('AionUi');
    expect(projectNames).toContain('Gym Mentor App');
    expect(projectNames).toContain('Finance Management App');
    expect(projectNames).toContain('Time Management App');
    expect(projectNames).toContain('Weekly Tech News');
    expect(projectNames).toContain('Stoic Channel');
    expect(projectNames).toContain('Kids Animation');
  });

  it('creates default org cron jobs', () => {
    const cron = createDefaultOrgCronJobs();
    expect(cron.length).toBe(2);
    expect(cron[0].cronExpression).toBe('0 2 * * *');
  });

  it('creates default org conversations', () => {
    const convs = createDefaultOrgConversations();
    expect(convs.length).toBe(3);
    expect(convs[0].type).toBe('ceo_directive');
  });
});
