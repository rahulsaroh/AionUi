/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export * from '@/types/organization';

export type NavigationTab = 'teams' | 'projects' | 'conversations' | 'organization';

export type NodeExecutionStatus = 'idle' | 'thinking' | 'delegating' | 'completed' | 'error';

export type ActiveHandoff = {
  id: string;
  sourceTeamId: string;
  targetSubTeamId: string;
  taskDirective: string;
  timestamp: number;
  status: 'in_flight' | 'completed' | 'error';
};

export type NodeActivityUpdate = {
  message: string;
  timestamp: number;
  agentName?: string;
  status?: NodeExecutionStatus;
};
