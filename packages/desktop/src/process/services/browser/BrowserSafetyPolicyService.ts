/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserProfileMode } from '@/common/browser/types';

export class BrowserSafetyPolicyService {
  /**
   * Check if a URL hostname matches the profile's allowed domains.
   * If allowedDomains is undefined or empty, returns true (no domain restriction).
   */
  public isDomainAllowed(targetUrl: string, allowedDomains?: string[]): boolean {
    if (!allowedDomains || allowedDomains.length === 0) {
      return true;
    }

    const trimmed = (targetUrl || '').trim();
    if (!trimmed || trimmed === 'about:blank' || trimmed.startsWith('about:')) {
      return true;
    }

    try {
      let urlWithScheme = trimmed;
      if (!/^https?:\/\//i.test(urlWithScheme) && !/^file:\/\//i.test(urlWithScheme)) {
        urlWithScheme = `https://${urlWithScheme}`;
      }

      const parsed = new URL(urlWithScheme);
      const hostname = parsed.hostname.toLowerCase();

      for (const pattern of allowedDomains) {
        const cleanPattern = pattern.trim().toLowerCase();
        if (!cleanPattern) continue;

        // Wildcard support: *.example.com or .example.com
        if (cleanPattern.startsWith('*.')) {
          const rootDomain = cleanPattern.slice(2);
          if (hostname === rootDomain || hostname.endsWith(`.${rootDomain}`)) {
            return true;
          }
        } else if (cleanPattern.startsWith('.')) {
          const rootDomain = cleanPattern.slice(1);
          if (hostname === rootDomain || hostname.endsWith(`.${rootDomain}`)) {
            return true;
          }
        } else {
          // Exact match or subdomains
          if (hostname === cleanPattern || hostname.endsWith(`.${cleanPattern}`)) {
            return true;
          }
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Throws an error if the URL domain is outside the profile's allowlist.
   */
  public assertDomainAllowed(targetUrl: string, allowedDomains?: string[], profileName?: string): void {
    if (!this.isDomainAllowed(targetUrl, allowedDomains)) {
      let hostname = targetUrl;
      try {
        const parsed = new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`);
        hostname = parsed.hostname;
      } catch {
        // Ignored
      }
      throw new Error(
        `Navigation blocked: Domain "${hostname}" is not in the allowlist for profile "${profileName || 'active'}". Navigation is prohibited.`
      );
    }
  }

  /**
   * Enforces Research vs Act mode restrictions.
   * In Research mode, no form submissions, uploads, or state-changing actions are permitted.
   */
  public assertModePermitsAction(
    action: string,
    mode?: BrowserProfileMode,
    profileName?: string,
    params?: Record<string, unknown>
  ): void {
    if (mode !== 'research') {
      return;
    }

    // Always disallowed in Research mode
    const strictlyDisallowedActions = ['uploadFile', 'type', 'select'];
    if (strictlyDisallowedActions.includes(action)) {
      throw new Error(
        `Action blocked: Profile "${profileName || 'active'}" is in Research mode (read-only). State-changing action "${action}" is prohibited.`
      );
    }

    // Check click targets for state-changing forms/buttons
    if (action === 'click' && params) {
      const locatorStr = JSON.stringify(params).toLowerCase();
      const stateChangingKeywords = [
        'type="submit"',
        'submit',
        'post',
        'publish',
        'delete',
        'remove',
        'save',
        'checkout',
        'buy',
        'pay',
        'confirm',
        'update',
      ];

      for (const kw of stateChangingKeywords) {
        if (locatorStr.includes(kw)) {
          throw new Error(
            `Action blocked: Profile "${profileName || 'active'}" is in Research mode (read-only). State-changing click on "${kw}" is prohibited.`
          );
        }
      }
    }

    // Check evaluate script for mutations
    if (action === 'evaluate' && params && typeof params.script === 'string') {
      const script = params.script.toLowerCase();
      if (
        script.includes('.submit(') ||
        script.includes('fetch(') ||
        script.includes('xmlhttprequest') ||
        script.includes('.click(') ||
        script.includes('.value =')
      ) {
        throw new Error(
          `Action blocked: Profile "${profileName || 'active'}" is in Research mode (read-only). Mutating script execution is prohibited.`
        );
      }
    }
  }
}

let browserSafetyPolicyServiceInstance: BrowserSafetyPolicyService | null = null;

export function getBrowserSafetyPolicyService(): BrowserSafetyPolicyService {
  if (!browserSafetyPolicyServiceInstance) {
    browserSafetyPolicyServiceInstance = new BrowserSafetyPolicyService();
  }
  return browserSafetyPolicyServiceInstance;
}
