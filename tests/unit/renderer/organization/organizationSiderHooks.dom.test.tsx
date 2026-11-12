/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OrganizationSiderContent from '@/renderer/components/layout/Sider/OrganizationSiderContent';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue || _key,
  }),
}));

vi.mock('@/renderer/pages/organization/store/useOrgStore', () => ({
  useOrgStore: () => ({
    hierarchy: {
      rootCeo: {
        id: 'root-ceo',
        name: 'Root CEO',
        parentId: null,
        ceoAgent: {
          id: 'agent-ceo',
          canonicalAgentId: 'canonical-ceo',
          name: 'Dr. Evelyn Vance',
          role: 'ceo',
          assignedTeamIds: [],
          lastActiveAt: null,
          status: 'idle',
        },
        lastActiveAt: null,
        status: 'idle',
      },
      departments: [],
      lastUpdated: Date.now(),
    },
    projects: [],
    conversations: [],
    cronJobs: [],
    nodeStatuses: {},
    updateNodeStatus: vi.fn(),
    addOrgConversation: vi.fn(),
    addDepartment: vi.fn(),
    updateDepartment: vi.fn(),
    addSubTeam: vi.fn(),
    addOrgProject: vi.fn(),
    addTeamMember: vi.fn(),
    updateRootCeo: vi.fn(),
    selectedDepartmentId: null,
    selectedTeamId: null,
    selectedProjectId: null,
    setSelectedDepartment: vi.fn(),
    setSelectedTeam: vi.fn(),
    setSelectedProject: vi.fn(),
    clearOrgSelection: vi.fn(),
    orgViewMode: 'canvas',
    setOrgViewMode: vi.fn(),
    selectedConversationId: null,
    setSelectedConversationId: vi.fn(),
  }),
}));

describe('OrganizationSiderContent Hooks and Render Stability', () => {
  it('toggles collapsed true and false without throwing a React hooks error', () => {
    const tooltipProps = { mini: true } as any;

    const { rerender } = render(
      <MemoryRouter>
        <OrganizationSiderContent collapsed={false} siderTooltipProps={tooltipProps} />
      </MemoryRouter>
    );

    // Toggle to collapsed=true
    expect(() => {
      rerender(
        <MemoryRouter>
          <OrganizationSiderContent collapsed={true} siderTooltipProps={tooltipProps} />
        </MemoryRouter>
      );
    }).not.toThrow();

    // Toggle back to collapsed=false
    expect(() => {
      rerender(
        <MemoryRouter>
          <OrganizationSiderContent collapsed={false} siderTooltipProps={tooltipProps} />
        </MemoryRouter>
      );
    }).not.toThrow();
  });
});
