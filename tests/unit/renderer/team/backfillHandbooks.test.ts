/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { backfillMissingHandbooks } from '@/renderer/utils/memberHandbook/backfillHandbooks';
import { memberHandbook } from '@/common/adapter/ipcBridge';
import type { TTeam } from '@/common/types/team/teamTypes';
import type { OrgHierarchy } from '@/types/organization';

describe('backfillMissingHandbooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects missing handbooks and calls memberHandbook.create for each', async () => {
    const mockGetStatus = vi.fn().mockImplementation(async ({ memberKey }) => {
      if (memberKey === 'team:t1:slot-1') {
        return { exists: true, status: 'created' };
      }
      return { exists: false, status: 'not_created' };
    });

    const mockCreate = vi.fn().mockResolvedValue({
      memberKey: 'mock',
      memberName: 'Mock',
      content: '',
      filePath: '',
      fileName: '',
      fileHash: 'hash',
      updatedAt: Date.now(),
      estimatedTokens: 10,
      budgetTokens: 3000,
    });

    vi.spyOn(memberHandbook, 'getStatus').mockImplementation(mockGetStatus);
    vi.spyOn(memberHandbook, 'create').mockImplementation(mockCreate);

    const testTeams: TTeam[] = [
      {
        id: 't1',
        user_id: 'u1',
        name: 'Alpha Team',
        workspace: '/ws',
        workspace_mode: 'shared',
        leader_assistant_id: 'slot-1',
        leader_agent_id: 'slot-1',
        assistants: [
          {
            slot_id: 'slot-1',
            conversation_id: 'c1',
            role: 'leader',
            assistant_backend: 'acp',
            assistant_name: 'Lead Architect',
            status: 'idle',
            pending_confirmations: 0,
            context_reset: { supported: true, availability: 'ready' },
          },
          {
            slot_id: 'slot-2',
            conversation_id: 'c2',
            role: 'teammate',
            assistant_backend: 'acp',
            assistant_name: 'android tester',
            status: 'idle',
            pending_confirmations: 0,
            context_reset: { supported: true, availability: 'ready' },
          },
        ],
        agents: [],
        created_at: 1,
        updated_at: 1,
      },
    ];

    const testHierarchy: OrgHierarchy = {
      rootCeo: {
        id: 'root-ceo',
        name: 'CEO Alice',
        parentId: null,
        status: 'idle',
        lastActiveAt: 1,
        ceoAgent: {
          id: 'agent-ceo',
          name: 'CEO Alice',
          role: 'CEO',
          assignedTeamIds: [],
          lastActiveAt: 1,
          status: 'idle',
          systemPrompt: 'Direct the organization.',
        },
      },
      departments: [],
      lastUpdated: 1,
    };

    const result = await backfillMissingHandbooks({
      teams: testTeams,
      hierarchy: testHierarchy,
    });

    expect(result.totalChecked).toBe(3); // slot-1, slot-2, root-ceo
    expect(result.skippedCount).toBe(1); // slot-1 was created
    expect(result.createdCount).toBe(2); // slot-2 and root-ceo created
    expect(result.errors.length).toBe(0);

    // Verify memberHandbook.create called for slot-2 (android tester)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        memberKey: 'team:t1:slot-2',
        memberName: 'android tester',
      })
    );

    // Verify memberHandbook.create called for root-ceo
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        memberKey: 'org:agent-ceo',
        memberName: 'CEO Alice',
        seedPrompt: 'Direct the organization.',
      })
    );
  });
});
