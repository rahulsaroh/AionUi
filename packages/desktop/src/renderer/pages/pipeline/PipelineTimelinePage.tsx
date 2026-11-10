/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Message, Spin } from '@arco-design/web-react';
import type { IPipelineRun } from '@/common/types/pipeline/pipelineTypes';
import { RunTimeline } from './RunTimeline';

const defaultDemoRun: IPipelineRun = {
  id: 'run-demo-pipeline-1',
  projectId: 'proj-video-gen',
  name: 'Video Production & Publish Pipeline',
  status: 'failed',
  createdAt: Date.now() - 3600000,
  updatedAt: Date.now() - 1800000,
  steps: [
    {
      id: 'step-1',
      runId: 'run-demo-pipeline-1',
      stepIndex: 0,
      name: 'Script Generation',
      status: 'completed',
      artifactPaths: ['./script.md'],
      contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      updatedAt: Date.now() - 3500000,
    },
    {
      id: 'step-2',
      runId: 'run-demo-pipeline-1',
      stepIndex: 1,
      name: 'Voiceover Synthesis',
      status: 'completed',
      artifactPaths: ['./audio.mp3'],
      contentHash: 'f4c2e1198fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b866',
      updatedAt: Date.now() - 3000000,
    },
    {
      id: 'step-3',
      runId: 'run-demo-pipeline-1',
      stepIndex: 2,
      name: 'Video Rendering',
      status: 'failed',
      artifactPaths: ['./video.mp4'],
      error: 'Backend killed mid-step: GPU process connection lost',
      updatedAt: Date.now() - 1800000,
    },
    {
      id: 'step-4',
      runId: 'run-demo-pipeline-1',
      stepIndex: 3,
      name: 'Publish to Social Media',
      status: 'pending',
      artifactPaths: [],
      updatedAt: Date.now() - 1800000,
    },
  ],
};

export const PipelineTimelinePage: React.FC = () => {
  const { runId: routeRunId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<IPipelineRun>(defaultDemoRun);
  const [loading, setLoading] = useState(false);

  const fetchRun = useCallback(async (targetId: string) => {
    if (!window.electronAPI?.pipelineGetRun) return false;
    try {
      setLoading(true);
      const res = await window.electronAPI.pipelineGetRun(targetId);
      if (res) {
        setRun(res);
        return true;
      }
    } catch (e) {
      console.warn('[PipelineTimelinePage] Failed to fetch run via IPC:', e);
    } finally {
      setLoading(false);
    }
    return false;
  }, []);

  useEffect(() => {
    const targetId = routeRunId || 'run-demo-pipeline-1';
    void fetchRun(targetId).then((found) => {
      if (!found && process.env.NODE_ENV !== 'production') {
        // Fallback to demo run only in dev / e2e mode when IPC record doesn't exist
        setRun(defaultDemoRun);
      }
    });
  }, [routeRunId, fetchRun]);

  const handleResume = async (runIdToResume: string) => {
    if (window.electronAPI?.pipelineResume) {
      try {
        const res = await window.electronAPI.pipelineResume(runIdToResume);
        if (res?.run) {
          setRun(res.run);
          Message.success(`Resumed from step ${res.resumeFromStepIndex}`);
          return;
        }
      } catch (err) {
        Message.error(`Resume failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }

    // Dev fallback simulation
    setRun((prev) => {
      let resumedIndex = -1;
      const updatedSteps = prev.steps.map((s) => {
        if (s.status === 'failed' || s.status === 'running') {
          if (resumedIndex === -1) resumedIndex = s.stepIndex;
          return {
            ...s,
            status: 'completed' as const,
            error: undefined,
            updatedAt: Date.now(),
          };
        }
        return s;
      });

      const allCompleted = updatedSteps.every((s) => s.status === 'completed' || s.status === 'skipped');
      return {
        ...prev,
        status: allCompleted ? 'completed' : 'running',
        updatedAt: Date.now(),
        steps: updatedSteps,
      };
    });
  };

  const handleRerunStep = async (runIdToRerun: string, fromStepIndex: number) => {
    if (window.electronAPI?.pipelineRerun) {
      try {
        const res = await window.electronAPI.pipelineRerun(runIdToRerun, fromStepIndex);
        if (res) {
          setRun(res);
          Message.info(`Re-running from step ${fromStepIndex}`);
          return;
        }
      } catch (err) {
        Message.error(`Re-run failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }

    // Dev fallback simulation
    setRun((prev) => {
      const updatedSteps = prev.steps.map((s) => {
        if (s.stepIndex >= fromStepIndex) {
          return {
            ...s,
            status: 'pending' as const,
            contentHash: undefined,
            error: undefined,
            updatedAt: Date.now(),
          };
        }
        return s;
      });

      return {
        ...prev,
        status: 'running',
        updatedAt: Date.now(),
        steps: updatedSteps,
      };
    });
  };

  if (loading) {
    return (
      <div className='flex items-center justify-center p-48px'>
        <Spin size={32} />
      </div>
    );
  }

  return (
    <div className='p-24px max-w-960px mx-auto w-full'>
      <RunTimeline run={run} onResume={handleResume} onRerunStep={handleRerunStep} />
    </div>
  );
};

export default PipelineTimelinePage;
