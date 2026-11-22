/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { knowledgeRepo } from '@/common/adapter/ipcBridge';
import type { KnowledgeRepo } from '@/common/types/knowledgeRepo';

export type KnowledgeUpdateStatus = 'none' | 'updating' | 'needs_attention' | 'up_to_date';

export function useMemberKnowledge(memberKey?: string) {
  const [allRepos, setAllRepos] = useState<KnowledgeRepo[]>([]);
  const [assignedRepoIds, setAssignedRepoIds] = useState<string[]>([]);
  const [whenToUseHint, setWhenToUseHint] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!memberKey) return;
    setLoading(true);
    setError(null);
    try {
      const [repos, assignment] = await Promise.all([knowledgeRepo.list(), knowledgeRepo.getAssignment(memberKey)]);
      setAllRepos(repos || []);
      setAssignedRepoIds(assignment?.repoIds || []);
      setWhenToUseHint(assignment?.whenToUseHint || '');
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load knowledge');
    } finally {
      setLoading(false);
    }
  }, [memberKey]);

  useEffect(() => {
    if (memberKey) {
      void refresh();
    } else {
      setAllRepos([]);
      setAssignedRepoIds([]);
      setWhenToUseHint('');
    }
  }, [memberKey, refresh]);

  useEffect(() => {
    const unsubscribe = knowledgeRepo.onProgress((progressEvent) => {
      setAllRepos((prev) =>
        prev.map((repo) => {
          if (repo.id !== progressEvent.repoId) return repo;
          const nextSyncStatus =
            progressEvent.phase === 'completed' ? 'idle' : progressEvent.phase === 'error' ? 'error' : 'syncing';
          return {
            ...repo,
            syncStatus: nextSyncStatus,
            syncError: progressEvent.error,
            progress: progressEvent,
          };
        })
      );
      if (progressEvent.phase === 'completed') {
        void knowledgeRepo.list().then((latest) => {
          if (latest) setAllRepos(latest);
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const assignedRepos = useMemo(() => {
    const idSet = new Set(assignedRepoIds);
    return allRepos.filter((r) => idSet.has(r.id));
  }, [allRepos, assignedRepoIds]);

  const status: KnowledgeUpdateStatus = useMemo(() => {
    if (assignedRepos.length === 0) return 'none';
    if (assignedRepos.some((r) => r.syncStatus === 'syncing')) return 'updating';
    if (
      assignedRepos.some(
        (r) => r.syncStatus === 'needs_attention' || r.syncStatus === 'error' || r.trustStatus === 'reapproval_required'
      )
    ) {
      return 'needs_attention';
    }
    return 'up_to_date';
  }, [assignedRepos]);

  const saveAssignment = useCallback(
    async (repoIds: string[], hint?: string) => {
      if (!memberKey) return;
      setLoading(true);
      try {
        await knowledgeRepo.setAssignment({
          memberKey,
          assignment: { repoIds, whenToUseHint: hint },
        });
        setAssignedRepoIds(repoIds);
        setWhenToUseHint(hint || '');
      } catch (err: unknown) {
        setError((err as Error).message || 'Failed to save knowledge assignment');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [memberKey]
  );

  const addAndAssignRepo = useCallback(
    async (params: { gitUrl: string; ref?: string; authToken?: string; name?: string }) => {
      if (!memberKey) throw new Error('Missing memberKey');
      try {
        const urlParts = params.gitUrl.replace(/\.git$/, '').split('/');
        const defaultName = urlParts[urlParts.length - 1] || 'repo';
        const repoName = params.name || defaultName;

        const newRepo = await knowledgeRepo.add({
          name: repoName,
          gitUrl: params.gitUrl,
          ref: params.ref || 'main',
          authToken: params.authToken,
        });

        // Automatically trust on first explicit add & attach
        if (newRepo.trustStatus === 'untrusted') {
          await knowledgeRepo.setTrust({ id: newRepo.id, trustStatus: 'trusted' });
          newRepo.trustStatus = 'trusted';
        }

        const nextIds = Array.from(new Set([...assignedRepoIds, newRepo.id]));
        await knowledgeRepo.setAssignment({
          memberKey,
          assignment: { repoIds: nextIds, whenToUseHint },
        });

        setAssignedRepoIds(nextIds);
        setAllRepos((prev) => {
          const exists = prev.some((r) => r.id === newRepo.id);
          return exists ? prev.map((r) => (r.id === newRepo.id ? newRepo : r)) : [...prev, newRepo];
        });
        return newRepo;
      } catch (err: unknown) {
        setError((err as Error).message || 'Failed to add and assign repo');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [memberKey, assignedRepoIds, whenToUseHint, refresh]
  );

  return {
    allRepos,
    assignedRepos,
    assignedRepoIds,
    whenToUseHint,
    status,
    loading,
    error,
    refresh,
    saveAssignment,
    addAndAssignRepo,
    setAssignedRepoIds,
    setWhenToUseHint,
  };
}
