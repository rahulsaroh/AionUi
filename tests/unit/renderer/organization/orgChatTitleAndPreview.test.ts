/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { getLastMessagePreview } from '@/renderer/components/layout/Sider/SiderChatRow';
import { computeAutoTitle } from '@/renderer/pages/organization/utils/orgCoherence';
import type { OrgConversation } from '@/types/organization';

describe('Step 1 Unit Tests: Auto-Titling and Message Previews', () => {
  describe('computeAutoTitle', () => {
    it('auto-titles from first user message up to 40 characters trimmed', () => {
      const prompt = '   Implement authentication API with JWT tokens and refresh mechanisms   ';
      const title = computeAutoTitle(prompt, 'New chat');
      expect(title).toBe('Implement authentication API with JWT to');
      expect(title?.length).toBe(40);
    });

    it('does not auto-title if conversation already has a custom title', () => {
      const prompt = 'Another follow-up message';
      const title = computeAutoTitle(prompt, 'Existing Chat Title');
      expect(title).toBeUndefined();
    });

    it('auto-titles when title is empty or undefined', () => {
      expect(computeAutoTitle('Short prompt', '')).toBe('Short prompt');
      expect(computeAutoTitle('Short prompt', undefined)).toBe('Short prompt');
    });
  });

  describe('getLastMessagePreview', () => {
    it('returns empty string when conversation has no messages', () => {
      const conv: OrgConversation = {
        id: 'conv-1',
        title: 'Test',
        type: 'team_execution',
        sourceNodeId: 'node-1',
        targetNodeId: 'node-1',
        timestamp: Date.now(),
        messages: [],
      };
      expect(getLastMessagePreview(conv)).toBe('');
    });

    it('returns last non-system message single-line text', () => {
      const conv: OrgConversation = {
        id: 'conv-1',
        title: 'Test',
        type: 'team_execution',
        sourceNodeId: 'node-1',
        targetNodeId: 'node-1',
        timestamp: Date.now(),
        messages: [
          { id: '1', sender: 'User', role: 'user', content: 'First message', timestamp: 1 },
          { id: '2', sender: 'Agent', role: 'assistant', content: 'Line 1\nLine 2', timestamp: 2 },
          { id: '3', sender: 'System', role: 'system', content: 'System notice', timestamp: 3 },
        ],
      };
      expect(getLastMessagePreview(conv)).toBe('Line 1 Line 2');
    });

    it('filters out engine status markers', () => {
      const conv: OrgConversation = {
        id: 'conv-1',
        title: 'Test',
        type: 'team_execution',
        sourceNodeId: 'node-1',
        targetNodeId: 'node-1',
        timestamp: Date.now(),
        messages: [
          { id: '1', sender: 'User', role: 'user', content: 'User question', timestamp: 1 },
          {
            id: '2',
            sender: 'CEO',
            role: 'assistant',
            content: 'Executive Directive Completed: "hi" executed through ...',
            timestamp: 2,
          },
        ],
      };
      expect(getLastMessagePreview(conv)).toBe('User question');
    });
  });
});
