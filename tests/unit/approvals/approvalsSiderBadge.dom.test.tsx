/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SiderPrimaryNav } from '@/renderer/components/layout/Sider/SiderNav/SiderPrimaryNav';
import { addInboxItem, clearInboxItems } from '@/common/autonomy/approvalsInboxStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue || _key,
  }),
}));

vi.mock('@/renderer/pages/team/hooks/useTeamList', () => ({
  useTeamList: () => ({ teams: [] }),
}));

vi.mock('@/renderer/pages/organization/store/useOrgTelemetryStore', () => ({
  useOrgTelemetryStore: () => ({ activeHandoffs: {} }),
}));

describe('SiderPrimaryNav Approvals Badge Count', () => {
  beforeEach(() => {
    clearInboxItems();
  });

  it('renders badge count with exact pending number', () => {
    addInboxItem({
      id: 'item-1',
      callId: 'call-1',
      conversationId: 'conv-1',
      title: 'Action 1',
      options: [],
      createdAt: Date.now(),
    });
    addInboxItem({
      id: 'item-2',
      callId: 'call-2',
      conversationId: 'conv-2',
      title: 'Action 2',
      options: [],
      createdAt: Date.now(),
    });

    render(
      <MemoryRouter>
        <SiderPrimaryNav
          isMobile={false}
          collapsed={false}
          siderTooltipProps={{}}
        />
      </MemoryRouter>
    );

    const badge = screen.getByTestId('sider-tab-badge-approvals');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('2');
  });

  it('hides badge when pending count is 0', () => {
    render(
      <MemoryRouter>
        <SiderPrimaryNav
          isMobile={false}
          collapsed={false}
          siderTooltipProps={{}}
        />
      </MemoryRouter>
    );

    expect(screen.queryByTestId('sider-tab-badge-approvals')).not.toBeInTheDocument();
  });
});
