/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildOrgDirectory,
  findOrgOwners,
  getOrgDirectoryPrompt,
  resetOrgDirectoryPromptCache,
  renderOrgDirectoryMarkdown,
} from '@/renderer/pages/organization/utils/orgDirectory';
import type { OrgAgentMember, OrgHierarchy, OrgProject } from '@/types/organization';

function member(id: string, name: string, role: string, extra: Partial<OrgAgentMember> = {}): OrgAgentMember {
  return {
    id,
    canonicalAgentId: id,
    name,
    role,
    assignedTeamIds: [],
    lastActiveAt: null,
    status: 'idle',
    ...extra,
  };
}

function buildHierarchy(): OrgHierarchy {
  const head = member('head-eng', 'Ava Head', 'department_head', { title: 'Head of Engineering' });
  const lead = member('lead-api', 'Ben Lead', 'team_lead', { skills: ['node', 'api'] });
  const specialist = member('spec-api', 'Cara API', 'specialist', { skills: ['typescript', 'openapi'] });

  return {
    rootCeo: {
      id: 'root-ceo',
      name: 'Global HQ',
      parentId: null,
      workspacePath: 'C:/org',
      ceoAgent: member('ceo-1', 'Root CEO', 'ceo'),
      lastActiveAt: null,
      status: 'idle',
    },
    departments: [
      {
        id: 'dept-eng',
        name: 'Engineering',
        description: 'Owns all product code and API services',
        workspacePath: 'C:/org/engineering',
        parentDepartmentId: null,
        departmentCeoAgent: head,
        teams: [
          {
            id: 'team-api',
            departmentId: 'dept-eng',
            name: 'API Team',
            teamLeadAgent: lead,
            hrCoordinatorAgent: member('hr-api', 'Dana HR', 'hr_coordinator'),
            specialistMembers: [specialist],
            members: [lead, specialist],
            workspacePath: 'C:/org/engineering/api',
            lastActiveAt: null,
            status: 'idle',
          },
        ],
        linkedProjects: [],
        lastActiveAt: null,
        status: 'idle',
      },
      {
        id: 'dept-media',
        name: 'Media',
        description: 'Owns video assets and thumbnails',
        workspacePath: 'C:/org/media',
        parentDepartmentId: null,
        departmentCeoAgent: member('head-media', 'Mona Head', 'department_head'),
        teams: [],
        linkedProjects: [],
        lastActiveAt: null,
        status: 'idle',
      },
    ],
    lastUpdated: 0,
  };
}

function buildProjects(): OrgProject[] {
  return [
    {
      id: 'proj-invoice',
      name: 'Invoice API',
      departmentId: 'dept-eng',
      teamIds: ['team-api'],
      goal: 'Serve billing invoices and payment receipts',
      workspacePath: 'C:/org/engineering/invoice-api',
      status: 'active',
      backendTeamId: 'backend-team-1',
    },
    {
      id: 'proj-youtube',
      name: 'YouTube Channel',
      departmentId: 'dept-media',
      teamIds: [],
      goal: 'Produce weekly tech videos and thumbnails',
      workspacePath: 'C:/org/media/youtube',
      status: 'active',
    },
  ];
}

describe('orgDirectory', () => {
  beforeEach(() => {
    resetOrgDirectoryPromptCache();
  });

  it('builds departments with ownership, teams, projects, and contacts', () => {
    const doc = buildOrgDirectory({
      hierarchy: buildHierarchy(),
      projects: buildProjects(),
      members: [],
      now: 123,
    });

    expect(doc.rootWorkspace).toBe('C:/org');
    expect(doc.departments.map((d) => d.name)).toEqual(['Engineering', 'Media']);

    const engineering = doc.departments[0];
    expect(engineering.head?.name).toBe('Ava Head');
    expect(engineering.teams[0].name).toBe('API Team');
    expect(engineering.teams[0].lead?.name).toBe('Ben Lead');
    expect(engineering.projects.map((p) => p.name)).toEqual(['Invoice API']);
    expect(engineering.members.map((m) => m.name)).toContain('Cara API');
  });

  it('renders a markdown document with ownership and a preserved manual notes section', () => {
    const doc = buildOrgDirectory({ hierarchy: buildHierarchy(), projects: buildProjects(), now: 0 });
    const markdown = renderOrgDirectoryMarkdown(doc);

    expect(markdown).toContain('# Organization Directory');
    expect(markdown).toContain('Owns folders: C:/org/engineering');
    expect(markdown).toContain('Invoice API (id: proj-invoice)');
    expect(markdown).toContain('## Manual Notes');
  });

  it('returns a compact routing block on the first call and a reminder afterwards', () => {
    const doc = buildOrgDirectory({ hierarchy: buildHierarchy(), projects: buildProjects() });

    const first = getOrgDirectoryPrompt(doc, { conversationId: 'conv-1' });
    expect(first).toContain('Organization Directory');
    expect(first).toContain('Engineering');
    expect(first).toContain('Routing rules');
    expect(first).toContain('assign_task');

    const second = getOrgDirectoryPrompt(doc, { conversationId: 'conv-1' });
    expect(second).toContain('Organization Directory reminder');
    expect(second.length).toBeLessThan(first.length);
  });

  it('honors the character budget', () => {
    const doc = buildOrgDirectory({ hierarchy: buildHierarchy(), projects: buildProjects() });
    const block = getOrgDirectoryPrompt(doc, { conversationId: 'conv-budget', maxChars: 300 });

    expect(block.length).toBeLessThanOrEqual(300);
    expect(block).toContain('truncated');
  });

  it('ranks the owning department by project name, path, and charter', () => {
    const doc = buildOrgDirectory({ hierarchy: buildHierarchy(), projects: buildProjects() });

    const invoice = findOrgOwners(doc, 'invoice billing');
    expect(invoice[0]?.departmentName).toBe('Engineering');
    expect(invoice[0]?.contactName).toBe('Ava Head');
    expect(invoice[0]?.projectIds).toContain('proj-invoice');

    const byPath = findOrgOwners(doc, 'C:/org/media/youtube/thumbnails');
    expect(byPath[0]?.departmentName).toBe('Media');

    const video = findOrgOwners(doc, 'thumbnail video assets');
    expect(video[0]?.departmentName).toBe('Media');
  });

  it('returns no matches for an unrelated query', () => {
    const doc = buildOrgDirectory({ hierarchy: buildHierarchy(), projects: buildProjects() });
    expect(findOrgOwners(doc, 'quantum welding')).toEqual([]);
  });

  it('includes knowledgeReposByProjectId and knowledgeReposByMemberId in directory output', () => {
    const doc = buildOrgDirectory({
      hierarchy: buildHierarchy(),
      projects: buildProjects(),
      knowledgeReposByMemberId: { 'spec-api': ['OpenAPI Playbook'] },
      knowledgeReposByProjectId: { 'proj-invoice': ['Billing Repo'] },
    });

    const md = renderOrgDirectoryMarkdown(doc);
    expect(md).toContain('knowledge: OpenAPI Playbook');
    expect(md).toContain('knowledge: Billing Repo');

    const prompt = getOrgDirectoryPrompt(doc, { conversationId: 'conv-knowledge' });
    expect(prompt).toContain('(knowledge: Billing Repo)');
  });
});
