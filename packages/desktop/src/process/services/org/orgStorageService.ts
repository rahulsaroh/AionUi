/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'node:fs';
import { getDataPath } from '@process/utils';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import type {
  OrgHierarchy,
  OrgProject,
  OrgAgentMember,
  OrgDepartmentNode,
  OrgCronJob,
  OrgConversation,
  OrgStorageBundle,
  RootCEO,
} from '@/types/organization';

export class OrgStorageService {
  private static instance: OrgStorageService | null = null;
  private driver: ISqliteDriver | null = null;

  constructor(customDriver?: ISqliteDriver) {
    if (customDriver) {
      this.driver = customDriver;
    }
  }

  public static getInstance(): OrgStorageService {
    if (!OrgStorageService.instance) {
      OrgStorageService.instance = new OrgStorageService();
    }
    return OrgStorageService.instance;
  }

  public static setInstance(instance: OrgStorageService | null): void {
    OrgStorageService.instance = instance;
  }

  private async getDriver(): Promise<ISqliteDriver> {
    if (this.driver) {
      return this.driver;
    }
    try {
      const { BetterSqlite3Driver } = await import('@process/services/database/drivers/BetterSqlite3Driver');
      const dbPath = path.join(getDataPath(), 'aionui.db');
      this.driver = new BetterSqlite3Driver(dbPath);
      const { initSchema } = await import('@process/services/database/schema');
      initSchema(this.driver);
      return this.driver;
    } catch (err) {
      console.error('[OrgStorageService] Failed to initialize BetterSqlite3Driver:', err);
      throw err;
    }
  }

  public async saveData(key: string, value: string): Promise<boolean> {
    const db = await this.getDriver();
    const now = Date.now();
    try {
      db.prepare(
        `INSERT INTO org_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(key, value, now);
      return true;
    } catch (err) {
      console.error(`[OrgStorageService] Failed to save key "${key}":`, err);
      return false;
    }
  }

  public async loadData(key: string): Promise<string | null> {
    const db = await this.getDriver();
    try {
      const row = db.prepare('SELECT value FROM org_state WHERE key = ?').get(key) as
        | { value: string }
        | undefined;
      return row ? row.value : null;
    } catch (err) {
      console.error(`[OrgStorageService] Failed to load key "${key}":`, err);
      return null;
    }
  }

  public async getMembers(): Promise<OrgAgentMember[]> {
    const db = await this.getDriver();
    try {
      const rows = db
        .prepare('SELECT id, name, role, system_prompt, model, skills FROM org_members ORDER BY name ASC')
        .all() as Array<{
        id: string;
        name: string;
        role: string;
        system_prompt: string | null;
        model: string | null;
        skills: string | null;
      }>;

      return rows.map((r) => ({
        id: r.id,
        canonicalAgentId: r.id,
        name: r.name,
        role: r.role,
        systemPrompt: r.system_prompt || undefined,
        model: r.model ? JSON.parse(r.model) : undefined,
        skills: r.skills ? JSON.parse(r.skills) : [],
        assignedTeamIds: [],
        lastActiveAt: null,
        status: 'idle',
      }));
    } catch (err) {
      console.error('[OrgStorageService] getMembers failed:', err);
      return [];
    }
  }

  public async saveMember(member: OrgAgentMember): Promise<boolean> {
    const db = await this.getDriver();
    const now = Date.now();
    try {
      db.prepare(
        `INSERT INTO org_members (id, name, role, system_prompt, model, skills, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           role = excluded.role,
           system_prompt = excluded.system_prompt,
           model = excluded.model,
           skills = excluded.skills,
           updated_at = excluded.updated_at`
      ).run(
        member.id,
        member.name,
        member.role,
        member.systemPrompt || null,
        member.model ? JSON.stringify(member.model) : null,
        member.skills ? JSON.stringify(member.skills) : JSON.stringify([]),
        now,
        now
      );
      return true;
    } catch (err) {
      console.error('[OrgStorageService] saveMember failed:', err);
      return false;
    }
  }

  public async saveMembers(members: OrgAgentMember[]): Promise<boolean> {
    const db = await this.getDriver();
    const now = Date.now();
    try {
      const stmt = db.prepare(
        `INSERT INTO org_members (id, name, role, system_prompt, model, skills, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           role = excluded.role,
           system_prompt = excluded.system_prompt,
           model = excluded.model,
           skills = excluded.skills,
           updated_at = excluded.updated_at`
      );
      db.transaction(() => {
        for (const m of members) {
          stmt.run(
            m.id,
            m.name,
            m.role,
            m.systemPrompt || null,
            m.model ? JSON.stringify(m.model) : null,
            m.skills ? JSON.stringify(m.skills) : JSON.stringify([]),
            now,
            now
          );
        }
      })();
      return true;
    } catch (err) {
      console.error('[OrgStorageService] saveMembers failed:', err);
      return false;
    }
  }

  public async deleteMember(id: string): Promise<boolean> {
    const db = await this.getDriver();
    try {
      db.prepare('DELETE FROM org_members WHERE id = ?').run(id);
      return true;
    } catch (err) {
      console.error('[OrgStorageService] deleteMember failed:', err);
      return false;
    }
  }

  public async getProjects(): Promise<OrgProject[]> {
    const db = await this.getDriver();
    try {
      const rows = db
        .prepare(
          'SELECT id, name, department_id, workspace_path, member_ids, goal, description, status, context FROM org_projects ORDER BY name ASC'
        )
        .all() as Array<{
        id: string;
        name: string;
        department_id: string;
        workspace_path: string | null;
        member_ids: string | null;
        goal: string | null;
        description: string | null;
        status: string | null;
        context: string | null;
      }>;

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        departmentId: r.department_id,
        teamIds: [],
        memberIds: r.member_ids ? JSON.parse(r.member_ids) : [],
        goal: r.goal || undefined,
        description: r.description || undefined,
        status: (r.status as OrgProject['status']) || 'active',
        context: r.context ? JSON.parse(r.context) : undefined,
        workspacePath: r.workspace_path || null,
      }));
    } catch (err) {
      console.error('[OrgStorageService] getProjects failed:', err);
      return [];
    }
  }

  public async saveProject(project: OrgProject): Promise<boolean> {
    const db = await this.getDriver();
    const now = Date.now();
    try {
      db.prepare(
        `INSERT INTO org_projects (id, name, department_id, workspace_path, member_ids, goal, description, status, context, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           department_id = excluded.department_id,
           workspace_path = excluded.workspace_path,
           member_ids = excluded.member_ids,
           goal = excluded.goal,
           description = excluded.description,
           status = excluded.status,
           context = excluded.context,
           updated_at = excluded.updated_at`
      ).run(
        project.id,
        project.name,
        project.departmentId,
        project.workspacePath || null,
        JSON.stringify(project.memberIds || []),
        project.goal || null,
        project.description || null,
        project.status || 'active',
        project.context ? JSON.stringify(project.context) : null,
        now,
        now
      );
      return true;
    } catch (err) {
      console.error('[OrgStorageService] saveProject failed:', err);
      return false;
    }
  }

  public async saveProjects(projects: OrgProject[]): Promise<boolean> {
    const db = await this.getDriver();
    const now = Date.now();
    try {
      const stmt = db.prepare(
        `INSERT INTO org_projects (id, name, department_id, workspace_path, member_ids, goal, description, status, context, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           department_id = excluded.department_id,
           workspace_path = excluded.workspace_path,
           member_ids = excluded.member_ids,
           goal = excluded.goal,
           description = excluded.description,
           status = excluded.status,
           context = excluded.context,
           updated_at = excluded.updated_at`
      );
      db.transaction(() => {
        for (const p of projects) {
          stmt.run(
            p.id,
            p.name,
            p.departmentId,
            p.workspacePath || null,
            JSON.stringify(p.memberIds || []),
            p.goal || null,
            p.description || null,
            p.status || 'active',
            p.context ? JSON.stringify(p.context) : null,
            now,
            now
          );
        }
      })();
      return true;
    } catch (err) {
      console.error('[OrgStorageService] saveProjects failed:', err);
      return false;
    }
  }

  public async deleteProject(id: string): Promise<boolean> {
    const db = await this.getDriver();
    try {
      db.prepare('DELETE FROM org_projects WHERE id = ?').run(id);
      return true;
    } catch (err) {
      console.error('[OrgStorageService] deleteProject failed:', err);
      return false;
    }
  }

  public async getDepartments(): Promise<Array<{
    id: string;
    name: string;
    workspacePath: string | null;
    headAgentId: string | null;
    parentDepartmentId: string | null;
    description?: string;
    icon?: string;
    color?: string;
    orderIndex?: number;
    status?: string;
  }>> {
    const db = await this.getDriver();
    try {
      const rows = db
        .prepare(
          'SELECT id, name, workspace_path, head_agent_id, parent_department_id, description, icon, color, order_index, status FROM org_departments ORDER BY order_index ASC'
        )
        .all() as Array<{
        id: string;
        name: string;
        workspace_path: string | null;
        head_agent_id: string | null;
        parent_department_id: string | null;
        description: string | null;
        icon: string | null;
        color: string | null;
        order_index: number | null;
        status: string | null;
      }>;

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        workspacePath: r.workspace_path,
        headAgentId: r.head_agent_id,
        parentDepartmentId: r.parent_department_id,
        description: r.description || undefined,
        icon: r.icon || undefined,
        color: r.color || undefined,
        orderIndex: r.order_index ?? undefined,
        status: r.status || 'idle',
      }));
    } catch (err) {
      console.error('[OrgStorageService] getDepartments failed:', err);
      return [];
    }
  }

  public async getFullBundle(): Promise<OrgStorageBundle | null> {
    const db = await this.getDriver();
    try {
      const rootCeoRaw = await this.loadData('root_ceo');
      const cronJobsRaw = await this.loadData('cron_jobs');
      const conversationsRaw = await this.loadData('conversations');
      const activeScope = (await this.loadData('active_scope')) as OrgStorageBundle['activeScope'];

      const members = await this.getMembers();
      const projects = await this.getProjects();
      const deptRows = await this.getDepartments();

      // If nothing is initialized in SQLite, return null
      if (!rootCeoRaw && members.length === 0 && deptRows.length === 0) {
        return null;
      }

      const rootCeo: RootCEO = rootCeoRaw
        ? JSON.parse(rootCeoRaw)
        : {
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
              assignedTeamIds: [],
              lastActiveAt: Date.now(),
              status: 'idle',
            },
            status: 'idle',
            lastActiveAt: Date.now(),
          };

      const memberMap = new Map<string, OrgAgentMember>();
      for (const m of members) {
        memberMap.set(m.id, m);
      }

      // Reconstruct departments without persisting duplicate rosters
      const departments: OrgDepartmentNode[] = deptRows.map((d) => {
        const headAgent = (d.headAgentId && memberMap.get(d.headAgentId)) || {
          id: `head-${d.id}`,
          canonicalAgentId: `head-${d.id}`,
          name: `${d.name} Head`,
          role: 'department_head',
          assignedTeamIds: [],
          lastActiveAt: null,
          status: 'idle',
        };

        const deptProjects = projects.filter((p) => p.departmentId === d.id);

        return {
          id: d.id,
          name: d.name,
          workspacePath: d.workspacePath,
          parentDepartmentId: d.parentDepartmentId,
          description: d.description,
          icon: d.icon,
          color: d.color,
          order: d.orderIndex,
          status: (d.status as OrgDepartmentNode['status']) || 'idle',
          departmentCeoAgent: headAgent,
          teams: [],
          linkedProjects: deptProjects.map((p) => ({
            id: p.id,
            name: p.name,
            path: p.workspacePath || undefined,
          })),
          lastActiveAt: null,
        };
      });

      const hierarchy: OrgHierarchy = {
        rootCeo,
        departments,
        lastUpdated: Date.now(),
      };

      const cronJobs: OrgCronJob[] = cronJobsRaw ? JSON.parse(cronJobsRaw) : [];
      const conversations: OrgConversation[] = conversationsRaw ? JSON.parse(conversationsRaw) : [];

      return {
        hierarchy,
        projects,
        members,
        cronJobs,
        conversations,
        activeScope: activeScope || 'workplace',
      };
    } catch (err) {
      console.error('[OrgStorageService] getFullBundle failed:', err);
      return null;
    }
  }

  public async saveFullBundle(bundle: OrgStorageBundle): Promise<boolean> {
    const db = await this.getDriver();
    const now = Date.now();
    try {
      db.transaction(() => {
        // 1. Save metadata into org_state
        const stmtState = db.prepare(
          `INSERT INTO org_state (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        );
        stmtState.run('root_ceo', JSON.stringify(bundle.hierarchy.rootCeo), now);
        stmtState.run('cron_jobs', JSON.stringify(bundle.cronJobs || []), now);
        if (bundle.conversations) {
          stmtState.run('conversations', JSON.stringify(bundle.conversations), now);
        }
        if (bundle.activeScope) {
          stmtState.run('active_scope', bundle.activeScope, now);
        }
        stmtState.run('initialized', 'true', now);

        // 2. Save members into org_members
        const stmtMember = db.prepare(
          `INSERT INTO org_members (id, name, role, system_prompt, model, skills, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             role = excluded.role,
             system_prompt = excluded.system_prompt,
             model = excluded.model,
             skills = excluded.skills,
             updated_at = excluded.updated_at`
        );
        for (const m of bundle.members || []) {
          stmtMember.run(
            m.id,
            m.name,
            m.role,
            m.systemPrompt || null,
            m.model ? JSON.stringify(m.model) : null,
            JSON.stringify(m.skills || []),
            now,
            now
          );
        }

        // 3. Save departments into org_departments (roster is NOT stored)
        const stmtDept = db.prepare(
          `INSERT INTO org_departments (id, name, workspace_path, head_agent_id, parent_department_id, description, icon, color, order_index, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             workspace_path = excluded.workspace_path,
             head_agent_id = excluded.head_agent_id,
             parent_department_id = excluded.parent_department_id,
             description = excluded.description,
             icon = excluded.icon,
             color = excluded.color,
             order_index = excluded.order_index,
             status = excluded.status,
             updated_at = excluded.updated_at`
        );
        for (const d of bundle.hierarchy.departments || []) {
          stmtDept.run(
            d.id,
            d.name,
            d.workspacePath || null,
            d.departmentCeoAgent?.id || null,
            d.parentDepartmentId || null,
            d.description || null,
            d.icon || null,
            d.color || null,
            d.order ?? null,
            d.status || 'idle',
            now,
            now
          );
        }

        // 4. Save projects into org_projects
        const stmtProj = db.prepare(
          `INSERT INTO org_projects (id, name, department_id, workspace_path, member_ids, goal, description, status, context, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             department_id = excluded.department_id,
             workspace_path = excluded.workspace_path,
             member_ids = excluded.member_ids,
             goal = excluded.goal,
             description = excluded.description,
             status = excluded.status,
             context = excluded.context,
             updated_at = excluded.updated_at`
        );
        for (const p of bundle.projects || []) {
          stmtProj.run(
            p.id,
            p.name,
            p.departmentId,
            p.workspacePath || null,
            JSON.stringify(p.memberIds || []),
            p.goal || null,
            p.description || null,
            p.status || 'active',
            p.context ? JSON.stringify(p.context) : null,
            now,
            now
          );
        }
      })();
      return true;
    } catch (err) {
      console.error('[OrgStorageService] saveFullBundle failed:', err);
      return false;
    }
  }
}

export const orgStorageService = OrgStorageService.getInstance();
