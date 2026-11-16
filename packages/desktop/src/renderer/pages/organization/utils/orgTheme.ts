/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CSSProperties } from 'react';
import type { OrgNodeStatus } from '@/types/organization';

export interface OrgThemeConfig {
  status: OrgNodeStatus;
  label: string;
  badgeText: string;
  borderColor: string;
  borderStyle: 'solid' | 'dashed';
  borderWidth: string;
  backgroundColor: string;
  boxShadow: string;
  textColor: string;
  accentColor: string;
  opacity: number;
  pulse: boolean;
}

export const ORG_THEME_PALETTE: Record<OrgNodeStatus, OrgThemeConfig> = {
  working: {
    status: 'working',
    label: 'Working',
    badgeText: 'Working',
    borderColor: '#34D399',
    borderStyle: 'solid',
    borderWidth: '1.5px',
    backgroundColor: 'rgba(16, 185, 129, 0.13)',
    boxShadow: '0 0 16px rgba(52, 211, 153, 0.28)',
    textColor: '#A7F3D0',
    accentColor: '#34D399',
    opacity: 1,
    pulse: true,
  },
  department_standby: {
    status: 'department_standby',
    label: 'Standby',
    badgeText: 'Standby',
    borderColor: '#FBBF24',
    borderStyle: 'solid',
    borderWidth: '1.5px',
    backgroundColor: 'rgba(245, 158, 11, 0.10)',
    boxShadow: '0 0 14px rgba(251, 191, 36, 0.22)',
    textColor: '#FDE68A',
    accentColor: '#FBBF24',
    opacity: 1,
    pulse: true,
  },
  queued_next: {
    status: 'queued_next',
    label: 'Next Up',
    badgeText: 'Next Up',
    borderColor: '#38BDF8',
    borderStyle: 'solid',
    borderWidth: '1.5px',
    backgroundColor: 'rgba(56, 189, 248, 0.09)',
    boxShadow: '0 0 12px rgba(56, 189, 248, 0.20)',
    textColor: '#BAE6FD',
    accentColor: '#38BDF8',
    opacity: 1,
    pulse: false,
  },
  recently_finished: {
    status: 'recently_finished',
    label: 'Just Finished',
    badgeText: 'Just Finished',
    borderColor: 'rgba(45, 212, 191, 0.40)',
    borderStyle: 'solid',
    borderWidth: '1.5px',
    backgroundColor: 'rgba(45, 212, 191, 0.06)',
    boxShadow: 'none',
    textColor: '#99F6E4',
    accentColor: '#2DD4BF',
    opacity: 0.95,
    pulse: false,
  },
  idle: {
    status: 'idle',
    label: 'Idle',
    badgeText: 'Idle',
    borderColor: '#334155',
    borderStyle: 'solid',
    borderWidth: '1px',
    backgroundColor: '#1E293B',
    boxShadow: 'none',
    textColor: '#94A3B8',
    accentColor: '#64748B',
    opacity: 1,
    pulse: false,
  },
  dormant: {
    status: 'dormant',
    label: '7d+ Unused',
    badgeText: '7d+ Unused',
    borderColor: '#27272A',
    borderStyle: 'dashed',
    borderWidth: '1px',
    backgroundColor: '#101114',
    boxShadow: 'none',
    textColor: '#71717A',
    accentColor: '#52525B',
    opacity: 0.52,
    pulse: false,
  },
  error: {
    status: 'error',
    label: 'Error',
    badgeText: 'Scope Error',
    borderColor: '#EF4444',
    borderStyle: 'solid',
    borderWidth: '1.5px',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    boxShadow: '0 0 14px rgba(239, 68, 68, 0.25)',
    textColor: '#FCA5A5',
    accentColor: '#EF4444',
    opacity: 1,
    pulse: false,
  },
};

export function computeLifecycleStatus(
  lastActiveAt: number | null | undefined,
  currentStatus?: OrgNodeStatus
): OrgNodeStatus {
  // If explicitly working, in standby, queued next, or recently finished, that overrides idle calculation
  if (
    currentStatus === 'working' ||
    currentStatus === 'department_standby' ||
    currentStatus === 'queued_next' ||
    currentStatus === 'recently_finished' ||
    currentStatus === 'error'
  ) {
    return currentStatus;
  }

  const now = Date.now();
  if (lastActiveAt) {
    const elapsed = now - lastActiveAt;
    // Less than 60 seconds ago => recently_finished
    if (elapsed < 60 * 1000) {
      return 'recently_finished';
    }
    // More than 7 days => dormant
    if (elapsed > 7 * 24 * 60 * 60 * 1000) {
      return 'dormant';
    }
    return 'idle';
  }

  // Null lastActiveAt is considered dormant / unused
  return 'dormant';
}

export function getOrgNodeStyle(status: OrgNodeStatus): CSSProperties {
  const theme = ORG_THEME_PALETTE[status] || ORG_THEME_PALETTE.idle;
  return {
    borderColor: theme.borderColor,
    borderStyle: theme.borderStyle,
    borderWidth: theme.borderWidth,
    backgroundColor: theme.backgroundColor,
    boxShadow: theme.boxShadow !== 'none' ? theme.boxShadow : undefined,
    opacity: theme.opacity,
    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
  };
}

export interface DepartmentAccent {
  name: string;
  border: string;
  glow: string;
  bg: string;
  text: string;
}

export const DEPARTMENT_PALETTE: DepartmentAccent[] = [
  { name: 'blue', border: '#38BDF8', glow: 'rgba(56, 189, 248, 0.35)', bg: 'rgba(14, 165, 233, 0.08)', text: '#7DD3FC' },
  { name: 'teal', border: '#2DD4BF', glow: 'rgba(45, 212, 191, 0.35)', bg: 'rgba(20, 184, 166, 0.08)', text: '#5EEAD4' },
  { name: 'purple', border: '#A855F7', glow: 'rgba(168, 85, 247, 0.35)', bg: 'rgba(168, 85, 247, 0.08)', text: '#D8B4FE' },
  { name: 'emerald', border: '#34D399', glow: 'rgba(52, 211, 153, 0.35)', bg: 'rgba(16, 185, 129, 0.08)', text: '#6EE7B7' },
  { name: 'amber', border: '#FBBF24', glow: 'rgba(251, 191, 36, 0.35)', bg: 'rgba(245, 158, 11, 0.08)', text: '#FDE68A' },
  { name: 'rose', border: '#FB7185', glow: 'rgba(251, 113, 133, 0.35)', bg: 'rgba(244, 63, 94, 0.08)', text: '#FDA4AF' },
  { name: 'indigo', border: '#818CF8', glow: 'rgba(129, 140, 248, 0.35)', bg: 'rgba(99, 102, 241, 0.08)', text: '#C7D2FE' },
  { name: 'cyan', border: '#22D3EE', glow: 'rgba(34, 211, 238, 0.35)', bg: 'rgba(6, 182, 212, 0.08)', text: '#67E8F9' },
];

export function getDepartmentAccent(index: number, customColor?: string): DepartmentAccent {
  if (customColor) {
    return {
      name: 'custom',
      border: customColor,
      glow: `${customColor}59`,
      bg: `${customColor}14`,
      text: customColor,
    };
  }
  return DEPARTMENT_PALETTE[index % DEPARTMENT_PALETTE.length];
}

export const MEMBER_ACCENT_PALETTE = [
  '#38BDF8', // sky
  '#A855F7', // purple
  '#34D399', // emerald
  '#F472B6', // pink
  '#FBBF24', // amber
  '#2DD4BF', // teal
  '#818CF8', // indigo
  '#FB923C', // orange
];

export function getMemberAccentColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % MEMBER_ACCENT_PALETTE.length;
  return MEMBER_ACCENT_PALETTE[idx];
}

export const TIER_NEON_THEMES = {
  ceo: {
    border: '#06B6D4',
    glow: 'rgba(6, 182, 212, 0.40)',
    bg: 'rgba(6, 182, 212, 0.06)',
    text: '#67E8F9',
  },
  project: {
    border: '#A855F7',
    glow: 'rgba(168, 85, 247, 0.35)',
    bg: 'rgba(168, 85, 247, 0.06)',
    text: '#D8B4FE',
  },
  team: {
    border: '#10B981',
    glow: 'rgba(16, 185, 129, 0.35)',
    bg: 'rgba(16, 185, 129, 0.06)',
    text: '#6EE7B7',
  },
};

