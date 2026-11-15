import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgStorageService } from '../../../packages/desktop/src/process/services/org/orgStorageService';
import { createInMemoryTestDb } from '../pipeline/testDbHelper';

describe('OrgStorageService', () => {
  let service: OrgStorageService;

  beforeEach(() => {
    service = new OrgStorageService(createInMemoryTestDb());
  });

  it('saves and retrieves key-value state in fallback store', async () => {
    const key = 'aionui:org-test-key';
    const payload = JSON.stringify({ hello: 'organization' });
    const saved = await service.saveData(key, payload);
    expect(saved).toBe(true);

    const loaded = await service.loadData(key);
    expect(loaded).toBe(payload);
  });

  it('returns null for missing key', async () => {
    const loaded = await service.loadData('non-existent-key');
    expect(loaded).toBeNull();
  });
});
