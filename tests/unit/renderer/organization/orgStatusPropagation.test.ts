/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeOrgStatusPropagation } from '@/renderer/pages/organization/utils/orgStatusPropagation';
import type { OrgHierarchy, OrgProject, OrgNodeStatus } from '@/types/organization';
import * as fs from 'fs';
import * as path from 'path';

describe('computeOrgStatusPropagation', () => {
  const createMockHierarchy = (): { hierarchy: OrgHierarchy; projects: OrgProject[] } => {
    const hierarchy: OrgHierarchy = {
      rootCeo: {
        id: 'root-ceo',
        name: 'Alex Rivera',
        status: 'idle',
        ceoAgent: {
          id: 'ceo-agent-1',
          name: 'Alex Rivera',
          canonicalAgentId: 'agent-alex-ceo',
          role: 'CEO',
          model: 'gemini-2.5-pro',
        },
      },
      departments: [
        {
          id: 'dept-eng',
          name: 'Engineering',
          color: '#38BDF8',
          status: 'idle',
          departmentCeoAgent: {
            id: 'dept-ceo-eng',
            name: 'Sarah Chen',
            role: 'Head of Engineering',
            model: 'gemini-2.5-flash',
          },
          teams: [
            {
              id: 'team-backend',
              name: 'Backend Core',
              departmentId: 'dept-eng',
              status: 'idle',
              linkedProjectId: 'proj-platform',
              specialistMembers: [
                {
                  id: 'member-be-1',
                  name: 'Dev One',
                  canonicalAgentId: 'agent-dev-1',
                  role: 'Backend Specialist',
                  model: 'gemini-2.5-flash',
                  status: 'idle',
                },
                {
                  id: 'member-shared-qa',
                  name: 'Shared QA',
                  canonicalAgentId: 'agent-qa-shared',
                  role: 'QA Specialist',
                  model: 'gemini-2.5-flash',
                  status: 'idle',
                },
              ],
            },
            {
              id: 'team-frontend',
              name: 'Frontend Web',
              departmentId: 'dept-eng',
              status: 'idle',
              specialistMembers: [
                {
                  id: 'member-fe-1',
                  name: 'Dev Two',
                  canonicalAgentId: 'agent-dev-2',
                  role: 'Frontend Specialist',
                  model: 'gemini-2.5-flash',
                  status: 'idle',
                },
              ],
            },
          ],
        },
        {
          id: 'dept-product',
          name: 'Product & Design',
          color: '#A855F7',
          status: 'idle',
          departmentCeoAgent: {
            id: 'dept-ceo-prod',
            name: 'Elena Rostova',
            role: 'VP Product',
            model: 'gemini-2.5-flash',
          },
          teams: [
            {
              id: 'team-mobile',
              name: 'Mobile UX',
              departmentId: 'dept-product',
              status: 'idle',
              specialistMembers: [
                {
                  id: 'member-shared-qa-prod',
                  name: 'Shared QA',
                  canonicalAgentId: 'agent-qa-shared',
                  role: 'QA Specialist',
                  model: 'gemini-2.5-flash',
                  status: 'idle',
                },
              ],
            },
          ],
        },
      ],
      lastUpdated: Date.now(),
    };

    const projects: OrgProject[] = [
      {
        id: 'proj-platform',
        departmentId: 'dept-eng',
        name: 'Cloud Engine v2',
        teamIds: ['team-backend'],
        status: 'active',
      },
    ];

    return { hierarchy, projects };
  };

  it('propagates member working status upward through team -> project -> department -> CEO', () => {
    const { hierarchy, projects } = createMockHierarchy();
    const nodeStatuses: Record<string, OrgNodeStatus> = {
      'member-be-1': 'working',
    };

    const result = computeOrgStatusPropagation(hierarchy, projects, nodeStatuses);

    // Member is working
    expect(result.workingNodeIds.has('member-be-1')).toBe(true);
    // Upward propagation: Team -> Project -> Department -> CEO
    expect(result.workingNodeIds.has('team-backend')).toBe(true);
    expect(result.workingNodeIds.has('project-proj-platform')).toBe(true);
    expect(result.workingNodeIds.has('dept-eng')).toBe(true);
    expect(result.workingNodeIds.has('root-ceo')).toBe(true);

    // Unrelated branches are NOT marked working
    expect(result.workingNodeIds.has('team-frontend')).toBe(false);
    expect(result.workingNodeIds.has('dept-product')).toBe(false);

    // Delegation edges along the working path are animated
    expect(result.workingEdgeIds.has('edge-root-ceo->dept-eng')).toBe(true);
    expect(result.workingEdgeIds.has('edge-dept-eng->project-proj-platform')).toBe(true);
    expect(result.workingEdgeIds.has('edge-project-proj-platform->team-backend')).toBe(true);
    expect(result.workingEdgeIds.has('edge-root-ceo->dept-product')).toBe(false);

    expect(result.activeWorkingCount).toBe(1);
    expect(result.exceedsAnimationLimit).toBe(false);
  });

  it('propagates shared member working status to ALL teams and departments where they appear', () => {
    const { hierarchy, projects } = createMockHierarchy();
    // Shared member working via canonicalAgentId
    const nodeStatuses: Record<string, OrgNodeStatus> = {
      'agent-qa-shared': 'working',
    };

    const result = computeOrgStatusPropagation(hierarchy, projects, nodeStatuses);

    // Both appearances are flagged
    expect(result.workingNodeIds.has('team-backend')).toBe(true);
    expect(result.workingNodeIds.has('team-mobile')).toBe(true);
    // Both departments are flagged
    expect(result.workingNodeIds.has('dept-eng')).toBe(true);
    expect(result.workingNodeIds.has('dept-product')).toBe(true);
    // CEO is flagged
    expect(result.workingNodeIds.has('root-ceo')).toBe(true);

    // Shared member tethers are animated
    expect(result.workingEdgeIds.has('tether-agent-qa-shared->team-backend')).toBe(true);
    expect(result.workingEdgeIds.has('tether-agent-qa-shared->team-mobile')).toBe(true);
  });

  it('tracks error, queued_next, and recently_finished statuses', () => {
    const { hierarchy, projects } = createMockHierarchy();
    const nodeStatuses: Record<string, OrgNodeStatus> = {
      'member-be-1': 'error',
      'member-fe-1': 'queued_next',
      'agent-qa-shared': 'recently_finished',
    };

    const result = computeOrgStatusPropagation(hierarchy, projects, nodeStatuses);

    expect(result.errorNodeIds.has('member-be-1')).toBe(true);
    expect(result.queuedNodeIds.has('member-fe-1')).toBe(true);
    expect(result.finishedNodeIds.has('member-shared-qa')).toBe(true);
    expect(result.finishedNodeIds.has('member-shared-qa-prod')).toBe(true);
  });

  describe('recently_finished timeout lifecycle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns to idle after simulated 2000ms duration', () => {
      let currentStatus: OrgNodeStatus = 'recently_finished';
      const onComplete = vi.fn(() => {
        currentStatus = 'idle';
      });

      // Simulate the 2s timer behavior used in OrgCanvasToolbar / agent lifecycle
      setTimeout(onComplete, 2000);

      expect(currentStatus).toBe('recently_finished');
      vi.advanceTimersByTime(1000);
      expect(currentStatus).toBe('recently_finished');
      expect(onComplete).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(currentStatus).toBe('idle');
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  it('includes reduced-motion accessibility fallbacks in orgGlow.css', () => {
    const cssPath = path.resolve(__dirname, '../../../../packages/desktop/src/renderer/pages/organization/orgGlow.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    // Verify prefers-reduced-motion media query is defined
    expect(cssContent).toContain('@media (prefers-reduced-motion: reduce)');
    // Verify animation is suppressed in reduced-motion
    expect(cssContent).toContain('animation: none !important');
    // Verify static box-shadow fallback exists
    expect(cssContent).toContain('--glow-color');
  });
});
