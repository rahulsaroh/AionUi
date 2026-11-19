import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OrgStorageService } from '../../../packages/desktop/src/process/services/org/orgStorageService';
import { createInMemoryTestDb } from '../pipeline/testDbHelper';
import {
  validateProjectShape,
  validateMemberShape,
} from '../../../packages/desktop/src/process/services/org/orgStorageService';

describe('orgStorageService: new fields persist (approvalPolicy, allowlist, executionEngine)', () => {
  let service: OrgStorageService;

  beforeEach(() => {
    service = new OrgStorageService(createInMemoryTestDb());
  });

  afterEach(() => {
    OrgStorageService.setInstance(null);
  });

  it('validates approvalPolicy enum and allowlist array bounds', () => {
    expect(validateProjectShape({ approvalPolicy: 'auto_edit' })).toBe(true);
    expect(validateProjectShape({ approvalPolicy: 'read_only' })).toBe(true);
    expect(validateProjectShape({ approvalPolicy: 'full_auto' })).toBe(true);
    expect(validateProjectShape({ approvalPolicy: 'bogus' })).toBe(false);
    expect(validateProjectShape({ allowlist: ['/a', '/b'] })).toBe(true);
    expect(validateProjectShape({ allowlist: 'not-array' })).toBe(false);
    expect(validateProjectShape({ allowlist: new Array(21).fill('/x') })).toBe(false);
  });

  it('validates executionEngine enum on member and nested in model', () => {
    expect(validateMemberShape({ id: 'm1', name: 'M', role: 'specialist', executionEngine: 'codex' })).toBe(true);
    expect(validateMemberShape({ id: 'm1', name: 'M', role: 'specialist', executionEngine: 'aionrs' })).toBe(true);
    expect(validateMemberShape({ id: 'm1', name: 'M', role: 'specialist', executionEngine: 'bogus' })).toBe(false);
    expect(validateMemberShape({ id: 'm1', name: 'M', role: 'specialist', model: { executionEngine: 'claude' } })).toBe(
      true
    );
    expect(validateMemberShape({ id: 'm1', name: 'M', role: 'specialist', model: { executionEngine: 'bogus' } })).toBe(
      false
    );
  });

  it('round-trips approvalPolicy and allowlist via project save/load', async () => {
    const proj = {
      id: 'p1',
      name: 'App1',
      departmentId: 'd1',
      teamIds: [],
      workspacePath: '/tmp/app1',
      status: 'active' as const,
      approvalPolicy: 'full_auto' as const,
      allowlist: ['/tmp/extra1', '/tmp/extra2'],
    };
    await service.saveProject(proj);
    const loaded = (await service.getProjects()).find((p) => p.id === 'p1');
    expect(loaded).toBeTruthy();
    expect(loaded!.approvalPolicy).toBe('full_auto');
    expect(loaded!.allowlist).toEqual(['/tmp/extra1', '/tmp/extra2']);
  });

  it('round-trips executionEngine via member save/load', async () => {
    const mem = {
      id: 'm1',
      canonicalAgentId: 'm1',
      name: 'TestBot',
      role: 'specialist' as const,
      executionEngine: 'claude' as const,
    };
    await service.saveMember(mem);
    const loaded = (await service.getMembers()).find((m) => m.id === 'm1');
    expect(loaded).toBeTruthy();
    expect(loaded!.executionEngine).toBe('claude');
  });

  it('executionEngine defaults to undefined when not set', async () => {
    const mem = {
      id: 'm2',
      canonicalAgentId: 'm2',
      name: 'TestBot2',
      role: 'specialist' as const,
      model: { modelId: 'gpt-4' },
    };
    await service.saveMember(mem);
    const loaded = (await service.getMembers()).find((m) => m.id === 'm2');
    expect(loaded).toBeTruthy();
    expect(loaded!.executionEngine).toBeUndefined(); // legacy row has no executionEngine
  });
});
