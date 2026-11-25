/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type SkillTelemetryRecord = {
  count: number;
  lastUsedAt: number;
};

export type SkillTelemetryMap = Record<string, SkillTelemetryRecord>;

const STORAGE_KEY = 'aionui:skill-telemetry:v1';

const hasStorage = (): boolean => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const getSkillTelemetryMap = (): SkillTelemetryMap => {
  if (!hasStorage()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as SkillTelemetryMap;
  } catch {
    return {};
  }
};

export const getSkillTelemetry = (skillName: string): SkillTelemetryRecord | null => {
  const map = getSkillTelemetryMap();
  return map[skillName] ?? null;
};

export const recordSkillUsage = (skillNames: string[], timestamp: number = Date.now()): SkillTelemetryMap => {
  const map = getSkillTelemetryMap();
  let changed = false;

  for (const name of skillNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const prev = map[trimmed];
    map[trimmed] = {
      count: (prev?.count ?? 0) + 1,
      lastUsedAt: timestamp,
    };
    changed = true;
  }

  if (changed && hasStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      // Ignore storage quota errors
    }
  }

  return map;
};
