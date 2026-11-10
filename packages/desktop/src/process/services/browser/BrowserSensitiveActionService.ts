/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import type { BrowserProfile } from '@/common/browser/types';
import type { IConfirmation } from '@/common/chat/chatLib';

export type SensitiveActionCategory =
  | 'publish'
  | 'send'
  | 'delete'
  | 'settings_change'
  | 'payment'
  | 'domain_navigation';

export type SensitiveClassificationResult = {
  isSensitive: boolean;
  category?: SensitiveActionCategory;
  reason?: string;
  summary: string;
};

type PendingApproval = {
  id: string;
  confirmation: IConfirmation;
  resolve: (approved: boolean) => void;
  reject: (err: Error) => void;
};

export class BrowserSensitiveActionService extends EventEmitter {
  private pendingApprovals: Map<string, PendingApproval> = new Map();

  /**
   * Classifies whether a browser action is sensitive based on action type,
   * URL patterns, locator text, and profile configuration.
   */
  public classifyAction(req: {
    action: string;
    url?: string;
    params?: Record<string, unknown>;
    profile?: BrowserProfile;
  }): SensitiveClassificationResult {
    const { action, url, params, profile } = req;
    const lowerUrl = (url || '').toLowerCase();
    const paramsStr = JSON.stringify(params || {}).toLowerCase();

    // 1. Payment patterns
    const paymentKeywords = ['checkout', 'payment', 'pay', 'billing', 'purchase', 'card-number', 'cvv', 'cardnumber'];
    const hasPaymentUrl = paymentKeywords.some((kw) => lowerUrl.includes(kw));
    const hasPaymentParam = paymentKeywords.some((kw) => paramsStr.includes(kw));

    if (hasPaymentUrl || hasPaymentParam) {
      return {
        isSensitive: true,
        category: 'payment',
        reason: 'Payment or checkout action detected',
        summary: `Action "${action}" on financial/payment flow (${url || 'page'})`,
      };
    }

    // 2. Settings & password change patterns
    const settingsKeywords = [
      'change-password',
      'reset-password',
      'password',
      'security-settings',
      'api-key',
      'billing-settings',
    ];
    const hasSettingsUrl = settingsKeywords.some((kw) => lowerUrl.includes(kw));
    const hasSettingsParam = settingsKeywords.some((kw) => paramsStr.includes(kw));

    if (hasSettingsUrl || hasSettingsParam) {
      return {
        isSensitive: true,
        category: 'settings_change',
        reason: 'Sensitive account settings or password change detected',
        summary: `Action "${action}" affecting sensitive security/account settings`,
      };
    }

    // 3. Delete patterns
    const deleteKeywords = ['delete', 'remove-account', 'destroy', 'cancel-subscription', 'purge'];
    const hasDeleteUrl = deleteKeywords.some((kw) => lowerUrl.includes(kw));
    const hasDeleteParam = deleteKeywords.some((kw) => paramsStr.includes(kw));

    if (hasDeleteUrl || hasDeleteParam) {
      return {
        isSensitive: true,
        category: 'delete',
        reason: 'Data or account deletion detected',
        summary: `Action "${action}" with destructive deletion risk`,
      };
    }

    // 4. Publish / post patterns
    const publishKeywords = ['publish', 'post-update', 'tweet', 'share-publicly', 'broadcast'];
    const hasPublishUrl = publishKeywords.some((kw) => lowerUrl.includes(kw));
    const hasPublishParam = publishKeywords.some((kw) => paramsStr.includes(kw));

    if (action === 'uploadFile' || hasPublishUrl || hasPublishParam) {
      return {
        isSensitive: true,
        category: 'publish',
        reason: 'Public posting or file upload detected',
        summary: `Action "${action}" publishing live content or uploading files`,
      };
    }

    // 5. Send message patterns
    const sendKeywords = ['send-message', 'direct-message', 'send-email', 'submit-comment'];
    if (sendKeywords.some((kw) => paramsStr.includes(kw))) {
      return {
        isSensitive: true,
        category: 'send',
        reason: 'Outbound messaging or communication detected',
        summary: `Action "${action}" sending outbound message or comment`,
      };
    }

    // 6. Custom sensitive URL patterns configured on profile
    if (profile?.sensitiveUrlPatterns && profile.sensitiveUrlPatterns.length > 0) {
      for (const pattern of profile.sensitiveUrlPatterns) {
        if (pattern && lowerUrl.includes(pattern.toLowerCase())) {
          return {
            isSensitive: true,
            category: 'settings_change',
            reason: `URL matches custom sensitive pattern "${pattern}"`,
            summary: `Action "${action}" on protected URL pattern`,
          };
        }
      }
    }

    return {
      isSensitive: false,
      summary: `Standard action "${action}"`,
    };
  }

  /**
   * Request user approval for a sensitive action via the Approvals Inbox / IConfirmation protocol.
   * If the profile has explicitly auto-approved this action, bypasses the prompt.
   */
  public async requestApproval(params: {
    category: SensitiveActionCategory;
    summary: string;
    reason: string;
    profile?: BrowserProfile;
    timeoutMs?: number;
  }): Promise<boolean> {
    const { category, summary, reason, profile, timeoutMs = 60000 } = params;

    // Check if explicitly allowed for this profile
    if (profile?.autoApproveActions && profile.autoApproveActions.includes(category)) {
      return true;
    }

    const id = `conf_browser_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const confirmation: IConfirmation = {
      id,
      call_id: callId,
      title: `Approval Required: ${category.toUpperCase()}`,
      description: `${reason}: ${summary}`,
      action: category,
      command_type: 'browser_action',
      options: [
        { label: 'Allow Action', value: 'proceed_once' },
        { label: 'Deny Action', value: 'cancel' },
      ],
    };

    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(id);
        resolve(false);
      }, timeoutMs);

      this.pendingApprovals.set(id, {
        id,
        confirmation,
        resolve: (approved) => {
          clearTimeout(timer);
          this.pendingApprovals.delete(id);
          resolve(approved);
        },
        reject: (err) => {
          clearTimeout(timer);
          this.pendingApprovals.delete(id);
          reject(err);
        },
      });

      // Emit event for UI (SafetyApprovalModal, Approvals Inbox, or Pet confirm)
      this.emit('sensitiveApprovalRequested', {
        id,
        confirmation,
        category,
        summary,
        profileId: profile?.id,
        profileName: profile?.name,
      });
    });
  }

  public respondApproval(id: string, approved: boolean): boolean {
    const pending = this.pendingApprovals.get(id);
    if (!pending) {
      return false;
    }
    pending.resolve(approved);
    return true;
  }

  public getPendingApprovals(): Array<{ id: string; confirmation: IConfirmation }> {
    return Array.from(this.pendingApprovals.values()).map((p) => ({
      id: p.id,
      confirmation: p.confirmation,
    }));
  }
}

let browserSensitiveActionServiceInstance: BrowserSensitiveActionService | null = null;

export function getBrowserSensitiveActionService(): BrowserSensitiveActionService {
  if (!browserSensitiveActionServiceInstance) {
    browserSensitiveActionServiceInstance = new BrowserSensitiveActionService();
  }
  return browserSensitiveActionServiceInstance;
}
