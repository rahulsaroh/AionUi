/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { NavigationTab } from '../types';

let currentTab: NavigationTab = 'conversations';
const listeners = new Set<(tab: NavigationTab) => void>();

function setNavTab(tab: NavigationTab) {
  currentTab = tab;
  listeners.forEach((listener) => listener(tab));
}

export function useOrgNavStore() {
  const [tab, setTab] = useState<NavigationTab>(currentTab);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    listeners.add(setTab);
    return () => {
      listeners.delete(setTab);
    };
  }, []);

  // Sync tab from pathname
  useEffect(() => {
    const path = location.pathname;
    if (path === '/organization' || path.startsWith('/organization/')) {
      setNavTab('organization');
    } else if (path.startsWith('/team/')) {
      setNavTab('teams');
    } else {
      setNavTab('conversations');
    }
  }, [location.pathname]);

  const switchTab = (nextTab: NavigationTab) => {
    setNavTab(nextTab);
    if (nextTab === 'organization') {
      void navigate('/organization');
    } else if (nextTab === 'teams') {
      const storedLastTeamId = localStorage.getItem('team:last-active-id');
      if (storedLastTeamId) {
        void navigate(`/team/${storedLastTeamId}`);
      } else {
        // Fallback to guid or first team
        void navigate('/guid');
      }
    } else if (nextTab === 'conversations') {
      void navigate('/guid');
    }
  };

  return {
    activeTab: tab,
    switchTab,
    setNavTab,
  };
}
