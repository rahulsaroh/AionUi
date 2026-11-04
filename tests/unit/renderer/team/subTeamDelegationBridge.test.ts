import { describe, it, expect, vi } from 'vitest';
import {
  MAX_DELEGATION_DEPTH,
  getDirectChildTeams,
  buildSubTeamDelegationDirective,
  parseSubTeamDelegationRequests,
  executeSubTeamDelegation,
} from '@/renderer/pages/team/utils/subTeamDelegationBridge';
import type { TTeam } from '@/common/types/team/teamTypes';

function makeMockTeam(
  id: string,
  name: string,
  parentId: string | null = null,
  role?: string,
  desc?: string
): TTeam {
  return {
    id,
    user_id: 'user_1',
    name,
    workspace: `/workspace/${id}`,
    workspace_mode: 'shared',
    leader_assistant_id: 'lead_1',
    assistants: [],
    created_at: 1000,
    updated_at: 1000,
    parentId,
    departmentRole: role,
    description: desc,
  };
}

describe('Sub-Team Delegation Bridge & Hierarchical Encapsulation', () => {
  const rootDept = makeMockTeam('root', 'Engineering Dept', null);
  const mobileTeam = makeMockTeam('mobile', 'Mobile Team', 'root', 'Mobile App', 'Android & iOS');
  const backendTeam = makeMockTeam('backend', 'Backend Team', 'root', 'API Services');
  const iosSpecialist = makeMockTeam('ios', 'iOS Core', 'mobile', 'Swift Dev');
  const allTeams = [rootDept, mobileTeam, backendTeam, iosSpecialist];

  it('enforces scoped visibility (only 1 level down)', () => {
    const directChildren = getDirectChildTeams('root', allTeams);
    expect(directChildren.map((t) => t.id)).toEqual(['mobile', 'backend']);
    // 'ios' is 2 levels down from 'root' - MUST NOT be visible to root
    expect(directChildren.some((t) => t.id === 'ios')).toBe(false);
  });

  it('builds delegation directive with direct child teams only', () => {
    const directive = buildSubTeamDelegationDirective(rootDept, allTeams, 0);
    expect(directive).toContain('Mobile Team');
    expect(directive).toContain('Backend Team');
    expect(directive).not.toContain('iOS Core');
    expect(directive).toContain('[DELEGATE_TO_SUB_TEAM:');
    expect(directive).toContain(`Current Hierarchy Depth: 0`);
  });

  it('parses structured delegation requests from LLM text', () => {
    const rawText = `
      I will assign the mobile tasks to our mobile department.
      [DELEGATE_TO_SUB_TEAM: {"subTeamId": "mobile", "taskDirective": "Build login screen", "contextFiles": ["auth.ts"]}]
    `;
    const requests = parseSubTeamDelegationRequests(rawText);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      subTeamId: 'mobile',
      taskDirective: 'Build login screen',
      contextFiles: ['auth.ts'],
    });
  });

  it('enforces MAX_DELEGATION_DEPTH safeguard = 5', async () => {
    const req = {
      subTeamId: 'mobile',
      taskDirective: 'Deep call',
    };

    const res = await executeSubTeamDelegation({
      parentTeam: rootDept,
      allTeams,
      request: req,
      currentDepth: MAX_DELEGATION_DEPTH,
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('MAX_DELEGATION_DEPTH');
  });

  it('rejects delegation to non-child teams (hierarchical boundary protection)', async () => {
    const req = {
      subTeamId: 'ios', // ios is grandchild, not direct child
      taskDirective: 'Direct instruction attempt',
    };

    const res = await executeSubTeamDelegation({
      parentTeam: rootDept,
      allTeams,
      request: req,
      currentDepth: 0,
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Hierarchical violation');
  });
});
