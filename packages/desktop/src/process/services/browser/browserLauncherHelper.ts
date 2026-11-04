/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { webContents, session, type WebContents } from 'electron';
import { ipcBridge } from '@/common';
import { BROWSER_SESSION_PARTITION } from '@/common/config/constants';
import { getCdpBridgeHandle } from '@process/utils/cdpBridgeRegistry';

/**
 * Finds the active in-app browser webview webContents.
 */
export function findBrowserWebContents(): WebContents | undefined {
  const all = webContents.getAllWebContents();
  return all.find((wc) => !wc.isDestroyed() && wc.getType() === 'webview');
}

/**
 * Ensures the built-in browser panel and webview are mounted and ready.
 * If the preview panel is closed, emits preview.open to trigger the in-app browser
 * and waits for the webview to register before resolving.
 */
export async function ensureInAppBrowserOpen(
  targetUrl?: string,
  timeoutMs: number = process.env.NODE_ENV === 'test' ? 500 : 10000
): Promise<WebContents> {
  const existing = findBrowserWebContents();
  if (existing) {
    return existing;
  }

  const initialUrl = targetUrl?.trim() || 'about:blank';
  let formattedUrl = initialUrl;
  if (!/^https?:\/\//i.test(formattedUrl) && !/^about:/i.test(formattedUrl) && !/^file:\/\//i.test(formattedUrl)) {
    formattedUrl = `https://${formattedUrl}`;
  }

  // Instruct renderer to open the built-in browser preview tab
  try {
    ipcBridge.preview.open.emit({
      content: formattedUrl,
      content_type: 'browser',
      metadata: {
        title: 'Browser',
      },
    });
  } catch (err) {
    console.warn('[browserLauncherHelper] Could not emit preview.open:', err);
  }

  // Poll for the webview WebContents to be created by the renderer
  const startTime = Date.now();
  const pollInterval = process.env.NODE_ENV === 'test' ? 50 : 200;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    const wc = findBrowserWebContents();
    if (wc) {
      // Auto-attach single-target CDP bridge if handle is ready
      try {
        const handle = getCdpBridgeHandle();
        if (handle) {
          handle.attach(wc.id);
        }
      } catch {
        // Best effort
      }

      return wc;
    }
  }

  throw new Error('Failed to activate built-in browser: Webview did not become ready in time.');
}

/**
 * Commits all session cookies and local storage to the persistent partition on disk.
 */
export async function flushBrowserSessionData(): Promise<void> {
  try {
    if (session && typeof session.fromPartition === 'function') {
      const ses = session.fromPartition(BROWSER_SESSION_PARTITION);
      if (ses?.cookies?.flushStore) {
        await ses.cookies.flushStore();
      }
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[browserLauncherHelper] Failed to flush browser session cookies:', err);
    }
  }
}
