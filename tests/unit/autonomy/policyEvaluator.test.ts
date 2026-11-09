/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  evaluatePolicy,
  isNeverAutoApprove,
  resolveAutonomyConfig,
  isInsideFolder,
  isCommandAllowlisted,
  isDomainAllowlisted,
} from '@/common/autonomy/policyEvaluator';
import type {
  ActionCategory,
  ActionContext,
  AutonomyConfig,
  AutonomyProfile,
  RememberedRule,
  RunState,
} from '@/common/autonomy/types';

describe('Policy Evaluator - Table-Driven Unit Tests', () => {
  const workspacePath = 'C:/Users/test/projects/my-app';

  describe('Path and Helper Functions', () => {
    it('isInsideFolder correctly determines relative and absolute paths', () => {
      expect(isInsideFolder('src/index.ts', workspacePath)).toBe(true);
      expect(isInsideFolder('C:/Users/test/projects/my-app/src/index.ts', workspacePath)).toBe(true);
      expect(isInsideFolder('c:\\users\\test\\projects\\my-app\\package.json', workspacePath)).toBe(true);
      expect(isInsideFolder('../secret.env', workspacePath)).toBe(false);
      expect(isInsideFolder('C:/Windows/System32/cmd.exe', workspacePath)).toBe(false);
      expect(isInsideFolder('/etc/passwd', workspacePath)).toBe(false);
    });

    it('isCommandAllowlisted checks prefixes and denies chained injections', () => {
      const allowlist = ['git status', 'git diff', 'npm test'];
      expect(isCommandAllowlisted('git status', allowlist)).toBe(true);
      expect(isCommandAllowlisted('git diff --stat', allowlist)).toBe(true);
      expect(isCommandAllowlisted('npm test -- --watch', allowlist)).toBe(true);
      expect(isCommandAllowlisted('rm -rf /', allowlist)).toBe(false);
      // Chaining with a dangerous command should fail
      expect(isCommandAllowlisted('git status && rm -rf /', allowlist)).toBe(false);
      expect(isCommandAllowlisted('git status; cat /etc/shadow', allowlist)).toBe(false);
      // Chaining safe allowlisted commands should pass
      expect(isCommandAllowlisted('git status && git diff', allowlist)).toBe(true);
    });

    it('isDomainAllowlisted matches exact and subdomains', () => {
      const allowlist = ['github.com', 'npmjs.org'];
      expect(isDomainAllowlisted('github.com', allowlist)).toBe(true);
      expect(isDomainAllowlisted('api.github.com', allowlist)).toBe(true);
      expect(isDomainAllowlisted('registry.npmjs.org', allowlist)).toBe(true);
      expect(isDomainAllowlisted('malicious-site.com', allowlist)).toBe(false);
      expect(isDomainAllowlisted('fakegithub.com', allowlist)).toBe(false);
    });
  });

  describe('Autonomy Config Resolution', () => {
    it('resolves project, team, task hierarchy and defaults headless to ask', () => {
      // 1. Headless default is 'ask'
      const headlessDefault = resolveAutonomyConfig({ isHeadless: true });
      expect(headlessDefault.profile).toBe('ask');

      // 2. Project config sets profile
      const projectConfig = resolveAutonomyConfig({
        projectConfig: { profile: 'trusted_workspace' },
        isHeadless: false,
      });
      expect(projectConfig.profile).toBe('trusted_workspace');

      // 3. Team config overrides project
      const teamOverride = resolveAutonomyConfig({
        projectConfig: { profile: 'trusted_workspace' },
        teamConfig: { profile: 'autopilot' },
        isHeadless: false,
      });
      expect(teamOverride.profile).toBe('autopilot');

      // 4. Task config overrides team & project
      const taskOverride = resolveAutonomyConfig({
        projectConfig: { profile: 'trusted_workspace' },
        teamConfig: { profile: 'autopilot' },
        taskConfig: { profile: 'ask' },
        isHeadless: false,
      });
      expect(taskOverride.profile).toBe('ask');

      // 5. Headless explicitly set to autopilot
      const headlessExplicit = resolveAutonomyConfig({
        taskConfig: { profile: 'autopilot' },
        isHeadless: true,
      });
      expect(headlessExplicit.profile).toBe('autopilot');
    });
  });

  describe('NEVER auto-approve list under ANY profile (including Autopilot)', () => {
    const autopilotConfig: AutonomyConfig = {
      profile: 'autopilot',
      maxToolCallsPerRun: 100,
      allowlistedCommands: ['git status', 'npm test'],
      allowlistedDomains: ['github.com'],
    };

    const neverApproveCases: Array<{
      desc: string;
      context: ActionContext;
      expectedReason: string;
    }> = [
      {
        desc: 'deleting outside the project folder',
        context: {
          category: 'file_delete',
          targetPath: 'C:/Windows/temp/file.txt',
          projectPath: workspacePath,
        },
        expectedReason: 'never_auto_approve:deleting_outside_project_folder',
      },
      {
        desc: 'deleting relative path traversing outside project folder',
        context: {
          category: 'file_delete',
          targetPath: '../outside/file.txt',
          projectPath: workspacePath,
        },
        expectedReason: 'never_auto_approve:deleting_outside_project_folder',
      },
      {
        desc: 'publishing/posting to external platforms',
        context: {
          category: 'publish',
          projectPath: workspacePath,
          tool: 'twitter_post',
        },
        expectedReason: 'never_auto_approve:publishing_to_external_platforms',
      },
      {
        desc: 'spending money',
        context: {
          category: 'spend',
          amount: 25.0,
          projectPath: workspacePath,
        },
        expectedReason: 'never_auto_approve:spending_money',
      },
      {
        desc: 'accessing credentials',
        context: {
          category: 'credentials',
          tool: 'get_api_key',
          projectPath: workspacePath,
        },
        expectedReason: 'never_auto_approve:accessing_credentials',
      },
    ];

    for (const testCase of neverApproveCases) {
      it(`never auto-approves: ${testCase.desc}`, () => {
        // Test helper directly
        const neverCheck = isNeverAutoApprove(testCase.context);
        expect(neverCheck.blocked).toBe(true);
        expect(neverCheck.reason).toBe(testCase.expectedReason);

        // Test evaluatePolicy under Autopilot
        const result = evaluatePolicy(testCase.context, autopilotConfig);
        expect(result.allowed).toBe(false);
        expect(result.requiresHuman).toBe(true);
        expect(result.reason).toBe(testCase.expectedReason);
      });
    }
  });

  describe('Comprehensive Profile x Action Type Matrix', () => {
    interface MatrixTestCase {
      profile: AutonomyProfile;
      actionCategory: ActionCategory;
      isInside: boolean;
      extraContext?: Partial<ActionContext>;
      runState?: RunState;
      expectedAllowed: boolean;
      expectedRequiresHuman: boolean;
      desc: string;
    }

    const testMatrix: MatrixTestCase[] = [
      // === ASK PROFILE ===
      {
        profile: 'ask',
        actionCategory: 'file_read',
        isInside: true,
        expectedAllowed: false,
        expectedRequiresHuman: false,
        desc: 'Ask: file_read inside requires approval',
      },
      {
        profile: 'ask',
        actionCategory: 'file_write',
        isInside: true,
        expectedAllowed: false,
        expectedRequiresHuman: false,
        desc: 'Ask: file_write inside requires approval',
      },
      {
        profile: 'ask',
        actionCategory: 'shell_exec',
        isInside: true,
        extraContext: { command: 'git status' },
        expectedAllowed: false,
        expectedRequiresHuman: false,
        desc: 'Ask: safe shell_exec requires approval',
      },

      // === TRUSTED_WORKSPACE PROFILE ===
      {
        profile: 'trusted_workspace',
        actionCategory: 'file_read',
        isInside: true,
        expectedAllowed: true,
        expectedRequiresHuman: false,
        desc: 'Trusted Workspace: file_read inside is auto-approved',
      },
      {
        profile: 'trusted_workspace',
        actionCategory: 'file_read',
        isInside: false,
        expectedAllowed: false,
        expectedRequiresHuman: false,
        desc: 'Trusted Workspace: file_read outside requires approval',
      },
      {
        profile: 'trusted_workspace',
        actionCategory: 'file_write',
        isInside: true,
        expectedAllowed: true,
        expectedRequiresHuman: false,
        desc: 'Trusted Workspace: file_write inside is auto-approved',
      },
      {
        profile: 'trusted_workspace',
        actionCategory: 'file_write',
        isInside: false,
        expectedAllowed: false,
        expectedRequiresHuman: false,
        desc: 'Trusted Workspace: file_write outside requires approval',
      },
      {
        profile: 'trusted_workspace',
        actionCategory: 'shell_exec',
        isInside: true,
        extraContext: { command: 'git status' },
        expectedAllowed: true,
        expectedRequiresHuman: false,
        desc: 'Trusted Workspace: allowlisted command git status is auto-approved',
      },
      {
        profile: 'trusted_workspace',
        actionCategory: 'shell_exec',
        isInside: true,
        extraContext: { command: 'npm install evil-package' },
        expectedAllowed: false,
        expectedRequiresHuman: false,
        desc: 'Trusted Workspace: non-allowlisted command requires approval',
      },
      {
        profile: 'trusted_workspace',
        actionCategory: 'file_delete',
        isInside: true,
        expectedAllowed: false,
        expectedRequiresHuman: false,
        desc: 'Trusted Workspace: file_delete inside still asks for confirmation',
      },
      {
        profile: 'trusted_workspace',
        actionCategory: 'network',
        isInside: true,
        extraContext: { domain: 'github.com' },
        expectedAllowed: false,
        expectedRequiresHuman: false,
        desc: 'Trusted Workspace: network call still asks for confirmation',
      },

      // === AUTOPILOT PROFILE ===
      {
        profile: 'autopilot',
        actionCategory: 'file_read',
        isInside: true,
        expectedAllowed: true,
        expectedRequiresHuman: false,
        desc: 'Autopilot: file_read inside is auto-approved',
      },
      {
        profile: 'autopilot',
        actionCategory: 'file_write',
        isInside: true,
        expectedAllowed: true,
        expectedRequiresHuman: false,
        desc: 'Autopilot: file_write inside is auto-approved',
      },
      {
        profile: 'autopilot',
        actionCategory: 'file_delete',
        isInside: true,
        expectedAllowed: true,
        expectedRequiresHuman: false,
        desc: 'Autopilot: file_delete inside workspace is auto-approved',
      },
      {
        profile: 'autopilot',
        actionCategory: 'file_delete',
        isInside: false,
        expectedAllowed: false,
        expectedRequiresHuman: true,
        desc: 'Autopilot: file_delete outside is NEVER auto-approved',
      },
      {
        profile: 'autopilot',
        actionCategory: 'shell_exec',
        isInside: true,
        extraContext: { command: 'cargo build' },
        expectedAllowed: true,
        expectedRequiresHuman: false,
        desc: 'Autopilot: shell execution inside workspace is auto-approved',
      },
      {
        profile: 'autopilot',
        actionCategory: 'shell_exec',
        isInside: false,
        extraContext: { command: 'cargo build' },
        expectedAllowed: false,
        expectedRequiresHuman: false,
        desc: 'Autopilot: shell execution outside workspace is not auto-approved',
      },
      {
        profile: 'autopilot',
        actionCategory: 'network',
        isInside: true,
        extraContext: { domain: 'api.github.com' },
        expectedAllowed: true,
        expectedRequiresHuman: false,
        desc: 'Autopilot: allowlisted domain is auto-approved',
      },
      {
        profile: 'autopilot',
        actionCategory: 'network',
        isInside: true,
        extraContext: { domain: 'untrusted-server.xyz' },
        expectedAllowed: false,
        expectedRequiresHuman: false,
        desc: 'Autopilot: non-allowlisted domain asks for approval',
      },

      // === AUTOPILOT LIMITS ===
      {
        profile: 'autopilot',
        actionCategory: 'file_read',
        isInside: true,
        runState: { toolCallsCount: 50 }, // max is 50
        expectedAllowed: false,
        expectedRequiresHuman: false,
        desc: 'Autopilot: hits max tool calls per run limit',
      },
      {
        profile: 'autopilot',
        actionCategory: 'file_write',
        isInside: true,
        runState: { toolCallsCount: 10, currentSpend: 100 }, // spendCap is 100
        expectedAllowed: false,
        expectedRequiresHuman: false,
        desc: 'Autopilot: hits spend cap limit',
      },
    ];

    for (const tc of testMatrix) {
      it(tc.desc, () => {
        const config: AutonomyConfig = {
          profile: tc.profile,
          maxToolCallsPerRun: 50,
          allowlistedCommands: ['git status', 'git diff', 'npm test'],
          allowlistedDomains: ['github.com', 'api.github.com'],
          spendCap: 100,
        };

        const targetPath = tc.isInside ? `${workspacePath}/src/file.ts` : 'C:/SomeOtherFolder/file.ts';

        const context: ActionContext = {
          category: tc.actionCategory,
          targetPath,
          projectPath: workspacePath,
          isOutsideWorkspace: !tc.isInside,
          ...tc.extraContext,
        };

        const result = evaluatePolicy(context, config, { runState: tc.runState });
        expect(result.allowed).toBe(tc.expectedAllowed);
        expect(result.requiresHuman).toBe(tc.expectedRequiresHuman);
      });
    }
  });

  describe('Remembered Rules ("Approve always in this project")', () => {
    it('auto-approves matching rule unless on NEVER auto-approve list', () => {
      const config: AutonomyConfig = { profile: 'ask' };
      const rules: RememberedRule[] = [
        {
          id: 'rule-1',
          projectId: 'proj-1',
          tool: 'bash_exec',
          pattern: 'npm run lint',
          createdAt: Date.now(),
        },
      ];

      // 1. Matching rule in same project -> auto-approved
      const matchContext: ActionContext = {
        category: 'shell_exec',
        tool: 'bash_exec',
        command: 'npm run lint',
        projectPath: workspacePath,
      };
      const matchResult = evaluatePolicy(matchContext, config, {
        rememberedRules: rules,
        projectId: 'proj-1',
      });
      expect(matchResult.allowed).toBe(true);
      expect(matchResult.ruleMatched).toBe('rule-1');

      // 2. Different project -> not auto-approved
      const diffProjResult = evaluatePolicy(matchContext, config, {
        rememberedRules: rules,
        projectId: 'proj-2',
      });
      expect(diffProjResult.allowed).toBe(false);

      // 3. Rule matching an action on NEVER auto-approve list -> NEVER auto-approved!
      const dangerousRule: RememberedRule = {
        id: 'rule-danger',
        projectId: 'proj-1',
        tool: 'delete_file',
        pattern: 'C:/Windows',
        createdAt: Date.now(),
      };
      const dangerousContext: ActionContext = {
        category: 'file_delete',
        tool: 'delete_file',
        targetPath: 'C:/Windows/important.sys',
        projectPath: workspacePath,
        isOutsideWorkspace: true,
      };
      const dangerousResult = evaluatePolicy(dangerousContext, config, {
        rememberedRules: [dangerousRule],
        projectId: 'proj-1',
      });
      expect(dangerousResult.allowed).toBe(false);
      expect(dangerousResult.requiresHuman).toBe(true);
    });
  });
});
