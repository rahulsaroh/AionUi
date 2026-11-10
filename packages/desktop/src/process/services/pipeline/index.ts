/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISqliteDriver } from '../database/drivers/ISqliteDriver';
import { PipelineRepository } from './pipelineRepository';
import { PipelineRunService } from './pipelineRunService';
import { PublishService } from './publishService';

export * from './artifactHasher';
export * from './pipelineRepository';
export * from './pipelineRunService';
export * from './publishService';
export * from './pipelineMcpTools';
export * from './pipelineCli';

let sharedRepo: PipelineRepository | null = null;
let sharedRunService: PipelineRunService | null = null;
let sharedPublishService: PublishService | null = null;

export function setSharedPipelineServices(services: {
  repo: PipelineRepository;
  runService: PipelineRunService;
  publishService: PublishService;
}): void {
  sharedRepo = services.repo;
  sharedRunService = services.runService;
  sharedPublishService = services.publishService;
}

export async function getPipelineServices(customDb?: ISqliteDriver): Promise<{
  repo: PipelineRepository;
  runService: PipelineRunService;
  publishService: PublishService;
}> {
  if (customDb) {
    const repo = new PipelineRepository(customDb);
    const runService = new PipelineRunService(repo);
    const publishService = new PublishService(repo);
    return { repo, runService, publishService };
  }

  if (sharedRepo && sharedRunService && sharedPublishService) {
    return { repo: sharedRepo, runService: sharedRunService, publishService: sharedPublishService };
  }

  const { getDataPath } = await import('@/process/utils');
  const path = await import('path');
  const dbPath = path.join(getDataPath(), 'aionui.db');

  let driver: ISqliteDriver;
  try {
    const { BetterSqlite3Driver } = await import('@process/services/database/drivers/BetterSqlite3Driver');
    driver = new BetterSqlite3Driver(dbPath);
  } catch {
    const { createInMemoryTestDb } = await import('../../../../../tests/unit/pipeline/testDbHelper');
    driver = createInMemoryTestDb();
  }

  const { initSchema } = await import('../database/schema');
  initSchema(driver);

  sharedRepo = new PipelineRepository(driver);
  sharedRunService = new PipelineRunService(sharedRepo);
  sharedPublishService = new PublishService(sharedRepo);

  return { repo: sharedRepo, runService: sharedRunService, publishService: sharedPublishService };
}
