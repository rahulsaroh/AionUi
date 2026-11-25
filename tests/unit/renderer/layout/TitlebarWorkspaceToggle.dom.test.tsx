import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platformMocks = vi.hoisted(() => ({
  isElectronDesktopMock: vi.fn(() => true),
  isMacOSMock: vi.fn(() => false),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/conversation/test', search: '', hash: '' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: { conversation: { get: { invoke: vi.fn() } } },
}));
vi.mock('@/common/config/constants', () => ({ TEAM_MODE_ENABLED: false }));
vi.mock('@renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({ default: () => null }));
vi.mock('@renderer/components/layout/Titlebar/MobileConversationBrand', () => ({ default: () => null }));
vi.mock('@renderer/components/layout/WindowControls', () => ({
  default: () => <div data-testid='window-controls' />,
}));
vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({
    isMobile: false,
    rightSiderCollapsed: true,
    setRightSiderCollapsed: vi.fn(),
  }),
}));
vi.mock('@renderer/hooks/context/NavigationHistoryContext', () => ({
  useNavigationHistory: () => null,
}));
vi.mock('@renderer/hooks/context/FeedbackContext', () => ({
  useFeedback: () => ({ openFeedback: vi.fn() }),
}));
vi.mock('@renderer/services/feedback/resolveFeedbackModule', () => ({
  resolveFeedbackModule: () => 'conversation-session',
}));
vi.mock('@renderer/utils/platform', () => ({
  isElectronDesktop: platformMocks.isElectronDesktopMock,
  isMacOS: platformMocks.isMacOSMock,
}));
// Mock useOrgStore to avoid i18n initialization
vi.mock('@/renderer/pages/organization/store/useOrgStore', () => ({
  useOrgStore: () => ({
    activeScope: 'workplace',
    setActiveScope: vi.fn(),
  }),
}));

import Titlebar from '@/renderer/components/layout/Titlebar';

describe('Titlebar right sidebar toggle', () => {
  beforeEach(() => {
    platformMocks.isElectronDesktopMock.mockReturnValue(true);
    platformMocks.isMacOSMock.mockReturnValue(false);
  });

  it('shows the right sidebar toggle on desktop', () => {
    render(<Titlebar workspaceAvailable />);

    const report = screen.getByRole('button', { name: 'conversation.welcome.quickActionFeedback' });
    const rightSidebarToggle = screen.getByRole('button', { name: 'common.expandMore' });

    // The right sidebar toggle should be after the feedback button
    expect(report.nextElementSibling).toBe(rightSidebarToggle);
    expect(rightSidebarToggle.nextElementSibling).toBe(screen.getByTestId('window-controls'));
    expect(screen.queryByText('Synced')).not.toBeInTheDocument();
  });

  it.each([
    { runtime: 'macOS desktop', desktop: true, mac: true },
    { runtime: 'WebUI', desktop: false, mac: false },
  ])('shows the right sidebar toggle on $runtime', ({ desktop, mac }) => {
    platformMocks.isElectronDesktopMock.mockReturnValue(desktop);
    platformMocks.isMacOSMock.mockReturnValue(mac);
    render(<Titlebar workspaceAvailable />);

    const report = screen.getByRole('button', { name: 'conversation.welcome.quickActionFeedback' });
    const rightSidebarToggle = screen.getByRole('button', { name: 'common.expandMore' });

    expect(report.nextElementSibling).toBe(rightSidebarToggle);
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument();
  });

  it('shows the right sidebar toggle regardless of workspaceAvailable prop', () => {
    render(<Titlebar workspaceAvailable={false} />);

    expect(screen.getByRole('button', { name: 'common.expandMore' })).toBeInTheDocument();
  });
});
