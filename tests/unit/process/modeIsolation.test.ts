/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryTestDb } from '../pipeline/testDbHelper';
import type { ISqliteDriver } from '@/process/services/database/drivers/ISqliteDriver';
import { OrgStorageService } from '@/process/services/org/orgStorageService';

describe('Mode Isolation', () => {
  let driver: ISqliteDriver;
  let storageService: OrgStorageService;

  beforeEach(async () => {
    driver = createInMemoryTestDb();
    storageService = new OrgStorageService(driver);
  });

  it('isolates org_projects by mode', async () => {
    // Save projects in organization mode
    const orgProjects = [
      {
        id: 'proj-org-1',
        name: 'Org Project 1',
        departmentId: 'dept-1',
        workspacePath: '/org/proj1',
        memberIds: [],
        goal: '',
        description: '',
        status: 'active',
        context: undefined,
        mode: 'organization',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'proj-org-2',
        name: 'Org Project 2',
        departmentId: 'dept-2',
        workspacePath: '/org/proj2',
        memberIds: [],
        goal: '',
        description: '',
        status: 'active',
        context: undefined,
        mode: 'organization',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    await storageService.saveProjects(orgProjects);

    // Save projects in workplace mode
    const workplaceProjects = [
      {
        id: 'proj-wp-1',
        name: 'Workplace Project 1',
        departmentId: 'dept-3',
        workspacePath: '/wp/proj1',
        memberIds: [],
        goal: '',
        description: '',
        status: 'active',
        context: undefined,
        mode: 'workplace',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    await storageService.saveProjects(workplaceProjects);

    // Fetch organization mode projects
    const fetchedOrg = await storageService.getProjects('organization');
    expect(fetchedOrg).toHaveLength(2);
    expect(fetchedOrg.every((p) => p.mode === 'organization')).toBe(true);

    // Fetch workplace mode projects
    const fetchedWp = await storageService.getProjects('workplace');
    expect(fetchedWp).toHaveLength(1);
    expect(fetchedWp.every((p) => p.mode === 'workplace')).toBe(true);

    // Fetch all (no mode filter)
    const fetchedAll = await storageService.getProjects();
    expect(fetchedAll).toHaveLength(3);
  });

  it('defaults to organization mode for org_projects when mode not specified', async () => {
    const projects = [
      {
        id: 'proj-no-mode',
        name: 'Project No Mode',
        departmentId: 'dept-1',
        workspacePath: '/proj',
        memberIds: [],
        goal: '',
        description: '',
        status: 'active',
        context: undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    await storageService.saveProjects(projects);

    const fetched = await storageService.getProjects('organization');
    expect(fetched).toHaveLength(1);
    expect(fetched[0].mode).toBe('organization');
  });
});
