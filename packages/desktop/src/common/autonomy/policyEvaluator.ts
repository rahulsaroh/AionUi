/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ActionCategory,
  ActionContext,
  AutonomyConfig,
  AutonomyProfile,
  PolicyEvaluationResult,
  RememberedRule,
  RunState,
} from './types';

const DEFAULT_ALLOWLISTED_COMMANDS = [
  'git status',
  'git diff',
  'git log',
  'npm test',
  'bun test',
  'bun run test',
  'ls',
  'dir',
  'echo',
];

const DEFAULT_ALLOWLISTED_DOMAINS = ['github.com', 'api.github.com', 'registry.npmjs.org', 'npmjs.com'];

/**
 * Normalizes path for cross-platform comparison (converts backslashes and lowercases on Windows).
 */
export function normalizePath(p: string): string {
  if (!p) return '';
  let normalized = p.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (normalized.endsWith('/') && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }
  // If Windows drive path e.g. C:/...
  if (/^[a-zA-Z]:\//.test(normalized)) {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

/**
 * Checks whether targetPath is strictly inside or equal to folderPath.
 */
export function isInsideFolder(targetPath?: string, folderPath?: string): boolean {
  if (!targetPath || !folderPath) return false;

  const normTarget = normalizePath(targetPath);
  const normFolder = normalizePath(folderPath);

  // If target path is relative and does not attempt directory traversal, consider inside
  if (!targetPath.startsWith('/') && !/^[a-zA-Z]:/.test(targetPath)) {
    if (targetPath.startsWith('..') || targetPath.includes('/..') || targetPath.includes('\\..')) {
      return false;
    }
    return true;
  }

  if (normTarget === normFolder) return true;
  return normTarget.startsWith(normFolder + '/');
}

/**
 * Determines whether the action is outside the project workspace folder.
 */
export function isActionOutsideWorkspace(context: ActionContext): boolean {
  if (typeof context.isOutsideWorkspace === 'boolean') {
    return context.isOutsideWorkspace;
  }
  if (!context.projectPath) {
    return false;
  }
  if (context.targetPath) {
    return !isInsideFolder(context.targetPath, context.projectPath);
  }
  return false;
}

/**
 * Checks the NEVER auto-approve list:
 * - Deleting outside the project folder
 * - Publishing/posting to external platforms
 * - Spending money
 * - Accessing credentials
 */
export function isNeverAutoApprove(context: ActionContext): { blocked: boolean; reason?: string } {
  if (context.category === 'file_delete' && isActionOutsideWorkspace(context)) {
    return { blocked: true, reason: 'never_auto_approve:deleting_outside_project_folder' };
  }
  if (context.category === 'publish') {
    return { blocked: true, reason: 'never_auto_approve:publishing_to_external_platforms' };
  }
  if (context.category === 'spend' || (context.amount !== undefined && context.amount > 0)) {
    return { blocked: true, reason: 'never_auto_approve:spending_money' };
  }
  if (context.category === 'credentials') {
    return { blocked: true, reason: 'never_auto_approve:accessing_credentials' };
  }
  return { blocked: false };
}

/**
 * Validates whether a command matches an allowlisted command pattern.
 * Checks for command chaining (;, &&, ||, |) to ensure every segment is safe.
 */
export function isCommandAllowlisted(command: string, allowlist: string[]): boolean {
  if (!command || !allowlist || allowlist.length === 0) return false;
  const trimmed = command.trim();

  // If command contains chaining operators, split and verify all parts
  const segments = trimmed
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return false;

  return segments.every((seg) => {
    return allowlist.some((allowed) => {
      const normAllowed = allowed.trim().toLowerCase();
      const normSeg = seg.toLowerCase();
      return normSeg === normAllowed || normSeg.startsWith(normAllowed + ' ');
    });
  });
}

/**
 * Checks whether a domain matches an allowlisted domain.
 */
export function isDomainAllowlisted(domain: string, allowlist: string[]): boolean {
  if (!domain || !allowlist || allowlist.length === 0) return false;
  const normDomain = domain.trim().toLowerCase();
  return allowlist.some((allowed) => {
    const normAllowed = allowed.trim().toLowerCase();
    return normDomain === normAllowed || normDomain.endsWith('.' + normAllowed);
  });
}

/**
 * Matches a remembered rule against an action context.
 */
export function matchesRememberedRule(rule: RememberedRule, context: ActionContext, projectId?: string): boolean {
  if (projectId && rule.projectId !== projectId) return false;
  if (rule.tool && context.tool && rule.tool !== context.tool) return false;

  if (rule.pattern) {
    const pattern = rule.pattern.trim().toLowerCase();
    if (context.command && context.command.trim().toLowerCase().startsWith(pattern)) {
      return true;
    }
    if (context.targetPath && normalizePath(context.targetPath).includes(pattern)) {
      return true;
    }
    if (context.domain && context.domain.toLowerCase().includes(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the effective autonomy configuration following precedence:
 * project config -> team override -> scheduled/headless task override.
 * Headless runs default to 'ask' unless explicitly configured.
 */
export function resolveAutonomyConfig(params: {
  projectConfig?: Partial<AutonomyConfig> | null;
  teamConfig?: Partial<AutonomyConfig> | null;
  taskConfig?: Partial<AutonomyConfig> | null;
  isHeadless?: boolean;
}): AutonomyConfig {
  const isHeadless = !!params.isHeadless;

  const defaultProfile: AutonomyProfile = isHeadless ? 'ask' : (params.projectConfig?.profile ?? 'ask');

  let resolvedProfile: AutonomyProfile = defaultProfile;
  if (params.projectConfig?.profile) resolvedProfile = params.projectConfig.profile;
  if (params.teamConfig?.profile) resolvedProfile = params.teamConfig.profile;
  if (params.taskConfig?.profile) resolvedProfile = params.taskConfig.profile;

  // Headless runs default to 'ask' unless explicitly set on taskConfig, teamConfig, or projectConfig
  if (isHeadless && !params.taskConfig?.profile && !params.teamConfig?.profile && !params.projectConfig?.profile) {
    resolvedProfile = 'ask';
  }

  const maxToolCallsPerRun =
    params.taskConfig?.maxToolCallsPerRun ??
    params.teamConfig?.maxToolCallsPerRun ??
    params.projectConfig?.maxToolCallsPerRun ??
    50;

  const allowlistedCommands = [
    ...DEFAULT_ALLOWLISTED_COMMANDS,
    ...(params.projectConfig?.allowlistedCommands ?? []),
    ...(params.teamConfig?.allowlistedCommands ?? []),
    ...(params.taskConfig?.allowlistedCommands ?? []),
  ];

  const allowlistedDomains = [
    ...DEFAULT_ALLOWLISTED_DOMAINS,
    ...(params.projectConfig?.allowlistedDomains ?? []),
    ...(params.teamConfig?.allowlistedDomains ?? []),
    ...(params.taskConfig?.allowlistedDomains ?? []),
  ];

  const spendCap = params.taskConfig?.spendCap ?? params.teamConfig?.spendCap ?? params.projectConfig?.spendCap;

  const timeoutHours =
    params.taskConfig?.timeoutHours ?? params.teamConfig?.timeoutHours ?? params.projectConfig?.timeoutHours ?? 12;

  return {
    profile: resolvedProfile,
    maxToolCallsPerRun,
    allowlistedCommands: Array.from(new Set(allowlistedCommands)),
    allowlistedDomains: Array.from(new Set(allowlistedDomains)),
    spendCap,
    timeoutHours,
  };
}

/**
 * Evaluates whether an action should be auto-approved or require human intervention.
 */
export function evaluatePolicy(
  context: ActionContext,
  config: AutonomyConfig,
  options?: {
    runState?: RunState;
    rememberedRules?: RememberedRule[];
    projectId?: string;
  }
): PolicyEvaluationResult {
  // 1. Check NEVER auto-approve list FIRST under any profile
  const neverCheck = isNeverAutoApprove(context);
  if (neverCheck.blocked) {
    return {
      allowed: false,
      reason: neverCheck.reason ?? 'never_auto_approve_policy',
      requiresHuman: true,
    };
  }

  // 2. Check Remembered Rules (Approve always in this project)
  if (options?.rememberedRules && options.rememberedRules.length > 0) {
    const matchingRule = options.rememberedRules.find((rule) =>
      matchesRememberedRule(rule, context, options.projectId)
    );
    if (matchingRule) {
      return {
        allowed: true,
        reason: 'remembered_rule_matched',
        requiresHuman: false,
        ruleMatched: matchingRule.id,
      };
    }
  }

  // 3. Evaluate by Profile
  const profile = config.profile || 'ask';

  switch (profile) {
    case 'ask':
      return {
        allowed: false,
        reason: 'profile_ask_requires_approval',
        requiresHuman: false,
      };

    case 'trusted_workspace': {
      const isOutside = isActionOutsideWorkspace(context);

      // Auto-approve file read/write strictly inside the project folder
      if (context.category === 'file_read') {
        if (!isOutside) {
          return { allowed: true, reason: 'trusted_workspace:file_read_inside', requiresHuman: false };
        }
        return { allowed: false, reason: 'trusted_workspace:file_read_outside', requiresHuman: false };
      }

      if (context.category === 'file_write') {
        if (!isOutside) {
          return { allowed: true, reason: 'trusted_workspace:file_write_inside', requiresHuman: false };
        }
        return { allowed: false, reason: 'trusted_workspace:file_write_outside', requiresHuman: false };
      }

      // Allowlisted shell commands
      if (context.category === 'shell_exec') {
        if (context.command && isCommandAllowlisted(context.command, config.allowlistedCommands ?? [])) {
          return { allowed: true, reason: 'trusted_workspace:shell_command_allowlisted', requiresHuman: false };
        }
        return { allowed: false, reason: 'trusted_workspace:shell_command_not_allowlisted', requiresHuman: false };
      }

      // Still ask for new network domains, deletes, and anything outside folder
      if (context.category === 'file_delete') {
        return { allowed: false, reason: 'trusted_workspace:deletes_require_approval', requiresHuman: false };
      }

      if (context.category === 'network') {
        return { allowed: false, reason: 'trusted_workspace:network_requires_approval', requiresHuman: false };
      }

      return { allowed: false, reason: 'trusted_workspace:action_requires_approval', requiresHuman: false };
    }

    case 'autopilot': {
      // Check max tool-calls per run
      if (
        options?.runState &&
        config.maxToolCallsPerRun !== undefined &&
        options.runState.toolCallsCount >= config.maxToolCallsPerRun
      ) {
        return {
          allowed: false,
          reason: `autopilot:max_tool_calls_exceeded (${options.runState.toolCallsCount}/${config.maxToolCallsPerRun})`,
          requiresHuman: false,
        };
      }

      // Check spend cap from cost-ledger if configured
      if (
        config.spendCap !== undefined &&
        options?.runState?.currentSpend !== undefined &&
        options.runState.currentSpend >= config.spendCap
      ) {
        return {
          allowed: false,
          reason: `autopilot:spend_cap_exceeded (${options.runState.currentSpend}/${config.spendCap})`,
          requiresHuman: false,
        };
      }

      const isOutside = isActionOutsideWorkspace(context);
      if (isOutside) {
        return { allowed: false, reason: 'autopilot:outside_project_workspace', requiresHuman: false };
      }

      // Inside project folder: auto-approve file read, write, delete, shell exec
      if (
        context.category === 'file_read' ||
        context.category === 'file_write' ||
        context.category === 'file_delete' ||
        context.category === 'shell_exec'
      ) {
        return { allowed: true, reason: `autopilot:inside_workspace_${context.category}`, requiresHuman: false };
      }

      // Network: auto-approve allowlisted domains
      if (context.category === 'network') {
        if (context.domain && isDomainAllowlisted(context.domain, config.allowlistedDomains ?? [])) {
          return { allowed: true, reason: 'autopilot:domain_allowlisted', requiresHuman: false };
        }
        return { allowed: false, reason: 'autopilot:domain_not_allowlisted', requiresHuman: false };
      }

      return { allowed: true, reason: 'autopilot:auto_approved', requiresHuman: false };
    }

    default:
      return { allowed: false, reason: 'unknown_profile_requires_approval', requiresHuman: false };
  }
}
