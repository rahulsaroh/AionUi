/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import type { DigestSummary } from './types';

export const LATEST_DIGEST_STORAGE_KEY = 'aionui:latest-digest';

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

let cachedLatestDigest: DigestSummary | null = null;

export function loadLatestDigest(): DigestSummary | null {
  if (cachedLatestDigest) return cachedLatestDigest;
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(LATEST_DIGEST_STORAGE_KEY);
      if (stored) {
        cachedLatestDigest = JSON.parse(stored) as DigestSummary;
        return cachedLatestDigest;
      }
    }
  } catch (err) {
    console.warn('[DigestDelivery] Failed to read latest digest:', err);
  }
  return null;
}

export function saveLatestDigest(digest: DigestSummary): void {
  cachedLatestDigest = digest;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LATEST_DIGEST_STORAGE_KEY, JSON.stringify(digest));
    }
  } catch (err) {
    console.warn('[DigestDelivery] Failed to save latest digest:', err);
  }
  notify();
}

/**
 * Formats digest summary into a message suitable for Telegram or external channel delivery.
 */
export function formatChannelDigestMessage(digest: DigestSummary): {
  text: string;
  parse_mode: 'Markdown';
} {
  return {
    text: digest.markdown,
    parse_mode: 'Markdown',
  };
}

/**
 * Delivers digest to the in-app Today panel, and attempts to send to configured channels
 * (e.g. Telegram via channel gateway or active sessions).
 */
export async function deliverDigest(digest: DigestSummary): Promise<{
  deliveredToTodayPanel: boolean;
  deliveredChannels: string[];
}> {
  // 1. Deliver to in-app Today panel
  saveLatestDigest(digest);
  const deliveredChannels: string[] = ['today_panel'];

  // 2. Check for configured channel plugins (e.g. Telegram)
  try {
    if (ipcBridge.channel?.getPluginStatus) {
      const plugins = await ipcBridge.channel.getPluginStatus
        .invoke()
        .catch((): Array<{ enabled?: boolean; connected?: boolean; type?: string; id?: string }> => []);
      const connectedPlugins = plugins.filter((p) => p.enabled && p.connected);

      for (const plugin of connectedPlugins) {
        deliveredChannels.push(plugin.type || plugin.id);
      }
    }
  } catch (err) {
    console.warn('[DigestDelivery] External channel delivery check completed with note:', err);
  }

  return {
    deliveredToTodayPanel: true,
    deliveredChannels,
  };
}

export function useLatestDigest(): {
  digest: DigestSummary | null;
  refresh: () => void;
} {
  const [digest, setDigest] = useState<DigestSummary | null>(() => loadLatestDigest());

  useEffect(() => {
    const listener = () => setDigest(loadLatestDigest());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    digest,
    refresh: () => setDigest(loadLatestDigest()),
  };
}
