/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ApprovalsInboxPage } from '@/renderer/pages/approvals/ApprovalsInboxPage';
import { addInboxItem, clearInboxItems, type InboxApprovalItem } from '@/common/autonomy/approvalsInboxStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue || _key,
  }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      success: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      confirmation: {
        confirm: {
          invoke: vi.fn().mockResolvedValue({}),
        },
        remove: {
          on: vi.fn().mockReturnValue(() => {}),
        },
      },
    },
  },
}));

describe('ApprovalsInboxPage Component', () => {
  const itemAlpha: InboxApprovalItem = {
    id: 'conf-team-alpha',
    callId: 'call-alpha-1',
    conversationId: 'conv-alpha-1',
    teamId: 'team-alpha',
    teamName: 'Team Alpha',
    agentName: 'AlphaBot',
    title: 'Deploy Microservice Alpha',
    command: 'kubectl apply -f alpha.yaml',
    action: 'shell_exec',
    options: [
      { label: 'Approve', value: 'proceed_once' },
      { label: 'Deny', value: 'cancel' },
    ],
    createdAt: Date.now(),
  };

  const itemBeta: InboxApprovalItem = {
    id: 'conf-team-beta',
    callId: 'call-beta-1',
    conversationId: 'conv-beta-1',
    teamId: 'team-beta',
    teamName: 'Team Beta',
    agentName: 'BetaBot',
    title: 'Run Migration Beta',
    command: 'prisma migrate deploy',
    action: 'shell_exec',
    options: [
      { label: 'Approve', value: 'proceed_once' },
      { label: 'Deny', value: 'cancel' },
    ],
    createdAt: Date.now(),
  };

  beforeEach(() => {
    clearInboxItems();
  });

  it('lists items from two different teams, supports batch approve, and updates state', async () => {
    addInboxItem(itemAlpha);
    addInboxItem(itemBeta);

    render(<ApprovalsInboxPage />);

    // 1. Verify items from both teams are listed
    const cardAlpha = screen.getByTestId('approval-item-conf-team-alpha');
    const cardBeta = screen.getByTestId('approval-item-conf-team-beta');
    expect(cardAlpha).toBeInTheDocument();
    expect(cardBeta).toBeInTheDocument();
    expect(within(cardAlpha).getByText('Team Alpha')).toBeInTheDocument();
    expect(within(cardBeta).getByText('Team Beta')).toBeInTheDocument();
    expect(within(cardAlpha).getByText('Deploy Microservice Alpha')).toBeInTheDocument();
    expect(within(cardBeta).getByText('Run Migration Beta')).toBeInTheDocument();

    // 2. Select All
    const selectAllCheckbox = screen.getByTestId('checkbox-select-all').querySelector('input');
    expect(selectAllCheckbox).toBeInTheDocument();
    fireEvent.click(selectAllCheckbox!);

    // 3. Batch approve button appears
    const batchApproveBtn = await screen.findByTestId('btn-batch-approve');
    expect(batchApproveBtn).toBeInTheDocument();
    fireEvent.click(batchApproveBtn);

    // 4. Items are approved and removed
    await waitFor(() => {
      expect(screen.queryByTestId('approval-item-conf-team-alpha')).not.toBeInTheDocument();
      expect(screen.queryByTestId('approval-item-conf-team-beta')).not.toBeInTheDocument();
    });
  });

  it('handles single item approve and single item deny', async () => {
    addInboxItem(itemAlpha);
    addInboxItem(itemBeta);

    render(<ApprovalsInboxPage />);

    // Approve item Alpha
    const btnApproveAlpha = screen.getByTestId('btn-approve-conf-team-alpha');
    fireEvent.click(btnApproveAlpha);

    await waitFor(() => {
      expect(screen.queryByTestId('approval-item-conf-team-alpha')).not.toBeInTheDocument();
      expect(screen.getByTestId('approval-item-conf-team-beta')).toBeInTheDocument();
    });

    // Deny item Beta
    const btnDenyBeta = screen.getByTestId('btn-deny-conf-team-beta');
    fireEvent.click(btnDenyBeta);

    await waitFor(() => {
      expect(screen.queryByTestId('approval-item-conf-team-beta')).not.toBeInTheDocument();
    });
  });
});
