/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SocialPostOptions, SocialPostResult } from '@/common/browser/safetyTypes';
import { getBrowserSafetyGateService } from './BrowserSafetyGateService';
import { getSocialRateLimiter } from './SocialRateLimiter';
import { getBrowserWorkflowEngine } from '../BrowserWorkflowEngine';

export class SocialApiService {
  /**
   * Post to social media routed through PublishService for strict idempotency,
   * with official Graph API as preferred path, falling back to human-paced browser automation.
   */
  public async post(options: SocialPostOptions): Promise<SocialPostResult> {
    const startTime = Date.now();
    const { platform, caption, mediaPath, autoApprove, profileId } = options;

    // Route through PublishService with idempotency keying and state machine
    try {
      const { getPipelineServices } = await import('../../pipeline');
      const { publishService } = await getPipelineServices();

      const publishRes = await publishService.publish(
        {
          projectId: profileId || 'default-social-project',
          platform,
          payload: {
            title: caption.slice(0, 60),
            caption,
            description: caption,
            mediaPath,
          },
          requireApproval: !autoApprove,
        },
        {
          publisher: async () => {
            const rawResult = await this.executeUnderlyingPost(options, startTime);
            if (!rawResult.success) {
              throw new Error(rawResult.error || 'Post execution failed');
            }
            return {
              postId: rawResult.postId || `post_${Date.now()}`,
              url: rawResult.url || '',
              metadata: { mode: rawResult.mode },
            };
          },
        }
      );

      if (publishRes.status === 'pending_approval') {
        return {
          success: false,
          platform,
          mode: 'official_api',
          error: 'Publish action is pending approval in Approvals Inbox.',
          durationMs: Date.now() - startTime,
        };
      }

      if (!publishRes.success) {
        return {
          success: false,
          platform,
          mode: 'official_api',
          error: publishRes.error || `Publishing returned status: ${publishRes.status}`,
          durationMs: Date.now() - startTime,
        };
      }

      return {
        success: true,
        platform,
        mode: (publishRes.postId ? 'official_api' : 'browser_automation') as 'official_api' | 'browser_automation',
        postId: publishRes.postId,
        url: publishRes.url,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      console.warn('[SocialApiService] Failed to route via PublishService, falling back to direct post:', err);
      return this.executeUnderlyingPost(options, startTime);
    }
  }

  /**
   * Underlying post execution through Graph API or Browser Automation.
   */
  private async executeUnderlyingPost(options: SocialPostOptions, startTime: number): Promise<SocialPostResult> {
    const { platform, caption, mediaPath, autoApprove, apiCredentials, profileId } = options;

    // 1. Safety Gate: Explicit user approval before publishing
    const safetyGate = getBrowserSafetyGateService();
    const approved = await safetyGate.requestApproval(
      'publish',
      `Publish post to ${platform}`,
      {
        platform,
        caption,
        mediaPath,
      },
      { autoApprove }
    );

    if (!approved) {
      return {
        success: false,
        platform,
        mode: 'official_api',
        error: 'Publish action was rejected by safety gate.',
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Concurrency Lock & Rate Limiter: Prevent bulk parallel posting and enforce daily caps
    const rateLimiter = getSocialRateLimiter();

    return await rateLimiter.acquireLock(async () => {
      const capCheck = rateLimiter.checkDailyCap(platform);
      if (!capCheck.allowed) {
        return {
          success: false,
          platform,
          mode: 'official_api',
          error: `Daily post cap reached for ${platform} (${capCheck.current}/${capCheck.max}). Post aborted to prevent account restriction.`,
          durationMs: Date.now() - startTime,
        };
      }

      // 3. Preferred Path: Official API
      if (apiCredentials?.accessToken) {
        try {
          const apiResult = await this.publishViaOfficialApi(platform, caption, mediaPath, {
            ...apiCredentials,
            accessToken: apiCredentials.accessToken,
          });
          rateLimiter.recordPost(platform);
          return {
            success: true,
            platform,
            mode: 'official_api',
            postId: apiResult.postId,
            url: apiResult.url,
            durationMs: Date.now() - startTime,
          };
        } catch (apiErr) {
          console.warn(
            `[SocialApiService] Official API failed for ${platform}, falling back to browser automation:`,
            apiErr
          );
          // Fall through to browser automation
        }
      }

      // 4. Fallback Path: Browser Automation with Human-like Pacing
      await rateLimiter.applyHumanPacing(1000, 3000);

      const workflowEngine = getBrowserWorkflowEngine();
      const workflowResult = await workflowEngine.executeWorkflow(
        'social-post',
        {
          platform,
          content: caption,
          mediaPath,
        },
        { profileId }
      );

      if (workflowResult.success) {
        rateLimiter.recordPost(platform);
        return {
          success: true,
          platform,
          mode: 'browser_automation',
          postId: `browser_${Date.now()}`,
          url: `https://${platform}.com`,
          durationMs: Date.now() - startTime,
        };
      }

      return {
        success: false,
        platform,
        mode: 'browser_automation',
        error: workflowResult.error || 'Browser automation workflow failed',
        durationMs: Date.now() - startTime,
      };
    });
  }

  /**
   * Post via official platform APIs (Meta Graph API for IG/FB)
   */
  private async publishViaOfficialApi(
    platform: 'instagram' | 'facebook',
    caption: string,
    mediaPath?: string,
    credentials?: { accessToken: string; pageId?: string; igUserId?: string }
  ): Promise<{ postId: string; url: string }> {
    const accessToken = credentials?.accessToken;
    if (!accessToken) {
      throw new Error('Access token is required for official API posting');
    }

    if (platform === 'facebook') {
      const pageId = credentials?.pageId || 'me';
      const endpoint = `https://graph.facebook.com/v19.0/${pageId}/feed`;

      const body: Record<string, string> = {
        message: caption,
        access_token: accessToken,
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(`Facebook Graph API error: ${res.statusText} - ${JSON.stringify(errorData)}`);
      }

      const data = (await res.json()) as { id: string };
      return {
        postId: data.id,
        url: `https://facebook.com/${data.id}`,
      };
    }

    if (platform === 'instagram') {
      const igUserId = credentials?.igUserId;
      if (!igUserId) {
        throw new Error('Instagram User ID (igUserId) is required for Instagram Graph API');
      }

      if (!mediaPath) {
        throw new Error('Instagram requires an image or video URL to publish a post');
      }

      // 1. Create media container
      const containerEndpoint = `https://graph.facebook.com/v19.0/${igUserId}/media`;
      const containerRes = await fetch(containerEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: mediaPath,
          caption,
          access_token: accessToken,
        }),
      });

      if (!containerRes.ok) {
        const errorData = (await containerRes.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(`Instagram container creation error: ${JSON.stringify(errorData)}`);
      }

      const containerData = (await containerRes.json()) as { id: string };

      // 2. Publish media container
      const publishEndpoint = `https://graph.facebook.com/v19.0/${igUserId}/media_publish`;
      const publishRes = await fetch(publishEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerData.id,
          access_token: accessToken,
        }),
      });

      if (!publishRes.ok) {
        const errorData = (await publishRes.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(`Instagram publish error: ${JSON.stringify(errorData)}`);
      }

      const publishData = (await publishRes.json()) as { id: string };
      return {
        postId: publishData.id,
        url: `https://instagram.com/p/${publishData.id}`,
      };
    }

    throw new Error(`Unsupported platform: ${platform}`);
  }
}

let socialApiInstance: SocialApiService | null = null;

export function getSocialApiService(): SocialApiService {
  if (!socialApiInstance) {
    socialApiInstance = new SocialApiService();
  }
  return socialApiInstance;
}
