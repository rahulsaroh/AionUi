/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  generateHandbookContent,
  matchRoleTemplate,
  ROLE_TEMPLATES,
  HANDBOOK_HEADER_COMMENT,
  LEARNED_SKILLS_MARKER_START,
  LEARNED_SKILLS_MARKER_END,
} from '@/process/services/memberHandbook/handbookTemplates';

describe('Handbook Templates & Generation', () => {
  it('matches all specified roles correctly', () => {
    expect(matchRoleTemplate('Android tester').roleTitle).toBe('Android Tester');
    expect(matchRoleTemplate('android-tester').roleTitle).toBe('Android Tester');
    expect(matchRoleTemplate('Flutter developer').roleTitle).toBe('Flutter Developer');
    expect(matchRoleTemplate('Senior UI/UX designer').roleTitle).toBe('UI/UX Designer');
    expect(matchRoleTemplate('Video editor').roleTitle).toBe('Video Editor');
    expect(matchRoleTemplate('AI Researcher').roleTitle).toBe('Researcher');
    expect(matchRoleTemplate('Project manager').roleTitle).toBe('Project Manager');
    expect(matchRoleTemplate('QA reviewer').roleTitle).toBe('QA Reviewer');
  });

  it('falls back to generic template for unknown roles', () => {
    expect(matchRoleTemplate('Quantum Physicist').roleTitle).toBe('Teammate');
    expect(matchRoleTemplate('').roleTitle).toBe('Teammate');
    expect(matchRoleTemplate(undefined).roleTitle).toBe('Teammate');
  });

  it('generates markdown with required fixed headings and comment markers', () => {
    const content = generateHandbookContent({
      memberName: 'android tester',
      role: 'Android tester',
    });

    expect(content.startsWith(HANDBOOK_HEADER_COMMENT)).toBe(true);
    expect(content).toContain('# Employee Handbook: android tester');
    expect(content).toContain('## Identity & Role');
    expect(content).toContain('## Talents');
    expect(content).toContain('## Working Methodology');
    expect(content).toContain('## Rules');
    expect(content).toContain('### Do');
    expect(content).toContain("### Don't");
    expect(content).toContain('## Output Standards & Self-Check Checklist');
    expect(content).toContain('Before completing your answer or task, verify:');
    expect(content).toContain('## Knowledge');
    expect(content).toContain('### Assigned Repositories');
    expect(content).toContain('### Notes');
    expect(content).toContain('## Lessons Learned');
    expect(content).toContain(LEARNED_SKILLS_MARKER_START);
    expect(content).toContain(LEARNED_SKILLS_MARKER_END);
  });

  it('includes assigned repositories when provided', () => {
    const content = generateHandbookContent({
      memberName: 'Flutter Lead',
      role: 'Flutter developer',
      assignedRepos: [
        { repoName: 'mobile-app', ref: 'main', commit: 'abc1234' },
        { repoName: 'design-tokens', ref: 'v2' },
      ],
    });

    expect(content).toContain('- **mobile-app** (ref: main) [commit: abc1234]');
    expect(content).toContain('- **design-tokens** (ref: v2)');
  });

  it('seeds from existing prompt when provided', () => {
    const content = generateHandbookContent({
      memberName: 'QA Lead',
      role: 'QA reviewer',
      seedPrompt: 'You always test with strict security headers.',
    });

    expect(content).toContain('You always test with strict security headers.');
    expect(content).toContain(ROLE_TEMPLATES['qa-reviewer'].identityAndRole);
  });

  it('preserves customContent when provided', () => {
    const custom = '# Custom Handbook\nTotally custom text';
    const content = generateHandbookContent({
      memberName: 'Custom Member',
      customContent: custom,
    });

    expect(content).toBe(custom);
  });
});
