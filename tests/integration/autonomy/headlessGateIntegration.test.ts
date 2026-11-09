/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { HeadlessGateManager } from '@/common/autonomy/headlessGateManager';
import { evaluatePolicy } from '@/common/autonomy/policyEvaluator';
import type { ActionContext, AutonomyConfig } from '@/common/autonomy/types';

describe('Headless Gate Handling - Integration Test', () => {
  const manager = new HeadlessGateManager();

  // Simulates a headless cron runner execution
  async function simulateHeadlessCronRun(
    gateManager: HeadlessGateManager,
    config: AutonomyConfig,
    action: ActionContext,
    options?: { timeoutMs?: number; gateId?: string }
  ) {
    const policyResult = evaluatePolicy(action, config);

    // If auto-approved by policy, execute immediately
    if (policyResult.allowed) {
      return {
        status: 'executed_immediately',
        actionExecuted: true,
      };
    }

    // Gated action: must park and wait for human approval
    const resolution = await gateManager.parkGate({
      id: options?.gateId,
      jobId: 'cron-job-backup-daily',
      conversationId: 'conv-cron-123',
      callId: 'call-bash-999',
      actionTitle: 'Execute Maintenance Script',
      actionDescription: action.command || 'File modification',
      commandType: 'bash',
      teamId: 'team-infra',
      projectId: 'proj-cloud-sync',
      agentName: 'DevOps Bot',
      timeoutMs: options?.timeoutMs ?? 5000,
    });

    if (resolution.approved) {
      // Resumes run
      return {
        status: 'resumed_and_executed',
        actionExecuted: true,
        channel: resolution.channel,
      };
    }

    if (resolution.expired) {
      // Clean expired state
      return {
        status: 'expired',
        actionExecuted: false,
        reason: resolution.reason,
      };
    }

    // Denied gracefully
    return {
      status: 'denied_gracefully',
      actionExecuted: false,
      reason: resolution.reason,
    };
  }

  it('parks when hitting gated action, appears in inbox, and approve resumes it', async () => {
    const config: AutonomyConfig = { profile: 'ask' }; // headless defaults to ask
    const action: ActionContext = {
      category: 'shell_exec',
      command: 'docker restart production-service',
      projectPath: '/workspace',
      isOutsideWorkspace: true,
    };

    const gateId = 'gate-approve-test';

    // Start headless cron run in background
    const runPromise = simulateHeadlessCronRun(manager, config, action, { gateId });

    // Verify it parked and appears in the inbox
    const pendingList = manager.getPendingGates();
    expect(pendingList).toHaveLength(1);
    expect(pendingList[0].id).toBe(gateId);
    expect(pendingList[0].status).toBe('waiting_for_approval');
    expect(pendingList[0].actionTitle).toBe('Execute Maintenance Script');
    expect(pendingList[0].teamId).toBe('team-infra');
    expect(pendingList[0].agentName).toBe('DevOps Bot');

    // Human approves via Inbox
    const approved = manager.approveGate(gateId, { channel: 'inbox', resolvedBy: 'admin' });
    expect(approved).toBe(true);

    // Run completes successfully
    const result = await runPromise;
    expect(result.status).toBe('resumed_and_executed');
    expect(result.actionExecuted).toBe(true);
    expect(result.channel).toBe('inbox');

    // Inbox no longer has pending gate
    expect(manager.getPendingGates()).toHaveLength(0);

    const gateState = manager.getGate(gateId);
    expect(gateState?.status).toBe('approved');
  });

  it('parks when hitting gated action, appears in inbox, and deny ends it gracefully', async () => {
    const config: AutonomyConfig = { profile: 'ask' };
    const action: ActionContext = {
      category: 'file_delete',
      targetPath: '/workspace/important-data.json',
      projectPath: '/workspace',
    };

    const gateId = 'gate-deny-test';
    const runPromise = simulateHeadlessCronRun(manager, config, action, { gateId });

    // Verify it is parked in inbox
    expect(manager.getPendingGates().some((g) => g.id === gateId)).toBe(true);

    // Human denies via Inbox
    const denied = manager.denyGate(gateId, { channel: 'inbox', reason: 'Blocked by security audit' });
    expect(denied).toBe(true);

    // Run terminates gracefully without crashing
    const result = await runPromise;
    expect(result.status).toBe('denied_gracefully');
    expect(result.actionExecuted).toBe(false);
    expect(result.reason).toBe('Blocked by security audit');

    expect(manager.getPendingGates().some((g) => g.id === gateId)).toBe(false);
    const gateState = manager.getGate(gateId);
    expect(gateState?.status).toBe('denied');
  });

  it('parks when hitting gated action, times out, and marks clean expired state', async () => {
    const config: AutonomyConfig = { profile: 'ask' };
    const action: ActionContext = {
      category: 'network',
      domain: 'unknown-third-party.api',
      projectPath: '/workspace',
    };

    const gateId = 'gate-timeout-test';
    // Short timeout 50ms for test
    const runPromise = simulateHeadlessCronRun(manager, config, action, { gateId, timeoutMs: 50 });

    expect(manager.getPendingGates().some((g) => g.id === gateId)).toBe(true);

    // Wait for timeout to fire
    const result = await runPromise;
    expect(result.status).toBe('expired');
    expect(result.actionExecuted).toBe(false);

    expect(manager.getPendingGates().some((g) => g.id === gateId)).toBe(false);
    const gateState = manager.getGate(gateId);
    expect(gateState?.status).toBe('expired');
  });
});
