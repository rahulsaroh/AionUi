/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { approveAlwaysInboxItem, approveInboxItem, denyInboxItem, type InboxApprovalItem } from './approvalsInboxStore';

export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

export interface TelegramApprovalMessage {
  text: string;
  reply_markup: {
    inline_keyboard: TelegramInlineButton[][];
  };
}

export interface TelegramUser {
  id: number | string;
  username?: string;
  first_name?: string;
}

/**
 * Formats a pending approval item into a Telegram message with inline buttons.
 */
export function formatTelegramApprovalMessage(item: InboxApprovalItem): TelegramApprovalMessage {
  const teamInfo = item.teamName ? `\n👥 Team: ${item.teamName}` : '';
  const agentInfo = item.agentName ? `\n🤖 Agent: ${item.agentName}` : '';
  const cmdInfo = item.command ? `\n💻 Command: \`${item.command}\`` : '';
  const descInfo = item.description ? `\n📝 ${item.description}` : '';

  const text = `⚠️ *Approval Required*${teamInfo}${agentInfo}\n*Action:* ${item.title}${cmdInfo}${descInfo}`;

  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `approve:${item.conversationId}:${item.callId}` },
          { text: '❌ Deny', callback_data: `deny:${item.conversationId}:${item.callId}` },
        ],
        [
          {
            text: '⚡ Approve Always (Project)',
            callback_data: `approve_always:${item.conversationId}:${item.callId}`,
          },
        ],
      ],
    },
  };
}

/**
 * Handles an incoming Telegram callback_query from an inline button click.
 */
export async function handleTelegramCallbackQuery(
  callbackData: string,
  user: TelegramUser,
  items: InboxApprovalItem[]
): Promise<{ success: boolean; responseText: string }> {
  const parts = callbackData.split(':');
  if (parts.length < 3) {
    return { success: false, responseText: 'Invalid callback data' };
  }

  const [action, conversationId, callId] = parts;
  const item = items.find((i) => i.conversationId === conversationId && i.callId === callId);

  if (!item) {
    return { success: false, responseText: 'Approval item not found or already resolved.' };
  }

  const username = user.username || user.first_name || String(user.id);

  if (action === 'approve') {
    await approveInboxItem(item, 'telegram');
    return { success: true, responseText: `✅ Approved by @${username}` };
  }

  if (action === 'deny') {
    await denyInboxItem(item, 'telegram');
    return { success: true, responseText: `❌ Denied by @${username}` };
  }

  if (action === 'approve_always') {
    await approveAlwaysInboxItem(item, 'telegram');
    return { success: true, responseText: `⚡ Approved always by @${username}` };
  }

  return { success: false, responseText: `Unknown action: ${action}` };
}
