/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveEntityKnowledgeInstructions,
  loadKnowledgeRepoMaps,
  withKnowledgeTaskLock,
} from '@/renderer/components/knowledge/resolveKnowledgeInstructions';

const mockGetAssignment = vi.fn();
const mockBuildInstructions = vi.fn();
const mockList = vi.fn();
const mockListAssignments = vi.fn();
const mockSetTaskRunning = vi.fn();

vi.mock('@/common/adapter/ipcBridge', () => ({
  knowledgeRepo: {
    getAssignment: (...args: unknown[]) => mockGetAssignment(...args),
    buildInstructions: (...args: unknown[]) => mockBuildInstructions(...args),
    list: (...args: unknown[]) => mockList(...args),
    listAssignments: (...args: unknown[]) => mockListAssignments(...args),
    setTaskRunning: (...args: unknown[]) => mockSetTaskRunning(...args),
  },
}));

describe('resolveKnowledgeInstructions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetTaskRunning.mockResolvedValue(undefined);
  });

  it('merges member repos before project repos and deduplicates IDs', async () => {
    mockGetAssignment.mockImplementation(async (key: string) => {
      if (key === 'org:m1') return { repoIds: ['repo-member', 'repo-shared'], whenToUseHint: 'member hint' };
      if (key === 'project:p1') return { repoIds: ['repo-shared', 'repo-proj'], whenToUseHint: 'proj hint' };
      return undefined;
    });
    mockBuildInstructions.mockResolvedValue({ instructions: 'PLAYBOOK_TEXT' });

    const res = await resolveEntityKnowledgeInstructions({
      memberKey: 'org:m1',
      memberName: 'Alice',
      projectId: 'p1',
      projectRepoIds: ['repo-proj', 'repo-ctx'],
      conversationId: 'conv-1',
    });

    expect(res.repoIds).toEqual(['repo-member', 'repo-shared', 'repo-proj', 'repo-ctx']);
    expect(res.instructions).toBe('PLAYBOOK_TEXT');
    expect(mockBuildInstructions).toHaveBeenCalledWith(
      expect.objectContaining({
        repoIds: ['repo-member', 'repo-shared', 'repo-proj', 'repo-ctx'],
        whenToUseHint: 'member hint',
        conversationId: 'conv-1',
      })
    );
  });

  it('returns empty instructions without calling buildInstructions when no repos are assigned', async () => {
    mockGetAssignment.mockResolvedValue(undefined);

    const res = await resolveEntityKnowledgeInstructions({
      memberKey: 'org:m1',
      memberName: 'Alice',
    });

    expect(res).toEqual({ instructions: '', repoIds: [] });
    expect(mockBuildInstructions).not.toHaveBeenCalled();
  });

  it('maps org member and project assignments to repo names', async () => {
    mockList.mockResolvedValue([
      { id: 'r1', name: 'Playbook Repo' },
      { id: 'r2', name: 'API Docs' },
    ]);
    mockListAssignments.mockResolvedValue({
      'org:member-1': { repoIds: ['r1'] },
      'project:proj-1': { repoIds: ['r2'] },
      'team:t1:s1': { repoIds: ['r1'] },
    });

    const maps = await loadKnowledgeRepoMaps();
    expect(maps.byMemberId).toEqual({ 'member-1': ['Playbook Repo'] });
    expect(maps.byProjectId).toEqual({ 'proj-1': ['API Docs'] });
  });

  it('releases knowledge task lock even when callback throws', async () => {
    await expect(
      withKnowledgeTaskLock(['r1'], async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(mockSetTaskRunning).toHaveBeenNthCalledWith(1, { repoIds: ['r1'], isRunning: true });
    expect(mockSetTaskRunning).toHaveBeenNthCalledWith(2, { repoIds: ['r1'], isRunning: false });
  });
});
