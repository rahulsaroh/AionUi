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
};

export function computeLifecycleStatus(
  lastActiveAt: number | null | undefined,
  currentStatus?: OrgNodeStatus
): OrgNodeStatus {
  // If explicitly working, in standby, or queued next, that overrides idle calculation
  if (currentStatus === 'working' || currentStatus === 'department_standby' || currentStatus === 'queued_next') {
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
