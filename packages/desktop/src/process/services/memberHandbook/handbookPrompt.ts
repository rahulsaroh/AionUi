/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HandbookInjectionResult } from '@/common/types/team/handbookTypes';

export type ParsedHandbookSections = {
  identityAndRole: string;
  talents: string[];
  methodology: string[];
  rulesDo: string[];
  rulesDont: string[];
  selfCheckChecklist: string[];
  assignedRepos: string;
  notes: string;
  lessonsLearned: string;
};

/**
 * Standard token estimation: ~3.8 characters per token for English/mixed code.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 3.8));
}

/**
 * Compute token budget based on model context size.
 * Enforces 5% of context with a hard max of 3000 tokens for small models.
 */
export function computeTokenBudget(model?: string): number {
  if (!model) return 3000;
  const m = model.toLowerCase();

  // Very small or edge models (e.g. 8k context) -> 5% is ~400 tokens
  if (m.includes('1b') || m.includes('3b') || m.includes('haiku') || m.includes('flash-lite')) {
    return 1000;
  }
  // Standard small models (e.g. 7b, 8b, mini, 32k context) -> 5% is ~1600 tokens
  if (m.includes('7b') || m.includes('8b') || m.includes('mini') || m.includes('small')) {
    return 1600;
  }

  // Large models / standard models: capped at 3000 tokens as requested
  return 3000;
}

/**
 * Parse Markdown headings into structured sections.
 */
export function parseHandbookMarkdown(content: string): ParsedHandbookSections {
  const lines = content.split('\n');

  let currentSection = '';
  let subSection = '';

  const result: ParsedHandbookSections = {
    identityAndRole: '',
    talents: [],
    methodology: [],
    rulesDo: [],
    rulesDont: [],
    selfCheckChecklist: [],
    assignedRepos: '',
    notes: '',
    lessonsLearned: '',
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    // Check H2
    if (line.startsWith('## ')) {
      currentSection = line.replace('## ', '').trim().toLowerCase();
      subSection = '';
      continue;
    }

    // Check H3
    if (line.startsWith('### ')) {
      subSection = line.replace('### ', '').trim().toLowerCase();
      continue;
    }

    if (currentSection.includes('identity') || currentSection.includes('role')) {
      if (line && !line.startsWith('<!--')) {
        result.identityAndRole += (result.identityAndRole ? '\n' : '') + rawLine;
      }
    } else if (currentSection.includes('talent')) {
      if (line.startsWith('- ') || line.startsWith('* ')) {
        result.talents.push(line.replace(/^[-*]\s+/, '').trim());
      }
    } else if (currentSection.includes('methodology') || currentSection.includes('working')) {
      if (/^\d+\.\s+/.test(line)) {
        result.methodology.push(line.replace(/^\d+\.\s+/, '').trim());
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        result.methodology.push(line.replace(/^[-*]\s+/, '').trim());
      }
    } else if (currentSection.includes('rule')) {
      if (subSection.includes('do') && !subSection.includes('don\'t') && !subSection.includes('dont')) {
        if (line.startsWith('- ') || line.startsWith('* ')) {
          result.rulesDo.push(line.replace(/^[-*]\s+/, '').trim());
        }
      } else if (subSection.includes('don\'t') || subSection.includes('dont')) {
        if (line.startsWith('- ') || line.startsWith('* ')) {
          result.rulesDont.push(line.replace(/^[-*]\s+/, '').trim());
        }
      }
    } else if (currentSection.includes('checklist') || currentSection.includes('output standard')) {
      if (line.startsWith('- [ ] ') || line.startsWith('- [x] ') || line.startsWith('- ') || line.startsWith('* ')) {
        result.selfCheckChecklist.push(line.replace(/^[-*]\s*(\[[ x]\]\s*)?/, '').trim());
      }
    } else if (currentSection.includes('knowledge')) {
      if (subSection.includes('repo')) {
        if (line && !line.startsWith('<!--')) {
          result.assignedRepos += (result.assignedRepos ? '\n' : '') + rawLine;
        }
      } else if (subSection.includes('note')) {
        if (line && !line.startsWith('<!--')) {
          result.notes += (result.notes ? '\n' : '') + rawLine;
        }
      } else {
        if (line && !line.startsWith('<!--')) {
          result.notes += (result.notes ? '\n' : '') + rawLine;
        }
      }
    } else if (currentSection.includes('learned')) {
      if (line && !line.startsWith('<!--')) {
        result.lessonsLearned += (result.lessonsLearned ? '\n' : '') + rawLine;
      }
    }
  }

  return result;
}

/**
 * Compress handbook content into prompt according to priority:
 * Priority 1: Methodology steps & Rules (highest - preserve intact)
 * Priority 2: Identity & Self-Check Checklist
 * Priority 3: Talents
 * Priority 4: Knowledge repos, notes, and lessons learned (lowest - compressed/truncated if needed)
 */
export function buildCompressedPrompt(
  parsed: ParsedHandbookSections,
  memberName: string,
  role?: string,
  budgetTokens = 3000
): string {
  // 1. Mandatory core: Methodology (numbered SOP) & Rules
  const methodologyText = parsed.methodology
    .map((step, idx) => `${idx + 1}. ${step}`)
    .join('\n');

  const doText = parsed.rulesDo.map((r) => `- DO: ${r}`).join('\n');
  const dontText = parsed.rulesDont.map((r) => `- DON'T: ${r}`).join('\n');
  const rulesBlock = [doText, dontText].filter(Boolean).join('\n');

  // Checklist ending
  const checklistItems = parsed.selfCheckChecklist.length > 0
    ? parsed.selfCheckChecklist.map((c) => `- [ ] ${c}`).join('\n')
    : '- [ ] Output adheres to assigned role standards and zero unverified assumptions.';

  const checklistBlock = `Before you answer, verify:\n${checklistItems}`;

  const identityHeader = role
    ? `Teammate: ${memberName} | Role: ${role}`
    : `Teammate: ${memberName}`;

  // Assemble base mandatory text
  let assembled = `[EMPLOYEE HANDBOOK: ${memberName}]
${identityHeader}
${parsed.identityAndRole ? `\nIdentity & Objectives:\n${parsed.identityAndRole}` : ''}

Working Methodology (SOP):
${methodologyText || '1. Analyze instructions.\n2. Execute step-by-step.\n3. Verify results.'}

Rules:
${rulesBlock || '- DO: Adhere to role requirements.\n- DON\'T: Introduce unverified changes.'}`;

  // Check remaining budget
  let currentTokens = estimateTokens(assembled) + estimateTokens(checklistBlock) + 50;
  const remaining = budgetTokens - currentTokens;

  // Priority 3: Talents
  if (remaining > 150 && parsed.talents.length > 0) {
    const talentLines = parsed.talents.map((t) => `- ${t}`).join('\n');
    const talentBlock = `\n\nTalents:\n${talentLines}`;
    if (estimateTokens(talentBlock) < remaining - 50) {
      assembled += talentBlock;
      currentTokens += estimateTokens(talentBlock);
    } else {
      // Condensed talents
      const condensed = `\n\nTalents: ${parsed.talents.slice(0, 3).join(', ')}`;
      assembled += condensed;
      currentTokens += estimateTokens(condensed);
    }
  }

  // Priority 4: Knowledge & Notes
  const remainingForNotes = budgetTokens - currentTokens - estimateTokens(checklistBlock) - 30;
  if (remainingForNotes > 80) {
    const knowledgeParts: string[] = [];
    if (parsed.assignedRepos && !parsed.assignedRepos.includes('No repositories assigned yet')) {
      knowledgeParts.push(`Assigned Repos:\n${parsed.assignedRepos}`);
    }
    if (parsed.notes) {
      knowledgeParts.push(`Notes:\n${parsed.notes}`);
    }
    if (parsed.lessonsLearned) {
      knowledgeParts.push(`Learned Insights:\n${parsed.lessonsLearned}`);
    }

    if (knowledgeParts.length > 0) {
      const fullKnowledge = `\n\nKnowledge Context:\n${knowledgeParts.join('\n')}`;
      if (estimateTokens(fullKnowledge) <= remainingForNotes) {
        assembled += fullKnowledge;
      } else {
        // Truncate
        const maxChars = Math.max(100, Math.floor(remainingForNotes * 3.5));
        assembled += `\n\nKnowledge Context:\n${fullKnowledge.slice(0, maxChars)}... [truncated for budget]`;
      }
    }
  }

  // Always end with the self-check checklist
  assembled += `\n\n${checklistBlock}\n[/EMPLOYEE HANDBOOK]`;

  return assembled;
}

/**
 * Build one-line reminder for subsequent turns.
 */
export function buildOneLineReminder(memberName: string, role?: string): string {
  const roleText = role ? ` (${role})` : '';
  return `[Employee Handbook Reminder: Follow your active handbook rules and SOP for ${memberName}${roleText}]`;
}

/**
 * Generate full injection result depending on whether it's first message or hash changed.
 */
export function generateInjectionResult(params: {
  memberName: string;
  role?: string;
  content: string;
  fileHash: string;
  isFirstMessage: boolean;
  model?: string;
}): HandbookInjectionResult {
  const { memberName, role, content, fileHash, isFirstMessage, model } = params;

  if (!isFirstMessage) {
    const reminder = buildOneLineReminder(memberName, role);
    return {
      promptBlock: reminder,
      isFullBlock: false,
      fileHash,
      estimatedTokens: estimateTokens(reminder),
    };
  }

  const budget = computeTokenBudget(model);
  const parsed = parseHandbookMarkdown(content);
  const fullBlock = buildCompressedPrompt(parsed, memberName, role, budget);

  return {
    promptBlock: fullBlock,
    isFullBlock: true,
    fileHash,
    estimatedTokens: estimateTokens(fullBlock),
  };
}
