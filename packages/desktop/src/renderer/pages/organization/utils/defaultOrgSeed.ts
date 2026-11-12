/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OrgHierarchy, OrgProject, OrgConversation, OrgCronJob, OrgAgentMember } from '@/types/organization';

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

export function createDefaultOrgMembers(): OrgAgentMember[] {
  const now = Date.now();
  return [
    {
      id: 'member-fullstack-coder',
      canonicalAgentId: 'canonical-fullstack-coder',
      name: 'Senior Fullstack Coder',
      role: 'specialist',
      title: 'Senior Software Engineer',
      assignedTeamIds: [],
      lastActiveAt: now,
      status: 'idle',
      skills: ['typescript', 'react', 'node', 'python', 'api'],
      systemPrompt:
        'You are a senior fullstack engineer skilled in building reliable web applications and microservices.',
    },
    {
      id: 'member-uiux-designer',
      canonicalAgentId: 'canonical-uiux-designer',
      name: 'UI/UX Designer',
      role: 'specialist',
      title: 'Product Designer',
      assignedTeamIds: [],
      lastActiveAt: now,
      status: 'idle',
      skills: ['ui', 'ux', 'css', 'design-systems', 'figma'],
      systemPrompt: 'You are a product designer focused on creating intuitive, accessible, and delightful interfaces.',
    },
    {
      id: 'member-tech-editor',
      canonicalAgentId: 'canonical-tech-editor',
      name: 'Technical Editor',
      role: 'specialist',
      title: 'Technical Writer & Content Editor',
      assignedTeamIds: [],
      lastActiveAt: now,
      status: 'idle',
      skills: ['copywriting', 'documentation', 'editing', 'content'],
      systemPrompt: 'You are a technical editor ensuring crisp, clear, and high-impact documentation and copy.',
    },
    {
      id: 'member-qa-engineer',
      canonicalAgentId: 'canonical-qa-engineer',
      name: 'QA & Test Engineer',
      role: 'specialist',
      title: 'Quality Assurance Specialist',
      assignedTeamIds: [],
      lastActiveAt: now,
      status: 'idle',
      skills: ['testing', 'vitest', 'playwright', 'automation', 'qa'],
      systemPrompt: 'You are a QA automation engineer verifying edge cases, integration tests, and regressions.',
    },
    {
      id: 'member-devops-specialist',
      canonicalAgentId: 'canonical-devops-specialist',
      name: 'DevOps Specialist',
      role: 'specialist',
      title: 'DevOps & Infrastructure Engineer',
      assignedTeamIds: [],
      lastActiveAt: now,
      status: 'idle',
      skills: ['docker', 'ci-cd', 'cloud', 'scripts', 'monitoring'],
      systemPrompt: 'You are a DevOps engineer specialized in CI/CD pipelines, containerization, and system stability.',
    },
  ];
}
