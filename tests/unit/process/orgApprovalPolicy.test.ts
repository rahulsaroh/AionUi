/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateApproval,
  normalizeApprovalPolicy,
  DEFAULT_APPROVAL_POLICY,
  type ApprovalContext,
} from '../../../packages/desktop/src/process/services/org/orgApprovalPolicy';

describe('orgApprovalPolicy: three-level policy evaluation', () => {
  it('defaults to auto_edit', () => {
    expect(DEFAULT_APPROVAL_POLICY).toBe('auto_edit');
    expect(normalizeApprovalPolicy(undefined)).toBe('auto_edit');
    expect(normalizeApprovalPolicy('bogus')).toBe('auto_edit');
    expect(normalizeApprovalPolicy('read_only')).toBe('read_only');
  });

  it('read_only: reads free, writes and shell ask', () => {
    const base: ApprovalContext = { policy: 'read_only', toolKind: 'read', inFolder: true };
    expect(evaluateApproval(base).decision).toBe('allow');

    expect(evaluateApproval({ ...base, toolKind: 'write' }).decision).toBe('ask');
    expect(evaluateApproval({ ...base, toolKind: 'shell' }).decision).toBe('ask');
  });

  it('auto_edit: reads and in-folder writes free, shell asks', () => {
    const base: ApprovalContext = { policy: 'auto_edit', toolKind: 'write', inFolder: true };
    expect(evaluateApproval(base).decision).toBe('allow');
    expect(evaluateApproval({ ...base, toolKind: 'read' }).decision).toBe('allow');
    expect(evaluateApproval({ ...base, toolKind: 'shell' }).decision).toBe('ask');
  });

  it('full_auto: in-folder reads, writes and shell all free', () => {
    const base: ApprovalContext = { policy: 'full_auto', toolKind: 'shell', inFolder: true };
    expect(evaluateApproval(base).decision).toBe('allow');
    expect(evaluateApproval({ ...base, toolKind: 'write' }).decision).toBe('allow');
    expect(evaluateApproval({ ...base, toolKind: 'read' }).decision).toBe('allow');
  });

  it('any operation outside the folder always asks, regardless of policy', () => {
    for (const policy of ['read_only', 'auto_edit', 'full_auto'] as const) {
      for (const toolKind of ['read', 'write', 'shell'] as const) {
        const d = evaluateApproval({ policy, toolKind, inFolder: false });
        expect(d.decision).toBe('ask');
        expect(d.reason).toMatch(/outside the assigned project folder/);
      }
    }
  });

  it('alwaysAskReason forces ask even under full_auto', () => {
    const d = evaluateApproval({
      policy: 'full_auto',
      toolKind: 'shell',
      inFolder: true,
      alwaysAskReason: 'git push --force',
    });
    expect(d.decision).toBe('ask');
    expect(d.reason).toBe('git push --force');
  });

  it('destructive-outside under full_auto asks (destructive + outside)', () => {
    const d = evaluateApproval({
      policy: 'full_auto',
      toolKind: 'shell',
      inFolder: false,
      alwaysAskReason: 'rm outside folder',
    });
    expect(d.decision).toBe('ask');
    expect(d.reason).toBe('rm outside folder');
  });
});
