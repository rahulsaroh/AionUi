/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import type { KnowledgeRepo, EffectiveInstructionResult, TeammateCapabilityCard } from '@/common/types/knowledgeRepo';

const DEFAULT_TOKEN_BUDGET = 8000; // max budget for injected knowledge repo content

// Standard multi-repo entrypoint files that should coexist across distinct repositories
// rather than shadowing one another as rule conflicts.
const SHARED_ENTRYPOINT_FILENAMES = new Set([
  'agents.md',
  'agent_guide.md',
  'claude.md',
  'gemini.md',
  '.cursorrules',
  '.windsurfrules',
  'copilot-instructions.md',
  'copilot_instructions.md',
  'architecture.md',
  'contributing.md',
  'readme.md',
  'readme.mdx',
  'readme.rst',
  'readme.txt',
  'readme',
]);

export class KnowledgeRepoPromptBuilder {
  /**
   * Build the injected instruction block per teammate with strict precedence:
   * (1) AionUi safety and permission settings
   * (2) User direct instructions in chat (placeholder marker)
   * (3) Teammate's own role prompt
   * (4) Repo rules in priority order (higher-priority repo wins conflicts)
   */
  buildInstructions(params: {
    memberName: string;
    rolePrompt?: string;
    repos: KnowledgeRepo[];
    whenToUseHint?: string;
    tokenBudget?: number;
    workingCopyPaths?: Record<string, string>;
    isReminder?: boolean;
  }): EffectiveInstructionResult {
    const {
      memberName,
      rolePrompt = '',
      repos,
      whenToUseHint,
      tokenBudget = DEFAULT_TOKEN_BUDGET,
      workingCopyPaths = {},
      isReminder = false,
    } = params;

    // Filter to only trusted repos with manifests (never inject untrusted or reapproval_required)
    const validRepos = repos.filter((r) => Boolean(r.manifest && r.trustStatus === 'trusted'));

    if (validRepos.length === 0) {
      return {
        instructions: rolePrompt.trim(),
        estimatedTokens: Math.ceil(rolePrompt.length / 4),
        budgetExceeded: false,
        budgetLimitTokens: tokenBudget,
        conflicts: [],
      };
    }

    // When reminder mode is active, send a concise one-line reminder with repo names
    if (isReminder) {
      const repoNames = validRepos.map((r) => r.name).join(', ');
      const reminder = `[Knowledge Reminder] Active knowledge repositories: ${repoNames}. Follow their documented rules and pipelines.`;
      return {
        instructions: reminder,
        estimatedTokens: Math.ceil(reminder.length / 4),
        budgetExceeded: false,
        budgetLimitTokens: tokenBudget,
        conflicts: [],
      };
    }

    const conflicts: Array<{ ruleA: string; ruleB: string; resolvedInFavorOf: string }> = [];
    const seenRuleNames = new Map<string, string>(); // name -> repoId

    // 1. Authoritative Playbook Preamble with mandatory read-only instruction
    const hintText = whenToUseHint ? `for ${whenToUseHint}` : 'for tasks assigned to you';
    const preamble = [
      `### Authoritative Knowledge Playbook for ${memberName}`,
      `You are operating with these repositories as your authoritative playbook ${hintText}. Follow their documented pipelines and rules step by step. Do not invent a different workflow. If a step cannot be performed, say so and ask the user instead of improvising.`,
      `Read the skill file from the given path before doing the task. Do not modify these files.`,
      `You have read-only access to inspect files under each repository's root path via read_file / list_dir / scan_folder.`,
      '',
    ].join('\n');

    // 2. Teammate Role Prompt Section
    const roleSection = rolePrompt.trim() ? `### Teammate Role\n${rolePrompt.trim()}\n\n` : '';

    // 3. Collect Always-On Rules from Repos in Priority Order
    const ruleBlocks: string[] = [];
    let estimatedTokens = Math.ceil((preamble.length + roleSection.length) / 4);
    let budgetExceeded = false;

    for (const repo of validRepos) {
      const workingDir = workingCopyPaths[repo.id] || repo.cachePath;
      const effectiveRoot = repo.subpath ? path.resolve(workingDir, repo.subpath) : workingDir;
      const repoHeader = `#### Rules from Repository: ${repo.name} (ref: ${repo.ref}, root: ${effectiveRoot})`;
      const repoRulesText: string[] = [repoHeader];

      for (const rule of repo.manifest.alwaysOnRules) {
        const isSharedEntrypoint = SHARED_ENTRYPOINT_FILENAMES.has(rule.name.toLowerCase());
        if (!isSharedEntrypoint) {
          if (seenRuleNames.has(rule.name)) {
            const priorRepo = seenRuleNames.get(rule.name)!;
            conflicts.push({
              ruleA: `${priorRepo}:${rule.name}`,
              ruleB: `${repo.name}:${rule.name}`,
              resolvedInFavorOf: `${priorRepo}:${rule.name}`,
            });
            continue; // Prior repo wins
          }
          seenRuleNames.set(rule.name, repo.name);
        }

        const absPath = path.resolve(effectiveRoot, rule.relativePath);
        const ruleText = `<!-- Rule: ${rule.relativePath} (Path: ${absPath}) -->\n${rule.content}\n`;
        const ruleTokens = Math.ceil(ruleText.length / 4);

        if (estimatedTokens + ruleTokens > tokenBudget) {
          budgetExceeded = true;
          const remainingTokens = Math.max(0, tokenBudget - estimatedTokens);
          const remainingChars = remainingTokens * 4;
          if (remainingChars > 100) {
            repoRulesText.push(
              `${ruleText.slice(0, remainingChars)}\n\n[TRUNCATED: Knowledge rule budget limit of ${tokenBudget} tokens reached]`
            );
          }
          break;
        } else {
          estimatedTokens += ruleTokens;
          repoRulesText.push(ruleText);
        }
      }

      if (repoRulesText.length > 1) {
        ruleBlocks.push(repoRulesText.join('\n'));
      }

      if (budgetExceeded) break;
    }

    // 4. On-Demand Skills Index (Progressive Disclosure) with absolute paths
    const skillIndexBlocks: string[] = [];
    for (const repo of validRepos) {
      if (!repo.manifest?.onDemandSkills?.length) continue;
      const workingDir = workingCopyPaths[repo.id] || repo.cachePath;
      const effectiveRoot = repo.subpath ? path.resolve(workingDir, repo.subpath) : workingDir;
      const skillsLines = repo.manifest.onDemandSkills.map((s) => {
        const absSkillPath = path.resolve(effectiveRoot, s.relativePath);
        return `- \`${repo.name}/${s.name}\`: ${s.description} (File: ${absSkillPath})`;
      });
      skillIndexBlocks.push(`#### Available On-Demand Skills & Pipelines (${repo.name}):\n${skillsLines.join('\n')}`);
    }

    const onDemandSection =
      skillIndexBlocks.length > 0
        ? `### Available Skills & Pipelines (Read the skill file from the given path before doing the task. Do not modify these files):\n${skillIndexBlocks.join('\n\n')}\n\n`
        : '';

    // 5. Repository Structure Maps (for general code & docs exploration within remaining budget)
    const repoMapBlocks: string[] = [];
    if (!budgetExceeded) {
      for (const repo of validRepos) {
        const repoMap = repo.manifest?.repoMap;
        if (!repoMap) continue;
        const workingDir = workingCopyPaths[repo.id] || repo.cachePath;
        const effectiveRoot = repo.subpath ? path.resolve(workingDir, repo.subpath) : workingDir;
        const block = `#### Repository Map: ${repo.name} (read-only root: ${effectiveRoot})\n\`\`\`\n${repoMap}\n\`\`\``;
        const blockTokens = Math.ceil(block.length / 4);
        if (estimatedTokens + blockTokens <= tokenBudget) {
          estimatedTokens += blockTokens;
          repoMapBlocks.push(block);
        }
      }
    }
    const repoMapSection =
      repoMapBlocks.length > 0
        ? `### Repository File Maps (Use read_file / list_dir on the read-only root to inspect specific files):\n${repoMapBlocks.join('\n\n')}\n\n`
        : '';

    const instructions = [
      preamble,
      roleSection,
      ruleBlocks.length > 0 ? `### Active Repository Rules:\n${ruleBlocks.join('\n\n')}\n\n` : '',
      onDemandSection,
      repoMapSection,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      instructions: instructions.trim(),
      estimatedTokens: Math.ceil(instructions.length / 4),
      budgetExceeded,
      budgetLimitTokens: tokenBudget,
      conflicts,
    };
  }

  /**
   * Build short capability cards for the team lead so it routes tasks accurately.
   */
  buildCapabilityCard(params: {
    memberSlotId: string;
    memberName: string;
    repos: KnowledgeRepo[];
    whenToUseHint?: string;
  }): TeammateCapabilityCard {
    const { memberSlotId, memberName, repos, whenToUseHint } = params;
    return {
      memberSlotId,
      memberName,
      repos: repos
        .filter((r) => r.trustStatus === 'trusted')
        .map((r) => ({
          repoId: r.id,
          repoName: r.name,
          whenToUseHint,
          keySkills: (r.manifest?.onDemandSkills || []).map((s) => s.name).slice(0, 10),
        })),
    };
  }
}

export const knowledgeRepoPromptBuilder = new KnowledgeRepoPromptBuilder();
