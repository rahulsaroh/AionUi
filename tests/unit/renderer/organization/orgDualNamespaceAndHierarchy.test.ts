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

describe('Corporate Hierarchy Data Model & Clean Slate Initialization', () => {
  const hierarchy = createDefaultOrgHierarchy();

  it('initializes Root CEO at the top level with null parentId', () => {
    expect(hierarchy.rootCeo).toBeDefined();
    expect(hierarchy.rootCeo.parentId).toBeNull();
    expect(hierarchy.rootCeo.ceoAgent.role).toBe('ceo');
    expect(hierarchy.rootCeo.chiefOfStaffAgent).toBeDefined();
    expect(hierarchy.rootCeo.chiefOfStaffAgent?.role).toBe('chief_of_staff');
  });

  it('starts with a clean slate: 0 pre-seeded departments', () => {
    expect(hierarchy.departments.length).toBe(0);
  });

  it('creates empty default projects, cron jobs, and conversations', () => {
    expect(createDefaultOrgProjects().length).toBe(0);
    expect(createDefaultOrgCronJobs().length).toBe(0);
    expect(createDefaultOrgConversations().length).toBe(0);
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
    const status = computeLifecycleStatus(recentTime, 'completed');
    expect(status).toBe('recently_finished');
  });

  it('computes dormant for tasks inactive for more than 7 days', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 3600 * 1000;
    const status = computeLifecycleStatus(eightDaysAgo, 'idle');
    expect(status).toBe('dormant');
  });
});

describe('Cascading Top-Down Delegation Engine (Phase 3)', () => {
  function createTestHierarchy(): OrgHierarchy {
    const base = createDefaultOrgHierarchy();
    const appDept = createDepartmentShell('App Builder Department');
    appDept.id = 'dept-app-builder';
    const appTeam = createTeamShell('dept-app-builder', 'Mobile App Team');
    appTeam.id = 'team-app-mobile';
    appDept.teams = [appTeam];

    const ytDept = createDepartmentShell('YouTube Automation Department');
    ytDept.id = 'dept-youtube';
    const ytTeam = createTeamShell('dept-youtube', 'Stoic Channel Team');
    ytTeam.id = 'team-yt-stoic';
    ytDept.teams = [ytTeam];

    return {
      ...base,
      departments: [appDept, ytDept],
    };
  }

  it('cascades user directive down from Root CEO to Dept CEO to Team Manager and Specialists', async () => {
    const hierarchy = createTestHierarchy();
    const engine = new OrgDelegationEngine(hierarchy);
    const result = await engine.executeDirective('Deploy biometric authentication for mobile app', 'dept-app-builder');

    expect(result.success).toBe(true);
    expect(result.involvedDepartmentIds).toContain('dept-app-builder');
    expect(result.logs.length).toBeGreaterThanOrEqual(4);

    // Verify chain of command in logs
    expect(result.logs[0].fromRole).toBe('User');
    expect(result.logs[1].toRole).toBe('Department CEO');
    expect(result.logs[result.logs.length - 1].toRole).toBe('Root CEO');

    // Verify max depth constraint
    result.logs.forEach((log) => {
      expect(log.depth).toBeLessThanOrEqual(MAX_DELEGATION_DEPTH);
    });
  });

  it('automatically routes specialized YouTube keywords to YouTube Automation Department', async () => {
    const hierarchy = createTestHierarchy();
    const engine = new OrgDelegationEngine(hierarchy);
    const result = await engine.executeDirective('Produce a stoic channel philosophical video about Marcus Aurelius');

    expect(result.success).toBe(true);
    expect(result.involvedDepartmentIds).toContain('dept-youtube');
  });

  it('supports direct 1:1 conversation execution with specific agents', async () => {
    const hierarchy = createTestHierarchy();
    const engine = new OrgDelegationEngine(hierarchy);
    const specialist = hierarchy.departments[0].teams[0].teamLeadAgent;
    const response = await engine.executeDirectMessage(specialist, 'Review our sprint items', undefined, false);

    expect(response).toContain('Team Lead');
    expect(response).toContain('Review our sprint items');
  });

  it('handles folder access inquiries with clear instructions', async () => {
    const hierarchy = createTestHierarchy();
    const engine = new OrgDelegationEngine(hierarchy);
    const result = await engine.executeDirective(
      'how can i give you a folder to access everything about our organization'
    );

    expect(result.success).toBe(true);
    expect(result.finalSynthesis).toContain('Bind Folder');
  });
});
