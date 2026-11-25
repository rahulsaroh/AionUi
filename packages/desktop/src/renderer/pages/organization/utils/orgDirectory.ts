/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Organization Directory ("org knowledge map").
 *
 * Builds one authoritative document that maps every department to the folders it owns,
 * its projects/teams/members, and the person to contact. Agents receive a compact,
 * token-bounded version at the start of a task so they can route a request instead of
 * scanning unrelated folders or re-deriving the org structure from scratch.
 */

import type {
  OrgAgentMember,
  OrgDepartmentNode,
  OrgDirectoryDoc,
  OrgDirectoryDepartmentEntry,
  OrgDirectoryMemberEntry,
  OrgDirectoryOwnerMatch,
  OrgDirectoryProjectEntry,
  OrgDirectoryTeamEntry,
  OrgHierarchy,
  OrgProject,
} from '@/types/organization';

const MANUAL_NOTES_HEADING = '## Manual Notes';

export interface BuildOrgDirectoryOptions {
  hierarchy: OrgHierarchy;
  projects: OrgProject[];
  members?: OrgAgentMember[];
  /** Optional knowledge repo names keyed by agent id, injected into each member entry. */
  knowledgeReposByMemberId?: Record<string, string[]>;
  /** Optional knowledge repo names keyed by project id, injected into each project entry. */
  knowledgeReposByProjectId?: Record<string, string[]>;
  now?: number;
}

export interface OrgDirectoryPromptOptions {
  conversationId?: string;
  /** Character budget for the injected block. Defaults to 6000 (~1500 tokens). */
  maxChars?: number;
  forceFull?: boolean;
}

function dedupeMembers(entries: OrgDirectoryMemberEntry[]): OrgDirectoryMemberEntry[] {
  const seen = new Set<string>();
  const result: OrgDirectoryMemberEntry[] = [];
  for (const entry of entries) {
    const key = entry.id || `${entry.name}:${entry.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function toMemberEntry(
  member: OrgAgentMember | undefined,
  knowledgeReposByMemberId?: Record<string, string[]>
): OrgDirectoryMemberEntry | undefined {
  if (!member) return undefined;
  const repos = knowledgeReposByMemberId?.[member.id];
  return {
    id: member.id,
    name: member.name,
    role: member.role || 'specialist',
    title: member.title,
    skills: member.skills && member.skills.length > 0 ? member.skills : undefined,
    workspacePath: member.workspacePath ?? null,
    knowledgeRepos: repos && repos.length > 0 ? repos : undefined,
  };
}

function collectTeamMembers(team: OrgDirectoryTeamEntry): OrgDirectoryMemberEntry[] {
  const entries: OrgDirectoryMemberEntry[] = [];
  if (team.lead) entries.push(team.lead);
  entries.push(...team.members);
  return dedupeMembers(entries);
}

function buildTeamEntry(
  team: {
    id: string;
    name: string;
    teamLeadAgent?: OrgAgentMember;
    hrCoordinatorAgent?: OrgAgentMember;
    specialistMembers?: OrgAgentMember[];
    members?: OrgAgentMember[];
    workspacePath?: string | null;
    workspacePaths?: string[];
    description?: string;
  },
  knowledgeReposByMemberId?: Record<string, string[]>
): OrgDirectoryTeamEntry {
  const lead = toMemberEntry(team.teamLeadAgent, knowledgeReposByMemberId);
  const roleMembers: OrgDirectoryMemberEntry[] = [
    ...(team.hrCoordinatorAgent
      ? [toMemberEntry(team.hrCoordinatorAgent, knowledgeReposByMemberId)].filter((m): m is OrgDirectoryMemberEntry =>
          Boolean(m)
        )
      : []),
    ...(team.specialistMembers || [])
      .map((m) => toMemberEntry(m, knowledgeReposByMemberId))
      .filter((m): m is OrgDirectoryMemberEntry => Boolean(m)),
  ];
  const flatMembers = (team.members || [])
    .map((m) => toMemberEntry(m, knowledgeReposByMemberId))
    .filter((m): m is OrgDirectoryMemberEntry => Boolean(m));

  return {
    id: team.id,
    name: team.name,
    workspacePath: team.workspacePath ?? null,
    workspacePaths: team.workspacePaths && team.workspacePaths.length > 0 ? team.workspacePaths : undefined,
    lead,
    members: dedupeMembers([...roleMembers, ...flatMembers]),
    description: team.description,
  };
}

function buildProjectEntry(
  project: OrgProject,
  knowledgeReposByProjectId?: Record<string, string[]>
): OrgDirectoryProjectEntry {
  const repos = knowledgeReposByProjectId?.[project.id] || project.context?.repos;
  return {
    id: project.id,
    name: project.name,
    workspacePath: project.workspacePath || project.path || null,
    goal: project.goal,
    description: project.description,
    memberIds: project.memberIds && project.memberIds.length > 0 ? project.memberIds : undefined,
    backendTeamId: project.backendTeamId,
    knowledgeRepos: repos && repos.length > 0 ? repos : undefined,
  };
}

export function buildOrgDirectory(options: BuildOrgDirectoryOptions): OrgDirectoryDoc {
  const { hierarchy, projects, members, knowledgeReposByMemberId, knowledgeReposByProjectId } = options;
  const departments: OrgDirectoryDepartmentEntry[] = hierarchy.departments.map((dept: OrgDepartmentNode) => {
    const teams = (dept.teams || []).map((team) => buildTeamEntry(team, knowledgeReposByMemberId));
    const deptProjects = projects
      .filter((p) => p.departmentId === dept.id)
      .map((p) => buildProjectEntry(p, knowledgeReposByProjectId));

    const memberIds = new Set<string>();
    for (const project of deptProjects) {
      for (const memberId of project.memberIds || []) memberIds.add(memberId);
    }
    const projectMembers = (members || [])
      .filter((m) => memberIds.has(m.id))
      .map((m) => toMemberEntry(m, knowledgeReposByMemberId))
      .filter((m): m is OrgDirectoryMemberEntry => Boolean(m));

    const deptMembers = dedupeMembers([
      ...(toMemberEntry(dept.departmentCeoAgent, knowledgeReposByMemberId)
        ? [toMemberEntry(dept.departmentCeoAgent, knowledgeReposByMemberId)!]
        : []),
      ...(toMemberEntry(dept.pmAgent, knowledgeReposByMemberId)
        ? [toMemberEntry(dept.pmAgent, knowledgeReposByMemberId)!]
        : []),
      ...teams.flatMap((team) => collectTeamMembers(team)),
      ...projectMembers,
    ]);

    return {
      id: dept.id,
      name: dept.name,
      description: dept.description,
      workspacePath: dept.workspacePath ?? null,
      head: toMemberEntry(dept.departmentCeoAgent, knowledgeReposByMemberId),
      projectManager: toMemberEntry(dept.pmAgent, knowledgeReposByMemberId),
      teams,
      projects: deptProjects,
      members: deptMembers,
    };
  });

  const departmentMemberIds = new Set(departments.flatMap((dept) => dept.members.map((m) => m.id)));
  const sharedMembers = (members || [])
    .filter((m) => !departmentMemberIds.has(m.id))
    .map((m) => toMemberEntry(m, knowledgeReposByMemberId))
    .filter((m): m is OrgDirectoryMemberEntry => Boolean(m));

  const entryById = new Map(departments.map((entry) => [entry.id, entry]));
  const orderedDepartments = hierarchy.departments
    .slice()
    .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((dept) => entryById.get(dept.id))
    .filter((entry): entry is OrgDirectoryDepartmentEntry => Boolean(entry));

  return {
    rootWorkspace: hierarchy.rootCeo.workspacePath ?? null,
    rootCeo: toMemberEntry(hierarchy.rootCeo.ceoAgent, knowledgeReposByMemberId),
    chiefOfStaff: toMemberEntry(hierarchy.rootCeo.chiefOfStaffAgent, knowledgeReposByMemberId),
    departments: orderedDepartments,
    sharedMembers,
    generatedAt: options.now ?? Date.now(),
  };
}

function formatMember(member: OrgDirectoryMemberEntry): string {
  const title = member.title ? ` — ${member.title}` : '';
  const skills = member.skills && member.skills.length > 0 ? ` | skills: ${member.skills.join(', ')}` : '';
  const repos =
    member.knowledgeRepos && member.knowledgeRepos.length > 0
      ? ` | knowledge: ${member.knowledgeRepos.join(', ')}`
      : '';
  return `${member.name} (${member.role}${title}) [id: ${member.id}]${skills}${repos}`;
}

export function renderOrgDirectoryMarkdown(doc: OrgDirectoryDoc, generatedAt = new Date(doc.generatedAt)): string {
  const lines: string[] = [];
  lines.push('# Organization Directory');
  lines.push('');
  lines.push(
    '<!-- Generated by AionUi Organization Mode. This section is regenerated automatically from the live org graph. Everything under "Manual Notes" is preserved. -->'
  );
  lines.push('');
  lines.push(`Master root: ${doc.rootWorkspace || '(not configured)'}`);
  lines.push(`Last generated: ${generatedAt.toISOString()}`);
  lines.push('');
  lines.push('## How To Use This Directory');
  lines.push('1. Match the request to the department that owns the relevant folder or topic.');
  lines.push('2. Read only that department/project folder. Do not scan unrelated departments.');
  lines.push(
    '3. Contact the named owner directly (direct chat, or `assign_task` with the project id) and ask for exactly the data you need.'
  );
  lines.push('4. If no department matches, ask the user or the Root CEO instead of guessing.');
  lines.push('');
  lines.push('## Departments');

  if (doc.departments.length === 0) {
    lines.push('');
    lines.push('_No departments have been created yet._');
  }

  for (const dept of doc.departments) {
    lines.push('');
    lines.push(`### ${dept.name}`);
    lines.push(`- Department ID: ${dept.id}`);
    lines.push(`- Owns folders: ${dept.workspacePath || '(no folder bound)'}`);
    if (dept.description) lines.push(`- Charter: ${dept.description}`);
    if (dept.head) lines.push(`- Department head: ${formatMember(dept.head)}`);
    if (dept.projectManager) lines.push(`- Project manager: ${formatMember(dept.projectManager)}`);

    if (dept.teams.length > 0) {
      lines.push('- Teams:');
      for (const team of dept.teams) {
        const folder = team.workspacePath ? ` | folder: ${team.workspacePath}` : '';
        const lead = team.lead ? ` | lead: ${formatMember(team.lead)}` : '';
        lines.push(
          `  - ${team.name} (id: ${team.id})${folder}${lead}${team.description ? ` — ${team.description}` : ''}`
        );
        if (team.members.length > 0) {
          lines.push(`    - Members: ${team.members.map(formatMember).join('; ')}`);
        }
      }
    }

    if (dept.projects.length > 0) {
      lines.push('- Projects:');
      for (const project of dept.projects) {
        const goal = project.goal || project.description;
        const knowledge =
          project.knowledgeRepos && project.knowledgeRepos.length > 0
            ? ` | knowledge: ${project.knowledgeRepos.join(', ')}`
            : '';
        lines.push(
          `  - ${project.name} (id: ${project.id}) | folder: ${project.workspacePath || '(none)'}${
            goal ? ` | goal: ${goal}` : ''
          }${knowledge}${project.backendTeamId ? ' | team ready' : ' | no backend team yet'}`
        );
      }
    } else {
      lines.push('- Projects: none yet');
    }

    const extraMembers = dept.members.filter((m) => m.id !== dept.head?.id && m.id !== dept.projectManager?.id);
    if (extraMembers.length > 0) {
      lines.push(`- Members: ${extraMembers.map(formatMember).join('; ')}`);
    }
  }

  lines.push('');
  lines.push('## Organization Leadership');
  if (doc.rootCeo) lines.push(`- Root CEO: ${formatMember(doc.rootCeo)}`);
  if (doc.chiefOfStaff) lines.push(`- Chief of staff: ${formatMember(doc.chiefOfStaff)}`);
  lines.push(`- Root workspace: ${doc.rootWorkspace || '(not configured)'}`);

  if (doc.sharedMembers.length > 0) {
    lines.push('');
    lines.push('## Shared Member Pool');
    for (const member of doc.sharedMembers) {
      lines.push(`- ${formatMember(member)}`);
    }
  }

  lines.push('');
  lines.push(MANUAL_NOTES_HEADING);
  lines.push(
    '<!-- Add durable department notes here (data locations, conventions, owners). AionUi preserves this section when the directory is regenerated. -->'
  );
  lines.push('');
  return lines.join('\n');
}

function compactMemberIds(members: OrgDirectoryMemberEntry[], limit = 6): string {
  if (members.length === 0) return 'none';
  const names = members.slice(0, limit).map((m) => `${m.name} (${m.role})`);
  if (members.length > limit) names.push(`+${members.length - limit} more`);
  return names.join(', ');
}

/**
 * Build the compact prompt block injected into an agent's first turn.
 * Excludes member inventory details for non-CEO roles to stay within budget.
 */
export function buildOrgDirectoryPromptBlock(doc: OrgDirectoryDoc, maxChars = 6000): string {
  const lines: string[] = [];
  lines.push('### Organization Directory (authoritative routing map — read this first)');
  lines.push(
    `Root workspace: ${doc.rootWorkspace || '(not configured)'}. Use this directory to find the department that owns the data you need, then contact that department/owner directly. Do not scan unrelated folders and do not guess ownership.`
  );
  lines.push('');
  lines.push('Departments and ownership:');

  if (doc.departments.length === 0) {
    lines.push('- (no departments yet — build the org first or ask the user)');
  }

  for (const dept of doc.departments) {
    const folders = [dept.workspacePath, ...dept.teams.map((t) => t.workspacePath)].filter(Boolean);
    const projects = dept.projects.map(
      (p) =>
        `${p.name} [id: ${p.id}${p.backendTeamId ? '' : ', no team yet'}]${p.workspacePath ? ` at ${p.workspacePath}` : ''}${
          p.knowledgeRepos && p.knowledgeRepos.length > 0 ? ` (knowledge: ${p.knowledgeRepos.join(', ')})` : ''
        }`
    );
    const teams = dept.teams.map((t) => `${t.name}${t.lead ? ` (lead: ${t.lead.name})` : ''}`);
    const contact = dept.head || dept.projectManager;
    const contactText = contact ? `${contact.name} (${contact.role})` : 'no named owner';
    const details = [
      `owns: ${folders.length > 0 ? folders.join(' | ') : 'no folder'}`,
      `contact: ${contactText}`,
      projects.length > 0 ? `projects: ${projects.join('; ')}` : 'projects: none',
      teams.length > 0 ? `teams: ${teams.join('; ')}` : '',
      dept.description ? `charter: ${dept.description}` : '',
    ].filter(Boolean);
    lines.push(`- ${dept.name} [dept id: ${dept.id}] — ${details.join(' — ')}`);
  }

  const shared = doc.sharedMembers.slice(0, 8);
  if (shared.length > 0) {
    lines.push('');
    lines.push(`Unassigned/shared members: ${compactMemberIds(shared)}`);
  }

  lines.push('');
  lines.push('Routing rules:');
  lines.push(
    '1. Find the department whose "owns" folder or charter covers the requested data. That department is the owner.'
  );
  lines.push(
    "2. Ask the named contact for the exact data you need (direct chat, or `assign_task` targeted at one of that department's project ids). State what you need and why."
  );
  lines.push('3. Read files only inside the owning department/project folder.');
  lines.push(
    '4. If nothing matches, call `find_owner` with the topic or path, or ask the user. Never invent a location.'
  );

  const text = lines.join('\n');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 80))}\n... [Organization Directory truncated to fit token budget]`;
}

function buildReminderBlock(doc: OrgDirectoryDoc): string {
  const names = doc.departments.map((d) => d.name).slice(0, 12);
  return `[Organization Directory reminder] Route work to the owning department (${names.join(', ') || 'none yet'}). Read the owning folder only; use find_owner when unsure.`;
}

export function computeOrgDirectorySignature(doc: OrgDirectoryDoc): string {
  const signature = {
    root: doc.rootWorkspace,
    departments: doc.departments.map((dept) => ({
      id: dept.id,
      name: dept.name,
      folder: dept.workspacePath,
      head: dept.head?.id,
      teams: dept.teams.map((team) => ({ id: team.id, folder: team.workspacePath, lead: team.lead?.id })),
      projects: dept.projects.map((project) => ({
        id: project.id,
        folder: project.workspacePath,
        team: project.backendTeamId,
      })),
    })),
  };
  const text = JSON.stringify(signature);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

// conversationId (or 'org-step') -> last signature that received the full block
const injectedSignatures = new Map<string, string>();

export function resetOrgDirectoryPromptCache(): void {
  injectedSignatures.clear();
}

/**
 * Full block on the first turn (or when the org structure changed); one-line reminder
 * afterwards so repeated turns do not re-pay for the full directory.
 */
export function getOrgDirectoryPrompt(doc: OrgDirectoryDoc, options: OrgDirectoryPromptOptions = {}): string {
  const signature = computeOrgDirectorySignature(doc);
  const key = options.conversationId || 'org-step';
  const previous = injectedSignatures.get(key);
  const shouldSendFull = options.forceFull || !previous || previous !== signature;

  injectedSignatures.set(key, signature);

  if (!shouldSendFull) return buildReminderBlock(doc);
  return buildOrgDirectoryPromptBlock(doc, options.maxChars);
}

function tokenizeQuery(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9@._-]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    )
  );
}

function looksLikePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.includes('\\') || value.includes('/');
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

/**
 * Rank departments against a free-text topic or path. Used by the `find_owner` tool.
 */
export function findOrgOwners(doc: OrgDirectoryDoc, query: string, limit = 5): OrgDirectoryOwnerMatch[] {
  const rawQuery = (query || '').trim();
  if (!rawQuery) return [];
  const tokens = tokenizeQuery(rawQuery);
  const queryPath = looksLikePath(rawQuery) ? normalizePath(rawQuery) : '';

  const matches: OrgDirectoryOwnerMatch[] = doc.departments.map((dept) => {
    let score = 0;
    const reasons: string[] = [];

    const deptName = dept.name.toLowerCase();
    const deptDescription = (dept.description || '').toLowerCase();
    const workspacePaths = [dept.workspacePath, ...dept.teams.map((t) => t.workspacePath)].filter(
      (value): value is string => Boolean(value)
    );

    for (const token of tokens) {
      if (deptName.includes(token)) {
        score += 60;
        reasons.push(`department name matches "${token}"`);
      }
      if (deptDescription.includes(token)) {
        score += 25;
        reasons.push(`department charter matches "${token}"`);
      }
      for (const folder of workspacePaths) {
        if (normalizePath(folder).includes(token)) {
          score += 30;
          reasons.push(`owned folder contains "${token}"`);
        }
      }
    }

    for (const project of dept.projects) {
      const projectName = project.name.toLowerCase();
      const projectText = `${project.goal || ''} ${project.description || ''}`.toLowerCase();
      for (const token of tokens) {
        if (projectName.includes(token)) {
          score += 45;
          reasons.push(`project "${project.name}" matches "${token}"`);
        } else if (projectText.includes(token)) {
          score += 20;
          reasons.push(`project "${project.name}" description matches "${token}"`);
        }
      }
      if (
        queryPath &&
        project.workspacePath &&
        (normalizePath(project.workspacePath).startsWith(queryPath) ||
          queryPath.startsWith(normalizePath(project.workspacePath)))
      ) {
        score += 90;
        reasons.push(`path overlaps project folder ${project.workspacePath}`);
      }
    }

    for (const team of dept.teams) {
      for (const token of tokens) {
        if (team.name.toLowerCase().includes(token)) {
          score += 25;
          reasons.push(`team "${team.name}" matches "${token}"`);
        }
      }
    }

    for (const member of dept.members) {
      const haystack = `${member.name} ${member.role} ${(member.skills || []).join(' ')}`.toLowerCase();
      for (const token of tokens) {
        if (haystack.includes(token)) {
          score += 15;
          reasons.push(`member ${member.name} matches "${token}"`);
        }
      }
    }

    if (queryPath && workspacePaths.some((folder) => normalizePath(folder).startsWith(queryPath))) {
      score += 100;
      reasons.push('requested path is inside this department folder');
    }

    const contact = dept.head || dept.projectManager || dept.teams.map((t) => t.lead).find(Boolean);
    return {
      departmentId: dept.id,
      departmentName: dept.name,
      score,
      workspacePaths,
      projectIds: dept.projects.map((project) => project.id),
      projectNames: dept.projects.map((project) => project.name),
      contactName: contact?.name,
      contactRole: contact?.role,
      contactId: contact?.id,
      reasons: Array.from(new Set(reasons)).slice(0, 6),
    };
  });

  return matches
    .filter((match) => match.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit);
}
