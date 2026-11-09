/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import type { IPipelineRun } from '@/common/types/pipeline/pipelineTypes';
import { RunTimeline } from './RunTimeline';

const STORAGE_KEY = 'aionui:active-pipeline-run';

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
  const [run, setRun] = useState<IPipelineRun>(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          return JSON.parse(stored) as IPipelineRun;
        }
      }
    } catch {
      // fallback
    }
    return defaultDemoRun;
  });

  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(run));
      }
    } catch {
      // ignore
    }
  }, [run]);

  const handleResume = async (runId: string) => {
    // Resume skips completed steps, moves the failed/incomplete step to running then completed
    setRun((prev) => {
      const updatedSteps = prev.steps.map((s) => {
        if (s.status === 'failed') {
          return {
            ...s,
            status: 'completed' as const,
            error: undefined,
            contentHash: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
            updatedAt: Date.now(),
          };
        }
        return s;
      });

      const allCompleted = updatedSteps.every((s) => s.status === 'completed' || s.status === 'skipped');

      const nextRun: IPipelineRun = {
        ...prev,
        status: allCompleted ? 'completed' : 'running',
        updatedAt: Date.now(),
        steps: updatedSteps,
      };

      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRun));
        }
      } catch {
        // ignore
      }

      return nextRun;
    });
  };

  const handleRerunStep = async (runId: string, fromStepIndex: number) => {
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

      const nextRun: IPipelineRun = {
        ...prev,
        status: 'running',
        updatedAt: Date.now(),
        steps: updatedSteps,
      };

      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRun));
        }
      } catch {
        // ignore
      }

      return nextRun;
    });
  };

  return (
    <div className='p-24px max-w-960px mx-auto w-full'>
      <RunTimeline run={run} onResume={handleResume} onRerunStep={handleRerunStep} />
    </div>
  );
};

export default PipelineTimelinePage;
