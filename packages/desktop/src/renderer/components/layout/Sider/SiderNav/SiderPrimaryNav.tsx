/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@arco-design/web-react';
import { FolderClose, MessageOne, NetworkTree, Peoples } from '@icon-park/react';
import classNames from 'classnames';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { isMacOS } from '@renderer/utils/platform';
import { useTeamList } from '@/renderer/pages/team/hooks/useTeamList';
import { useOrgTelemetryStore } from '@/renderer/pages/organization/store/useOrgTelemetryStore';

interface SiderPrimaryNavProps {
  isMobile: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onSessionClick?: () => void;
}

export const SiderPrimaryNav: React.FC<SiderPrimaryNavProps> = ({
  isMobile,
  collapsed,
  siderTooltipProps,
  onSessionClick,
}) => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const isMac = isMacOS();
  const mod = isMac ? '⌘' : 'Ctrl+';
  const { teams = [] } = useTeamList();
  const { activeHandoffs } = useOrgTelemetryStore();

  const isOrgActive = location.pathname.startsWith('/organization');
  const isTeamActive = location.pathname.startsWith('/team/');
  const isChatActive =
    location.pathname.startsWith('/conversation/') || location.pathname === '/guid' || location.pathname === '/';

  const inFlightHandoffsCount = Object.keys(activeHandoffs).length;

  const tabs = [
    {
      id: 'teams',
      label: t('team.sider.teamsTab', { defaultValue: 'Teams' }),
      icon: Peoples,
      isActive: isTeamActive,
      shortcut: `${mod}1`,
      badge: teams.length > 0 ? teams.length : undefined,
      onClick: () => {
        onSessionClick?.();
        const storedLastTeamId = localStorage.getItem('team:last-active-id');
        if (storedLastTeamId && teams.some((t) => t.id === storedLastTeamId)) {
          void navigate(`/team/${storedLastTeamId}`);
        } else if (teams.length > 0) {
          void navigate(`/team/${teams[0].id}`);
        } else {
          void navigate('/guid');
        }
      },
    },
    {
      id: 'projects',
      label: t('conversation.history.projectsSection', { defaultValue: 'Projects' }),
      icon: FolderClose,
      isActive: false, // Projects section is grouped in sidebar history
      shortcut: `${mod}2`,
      onClick: () => {
        onSessionClick?.();
        // Focus or scroll to projects section
        const projEl = document.querySelector('[data-section="projects"]');
        if (projEl) {
          projEl.scrollIntoView({ behavior: 'smooth' });
        }
      },
    },
    {
      id: 'conversations',
      label: t('conversation.history.conversationsSection', { defaultValue: 'Conversations' }),
      icon: MessageOne,
      isActive: isChatActive,
      shortcut: `${mod}3`,
      onClick: () => {
        onSessionClick?.();
        void navigate('/guid');
      },
    },
    {
      id: 'organization',
      label: t('team.organization.tab', { defaultValue: 'Organization' }),
      icon: NetworkTree,
      isActive: isOrgActive,
      shortcut: `${mod}4`,
      badge: inFlightHandoffsCount > 0 ? inFlightHandoffsCount : undefined,
      onClick: () => {
        onSessionClick?.();
        void navigate('/organization');
      },
    },
  ];

  if (collapsed) {
    return (
      <div className='flex flex-col gap-2px w-full'>
        {tabs.map((tab) => {
          const IconComp = tab.icon;
          return (
            <Tooltip key={tab.id} {...siderTooltipProps} content={`${tab.label} (${tab.shortcut})`} position='right'>
              <div
                data-testid={`sider-tab-${tab.id}`}
                className={classNames(
                  'w-full h-34px flex items-center justify-center cursor-pointer transition-colors rd-8px text-t-primary relative',
                  tab.isActive ? 'bg-fill-3 text-primary font-semibold' : 'hover:bg-fill-3 active:bg-fill-4'
                )}
                onClick={tab.onClick}
              >
                <IconComp
                  theme='outline'
                  size='18'
                  fill='currentColor'
                  className='block leading-none shrink-0'
                  style={{ lineHeight: 0 }}
                />
                {tab.badge && <span className='size-5px rounded-full bg-cyan-400 absolute top-1 right-2' />}
              </div>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  return (
    <div className='flex items-center gap-2px p-2px mx-8px mb-4px rounded-8px bg-fill-1 border border-solid border-[var(--color-border-2)] select-none'>
      {tabs.map((tab) => {
        const IconComp = tab.icon;
        return (
          <Tooltip key={tab.id} {...siderTooltipProps} content={`${tab.label} (${tab.shortcut})`} position='top'>
            <Button
              type='text'
              size='mini'
              data-testid={`sider-tab-${tab.id}`}
              className={classNames(
                '!flex-1 !h-full !py-4px !px-4px flex items-center justify-center gap-4px rounded-6px text-12px font-medium transition-all cursor-pointer border-none',
                tab.isActive
                  ? '!bg-[var(--color-bg-2)] !text-primary shadow-sm !font-semibold'
                  : '!bg-transparent !text-t-secondary hover:!text-t-primary hover:!bg-fill-2'
              )}
              onClick={tab.onClick}
            >
              <IconComp theme='outline' size={14} fill='currentColor' className='shrink-0' />
              <span className='truncate text-11px'>{tab.label}</span>
              {tab.badge && <span className='size-5px rounded-full bg-cyan-400 shrink-0' />}
            </Button>
          </Tooltip>
        );
      })}
    </div>
  );
};

export default React.memo(SiderPrimaryNav);
