/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import type { IConfirmation } from '@/common/chat/chatLib';
import { headlessGateManager } from './headlessGateManager';
import { addRememberedRule } from './rulesStore';
import { recordAuditLog } from './auditLogStore';
import type { AuditChannel, HeadlessGateItem } from './types';

export interface PublishPreviewData {
  platform: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  title: string;
  description?: string;
  contentHash?: string;
}

export interface InboxApprovalItem {
  id: string; // unique ID
  callId: string; // IConfirmation call_id
  conversationId: string;
  msgId?: string;
  teamId?: string;
  teamName?: string;
  projectId?: string;
  projectName?: string;
  agentName?: string;
  agentAvatar?: string;
  title: string;
  description?: string;
  command?: string;
  diffPreview?: string;
  action?: string;
  commandType?: string;
  options: Array<{ label: string; value: string }>;
  isHeadless?: boolean;
  jobId?: string;
  publishPreview?: PublishPreviewData;
  createdAt: number;
  expiresAt?: number;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

const STORAGE_KEY = 'aionui:approvals-inbox';
let inMemoryItems: Map<string, InboxApprovalItem> = new Map();

export function loadInboxItems(): InboxApprovalItem[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as InboxApprovalItem[];
        inMemoryItems.clear();
        for (const item of arr) {
          inMemoryItems.set(item.id, item);
        }
      }
    }
  } catch (e) {
    console.warn('[approvalsInboxStore] Failed to read from localStorage:', e);
  }
  return Array.from(inMemoryItems.values());
}

export function saveInboxItems(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const arr = Array.from(inMemoryItems.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    }
  } catch (e) {
    console.warn('[approvalsInboxStore] Failed to write to localStorage:', e);
  }
  notify();
}

export function addInboxItem(item: InboxApprovalItem): void {
  inMemoryItems.set(item.id, item);
  saveInboxItems();
}

export function removeInboxItem(idOrCallId: string): void {
  let removed = false;
  if (inMemoryItems.has(idOrCallId)) {
    inMemoryItems.delete(idOrCallId);
    removed = true;
  } else {
    for (const [id, item] of inMemoryItems.entries()) {
      if (item.callId === idOrCallId || item.id === idOrCallId) {
        inMemoryItems.delete(id);
        removed = true;
        break;
      }
    }
  }
  if (removed) {
    saveInboxItems();
  }
}

export function clearInboxItems(): void {
  inMemoryItems.clear();
  saveInboxItems();
}

export function fromConfirmation(
  conversationId: string,
  conf: IConfirmation,
  extra?: { teamId?: string; teamName?: string; projectId?: string; projectName?: string; agentName?: string }
): InboxApprovalItem {
  const options = Array.isArray(conf.options)
    ? conf.options.map((o) => ({ label: o?.label || String(o?.value || ''), value: String(o?.value || '') }))
    : [
        { label: 'Allow', value: 'proceed_once' },
        { label: 'Deny', value: 'cancel' },
      ];

  return {
    id: `conf_${conversationId}_${conf.call_id || conf.id}`,
    callId: conf.call_id || conf.id,
    conversationId,
    teamId: extra?.teamId,
    teamName: extra?.teamName,
    projectId: extra?.projectId,
    projectName: extra?.projectName,
    agentName: extra?.agentName,
    title: conf.title || conf.description || 'Permission Request',
    description: conf.description,
    command: conf.command_type || conf.action,
    action: conf.action,
    commandType: conf.command_type,
    options,
    isHeadless: false,
    createdAt: Date.now(),
  };
}

export function fromHeadlessGate(gate: HeadlessGateItem): InboxApprovalItem {
  return {
    id: gate.id,
    callId: gate.callId,
    conversationId: gate.conversationId,
    teamId: gate.teamId,
    teamName: gate.teamId ? `Team ${gate.teamId}` : undefined,
    projectId: gate.projectId,
    agentName: gate.agentName || 'Headless Agent',
    title: gate.actionTitle || 'Headless Action Confirmation',
    description: gate.actionDescription,
    command: gate.commandPreview,
    diffPreview: gate.diffPreview,
    commandType: gate.commandType,
    options: [
      { label: 'Approve', value: 'proceed_once' },
      { label: 'Deny', value: 'cancel' },
    ],
    isHeadless: true,
    jobId: gate.jobId,
    createdAt: gate.createdAt,
    expiresAt: gate.expiresAt,
  };
}

/**
 * Approve a single item.
 */
export async function approveInboxItem(item: InboxApprovalItem, channel: AuditChannel = 'inbox'): Promise<void> {
  // 1. Call backend IConfirmation endpoint
  try {
    await ipcBridge.conversation.confirmation.confirm.invoke({
      conversation_id: item.conversationId,
      call_id: item.callId,
      msg_id: item.msgId || '',
      data: { value: 'proceed_once' },
      always_allow: false,
    });
  } catch (e) {
    console.warn('[approvalsInboxStore] Backend confirmation failed:', e);
  }

  // 2. Unblock headless gate if headless
  if (item.isHeadless) {
    headlessGateManager.approveGate(item.id, { channel, resolvedBy: 'user' });
  }

  // 3. Record audit log
  recordAuditLog({
    confirmationId: item.callId,
    conversationId: item.conversationId,
    projectId: item.projectId,
    teamId: item.teamId,
    action: item.title,
    actionType: item.action || item.commandType,
    decision: 'approved',
    decisionBy: 'user',
    channel,
    details: item.command || item.description,
  });

  // 4. Remove from inbox
  removeInboxItem(item.id);
}

/**
 * Deny a single item.
 */
export async function denyInboxItem(item: InboxApprovalItem, channel: AuditChannel = 'inbox'): Promise<void> {
  try {
    await ipcBridge.conversation.confirmation.confirm.invoke({
      conversation_id: item.conversationId,
      call_id: item.callId,
      msg_id: item.msgId || '',
      data: { value: 'cancel' },
      always_allow: false,
    });
  } catch (e) {
    console.warn('[approvalsInboxStore] Backend deny failed:', e);
  }

  if (item.isHeadless) {
    headlessGateManager.denyGate(item.id, { channel, resolvedBy: 'user' });
  }

  recordAuditLog({
    confirmationId: item.callId,
    conversationId: item.conversationId,
    projectId: item.projectId,
    teamId: item.teamId,
    action: item.title,
    actionType: item.action || item.commandType,
    decision: 'denied',
    decisionBy: 'user',
    channel,
    details: item.command || item.description,
  });

  removeInboxItem(item.id);
}

/**
 * Approve Always: saves remembered rule and approves.
 */
export async function approveAlwaysInboxItem(item: InboxApprovalItem, channel: AuditChannel = 'inbox'): Promise<void> {
  // 1. Save remembered rule
  const projectId = item.projectId || 'default';
  const pattern = item.command || item.action || '*';
  addRememberedRule({
    projectId,
    tool: item.action || item.commandType || 'action',
    pattern,
    actionType: item.action,
  });

  // 2. Call backend with always_allow: true
  try {
    await ipcBridge.conversation.confirmation.confirm.invoke({
      conversation_id: item.conversationId,
      call_id: item.callId,
      msg_id: item.msgId || '',
      data: { value: 'proceed_always' },
      always_allow: true,
    });
  } catch (e) {
    console.warn('[approvalsInboxStore] Backend approve-always failed:', e);
  }

  if (item.isHeadless) {
    headlessGateManager.approveGate(item.id, { channel, resolvedBy: 'user' });
  }

  recordAuditLog({
    confirmationId: item.callId,
    conversationId: item.conversationId,
    projectId: item.projectId,
    teamId: item.teamId,
    action: item.title,
    actionType: item.action || item.commandType,
    decision: 'approved',
    decisionBy: 'user',
    channel,
    details: `Approve Always (rule saved for project ${projectId}: ${pattern})`,
  });

  removeInboxItem(item.id);
}

/**
 * Batch approve multiple items.
 */
export async function batchApproveItems(items: InboxApprovalItem[], channel: AuditChannel = 'inbox'): Promise<void> {
  for (const item of items) {
    await approveInboxItem(item, channel);
  }
}

/**
 * Batch deny multiple items.
 */
export async function batchDenyItems(items: InboxApprovalItem[], channel: AuditChannel = 'inbox'): Promise<void> {
  for (const item of items) {
    await denyInboxItem(item, channel);
  }
}

/**
 * React hook to access and manage the Approvals Inbox.
 */
export function useApprovalsInbox(): {
  items: InboxApprovalItem[];
  pendingCount: number;
  approve: (item: InboxApprovalItem, channel?: AuditChannel) => Promise<void>;
  deny: (item: InboxApprovalItem, channel?: AuditChannel) => Promise<void>;
  approveAlways: (item: InboxApprovalItem, channel?: AuditChannel) => Promise<void>;
  batchApprove: (items: InboxApprovalItem[], channel?: AuditChannel) => Promise<void>;
  batchDeny: (items: InboxApprovalItem[], channel?: AuditChannel) => Promise<void>;
  addItem: (item: InboxApprovalItem) => void;
  removeItem: (idOrCallId: string) => void;
} {
  const [items, setItems] = useState<InboxApprovalItem[]>(() => loadInboxItems());

  useEffect(() => {
    const handleUpdate = () => {
      setItems(loadInboxItems());
    };
    listeners.add(handleUpdate);

    // Listen to headless gate manager events
    const onGateParked = (gate: HeadlessGateItem) => {
      addInboxItem(fromHeadlessGate(gate));
    };
    const onGateResolved = ({ item }: { item: HeadlessGateItem }) => {
      removeInboxItem(item.id);
    };
    const onGateExpired = (item: HeadlessGateItem) => {
      removeInboxItem(item.id);
    };

    headlessGateManager.on('gate:parked', onGateParked);
    headlessGateManager.on('gate:resolved', onGateResolved);
    headlessGateManager.on('gate:expired', onGateExpired);

    // Listen to IPC confirmation removals
    let offIpc: (() => void) | undefined;
    try {
      offIpc = ipcBridge.conversation.confirmation.remove.on((data) => {
        removeInboxItem(data.id);
      });
    } catch {
      // IPC not available in tests or web-only mode
    }

    return () => {
      listeners.delete(handleUpdate);
      headlessGateManager.off('gate:parked', onGateParked);
      headlessGateManager.off('gate:resolved', onGateResolved);
      headlessGateManager.off('gate:expired', onGateExpired);
      if (offIpc) offIpc();
    };
  }, []);

  const approve = useCallback(async (item: InboxApprovalItem, channel?: AuditChannel) => {
    await approveInboxItem(item, channel);
  }, []);

  const deny = useCallback(async (item: InboxApprovalItem, channel?: AuditChannel) => {
    await denyInboxItem(item, channel);
  }, []);

  const approveAlways = useCallback(async (item: InboxApprovalItem, channel?: AuditChannel) => {
    await approveAlwaysInboxItem(item, channel);
  }, []);

  const batchApprove = useCallback(async (selectedItems: InboxApprovalItem[], channel?: AuditChannel) => {
    await batchApproveItems(selectedItems, channel);
  }, []);

  const batchDeny = useCallback(async (selectedItems: InboxApprovalItem[], channel?: AuditChannel) => {
    await batchDenyItems(selectedItems, channel);
  }, []);

  return {
    items,
    pendingCount: items.length,
    approve,
    deny,
    approveAlways,
    batchApprove,
    batchDeny,
    addItem: addInboxItem,
    removeItem: removeInboxItem,
  };
}
