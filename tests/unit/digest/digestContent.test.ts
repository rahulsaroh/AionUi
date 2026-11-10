/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateMorningDigest } from '@/common/digest/digestGenerator';
import {
  clearCostLedgerForTesting,
  recordRunStart,
  updateRunStatus,
  recordUsage,
} from '@/common/costs/costLedgerStore';
import type { InboxApprovalItem } from '@/common/autonomy/approvalsInboxStore';

describe('Morning Digest Content Generator', () => {
  beforeEach(() => {
    clearCostLedgerForTesting();
  });

  it('generates accurate digest summary matching expected structure and snapshot', () => {
    const fixedNow = 1773043200000; // 2026-03-09T08:00:00.000Z
    const run1Time = fixedNow - 3 * 3600 * 1000;
    const run2Time = fixedNow - 2 * 3600 * 1000;
    const run3Time = fixedNow - 1 * 3600 * 1000;

    // Run 1: completed with usage
    recordRunStart({
      id: 'run_comp_1',
      project_id: 'proj_marketing',
      team_id: 'team_copywriters',
      trigger: 'cron',
      started_at: run1Time,
    });
    recordUsage({
      run_id: 'run_comp_1',
      agent_role: 'copywriter',
      provider: 'openai',
      model: 'gpt-4o',
      input_tokens: 50_000,
      output_tokens: 10_000,
      estimated_cost: 0.225,
      created_at: run1Time + 5000,
    });
    updateRunStatus('run_comp_1', 'completed', run1Time + 30000);

    // Run 2: failed
    recordRunStart({
      id: 'run_fail_2',
      team_id: 'team_data',
      trigger: 'manual',
      started_at: run2Time,
    });
    updateRunStatus('run_fail_2', 'failed', run2Time + 15000);

    // Run 3: waiting/running with unknown CLI agent usage
    recordRunStart({
      id: 'run_wait_3',
      trigger: 'channel',
      started_at: run3Time,
    });
    recordUsage({
      run_id: 'run_wait_3',
      agent_role: 'terminal_runner',
      provider: 'external_cli',
      model: 'claude_code_cli',
      input_tokens: null,
      output_tokens: null,
      estimated_cost: null,
      created_at: run3Time + 2000,
    });

    // Mock pending approvals
    const mockApprovals: InboxApprovalItem[] = [
      {
        id: 'app_1',
        callId: 'call_99',
        conversationId: 'conv_123',
        title: 'Deploy to Staging',
        teamName: 'DevOps',
        agentName: 'DeployBot',
        command: 'kubectl apply -f deployment.yaml',
        options: [{ label: 'Approve', value: 'yes' }],
        createdAt: fixedNow - 30 * 60 * 1000,
      },
    ];

    const digest = generateMorningDigest({
      now: fixedNow,
      injectedApprovals: mockApprovals,
    });

    expect(digest.runs.completed).toBe(1);
    expect(digest.runs.failed).toBe(1);
    expect(digest.runs.waiting).toBe(1);
    expect(digest.runs.total).toBe(3);

    expect(digest.outputs).toHaveLength(1);
    expect(digest.outputs[0].link).toBe('#/team/team_copywriters');

    expect(digest.approvals).toHaveLength(1);
    expect(digest.approvals[0].title).toBe('Deploy to Staging');
    expect(digest.approvals[0].teamName).toBe('DevOps');

    // Unknown usage should be flagged and displayed as unknown/est
    expect(digest.spend.hasUnknown).toBe(true);
    expect(digest.spend.costText).toContain('unknown');

    // Snapshot test for generated markdown
    expect(digest.markdown).toMatchSnapshot();
  });
});
