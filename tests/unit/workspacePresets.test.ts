/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  getWorkspacePreset,
  normalizeWorkspaceKey,
  resolveWorkspacePresetInstructions,
  saveWorkspacePreset,
} from '../../packages/desktop/src/renderer/utils/workspace/workspacePresets';

const createMemoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
};

describe('workspacePresets', () => {
  beforeEach(() => {
    const memoryStorage = createMemoryStorage();
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: memoryStorage },
      configurable: true,
      writable: true,
    });
  });

  it('normalizes empty workspace to global', () => {
    expect(normalizeWorkspaceKey(undefined)).toBe('global');
    expect(normalizeWorkspaceKey('   ')).toBe('global');
    expect(normalizeWorkspaceKey('C:\\proj')).toBe('C:\\proj');
  });

  it('saves and resolves built-in and custom presets per workspace', () => {
    expect(getWorkspacePreset('C:\\repo').presetId).toBe('default');
    expect(resolveWorkspacePresetInstructions('C:\\repo')).toBe('');

    saveWorkspacePreset('C:\\repo', { presetId: 'concise' });
    expect(getWorkspacePreset('C:\\repo').presetId).toBe('concise');
    expect(resolveWorkspacePresetInstructions('C:\\repo')).toContain('concise');

    saveWorkspacePreset('C:\\repo2', {
      presetId: 'custom',
      customInstructions: 'Always answer in haiku.',
    });
    expect(resolveWorkspacePresetInstructions('C:\\repo2')).toBe('Always answer in haiku.');
  });
});
