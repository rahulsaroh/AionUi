/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OrgHierarchy, OrgProject, OrgConversation, OrgCronJob } from '@/types/organization';

export const CANONICAL_SHARED_AGENTS: Record<string, { name: string; role: string }> = {
  'canonical-visual-designer': { name: 'Visual Designer', role: 'specialist' },
  'canonical-finance-mgr': { name: 'Finance Manager', role: 'specialist' },
  'canonical-physical-coach': { name: 'High Performance Physical Coach', role: 'specialist' },
  'canonical-auto-script-eng': { name: 'Automation Scripting Engineer', role: 'specialist' },
  'canonical-uiux-specialist': { name: 'UI/UX Specialist', role: 'specialist' },
};

export function createDefaultOrgHierarchy(): OrgHierarchy {
  const now = Date.now();

  const rootCeo: OrgHierarchy['rootCeo'] = {
    id: 'root-ceo',
    name: 'Global Executive HQ',
    parentId: null,
    workspacePath: null,
    ceoAgent: {
      id: 'agent-root-ceo',
      canonicalAgentId: 'canonical-root-ceo',
      name: 'Global Organization CEO',
      title: 'Chief Executive Officer',
      role: 'ceo',
      icon: 'crown',
      assistant_backend: 'acp',
      assignedTeamIds: [],
      lastActiveAt: now,
      status: 'idle',
      workspacePath: null,
      model: {
        modelId: 'claude-3-7-sonnet',
        providerId: 'anthropic',
      },
    },
    chiefOfStaffAgent: {
      id: 'agent-cos-hr',
      canonicalAgentId: 'canonical-cos-hr',
      name: 'Chief HR & Operations Officer',
      title: 'Chief of Staff / VP People',
      role: 'chief_of_staff',
      icon: 'peoples',
      assistant_backend: 'acp',
      assignedTeamIds: [],
      lastActiveAt: now,
      status: 'idle',
      model: {
        modelId: 'claude-3-5-haiku',
        providerId: 'anthropic',
      },
    },
    lastActiveAt: now,
    status: 'idle',
  };

  return {
    rootCeo,
    departments: [],
    lastUpdated: now,
  };
}

export function createDefaultOrgProjects(): OrgProject[] {
  return [];
}

export function createDefaultOrgConversations(): OrgConversation[] {
  return [];
}

export function createDefaultOrgCronJobs(): OrgCronJob[] {
  return [];
}
