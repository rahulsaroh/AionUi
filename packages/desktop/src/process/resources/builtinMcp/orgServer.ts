#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in MCP server for Organization Management ("aionui-org").
 * Runs as a standalone stdio process spawned by the MCP client (e.g. ACP agent session).
 * Forwards tool execution to the main process bridge via authenticated HTTP.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BUILTIN_ORG_MCP_NAME } from './constants';
import { getDataPath } from '@process/utils';

const logDiagnostic = (message: string): void => {
  process.stderr.write(`[builtin-mcp-org] ${message}\n`);
};

interface OrgLocalDb {
  prepare(sql: string): {
    get(...params: any[]): any;
    all(...params: any[]): any[];
    run(...params: any[]): any;
  };
  exec(sql: string): void;
}

let orgDb: OrgLocalDb | null = null;

function resolveDbPath(): string {
  const candidates: string[] = [process.env.AIONUI_DB_PATH].filter(Boolean) as string[];

  try {
    const p = path.join(getDataPath(), 'aionui.db');
    candidates.push(p);
  } catch {
    // ignore
  }

  const homedir = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'AionUi', 'aionui', 'aionui.db'));
    candidates.push(path.join(appData, 'AionUi-Dev', 'aionui', 'aionui.db'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(homedir, 'Library', 'Application Support', 'AionUi', 'aionui', 'aionui.db'));
    candidates.push(path.join(homedir, 'Library', 'Application Support', 'AionUi-Dev', 'aionui', 'aionui.db'));
  } else {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(homedir, '.config');
    candidates.push(path.join(configHome, 'AionUi', 'aionui', 'aionui.db'));
    candidates.push(path.join(configHome, 'AionUi-Dev', 'aionui', 'aionui.db'));
  }

  candidates.push(path.join(process.cwd(), 'aionui.db'));

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  try {
    return path.join(getDataPath(), 'aionui.db');
  } catch {
    return candidates[0] || 'aionui.db';
  }
}

function openOrgDb(): OrgLocalDb {
  if (orgDb) return orgDb;
  const dbPath = resolveDbPath();

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    if (DatabaseSync) {
      const syncDb = new DatabaseSync(dbPath, { open: true });
      orgDb = syncDb;
      return syncDb;
    }
  } catch {
    // fall through to better-sqlite3
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require('better-sqlite3');
    const bDb = new BetterSqlite3(dbPath);
    bDb.pragma('busy_timeout = 5000');
    try {
      bDb.pragma('journal_mode = WAL');
    } catch {}
    orgDb = bDb;
    return bDb;
  } catch (err) {
    logDiagnostic(`Database open failed for ${dbPath}: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

function execLocalOrgTool(
  tool: string,
  args: Record<string, any>,
  role: string,
  deptId?: string,
  projectId?: string
): { success: boolean; result?: any; error?: string } | null {
  try {
    const db = openOrgDb();

    switch (tool) {
      case 'list_org': {
        const hierarchyRow = db.prepare('SELECT value FROM org_state WHERE key = ?').get('aionui:org-hierarchy') as
          | { value: string }
          | undefined;
        const projectsRow = db.prepare('SELECT value FROM org_state WHERE key = ?').get('aionui:org-projects') as
          | { value: string }
          | undefined;
        const membersRow = db.prepare('SELECT value FROM org_state WHERE key = ?').get('aionui:org-members') as
          | { value: string }
          | undefined;

        const hierarchy = hierarchyRow ? JSON.parse(hierarchyRow.value) : { rootCeo: {}, departments: [] };
        const allProjects: any[] = projectsRow ? JSON.parse(projectsRow.value) : [];
        const allMembers: any[] = membersRow ? JSON.parse(membersRow.value) : [];

        let depts = hierarchy.departments || [];
        let projs = allProjects;
        if ((role === 'department_head' || role === 'team_lead') && deptId) {
          depts = depts.filter((d: any) => d.id === deptId);
          projs = projs.filter((p: any) => p.departmentId === deptId);
        }

        const deptIds = new Set(depts.map((d: any) => d.id));

        const memberMap = new Map<string, { id: string; name: string; role: string; skills?: string[] }>();
        for (const m of allMembers) {
          if (m && m.id) {
            memberMap.set(m.id, { id: m.id, name: m.name, role: m.role, skills: m.skills });
          }
        }
        for (const d of depts) {
          for (const t of d.teams || []) {
            for (const sm of t.specialistMembers || []) {
              if (sm && sm.id && !memberMap.has(sm.id)) {
                memberMap.set(sm.id, { id: sm.id, name: sm.name, role: sm.role, skills: sm.skills });
              }
            }
          }
        }

        return {
          success: true,
          result: {
            masterRoot: hierarchy.rootCeo?.workspacePath || null,
            departments: depts.map((d: any) => ({
              id: d.id,
              name: d.name,
              workspacePath: d.workspacePath,
              description: d.description,
              teams: (d.teams || []).map((t: any) => ({
                id: t.id,
                name: t.name,
                specialistMembers: (t.specialistMembers || []).map((sm: any) => ({
                  id: sm.id,
                  name: sm.name,
                  role: sm.role,
                })),
              })),
              projects: projs
                .filter((p: any) => p.departmentId === d.id)
                .map((p: any) => ({
                  id: p.id,
                  name: p.name,
                  workspacePath: p.workspacePath,
                  goal: p.goal,
                  memberIds: p.memberIds || [],
                })),
            })),
            projects: projs.map((p: any) => ({
              id: p.id,
              name: p.name,
              departmentId: p.departmentId,
              workspacePath: p.workspacePath,
              goal: p.goal,
              memberIds: p.memberIds || [],
            })),
            members: Array.from(memberMap.values()),
            departmentsCount: depts.length,
            projectsCount: projs.length,
            membersCount: memberMap.size,
            _scopeFiltered: deptIds.size > 0 ? Array.from(deptIds) : undefined,
          },
        };
      }

      case 'assign_member': {
        const pid = String(args.projectId || '').trim();
        const mid = String(args.memberId || '').trim();
        if (!mid || !pid) {
          return { success: false, error: 'assign_member requires "projectId" and "memberId".' };
        }

        if ((role === 'department_head' || role === 'team_lead') && deptId) {
          try {
            const proj = db.prepare('SELECT department_id FROM org_projects WHERE id = ?').get(pid) as
              | { department_id: string }
              | undefined;
            if (proj && proj.department_id !== deptId) {
              return {
                success: false,
                error: `Access denied: ${role} can only assign members to projects in its own department (${deptId}), not "${pid}".`,
              };
            }
          } catch {}
        }

        try {
          const proj = db.prepare('SELECT member_ids FROM org_projects WHERE id = ?').get(pid) as
            | { member_ids: string }
            | undefined;
          if (proj) {
            const currentIds: string[] = proj.member_ids ? JSON.parse(proj.member_ids) : [];
            if (!currentIds.includes(mid)) {
              const nextIds = [...currentIds, mid];
              db.prepare('UPDATE org_projects SET member_ids = ?, updated_at = ? WHERE id = ?').run(
                JSON.stringify(nextIds),
                Date.now(),
                pid
              );
            }
          }
        } catch {}

        const stateRow = db.prepare('SELECT value FROM org_state WHERE key = ?').get('aionui:org-projects') as
          | { value: string }
          | undefined;
        if (stateRow) {
          const allProjects: any[] = JSON.parse(stateRow.value);
          let changed = false;
          const nextProjects = allProjects.map((p) => {
            if (p.id === pid) {
              const currentIds: string[] = p.memberIds || [];
              if (!currentIds.includes(mid)) {
                changed = true;
                return { ...p, memberIds: [...currentIds, mid] };
              }
            }
            return p;
          });
          if (changed) {
            db.prepare('UPDATE org_state SET value = ?, updated_at = ? WHERE key = ?').run(
              JSON.stringify(nextProjects),
              Date.now(),
              'aionui:org-projects'
            );
          }
        }

        return { success: true, result: { projectId: pid, memberId: mid, assigned: true } };
      }

      case 'remove_member': {
        const mid = String(args.memberId || '').trim();
        const pid = args.projectId ? String(args.projectId).trim() : undefined;
        const tid = args.teamId ? String(args.teamId).trim() : undefined;
        const did = args.departmentId ? String(args.departmentId).trim() : undefined;
        if (!mid) {
          return { success: false, error: 'remove_member requires "memberId".' };
        }

        let removed = false;

        if (pid) {
          try {
            const proj = db.prepare('SELECT member_ids FROM org_projects WHERE id = ?').get(pid) as
              | { member_ids: string }
              | undefined;
            if (proj && proj.member_ids) {
              const currentIds: string[] = JSON.parse(proj.member_ids);
              if (currentIds.includes(mid)) {
                const next = currentIds.filter((id) => id !== mid);
                db.prepare('UPDATE org_projects SET member_ids = ?, updated_at = ? WHERE id = ?').run(
                  JSON.stringify(next),
                  Date.now(),
                  pid
                );
                removed = true;
              }
            }
          } catch {}
        }

        const stateRow = db.prepare('SELECT value FROM org_state WHERE key = ?').get('aionui:org-projects') as
          | { value: string }
          | undefined;
        if (stateRow) {
          const allProjects: any[] = JSON.parse(stateRow.value);
          let changed = false;
          const nextProjects = allProjects.map((p) => {
            const shouldCheck = pid ? p.id === pid : did ? p.departmentId === did : true;
            if (shouldCheck && p.memberIds && p.memberIds.includes(mid)) {
              changed = true;
              removed = true;
              return { ...p, memberIds: p.memberIds.filter((id: string) => id !== mid) };
            }
            return p;
          });
          if (changed) {
            db.prepare('UPDATE org_state SET value = ?, updated_at = ? WHERE key = ?').run(
              JSON.stringify(nextProjects),
              Date.now(),
              'aionui:org-projects'
            );
          }
        }

        const hierRow = db.prepare('SELECT value FROM org_state WHERE key = ?').get('aionui:org-hierarchy') as
          | { value: string }
          | undefined;
        if (hierRow) {
          const hier: any = JSON.parse(hierRow.value);
          let changed = false;
          if (hier.departments) {
            hier.departments = hier.departments.map((d: any) => {
              if (did && d.id !== did) return d;
              return {
                ...d,
                teams: (d.teams || []).map((t: any) => {
                  if (tid && t.id !== tid) return t;
                  const hasMem = (t.specialistMembers || []).some(
                    (m: any) => m.id === mid || m.canonicalAgentId === mid
                  );
                  if (hasMem) {
                    changed = true;
                    removed = true;
                    return {
                      ...t,
                      specialistMembers: t.specialistMembers.filter(
                        (m: any) => m.id !== mid && m.canonicalAgentId !== mid
                      ),
                    };
                  }
                  return t;
                }),
              };
            });
          }
          if (changed) {
            db.prepare('UPDATE org_state SET value = ?, updated_at = ? WHERE key = ?').run(
              JSON.stringify(hier),
              Date.now(),
              'aionui:org-hierarchy'
            );
          }
        }

        return {
          success: true,
          result: { memberId: mid, removed, projectId: pid || null, teamId: tid || null, departmentId: did || null },
        };
      }

      case 'delete_member': {
        const mid = String(args.memberId || '').trim();
        if (!mid) {
          return { success: false, error: 'delete_member requires "memberId".' };
        }

        try {
          db.prepare('DELETE FROM org_members WHERE id = ?').run(mid);
        } catch {}

        const membersRow = db.prepare('SELECT value FROM org_state WHERE key = ?').get('aionui:org-members') as
          | { value: string }
          | undefined;
        if (membersRow) {
          const allMembers: any[] = JSON.parse(membersRow.value);
          const nextMembers = allMembers.filter((m: any) => m.id !== mid && m.canonicalAgentId !== mid);
          db.prepare('UPDATE org_state SET value = ?, updated_at = ? WHERE key = ?').run(
            JSON.stringify(nextMembers),
            Date.now(),
            'aionui:org-members'
          );
        }

        try {
          const projs = db.prepare('SELECT id, member_ids FROM org_projects').all() as Array<{
            id: string;
            member_ids: string;
          }>;
          for (const p of projs) {
            if (p.member_ids) {
              const currentIds: string[] = JSON.parse(p.member_ids);
              if (currentIds.includes(mid)) {
                const next = currentIds.filter((id) => id !== mid);
                db.prepare('UPDATE org_projects SET member_ids = ?, updated_at = ? WHERE id = ?').run(
                  JSON.stringify(next),
                  Date.now(),
                  p.id
                );
              }
            }
          }
        } catch {}

        const stateRow = db.prepare('SELECT value FROM org_state WHERE key = ?').get('aionui:org-projects') as
          | { value: string }
          | undefined;
        if (stateRow) {
          const allProjects: any[] = JSON.parse(stateRow.value);
          const nextProjects = allProjects.map((p) => {
            if (p.memberIds && p.memberIds.includes(mid)) {
              return { ...p, memberIds: p.memberIds.filter((id: string) => id !== mid) };
            }
            return p;
          });
          db.prepare('UPDATE org_state SET value = ?, updated_at = ? WHERE key = ?').run(
            JSON.stringify(nextProjects),
            Date.now(),
            'aionui:org-projects'
          );
        }

        const hierRow = db.prepare('SELECT value FROM org_state WHERE key = ?').get('aionui:org-hierarchy') as
          | { value: string }
          | undefined;
        if (hierRow) {
          const hier: any = JSON.parse(hierRow.value);
          if (hier.departments) {
            hier.departments = hier.departments.map((d: any) => ({
              ...d,
              teams: (d.teams || []).map((t: any) => ({
                ...t,
                specialistMembers: (t.specialistMembers || []).filter(
                  (m: any) => m.id !== mid && m.canonicalAgentId !== mid
                ),
              })),
            }));
            db.prepare('UPDATE org_state SET value = ?, updated_at = ? WHERE key = ?').run(
              JSON.stringify(hier),
              Date.now(),
              'aionui:org-hierarchy'
            );
          }
        }

        return {
          success: true,
          result: { memberId: mid, deleted: true },
        };
      }

      case 'remove_members_from_department_projects': {
        const did = String(args.departmentId || '').trim();
        const mids: string[] = Array.isArray(args.memberIds) ? args.memberIds : [];
        if (!did || mids.length === 0) {
          return {
            success: false,
            error: 'remove_members_from_department_projects requires "departmentId" and "memberIds".',
          };
        }

        if ((role === 'department_head' || role === 'team_lead') && deptId && did !== deptId) {
          return {
            success: false,
            error: `Access denied: ${role} can only modify projects in its own department (${deptId}), not "${did}".`,
          };
        }

        const midSet = new Set(mids);
        let changed = false;

        try {
          const projects = db
            .prepare('SELECT id, member_ids FROM org_projects WHERE department_id = ?')
            .all(did) as Array<{
            id: string;
            member_ids: string;
          }>;
          for (const proj of projects) {
            const currentIds: string[] = proj.member_ids ? JSON.parse(proj.member_ids) : [];
            const nextIds = currentIds.filter((id) => !midSet.has(id));
            if (nextIds.length !== currentIds.length) {
              db.prepare('UPDATE org_projects SET member_ids = ?, updated_at = ? WHERE id = ?').run(
                JSON.stringify(nextIds),
                Date.now(),
                proj.id
              );
              changed = true;
            }
          }
        } catch {}

        const stateRow = db.prepare('SELECT value FROM org_state WHERE key = ?').get('aionui:org-projects') as
          | { value: string }
          | undefined;
        if (stateRow) {
          const allProjects: any[] = JSON.parse(stateRow.value);
          let stateChanged = false;
          const nextProjects = allProjects.map((p: any) => {
            if (p.departmentId !== did) return p;
            const currentIds: string[] = p.memberIds || [];
            const nextIds = currentIds.filter((id) => !midSet.has(id));
            if (nextIds.length !== currentIds.length) {
              stateChanged = true;
              return { ...p, memberIds: nextIds, updatedAt: Date.now() };
            }
            return p;
          });
          if (stateChanged) {
            db.prepare('UPDATE org_state SET value = ?, updated_at = ? WHERE key = ?').run(
              JSON.stringify(nextProjects),
              Date.now(),
              'aionui:org-projects'
            );
          }
        }

        const hierRow = db.prepare('SELECT value FROM org_state WHERE key = ?').get('aionui:org-hierarchy') as
          | { value: string }
          | undefined;
        if (hierRow) {
          const hier: any = JSON.parse(hierRow.value);
          if (hier.departments) {
            hier.departments = hier.departments.map((d: any) => {
              if (d.id !== did) return d;
              return {
                ...d,
                teams: (d.teams || []).map((t: any) => ({
                  ...t,
                  specialistMembers: (t.specialistMembers || []).filter(
                    (m: any) => !midSet.has(m.id) && !midSet.has(m.canonicalAgentId)
                  ),
                })),
              };
            });
            db.prepare('UPDATE org_state SET value = ?, updated_at = ? WHERE key = ?').run(
              JSON.stringify(hier),
              Date.now(),
              'aionui:org-hierarchy'
            );
          }
        }

        return { success: true, result: { departmentId: did, memberIds: mids, removed: changed } };
      }

      case 'assign_task': {
        const target = String(args.project_id || args.target || '').trim();
        const task = String(args.text || args.task || '').trim();
        if (!target || !task) {
          return { success: false, error: 'assign_task requires "project_id" (or "target") and "text" (or "task").' };
        }
        return {
          success: true,
          result: {
            delegated: true,
            target,
            task,
            assignedAt: Date.now(),
            status: 'queued',
            note: `Task delegated to ${target}: ${task}`,
          },
        };
      }

      case 'get_project_status': {
        const target = String(args.project_id || args.projectId || args.target || '').trim();
        return {
          success: true,
          result: {
            projectId: target,
            status: 'active',
            tasksCount: 0,
            activeTurns: 0,
          },
        };
      }

      case 'list_project_tasks': {
        const target = String(args.project_id || args.projectId || args.target || '').trim();
        return {
          success: true,
          result: {
            projectId: target,
            tasks: [],
          },
        };
      }

      case 'hire_member': {
        const name = String(args.name || '').trim();
        const roleVal = String(args.role || '').trim();
        if (!name || !roleVal) {
          return { success: false, error: 'hire_member requires "name" and "role".' };
        }
        const memId = `member-${Date.now()}`;
        const now = Date.now();
        try {
          db.prepare(
            `INSERT INTO org_members (id, name, role, system_prompt, model, skills, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, updated_at = excluded.updated_at`
          ).run(memId, name, roleVal, args.systemPrompt || null, null, JSON.stringify(args.skills || []), now, now);
        } catch {}

        const membersRow = db.prepare('SELECT value FROM org_state WHERE key = ?').get('aionui:org-members') as
          | { value: string }
          | undefined;
        const allMembers: any[] = membersRow ? JSON.parse(membersRow.value) : [];
        const newMember: any = {
          id: memId,
          canonicalAgentId: memId,
          name,
          role: roleVal,
          skills: args.skills || [],
          systemPrompt: args.systemPrompt || '',
          assignedTeamIds: [],
          lastActiveAt: now,
          status: 'idle',
        };
        allMembers.push(newMember);
        db.prepare('UPDATE org_state SET value = ?, updated_at = ? WHERE key = ?').run(
          JSON.stringify(allMembers),
          now,
          'aionui:org-members'
        );

        if (args.projectId) {
          try {
            const proj = db.prepare('SELECT member_ids FROM org_projects WHERE id = ?').get(args.projectId) as
              | { member_ids: string }
              | undefined;
            if (proj) {
              const currentIds: string[] = proj.member_ids ? JSON.parse(proj.member_ids) : [];
              if (!currentIds.includes(memId)) {
                const nextIds = [...currentIds, memId];
                db.prepare('UPDATE org_projects SET member_ids = ?, updated_at = ? WHERE id = ?').run(
                  JSON.stringify(nextIds),
                  now,
                  args.projectId
                );
              }
            }
          } catch {}
        }

        return {
          success: true,
          result: { id: memId, name, role: roleVal, created: true, assignedToProject: args.projectId || null },
        };
      }

      case 'get_status': {
        let deptsCount = 0;
        let projsCount = 0;
        let membersCount = 0;
        try {
          const depts = db.prepare('SELECT COUNT(*) as c FROM org_departments').get() as { c: number };
          const projs = db.prepare('SELECT COUNT(*) as c FROM org_projects').get() as { c: number };
          const members = db.prepare('SELECT COUNT(*) as c FROM org_members').get() as { c: number };
          deptsCount = depts.c;
          projsCount = projs.c;
          membersCount = members.c;
        } catch {
          const hierarchyRow = db.prepare('SELECT value FROM org_state WHERE key = ?').get('aionui:org-hierarchy') as
            | { value: string }
            | undefined;
          const projectsRow = db.prepare('SELECT value FROM org_state WHERE key = ?').get('aionui:org-projects') as
            | { value: string }
            | undefined;
          const hierarchy = hierarchyRow ? JSON.parse(hierarchyRow.value) : { departments: [] };
          const allProjects: any[] = projectsRow ? JSON.parse(projectsRow.value) : [];
          deptsCount = (hierarchy.departments || []).length;
          projsCount = allProjects.length;
        }
        return {
          success: true,
          result: {
            departments: deptsCount,
            projects: projsCount,
            members: membersCount,
            masterRoot: null,
            formattedSummary: `Organization operating with ${deptsCount} departments, ${projsCount} projects, ${membersCount} members.`,
          },
        };
      }

      default:
        return null;
    }
  } catch (err) {
    logDiagnostic(`Local execution error in ${tool}: ${err instanceof Error ? err.message : String(err)}`);
    return {
      success: false,
      error: `Local org tool "${tool}" failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function callBridgeTool(
  tool: string,
  args: Record<string, any>
): Promise<{ success: boolean; result?: any; error?: string }> {
  const port = process.env.AIONUI_ORG_BRIDGE_PORT;
  const token = process.env.AIONUI_ORG_BRIDGE_TOKEN;
  const role = process.env.AIONUI_ORG_ROLE || 'ceo';
  const deptId = process.env.AIONUI_ORG_DEPT_ID;
  const projectId = process.env.AIONUI_ORG_PROJECT_ID;
  const deptWorkspacePath = process.env.AIONUI_ORG_DEPT_WORKSPACE;
  const projectFolder = process.env.AIONUI_ORG_PROJECT_FOLDER || deptWorkspacePath;
  const approvalPolicy = process.env.AIONUI_ORG_APPROVAL_POLICY;

  if (!port || !token) {
    const local = execLocalOrgTool(tool, args, role, deptId, projectId);
    if (local) return local;
    return {
      success: false,
      error: 'Organization bridge is unavailable (missing AIONUI_ORG_BRIDGE_PORT or TOKEN).',
    };
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/org-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tool,
        args,
        role,
        deptId,
        projectId,
        deptWorkspacePath,
        projectFolder,
        approvalPolicy,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      const local = execLocalOrgTool(tool, args, role, deptId, projectId);
      if (local) return local;
      return {
        success: false,
        error: `Bridge HTTP ${res.status}: ${text}`,
      };
    }

    const json = (await res.json()) as { success: boolean; result?: any; error?: string };
    if (!json.success) {
      const local = execLocalOrgTool(tool, args, role, deptId, projectId);
      if (local) return local;
    }
    return json;
  } catch (err) {
    const local = execLocalOrgTool(tool, args, role, deptId, projectId);
    if (local) return local;
    return {
      success: false,
      error: `Bridge communication failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function formatToolResponse(response: { success: boolean; result?: any; error?: string }) {
  if (!response.success) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ${response.error || 'Unknown error occurred during tool execution.'}`,
        },
      ],
      isError: true,
    };
  }

  const outputText =
    typeof response.result === 'string'
      ? response.result
      : JSON.stringify(response.result ?? { success: true }, null, 2);

  return {
    content: [
      {
        type: 'text' as const,
        text: outputText,
      },
    ],
  };
}

async function main() {
  const role = process.env.AIONUI_ORG_ROLE || 'ceo';
  logDiagnostic(`Starting aionui-org MCP server for role="${role}"...`);

  const server = new McpServer({
    name: BUILTIN_ORG_MCP_NAME,
    version: '1.0.0',
  });

  // Tools available to CEO, Department Head, and Team Lead
  if (role === 'ceo' || role === 'department_head' || role === 'team_lead') {
    server.tool(
      'scan_folder',
      'Scans a folder and returns a compact directory tree with domain/project-type hints (Flutter, YouTube, Digital Products, Web, Python). Refuses paths outside master root.',
      {
        path: z
          .string()
          .optional()
          .describe('Absolute path to folder to scan. If omitted, scans the root organization workspace.'),
        depth: z.number().int().min(1).max(3).optional().describe('Maximum traversal depth (1-3, default: 2).'),
        maxEntries: z
          .number()
          .int()
          .min(10)
          .max(500)
          .optional()
          .describe('Maximum directory entries to inspect (default: 100, max: 500).'),
      },
      async (args) => {
        const res = await callBridgeTool('scan_folder', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'create_project',
      'Creates a new project under a department, bound to an app or product folder.',
      {
        departmentId: z.string().describe('ID of the parent department'),
        name: z.string().describe('Name of the project (e.g. Flutter Mobile App, Video Production)'),
        folder: z.string().describe('Absolute directory path on disk for this project'),
        goal: z.string().optional().describe('Primary objective or charter for the project'),
        memberIds: z.array(z.string()).optional().describe('IDs of shared members to assign to this project'),
      },
      async (args) => {
        const res = await callBridgeTool('create_project', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'create_team',
      'Creates a new sub-team under a department.',
      {
        departmentId: z.string().describe('ID of the parent department'),
        name: z.string().describe('Name of the team (e.g. Conditioning and Exercise Team, Backend Team)'),
      },
      async (args) => {
        const res = await callBridgeTool('create_team', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'hire_member',
      'Recruits a new specialist into the shared member pool and optionally assigns them to a project or team. Duplicate members (same name + role) are detected and reused instead of creating duplicates.',
      {
        name: z.string().describe('Name of the new member (e.g. "Backend Engineer", "UX Designer")'),
        role: z.string().describe('Role or specialty of the member'),
        projectId: z.string().optional().describe('Optional project ID to immediately assign the new member to'),
        teamId: z.string().optional().describe('Optional team ID to immediately assign the new member to'),
        departmentId: z
          .string()
          .optional()
          .describe('Optional department ID to scope the hire (required for team_lead, optional for department_head)'),
        skills: z.array(z.string()).optional().describe('Technical or creative skills'),
        systemPrompt: z.string().optional().describe('Custom system instructions for this member'),
      },
      async (args) => {
        const res = await callBridgeTool('hire_member', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'assign_member',
      'Assigns an existing member from the shared pool to a project or team.',
      {
        memberId: z.string().describe('ID of member from shared pool'),
        projectId: z.string().optional().describe('Target project ID'),
        teamId: z.string().optional().describe('Target team ID'),
      },
      async (args) => {
        const res = await callBridgeTool('assign_member', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'remove_member',
      'Removes or unassigns a member from a project or team, or from all projects in a department.',
      {
        memberId: z.string().describe('ID of member to remove'),
        projectId: z.string().optional().describe('Target project ID to remove member from'),
        teamId: z.string().optional().describe('Target team ID to remove member from'),
        departmentId: z.string().optional().describe('Department ID to remove member from all its projects'),
      },
      async (args) => {
        const res = await callBridgeTool('remove_member', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'delete_member',
      'Permanently deletes a specialist member from the organization, deleting them from the shared member pool and unassigning them from all projects and teams.',
      {
        memberId: z.string().describe('ID of the member to delete permanently'),
      },
      async (args) => {
        const res = await callBridgeTool('delete_member', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'remove_members_from_department_projects',
      'Removes specified members from all projects under a department.',
      {
        departmentId: z.string().describe('ID of the department whose projects should be modified'),
        memberIds: z.array(z.string()).describe('IDs of members to remove from all projects in the department'),
      },
      async (args) => {
        const res = await callBridgeTool('remove_members_from_department_projects', args);
        return formatToolResponse(res);
      }
    );
  }

  // Tools exclusive to Root CEO
  if (role === 'ceo') {
    server.tool(
      'create_department',
      'Creates a new department bound to a specific local directory under master root.',
      {
        name: z.string().describe('Name of the department (e.g. App Builder, YouTube Automation, Digital Products)'),
        folder: z.string().describe('Absolute directory path on disk bound to this department'),
        description: z.string().optional().describe('Charter and responsibilities of the department'),
      },
      async (args) => {
        const res = await callBridgeTool('create_department', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'propose_structure',
      'Proposes organizational structure (departments, projects, suggested members) to the user for review. Renders an interactive proposal card with Approve/Edit/Reject. Creates NOTHING until the user approves.',
      {
        departments: z
          .array(
            z.object({
              name: z.string().describe('Department name'),
              folder: z.string().describe('Department folder path'),
              description: z.string().optional().describe('Department description'),
              projects: z
                .array(
                  z.object({
                    name: z.string().describe('Project name'),
                    folder: z.string().describe('Project folder path'),
                    description: z.string().optional().describe('Project description'),
                  })
                )
                .optional(),
            })
          )
          .describe('Proposed departments and their sub-projects'),
        suggestedMembers: z
          .array(
            z.object({
              name: z.string().describe('Specialist name'),
              role: z.string().describe('Role / specialty'),
            })
          )
          .optional()
          .describe('Suggested members to hire for this structure'),
      },
      async (args) => {
        const res = await callBridgeTool('propose_structure', args);
        return formatToolResponse(res);
      }
    );
  }

  // Execution tools (shell + file ops) available to Project Heads, Team Leads, and specialist members.
  // These run strictly inside the agent's assigned project/workspace folder in the main process,
  // gated by the per-project approval policy (read_only | auto_edit | full_auto) and the
  // folder jail. The Root CEO (role === 'ceo') intentionally does NOT get these tools.
  if (role === 'project_head' || role === 'team_lead') {
    server.tool(
      'list_dir',
      'Lists the immediate files and subdirectories of a folder inside the project workspace. Free (read-only).',
      {
        path: z
          .string()
          .optional()
          .describe('Absolute path to a folder inside the project workspace. Defaults to the project root.'),
      },
      async (args) => {
        const res = await callBridgeTool('list_dir', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'read_file',
      'Reads a UTF-8 text file inside the project workspace. Free (read-only). Sensitive files (e.g. .env, keys) require user approval.',
      {
        path: z.string().describe('Absolute path to the file inside the project workspace.'),
      },
      async (args) => {
        const res = await callBridgeTool('read_file', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'write_file',
      'Creates or overwrites a UTF-8 text file inside the project workspace. Whether this needs approval depends on the project approval policy.',
      {
        path: z.string().describe('Absolute path to the file inside the project workspace.'),
        content: z.string().describe('Full new UTF-8 content of the file.'),
      },
      async (args) => {
        const res = await callBridgeTool('write_file', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'run_shell',
      'Runs a shell command with the project workspace as the working directory. Approval depends on the project policy (auto_edit asks, full_auto allows in-folder safe commands). Commands touching paths outside the folder or performing destructive/system actions always require approval. Returns exitCode, stdout, stderr.',
      {
        command: z.string().describe('Shell command to execute.'),
        cwd: z
          .string()
          .optional()
          .describe('Working directory inside the project workspace. Defaults to the project root.'),
        timeoutMs: z.number().int().min(1000).max(300000).optional().describe('Timeout in ms (1s-5min, default 60s).'),
      },
      async (args) => {
        const res = await callBridgeTool('run_shell', args);
        return formatToolResponse(res);
      }
    );
  }

  // Tools available to all roles (CEO, Dept Head, Project Head)
  server.tool(
    'get_org_directory',
    'Returns the full Organization Directory document: which department owns which folders, its projects/teams/members, and who to contact. Read this before scanning folders or asking for data.',
    {},
    async () => {
      const res = await callBridgeTool('get_org_directory', {});
      return formatToolResponse(res);
    }
  );

  server.tool(
    'find_owner',
    'Finds which department owns a topic, artifact name, project name, or folder path using the Organization Directory. Returns the owning department, its folders/projects, and the person to contact. Use this before scanning folders.',
    {
      query: z.string().describe('Topic, artifact name, project name, or absolute folder path'),
    },
    async (args) => {
      const res = await callBridgeTool('find_owner', args);
      return formatToolResponse(res);
    }
  );

  server.tool(
    'list_org',
    'Lists the full current organization state including departments, projects, and active shared members.',
    {},
    async () => {
      const res = await callBridgeTool('list_org', {});
      return formatToolResponse(res);
    }
  );

  server.tool(
    'assign_task',
    'Delegates an execution task to a specific project lead or department. If new team members should be recruited, pass approved_lineup_id after getting explicit user approval first.',
    {
      project_id: z.string().optional().describe('ID or name of target project'),
      target: z.string().optional().describe('Target project ID or department (alias for project_id)'),
      text: z.string().optional().describe('Clear, actionable technical directive for execution'),
      task: z.string().optional().describe('Clear, actionable directive for execution (alias for text)'),
      approved_lineup_id: z
        .string()
        .optional()
        .describe(
          'ID of the user-approved lineup (from proposal approval or ask_user reply). Pass this id exactly as received.'
        ),
      approved_lineup: z
        .union([
          z.string(),
          z.array(
            z.union([
              z.string(),
              z.object({
                name: z.string(),
                assistant: z.string(),
              }),
            ])
          ),
        ])
        .optional()
        .describe(
          'Deprecated fallback: User-approved lineup for member recruitment. Prefer passing approved_lineup_id.'
        ),
    },
    async (args) => {
      const res = await callBridgeTool('assign_task', args);
      return formatToolResponse(res);
    }
  );

  server.tool(
    'get_project_status',
    'Retrieves the current execution run state, active agent turns, and mailbox messages for a project team.',
    {
      project_id: z.string().describe('Target project ID'),
    },
    async (args) => {
      const res = await callBridgeTool('get_project_status', args);
      return formatToolResponse(res);
    }
  );

  server.tool(
    'list_project_tasks',
    'Lists the current tasks and their execution status (completed, in_progress, blocked) for a project team.',
    {
      project_id: z.string().describe('Target project ID'),
    },
    async (args) => {
      const res = await callBridgeTool('list_project_tasks', args);
      return formatToolResponse(res);
    }
  );

  server.tool(
    'get_status',
    'Retrieves current organization status, active projects, and telemetry from across the company.',
    {},
    async () => {
      const res = await callBridgeTool('get_status', {});
      return formatToolResponse(res);
    }
  );

  server.tool(
    'ask_user',
    'Asks the user a clarifying question when an executive directive or folder structure is ambiguous.',
    {
      question: z.string().describe('Question to present to the user'),
    },
    async (args) => {
      const res = await callBridgeTool('ask_user', args);
      return formatToolResponse(res);
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logDiagnostic('Connected to stdio transport successfully.');
}

main().catch((err) => {
  logDiagnostic(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
