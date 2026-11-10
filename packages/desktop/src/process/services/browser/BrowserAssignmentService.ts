/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISqliteDriver } from '../database/drivers/ISqliteDriver';
import type { BrowserProfileAssignment } from '@/common/browser/types';
import { DEFAULT_BROWSER_PROFILE_ID } from '@/common/browser/constants';

export class BrowserAssignmentService {
  private inMemoryAssignments: Map<string, BrowserProfileAssignment> = new Map();
  private db?: ISqliteDriver;

  constructor(options?: { db?: ISqliteDriver }) {
    this.db = options?.db;
    this.loadFromDb();
  }

  public setDb(db: ISqliteDriver): void {
    this.db = db;
    this.loadFromDb();
  }

  private loadFromDb(): void {
    if (!this.db) return;
    try {
      const rows = this.db
        .prepare('SELECT id, profile_id, scope_type, scope_id, created_at FROM browser_profile_assignments')
        .all() as Array<{
        id: string;
        profile_id: string;
        scope_type: 'project' | 'team';
        scope_id: string;
        created_at: number;
      }>;

      this.inMemoryAssignments.clear();
      for (const row of rows) {
        this.inMemoryAssignments.set(row.id, {
          id: row.id,
          profileId: row.profile_id,
          scopeType: row.scope_type,
          scopeId: row.scope_id,
          createdAt: row.created_at,
        });
      }
    } catch {
      // Table might not exist yet or mock driver
    }
  }

  public assignProfile(profileId: string, scopeType: 'project' | 'team', scopeId: string): BrowserProfileAssignment {
    if (!profileId || !scopeId) {
      throw new Error('profileId and scopeId are required');
    }

    const id = `${profileId}_${scopeType}_${scopeId}`;
    const assignment: BrowserProfileAssignment = {
      id,
      profileId,
      scopeType,
      scopeId,
      createdAt: Date.now(),
    };

    this.inMemoryAssignments.set(id, assignment);

    if (this.db) {
      try {
        this.db
          .prepare(
            `INSERT OR REPLACE INTO browser_profile_assignments (id, profile_id, scope_type, scope_id, created_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(id, profileId, scopeType, scopeId, assignment.createdAt);
      } catch (err) {
        console.warn('[BrowserAssignmentService] Failed to persist assignment to DB:', err);
      }
    }

    return assignment;
  }

  public unassignProfile(profileId: string, scopeType: 'project' | 'team', scopeId: string): boolean {
    const id = `${profileId}_${scopeType}_${scopeId}`;
    const existed = this.inMemoryAssignments.delete(id);

    if (this.db) {
      try {
        this.db.prepare('DELETE FROM browser_profile_assignments WHERE id = ?').run(id);
      } catch (err) {
        console.warn('[BrowserAssignmentService] Failed to delete assignment from DB:', err);
      }
    }

    return existed;
  }

  public getAssignedProfiles(scopeType: 'project' | 'team', scopeId: string): string[] {
    const matched: string[] = [];
    for (const item of this.inMemoryAssignments.values()) {
      if (item.scopeType === scopeType && item.scopeId === scopeId) {
        matched.push(item.profileId);
      }
    }
    return matched;
  }

  public getAssignmentsForProfile(profileId: string): BrowserProfileAssignment[] {
    const matched: BrowserProfileAssignment[] = [];
    for (const item of this.inMemoryAssignments.values()) {
      if (item.profileId === profileId) {
        matched.push({ ...item });
      }
    }
    return matched;
  }

  public canScopeUseProfile(profileId: string, scopeType?: 'project' | 'team', scopeId?: string): boolean {
    if (!scopeType || !scopeId) {
      return true;
    }

    const assignedProfiles = this.getAssignedProfiles(scopeType, scopeId);

    // If this scope has specific assigned profiles, ONLY those can be used
    if (assignedProfiles.length > 0) {
      return assignedProfiles.includes(profileId);
    }

    // If no profiles are explicitly assigned to this scope, allow default profile
    return profileId === DEFAULT_BROWSER_PROFILE_ID;
  }

  public assertScopeCanUseProfile(profileId: string, scopeType?: 'project' | 'team', scopeId?: string): void {
    if (!this.canScopeUseProfile(profileId, scopeType, scopeId)) {
      throw new Error(
        `Access denied: Profile "${profileId}" is not assigned to ${scopeType || 'scope'} "${scopeId}". Only explicitly assigned profiles may be used.`
      );
    }
  }

  public clearAll(): void {
    this.inMemoryAssignments.clear();
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM browser_profile_assignments').run();
      } catch {
        // Ignored
      }
    }
  }
}

let browserAssignmentServiceInstance: BrowserAssignmentService | null = null;

export function getBrowserAssignmentService(): BrowserAssignmentService {
  if (!browserAssignmentServiceInstance) {
    browserAssignmentServiceInstance = new BrowserAssignmentService();
  }
  return browserAssignmentServiceInstance;
}
