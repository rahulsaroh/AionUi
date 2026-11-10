/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import type { BrowserSessionHealthEvent, BrowserSessionHealthStatus } from '@/common/browser/types';
import { getBrowserProfileService } from './BrowserProfileService';

export class BrowserSessionHealthService extends EventEmitter {
  private profileHealthMap: Map<string, BrowserSessionHealthStatus> = new Map();

  /**
   * Evaluates the current page URL and visible content to detect if a session has expired
   * or been redirected to a login/auth wall.
   */
  public checkSessionHealth(params: {
    profileId: string;
    url: string;
    pageText?: string;
    statusCode?: number;
  }): BrowserSessionHealthStatus {
    const { profileId, url, pageText, statusCode } = params;
    const lowerUrl = (url || '').toLowerCase();
    const lowerText = (pageText || '').toLowerCase();

    // 1. Status code check
    if (statusCode === 401 || statusCode === 403) {
      this.markReloginNeeded(profileId, url, `HTTP ${statusCode} Authentication Required`);
      return 'relogin_needed';
    }

    // 2. Known login / sign-in URL patterns
    const loginUrlPatterns = [
      '/login',
      '/signin',
      '/sign-in',
      '/auth/login',
      '/accounts/login',
      'accounts.google.com',
      'login.live.com',
      'appleid.apple.com',
      'auth0.com',
    ];

    const isLoginUrl = loginUrlPatterns.some((pattern) => lowerUrl.includes(pattern));

    // 3. Known login / session expiry text patterns
    const loginTextPatterns = [
      'session expired',
      'please log in to continue',
      'sign in to continue',
      'log in with your account',
      'enter your password to continue',
    ];

    const hasLoginText = loginTextPatterns.some((pattern) => lowerText.includes(pattern));

    if (isLoginUrl || hasLoginText) {
      const reason = isLoginUrl ? 'Redirected to login page' : 'Session expired prompt detected';
      this.markReloginNeeded(profileId, url, reason);
      return 'relogin_needed';
    }

    this.markHealthy(profileId);
    return 'healthy';
  }

  public markReloginNeeded(profileId: string, url: string, reason: string): void {
    this.profileHealthMap.set(profileId, 'relogin_needed');

    try {
      const profileService = getBrowserProfileService();
      const profile = profileService.getProfile(profileId);
      if (profile && profile.sessionHealth !== 'relogin_needed') {
        profileService.updateProfile({ id: profileId, sessionHealth: 'relogin_needed' });
      }
    } catch {
      // Ignored
    }

    const event: BrowserSessionHealthEvent = {
      profileId,
      url,
      status: 'relogin_needed',
      reason,
      timestamp: Date.now(),
    };

    this.emit('reloginNeeded', event);
  }

  public markHealthy(profileId: string): void {
    this.profileHealthMap.set(profileId, 'healthy');

    try {
      const profileService = getBrowserProfileService();
      const profile = profileService.getProfile(profileId);
      if (profile && profile.sessionHealth !== 'healthy') {
        profileService.updateProfile({ id: profileId, sessionHealth: 'healthy' });
      }
    } catch {
      // Ignored
    }

    this.emit('sessionHealthy', { profileId, status: 'healthy', timestamp: Date.now() });
  }

  public isReloginNeeded(profileId: string): boolean {
    return this.profileHealthMap.get(profileId) === 'relogin_needed';
  }
}

let browserSessionHealthServiceInstance: BrowserSessionHealthService | null = null;

export function getBrowserSessionHealthService(): BrowserSessionHealthService {
  if (!browserSessionHealthServiceInstance) {
    browserSessionHealthServiceInstance = new BrowserSessionHealthService();
  }
  return browserSessionHealthServiceInstance;
}
