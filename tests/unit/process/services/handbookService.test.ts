/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HandbookService,
  sanitizeHandbookFileName,
  computeTokenBudget,
  parseHandbookMarkdown,
  buildCompressedPrompt,
} from '@/process/services/memberHandbook';

describe('HandbookService & Member Handbook Core', () => {
  let testDir: string;
  let service: HandbookService;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'handbook-test-'));
    service = new HandbookService({ handbookDir: testDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Filename sanitization and collision handling', () => {
    it('sanitizes illegal characters in member names', () => {
      expect(sanitizeHandbookFileName('android tester')).toBe('android tester');
      expect(sanitizeHandbookFileName('lead/architect:v1?*')).toBe('lead_architect_v1__');
      expect(sanitizeHandbookFileName('   spaced name... ')).toBe('spaced name');
      expect(sanitizeHandbookFileName('')).toBe('member');
    });

    it('resolves collision by appending (2), (3)', async () => {
      const member1 = await service.create({
        memberKey: 'team:1:m1',
        memberName: 'android tester',
        role: 'Android tester',
      });
      expect(member1.fileName).toBe('android tester.md');

      const member2 = await service.create({
        memberKey: 'team:1:m2',
        memberName: 'android tester',
        role: 'Android tester',
      });
      expect(member2.fileName).toBe('android tester (2).md');

      const member3 = await service.create({
        memberKey: 'team:1:m3',
        memberName: 'android tester',
        role: 'Android tester',
      });
      expect(member3.fileName).toBe('android tester (3).md');
    });
  });

  describe('Lifecycle: Create, Read, Update, Rename, Delete', () => {
    it('creates and reads handbook with generated template', async () => {
      const created = await service.create({
        memberKey: 'team:10:slot-a',
        memberName: 'android tester',
        role: 'Android tester',
      });

      expect(created.memberKey).toBe('team:10:slot-a');
      expect(created.fileName).toBe('android tester.md');
      expect(created.content).toContain('## Working Methodology');

      const readBack = await service.read('team:10:slot-a');
      expect(readBack).not.toBeNull();
      expect(readBack?.content).toBe(created.content);
      expect(readBack?.fileHash).toBe(created.fileHash);
    });

    it('updates handbook and increments history', async () => {
      await service.create({
        memberKey: 'org:agent-1',
        memberName: 'Flutter Lead',
        role: 'Flutter developer',
      });

      const updateRes = await service.update({
        memberKey: 'org:agent-1',
        content: '# Updated Flutter Content\nNew SOP step.',
      });
      expect(updateRes.success).toBe(true);

      const history = await service.listHistory('org:agent-1');
      expect(history.length).toBeGreaterThanOrEqual(2);

      const readBack = await service.read('org:agent-1');
      expect(readBack?.content).toBe('# Updated Flutter Content\nNew SOP step.');
    });

    it('renames member, updates file on disk and preserves history', async () => {
      await service.create({
        memberKey: 'team:5:slot-1',
        memberName: 'junior qa',
        role: 'QA reviewer',
      });

      const renameRes = await service.rename({
        memberKey: 'team:5:slot-1',
        newMemberName: 'senior qa',
      });
      expect(renameRes.newFileName).toBe('senior qa.md');

      // Old file should no longer exist
      await expect(fs.access(path.join(testDir, 'junior qa.md'))).rejects.toThrow();
      // New file should exist
      const stat = await fs.stat(path.join(testDir, 'senior qa.md'));
      expect(stat.isFile()).toBe(true);

      // Read back with memberKey
      const readBack = await service.read('team:5:slot-1');
      expect(readBack?.fileName).toBe('senior qa.md');
      expect(readBack?.memberName).toBe('senior qa');

      // History was preserved
      const history = await service.listHistory('team:5:slot-1');
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].fileName).toBe('senior qa.md');
    });

    it('archives file on delete and removes from mapping', async () => {
      await service.create({
        memberKey: 'team:1:slot-del',
        memberName: 'temp agent',
      });

      const delRes = await service.delete('team:1:slot-del', true);
      expect(delRes.success).toBe(true);

      const readBack = await service.read('team:1:slot-del');
      expect(readBack).toBeNull();

      // Check archive folder
      const archiveDir = path.join(testDir, '.archive');
      const archivedFiles = await fs.readdir(archiveDir);
      expect(archivedFiles.some((f) => f.includes('temp agent.md'))).toBe(true);
    });
  });

  describe('History and Revert (last 20 versions)', () => {
    it('caps history at 20 versions and reverts correctly', async () => {
      await service.create({
        memberKey: 'team:hist:1',
        memberName: 'version tester',
      });

      for (let i = 1; i <= 25; i++) {
        await service.update({
          memberKey: 'team:hist:1',
          content: `# Version ${i} content`,
        });
      }

      const history = await service.listHistory('team:hist:1');
      expect(history.length).toBe(20);

      // Revert to an earlier version in history
      const targetVersion = history[5];
      const reverted = await service.revert('team:hist:1', targetVersion.id);
      expect(reverted.content).toContain('Version');
    });
  });

  describe('Prompt Injection: First message vs Reminder vs Hash Change', () => {
    it('sends full block on first message and one-line reminder on subsequent message', async () => {
      await service.create({
        memberKey: 'team:inj:1',
        memberName: 'android tester',
        role: 'Android tester',
      });

      const firstInjection = await service.getInjectedBlock({
        memberKey: 'team:inj:1',
        conversationId: 'conv-100',
        isFirstMessage: true,
      });

      expect(firstInjection?.isFullBlock).toBe(true);
      expect(firstInjection?.promptBlock).toContain('[EMPLOYEE HANDBOOK: android tester]');
      expect(firstInjection?.promptBlock).toContain('Before you answer, verify:');

      const secondInjection = await service.getInjectedBlock({
        memberKey: 'team:inj:1',
        conversationId: 'conv-100',
        isFirstMessage: false,
      });

      expect(secondInjection?.isFullBlock).toBe(false);
      expect(secondInjection?.promptBlock).toContain('[Employee Handbook Reminder: Follow your active handbook rules');
    });

    it('triggers full block re-injection when file hash changes', async () => {
      await service.create({
        memberKey: 'team:inj:2',
        memberName: 'UI Designer',
        role: 'UI/UX designer',
      });

      // Turn 1
      await service.getInjectedBlock({
        memberKey: 'team:inj:2',
        conversationId: 'conv-200',
        isFirstMessage: true,
      });

      // Turn 2: reminder
      const turn2 = await service.getInjectedBlock({
        memberKey: 'team:inj:2',
        conversationId: 'conv-200',
        isFirstMessage: false,
      });
      expect(turn2?.isFullBlock).toBe(false);

      // External or in-app update
      await service.update({
        memberKey: 'team:inj:2',
        content:
          '# Modified UI Designer Handbook\n## Working Methodology\n1. Brand new SOP step.\n## Rules\n### Do\n- Follow tokens',
      });

      // Turn 3: hash changed, should re-inject full block!
      const turn3 = await service.getInjectedBlock({
        memberKey: 'team:inj:2',
        conversationId: 'conv-200',
        isFirstMessage: false,
      });
      expect(turn3?.isFullBlock).toBe(true);
      expect(turn3?.promptBlock).toContain('[EMPLOYEE HANDBOOK: UI Designer]');
      expect(turn3?.promptBlock).toContain('Brand new SOP step');
    });
  });

  describe('Small-model token budget and compression priority', () => {
    it('computes token budget correctly for small models vs large models', () => {
      expect(computeTokenBudget('gemini-1.5-flash-8b')).toBe(1600);
      expect(computeTokenBudget('claude-3-haiku')).toBe(1000);
      expect(computeTokenBudget('gpt-4o-mini')).toBe(1600);
      expect(computeTokenBudget('claude-3-5-sonnet')).toBe(3000);
      expect(computeTokenBudget(undefined)).toBe(3000);
    });

    it('preserves methodology and rules while truncating notes when budget is tight', () => {
      const parsed = parseHandbookMarkdown(`
## Working Methodology
1. Step A: Critical reproduction
2. Step B: Compose assertions
3. Step C: Logcat capture

## Rules
### Do
- Always use semantic test tags
### Don't
- Never use Thread.sleep

## Knowledge
### Notes
${'Very long verbose domain notes '.repeat(100)}
      `);

      const compressed = buildCompressedPrompt(parsed, 'android tester', 'Android tester', 500);

      // Methodology and Rules MUST be present
      expect(compressed).toContain('Step A: Critical reproduction');
      expect(compressed).toContain('Step B: Compose assertions');
      expect(compressed).toContain('Always use semantic test tags');
      expect(compressed).toContain('Never use Thread.sleep');
      expect(compressed).toContain('Before you answer, verify:');
      // Verbose notes are truncated to fit budget
      expect(compressed.length).toBeLessThan(2500);
    });
  });

  describe('Knowledge Repos Extension Hook', () => {
    it('updates Knowledge section via setKnowledgeSection', async () => {
      await service.create({
        memberKey: 'team:kr:1',
        memberName: 'Flutter Specialist',
        role: 'Flutter developer',
      });

      const res = await service.setKnowledgeSection(
        'team:kr:1',
        [{ repoName: 'frontend-core', ref: 'v1.2.0', commit: 'abc999' }],
        'Verified architecture digest.'
      );
      expect(res.success).toBe(true);

      const readBack = await service.read('team:kr:1');
      expect(readBack?.content).toContain('- **frontend-core** (ref: v1.2.0) [commit: abc999]');
      expect(readBack?.content).toContain('Verified architecture digest.');
    });
  });

  describe('Status checking', () => {
    it('returns not_created for unknown member and created for existing member', async () => {
      const notCreated = await service.getStatus({ memberKey: 'team:unknown:1' });
      expect(notCreated.status).toBe('not_created');
      expect(notCreated.exists).toBe(false);

      await service.create({
        memberKey: 'team:known:1',
        memberName: 'android tester',
      });

      const created = await service.getStatus({ memberKey: 'team:known:1' });
      expect(created.status).toBe('created');
      expect(created.exists).toBe(true);
      expect(created.fileName).toBe('android tester.md');
    });
  });
});
