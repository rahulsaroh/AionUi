/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type WorkspacePresetId = 'default' | 'concise' | 'technical' | 'executive' | 'code-first' | 'custom';

export type WorkspaceOutputPreset = {
  id: WorkspacePresetId;
  label: string;
  description: string;
  instructions: string;
};

export type SavedWorkspacePreset = {
  presetId: WorkspacePresetId;
  customInstructions?: string;
  updatedAt: number;
};

export const WORKSPACE_OUTPUT_PRESETS: WorkspaceOutputPreset[] = [
  {
    id: 'default',
    label: 'Balanced (Default)',
    description: 'Standard AionUi assistant tone with balanced detail.',
    instructions: '',
  },
  {
    id: 'concise',
    label: 'Concise & Direct',
    description: 'Short, bullet-driven answers with minimal preamble.',
    instructions: 'Keep responses concise, direct, and bullet-focused. Omit unnecessary preamble or repetition.',
  },
  {
    id: 'technical',
    label: 'Deep Technical',
    description: 'Include architecture trade-offs, edge cases, and verification steps.',
    instructions: 'Provide thorough technical explanations, edge-case analysis, and concrete verification steps.',
  },
  {
    id: 'executive',
    label: 'Executive Summary',
    description: 'Lead with key takeaways, impact, and recommended next actions.',
    instructions:
      'Lead with a brief executive summary, highlight business/user impact, and end with clear next actions.',
  },
  {
    id: 'code-first',
    label: 'Code-First',
    description: 'Prioritize runnable code snippets and minimal prose.',
    instructions: 'Prioritize clean, runnable code examples and exact file diffs with brief inline explanations.',
  },
  {
    id: 'custom',
    label: 'Custom Instructions',
    description: 'Define your own output formatting and tone rules for this workspace.',
    instructions: '',
  },
];

const STORAGE_KEY = 'aionui:workspace-presets:v1';

const hasStorage = (): boolean => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const normalizeWorkspaceKey = (workspace?: string): string => {
  const trimmed = workspace?.trim();
  return trimmed ? trimmed : 'global';
};

export const getWorkspacePresetsMap = (): Record<string, SavedWorkspacePreset> => {
  if (!hasStorage()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, SavedWorkspacePreset>;
  } catch {
    return {};
  }
};

export const getWorkspacePreset = (workspace?: string): SavedWorkspacePreset => {
  const key = normalizeWorkspaceKey(workspace);
  const map = getWorkspacePresetsMap();
  return map[key] ?? { presetId: 'default', updatedAt: 0 };
};

export const saveWorkspacePreset = (
  workspace: string | undefined,
  preset: Omit<SavedWorkspacePreset, 'updatedAt'>
): SavedWorkspacePreset => {
  const key = normalizeWorkspaceKey(workspace);
  const map = getWorkspacePresetsMap();
  const next: SavedWorkspacePreset = {
    ...preset,
    updatedAt: Date.now(),
  };
  map[key] = next;
  if (hasStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      // Ignore storage quota errors
    }
  }
  return next;
};

export const resolveWorkspacePresetInstructions = (workspace?: string): string => {
  const saved = getWorkspacePreset(workspace);
  if (saved.presetId === 'custom') {
    return saved.customInstructions?.trim() ?? '';
  }
  return WORKSPACE_OUTPUT_PRESETS.find((item) => item.id === saved.presetId)?.instructions ?? '';
};
