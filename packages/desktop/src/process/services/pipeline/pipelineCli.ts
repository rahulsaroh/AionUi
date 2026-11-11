/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PipelineRunService } from './pipelineRunService';
import type { PublishService } from './publishService';

export type CliCommandResult = {
  success: boolean;
  data?: unknown;
  error?: string;
};

function parseFlags(flagArgs: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = flagArgs[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    }
  }
  return flags;
}

export async function executePipelineCliCommand(
  args: string[],
  services: { runService: PipelineRunService; publishService: PublishService }
): Promise<CliCommandResult> {
  const [command, ...rest] = args;
  const flags = parseFlags(rest);

  try {
    switch (command) {
      case 'step.begin': {
        const runId = flags.run || flags.runId;
        const step = flags.step;
        if (!runId || !step) {
          return { success: false, error: 'Usage: step.begin --run <runId> --step <step> [--inputs <json>]' };
        }
        const inputs = flags.inputs ? (JSON.parse(flags.inputs) as Record<string, unknown>) : undefined;
        const parsedStep = /^\d+$/.test(step) ? Number.parseInt(step, 10) : step;
        const updated = services.runService.beginStep(runId, parsedStep, inputs);
        return { success: true, data: updated };
      }

      case 'step.complete': {
        const runId = flags.run || flags.runId;
        const step = flags.step;
        if (!runId || !step) {
          return {
            success: false,
            error: 'Usage: step.complete --run <runId> --step <step> [--artifacts <p1,p2>] [--dir <baseDir>]',
          };
        }
        const artifactPaths = flags.artifacts ? flags.artifacts.split(',').map((s) => s.trim()) : [];
        const baseDir = flags.dir || flags.baseDir;
        const sideEffectFree = flags['side-effect-free'] === 'true' || flags.sideEffectFree === 'true';
        const parsedStep = /^\d+$/.test(step) ? Number.parseInt(step, 10) : step;
        const updated = services.runService.completeStep(runId, parsedStep, artifactPaths, baseDir, {
          sideEffectFree,
        });
        return { success: true, data: updated };
      }

      case 'step.fail': {
        const runId = flags.run || flags.runId;
        const step = flags.step;
        const error = flags.error || 'Step execution failed';
        if (!runId || !step) {
          return { success: false, error: 'Usage: step.fail --run <runId> --step <step> --error <message>' };
        }
        const parsedStep = /^\d+$/.test(step) ? Number.parseInt(step, 10) : step;
        const updated = services.runService.failStep(runId, parsedStep, error);
        return { success: true, data: updated };
      }

      case 'resume': {
        const runId = flags.run || flags.runId;
        if (!runId) {
          return { success: false, error: 'Usage: resume --run <runId> [--dir <baseDir>]' };
        }
        const baseDir = flags.dir || flags.baseDir;
        const result = services.runService.resumeRun(runId, baseDir);
        return { success: true, data: result };
      }

      case 'rerun': {
        const runId = flags.run || flags.runId;
        const from = flags.from || flags.step;
        if (!runId || from === undefined) {
          return { success: false, error: 'Usage: rerun --run <runId> --from <stepIndex>' };
        }
        const fromIndex = Number.parseInt(from, 10);
        const result = services.runService.rerunFromStep(runId, fromIndex);
        return { success: true, data: result };
      }

      case 'publish': {
        const projectId = flags.project || flags.projectId;
        const platform = flags.platform;
        const contentHash = flags.hash || flags.contentHash;
        const title = flags.title || 'Untitled Post';
        const description = flags.description;
        const mediaPath = flags.media || flags.mediaPath;

        if (!projectId || !platform) {
          return {
            success: false,
            error:
              'Usage: publish --project <id> --platform <platform> [--hash <hash>] [--title <title>] [--media <path>]',
          };
        }

        const result = await services.publishService.publish({
          projectId,
          platform,
          contentHash,
          payload: {
            title,
            description,
            mediaPath,
          },
        });

        return { success: result.success, data: result };
      }

      default:
        return {
          success: false,
          error: `Unknown pipeline command: ${command}. Valid: step.begin, step.complete, step.fail, resume, rerun, publish`,
        };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
