/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  ROLE_TEMPLATES,
  HANDBOOK_HEADER_COMMENT,
  LEARNED_SKILLS_MARKER_START,
  LEARNED_SKILLS_MARKER_END,
  matchRoleTemplate,
  generateHandbookContent,
} from './handbookTemplates';

export { HandbookHistoryManager, handbookHistoryManager, MAX_HISTORY_VERSIONS } from './handbookHistory';
export { HandbookWatcher, handbookWatcher } from './handbookWatcher';
export {
  estimateTokens,
  computeTokenBudget,
  parseHandbookMarkdown,
  buildCompressedPrompt,
  buildOneLineReminder,
  generateInjectionResult,
} from './handbookPrompt';
export { HandbookService, handbookService, sanitizeHandbookFileName } from './handbookService';
