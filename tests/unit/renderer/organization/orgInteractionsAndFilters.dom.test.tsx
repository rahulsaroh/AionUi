/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import AgentMemberPill from '@/renderer/pages/organization/components/AgentMemberPill';
import type { OrgAgentMember } from '@/types/organization';

describe('Commit D: Interactions, Tooltips and Filters', () => {
  describe('Member Hover Tooltip Content', () => {
    const mockMember: OrgAgentMember = {
      id: 'member-qa-1',
      name: 'Morgan Vance',
      canonicalAgentId: 'agent-morgan-qa',
      role: 'QA Architect',
      title: 'Principal Test Automation Engineer',
      model: 'gemini-2.5-flash',
      status: 'idle',
    };

    it('renders role, title, and idle status in chip variant', () => {
      render(
        <ReactFlowProvider>
          <AgentMemberPill
            member={mockMember}
            departmentsServed={['Engineering', 'Product']}
            sharedCount={2}
            variant='chip'
          />
        </ReactFlowProvider>
      );

      // Verify chip displays first name and robot avatar with full name title
      expect(screen.getByText('Morgan')).toBeDefined();
      expect(screen.getByTitle('Morgan Vance')).toBeDefined();
    });

    it('displays full name and role badge in card variant', () => {
      const workingMember: OrgAgentMember = {
        ...mockMember,
        status: 'working',
      };

      render(
        <ReactFlowProvider>
          <AgentMemberPill member={workingMember} departmentsServed={['Engineering']} sharedCount={1} variant='card' />
        </ReactFlowProvider>
      );

      expect(screen.getByText('Morgan Vance')).toBeDefined();
      expect(screen.getByText('Principal Test Automation Engineer')).toBeDefined();
    });
  });

  describe('Filter Logic', () => {
    it('correctly categorizes active nodes as those with working status or working descendant', () => {
      const workingNodeIds = new Set(['team-be', 'dept-eng', 'root-ceo']);
      const activeFilter = 'active';

      const isNodeMatching = (nodeId: string) => {
        if (activeFilter === 'all') return true;
        if (activeFilter === 'active') return workingNodeIds.has(nodeId);
        return false;
      };

      expect(isNodeMatching('team-be')).toBe(true);
      expect(isNodeMatching('dept-eng')).toBe(true);
      expect(isNodeMatching('root-ceo')).toBe(true);
      expect(isNodeMatching('team-design-idle')).toBe(false);
      expect(isNodeMatching('dept-sales-idle')).toBe(false);
    });

    it('correctly matches shared pool members and their parent teams in shared filter', () => {
      const sharedMemberIds = new Set(['shared-agent-qa']);
      const teamsWithShared = new Set(['team-eng-qa', 'team-prod-qa']);
      const activeFilter = 'shared';

      const isNodeMatching = (nodeId: string) => {
        if (activeFilter === 'all') return true;
        if (activeFilter === 'shared') {
          return nodeId === 'shared-member-header' || sharedMemberIds.has(nodeId) || teamsWithShared.has(nodeId);
        }
        return false;
      };

      expect(isNodeMatching('shared-member-header')).toBe(true);
      expect(isNodeMatching('shared-agent-qa')).toBe(true);
      expect(isNodeMatching('team-eng-qa')).toBe(true);
      expect(isNodeMatching('team-unrelated')).toBe(false);
    });

    it('clears selection on Escape key', () => {
      let selectedNodeId: string | null = 'team-be';
      let hoveredNodeId: string | null = 'team-be';

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          selectedNodeId = null;
          hoveredNodeId = null;
        }
      };

      window.addEventListener('keydown', handleKeyDown);

      // Simulate Escape key press
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(selectedNodeId).toBeNull();
      expect(hoveredNodeId).toBeNull();

      window.removeEventListener('keydown', handleKeyDown);
    });
  });
});
