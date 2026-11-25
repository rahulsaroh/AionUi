/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  getSkillTelemetry,
  getSkillTelemetryMap,
  recordSkillUsage,
} from '../../packages/desktop/src/renderer/utils/skills/skillTelemetry';

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

describe('skillTelemetry', () => {
  beforeEach(() => {
    const memoryStorage = createMemoryStorage();
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: memoryStorage },
      configurable: true,
      writable: true,
    });
  });

  it('returns empty map when nothing recorded', () => {
    expect(getSkillTelemetryMap()).toEqual({});
    expect(getSkillTelemetry('docx')).toBeNull();
  });

  it('increments usage count and updates lastUsedAt', () => {
    recordSkillUsage(['docx', 'pptx'], 1000);
    recordSkillUsage(['docx', '  '], 2500);

    expect(getSkillTelemetry('docx')).toEqual({ count: 2, lastUsedAt: 2500 });
    expect(getSkillTelemetry('pptx')).toEqual({ count: 1, lastUsedAt: 1000 });
  });
});
