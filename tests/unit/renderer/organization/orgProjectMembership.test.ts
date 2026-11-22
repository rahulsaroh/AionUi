/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { OrgProject } from '@/types/organization';
import { addProjectMemberSource, removeProjectMemberSource } from '@/renderer/pages/organization/utils/orgCoherence';

const project: OrgProject = {
  id: 'project-1',
  name: 'Weekly Tech News',
  departmentId: 'youtube',
  teamIds: ['team-a', 'team-b'],
  status: 'active',
};

describe('project membership sources', () => {
  it('retains a directly assigned member when their team source is removed', () => {
    const assigned = addProjectMemberSource(
      addProjectMemberSource(project, 'member-1', 'team-a'),
      'member-1',
      'direct'
    );
    const next = removeProjectMemberSource(assigned, 'member-1', 'team-a');

    expect(next.memberIds).toEqual(['member-1']);
    expect(next.memberSources?.['member-1']).toEqual({ direct: true });
  });

  it('retains a member assigned through another team', () => {
    const assigned = addProjectMemberSource(
      addProjectMemberSource(project, 'member-1', 'team-a'),
      'member-1',
      'team-b'
    );
    const next = removeProjectMemberSource(assigned, 'member-1', 'team-a');

    expect(next.memberIds).toEqual(['member-1']);
    expect(next.memberSources?.['member-1']).toEqual({ teamIds: ['team-b'] });
  });

  it('removes a member when their only team source is removed', () => {
    const assigned = addProjectMemberSource(project, 'member-1', 'team-a');
    const next = removeProjectMemberSource(assigned, 'member-1', 'team-a');

    expect(next.memberIds).toEqual([]);
    expect(next.memberSources).toEqual({});
  });
});
