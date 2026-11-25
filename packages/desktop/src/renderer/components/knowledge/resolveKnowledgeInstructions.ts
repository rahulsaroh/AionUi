/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { knowledgeRepo } from '@/common/adapter/ipcBridge';
import type { KnowledgeAssignment, KnowledgeRepo } from '@/common/types/knowledgeRepo';

export type ResolvedKnowledgeResult = {
  instructions: string;
  repoIds: string[];
};

export type KnowledgeRepoMaps = {
  byMemberId: Record<string, string[]>;
  byProjectId: Record<string, string[]>;
  repoNamesById: Map<string, string>;
};

/**
 * Resolve and merge knowledge repository instructions for a member and/or bound project.
 * Member-assigned repos take priority over project-level repos.
 */
export async function resolveEntityKnowledgeInstructions(params: {
  memberKey?: string;
  memberName: string;
  projectId?: string;
  projectRepoIds?: string[];
  conversationId?: string;
  forceFullPlaybook?: boolean;
}): Promise<ResolvedKnowledgeResult> {
  try {
    const [memberAssign, projectAssign] = await Promise.all([
      params.memberKey
        ? knowledgeRepo.getAssignment(params.memberKey).catch((): KnowledgeAssignment | undefined => undefined)
        : undefined,
      params.projectId
        ? knowledgeRepo
            .getAssignment(`project:${params.projectId}`)
            .catch((): KnowledgeAssignment | undefined => undefined)
        : undefined,
    ]);

    const mergedRepoIds = Array.from(
      new Set([...(memberAssign?.repoIds || []), ...(projectAssign?.repoIds || []), ...(params.projectRepoIds || [])])
    ).filter(Boolean);

    if (mergedRepoIds.length === 0) {
      return { instructions: '', repoIds: [] };
    }

    const whenToUseHint = memberAssign?.whenToUseHint || projectAssign?.whenToUseHint;
    const inst = await knowledgeRepo.buildInstructions({
      memberKey: params.memberKey || (params.projectId ? `project:${params.projectId}` : undefined),
      conversationId: params.conversationId,
      memberName: params.memberName,
      repoIds: mergedRepoIds,
      whenToUseHint,
      forceFullPlaybook: params.forceFullPlaybook,
    });

    return {
      instructions: inst?.instructions || '',
      repoIds: mergedRepoIds,
    };
  } catch (err) {
    console.warn('[resolveEntityKnowledgeInstructions] Failed to resolve knowledge:', err);
    return { instructions: '', repoIds: [] };
  }
}

/**
 * Load knowledge repo names mapped by org member ID and project ID for Org Directory generation.
 */
export async function loadKnowledgeRepoMaps(): Promise<KnowledgeRepoMaps> {
  const byMemberId: Record<string, string[]> = {};
  const byProjectId: Record<string, string[]> = {};
  const repoNamesById = new Map<string, string>();

  try {
    const [repos, assignments] = await Promise.all([
      knowledgeRepo.list().catch((): KnowledgeRepo[] => []),
      knowledgeRepo.listAssignments().catch((): Record<string, KnowledgeAssignment> => ({})),
    ]);

    for (const r of repos || []) {
      repoNamesById.set(r.id, r.name);
    }

    for (const [key, assign] of Object.entries(assignments || {})) {
      const names = (assign?.repoIds || []).map((id) => repoNamesById.get(id) || id).filter(Boolean);
      if (names.length === 0) continue;
      if (key.startsWith('org:')) {
        byMemberId[key.slice('org:'.length)] = names;
      } else if (key.startsWith('project:')) {
        byProjectId[key.slice('project:'.length)] = names;
      }
    }
  } catch {
    // Best-effort lookup; never block turn execution
  }

  return { byMemberId, byProjectId, repoNamesById };
}

/**
 * Mark active knowledge repos as running during an agent turn so background updates defer safely.
 */
export async function withKnowledgeTaskLock<T>(repoIds: string[], fn: () => Promise<T>): Promise<T> {
  if (!repoIds || repoIds.length === 0) {
    return fn();
  }
  await knowledgeRepo.setTaskRunning({ repoIds, isRunning: true }).catch((): void => undefined);
  try {
    return await fn();
  } finally {
    await knowledgeRepo.setTaskRunning({ repoIds, isRunning: false }).catch((): void => undefined);
  }
}
