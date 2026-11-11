/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as z from 'zod';
import type { PipelineRunService } from './pipelineRunService';
import type { PublishService } from './publishService';

export function createPipelineMcpToolDefinitions(runService: PipelineRunService, publishService: PublishService) {
  return [
    {
      name: 'step_begin',
      description: 'Mark a pipeline step as started/running and record inputs.',
      parameters: z.object({
        runId: z.string().describe('ID of the pipeline run'),
        step: z.union([z.string(), z.number()]).describe('Step index or step name/id'),
        inputs: z.record(z.unknown()).optional().describe('Input parameters for the step'),
      }),
      execute: async (args: { runId: string; step: string | number; inputs?: Record<string, unknown> }) => {
        const step = runService.beginStep(args.runId, args.step, args.inputs);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ message: `Step '${step.name}' began`, step }),
            },
          ],
        };
      },
    },
    {
      name: 'step_complete',
      description: 'Complete a pipeline step with artifact paths and compute content hash.',
      parameters: z.object({
        runId: z.string().describe('ID of the pipeline run'),
        step: z.union([z.string(), z.number()]).describe('Step index or step name/id'),
        artifactPaths: z.array(z.string()).describe('List of output file paths produced by this step'),
        baseDir: z.string().optional().describe('Project base directory for relative artifact paths'),
        sideEffectFree: z
          .boolean()
          .optional()
          .describe('Whether a step with no artifacts is side-effect-free and can be skipped on resume'),
      }),
      execute: async (args: {
        runId: string;
        step: string | number;
        artifactPaths: string[];
        baseDir?: string;
        sideEffectFree?: boolean;
      }) => {
        const step = runService.completeStep(args.runId, args.step, args.artifactPaths, args.baseDir, {
          sideEffectFree: args.sideEffectFree,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                message: `Step '${step.name}' completed`,
                contentHash: step.contentHash,
                step,
              }),
            },
          ],
        };
      },
    },
    {
      name: 'step_fail',
      description: 'Mark a pipeline step as failed with error details.',
      parameters: z.object({
        runId: z.string().describe('ID of the pipeline run'),
        step: z.union([z.string(), z.number()]).describe('Step index or step name/id'),
        error: z.string().describe('Error message or failure reason'),
      }),
      execute: async (args: { runId: string; step: string | number; error: string }) => {
        const step = runService.failStep(args.runId, args.step, args.error);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ message: `Step '${step.name}' failed`, error: args.error, step }),
            },
          ],
        };
      },
    },
    {
      name: 'pipeline_resume',
      description: 'Resume a run from the last valid completed step, verifying artifact hashes.',
      parameters: z.object({
        runId: z.string().describe('ID of the pipeline run'),
        baseDir: z.string().optional().describe('Project base directory for relative artifact paths'),
      }),
      execute: async (args: { runId: string; baseDir?: string }) => {
        const result = runService.resumeRun(args.runId, args.baseDir);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                message: result.canResume
                  ? `Resuming run from step index ${result.resumeFromStepIndex}`
                  : 'All steps already completed',
                resumeFromStepIndex: result.resumeFromStepIndex,
                skippedStepIndices: result.skippedStepIndices,
                invalidatedStepIndices: result.invalidatedStepIndices,
                run: result.run,
              }),
            },
          ],
        };
      },
    },
    {
      name: 'pipeline_rerun',
      description: 'Re-run from a specific step, invalidating that step and all downstream steps.',
      parameters: z.object({
        runId: z.string().describe('ID of the pipeline run'),
        fromStepIndex: z.number().describe('Step index to re-run from (0-based)'),
      }),
      execute: async (args: { runId: string; fromStepIndex: number }) => {
        const run = runService.rerunFromStep(args.runId, args.fromStepIndex);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                message: `Invalidated steps from index ${args.fromStepIndex} onwards`,
                run,
              }),
            },
          ],
        };
      },
    },
    {
      name: 'publish_content',
      description: 'Publish content to YouTube, Instagram, or Facebook with idempotency key.',
      parameters: z.object({
        projectId: z.string().describe('Project identifier'),
        platform: z.string().describe('Platform name, e.g. youtube, instagram, facebook'),
        contentHash: z.string().optional().describe('Optional content hash of publication artifacts'),
        title: z.string().describe('Post or video title'),
        description: z.string().optional().describe('Post description or caption'),
        thumbnailUrl: z.string().optional().describe('URL or path to thumbnail image'),
        videoUrl: z.string().optional().describe('URL or path to video file'),
        mediaPath: z.string().optional().describe('Local media file path'),
      }),
      execute: async (args: {
        projectId: string;
        platform: string;
        contentHash?: string;
        title: string;
        description?: string;
        thumbnailUrl?: string;
        videoUrl?: string;
        mediaPath?: string;
      }) => {
        const result = await publishService.publish({
          projectId: args.projectId,
          platform: args.platform,
          contentHash: args.contentHash,
          payload: {
            title: args.title,
            description: args.description,
            thumbnailUrl: args.thumbnailUrl,
            videoUrl: args.videoUrl,
            mediaPath: args.mediaPath,
          },
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result),
            },
          ],
        };
      },
    },
  ];
}
