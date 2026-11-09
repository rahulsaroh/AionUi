/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  formatTelegramApprovalMessage,
  handleTelegramCallbackQuery,
} from '@/common/autonomy/telegramApprovalGateway';
import type { InboxApprovalItem } from '@/common/autonomy/approvalsInboxStore';
import * as inboxStore from '@/common/autonomy/approvalsInboxStore';

describe('Telegram Approval Gateway', () => {
  const mockItem: InboxApprovalItem = {
    id: 'item-tg-1',
    callId: 'call-tg-1',
    conversationId: 'conv-tg-1',
    title: 'Deploy to Staging',
    description: 'docker-compose up -d',
    command: 'docker-compose up -d',
    teamId: 'team-ops',
    teamName: 'Operations Team',
    agentName: 'DeployBot',
    options: [
      { label: 'Approve', value: 'proceed_once' },
      { label: 'Deny', value: 'cancel' },
    ],
    createdAt: Date.now(),
  };

  it('formats approval item into Telegram message with inline buttons', () => {
    const formatted = formatTelegramApprovalMessage(mockItem);

    expect(formatted.text).toContain('⚠️ *Approval Required*');
    expect(formatted.text).toContain('Operations Team');
    expect(formatted.text).toContain('DeployBot');
    expect(formatted.text).toContain('docker-compose up -d');

    const keyboard = formatted.reply_markup.inline_keyboard;
    expect(keyboard).toHaveLength(2);
    // Row 1: Approve and Deny
    expect(keyboard[0][0].text).toContain('Approve');
    expect(keyboard[0][0].callback_data).toBe('approve:conv-tg-1:call-tg-1');
    expect(keyboard[0][1].text).toContain('Deny');
    expect(keyboard[0][1].callback_data).toBe('deny:conv-tg-1:call-tg-1');
    // Row 2: Approve Always
    expect(keyboard[1][0].text).toContain('Approve Always');
    expect(keyboard[1][0].callback_data).toBe('approve_always:conv-tg-1:call-tg-1');
  });

  it('handles Telegram approve callback query', async () => {
    const spyApprove = vi.spyOn(inboxStore, 'approveInboxItem').mockResolvedValue();

    const res = await handleTelegramCallbackQuery(
      'approve:conv-tg-1:call-tg-1',
      { id: 12345, username: 'alice' },
      [mockItem]
    );

    expect(res.success).toBe(true);
    expect(res.responseText).toContain('Approved by @alice');
    expect(spyApprove).toHaveBeenCalledWith(mockItem, 'telegram');

    spyApprove.mockRestore();
  });

  it('handles Telegram deny callback query', async () => {
    const spyDeny = vi.spyOn(inboxStore, 'denyInboxItem').mockResolvedValue();

    const res = await handleTelegramCallbackQuery(
      'deny:conv-tg-1:call-tg-1',
      { id: 67890, username: 'bob' },
      [mockItem]
    );

    expect(res.success).toBe(true);
    expect(res.responseText).toContain('Denied by @bob');
    expect(spyDeny).toHaveBeenCalledWith(mockItem, 'telegram');

    spyDeny.mockRestore();
  });

  it('handles Telegram approve_always callback query', async () => {
    const spyAlways = vi.spyOn(inboxStore, 'approveAlwaysInboxItem').mockResolvedValue();

    const res = await handleTelegramCallbackQuery(
      'approve_always:conv-tg-1:call-tg-1',
      { id: 99999, username: 'charlie' },
      [mockItem]
    );

    expect(res.success).toBe(true);
    expect(res.responseText).toContain('Approved always by @charlie');
    expect(spyAlways).toHaveBeenCalledWith(mockItem, 'telegram');

    spyAlways.mockRestore();
  });
});
