/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NavigateFunction, NavigateOptions } from 'react-router-dom';

/**
 * Module-level handle to React Router's `navigate`, registered once by a
 * component mounted inside the Router (see `Layout`). This lets code that runs
 * *outside* the Router context — e.g. the globally-mounted FeedbackReportModal,
 * which lives above `<Router>` in the provider tree — trigger navigation
 * without calling `useNavigate()` during render (which would throw
 * "useNavigate() may be used only in the context of a <Router>").
 */
let navigateRef: NavigateFunction | null = null;

export const setGlobalNavigate = (navigate: NavigateFunction | null): void => {
  navigateRef = navigate;
};

/**
 * Navigate to a path from anywhere, including outside the Router tree. No-op
 * (with a console warning) if the Router hasn't mounted yet — callers treat
 * navigation as best-effort rather than a hard dependency.
 */
export const globalNavigate = (to: string, options?: NavigateOptions): void => {
  if (!navigateRef) {
    console.warn('[navigation] globalNavigate called before Router mounted; ignoring.');
    return;
  }
  navigateRef(to, options);
};

export const routeLoaders = {
  guid: () => import('@renderer/pages/guid'),
  conversation: () => import('@renderer/pages/conversation'),
  team: () => import('@renderer/pages/team'),
  organization: () => import('@renderer/pages/organization'),
  approvals: () => import('@renderer/pages/approvals/ApprovalsInboxPage'),
  pipeline: () => import('@renderer/pages/pipeline/PipelineTimelinePage'),
  costs: () => import('@renderer/pages/costs/CostsPage'),
  today: () => import('@renderer/pages/today/TodayPage'),
  scheduled: () => import('@renderer/pages/cron/ScheduledTasksPage'),
  scheduledDetail: () => import('@renderer/pages/cron/ScheduledTasksPage/TaskDetailPage'),
  assistants: () => import('@renderer/pages/settings/AssistantSettings'),
  settingsSider: () => import('@renderer/pages/settings/components/SettingsSider'),
  settingsAgent: () => import('@renderer/pages/settings/AgentSettings'),
  settingsAgentRepair: () => import('@renderer/pages/settings/AgentSettings/AgentRepairPage'),
  settingsModel: () => import('@renderer/pages/settings/ModeSettings'),
  settingsGateway: () => import('@renderer/pages/settings/GatewaySettings'),
  settingsSkills: () => import('@renderer/pages/settings/SkillsSettings/SkillsHubSettings'),
  settingsSkillDetail: () => import('@renderer/pages/settings/SkillsSettings/SkillDetailPage'),
  settingsTools: () => import('@renderer/pages/settings/ToolsSettings'),
  settingsRules: () => import('@renderer/pages/settings/RememberedRulesSettings'),
  settingsAppearance: () => import('@renderer/pages/settings/AppearanceSettings'),
  settingsWebui: () => import('@renderer/pages/settings/WebuiSettings'),
  settingsPet: () => import('@renderer/pages/settings/PetSettings'),
  settingsArchived: () => import('@renderer/pages/settings/ArchivedSettings'),
  settingsSystem: () => import('@renderer/pages/settings/SystemSettings'),
  settingsExt: () => import('@renderer/pages/settings/ExtensionSettingsPage'),
} as const;

export type RouteLoaderKey = keyof typeof routeLoaders;

const preloadedRoutes = new Set<RouteLoaderKey>();

/**
 * Eagerly load a lazy route's JS chunk once, ignoring failures so preloading
 * never disrupts navigation.
 */
export const preloadRoute = (key: RouteLoaderKey): void => {
  if (preloadedRoutes.has(key)) return;
  preloadedRoutes.add(key);
  void routeLoaders[key]().catch(() => {
    preloadedRoutes.delete(key);
  });
};

/**
 * Preload the route chunk(s) corresponding to a target path.
 */
export const preloadRouteForPath = (path: string): void => {
  if (path.startsWith('/organization')) {
    preloadRoute('organization');
  } else if (path.startsWith('/team/')) {
    preloadRoute('team');
  } else if (path.startsWith('/conversation/')) {
    preloadRoute('conversation');
  } else if (path.startsWith('/guid')) {
    preloadRoute('guid');
  } else if (path.startsWith('/approvals')) {
    preloadRoute('approvals');
  } else if (path.startsWith('/scheduled')) {
    preloadRoute('scheduled');
  } else if (path.startsWith('/assistants')) {
    preloadRoute('assistants');
  } else if (path.startsWith('/costs')) {
    preloadRoute('costs');
  } else if (path.startsWith('/today')) {
    preloadRoute('today');
  } else if (path.startsWith('/pipeline')) {
    preloadRoute('pipeline');
  } else if (path.startsWith('/settings')) {
    preloadRoute('settingsSider');
    if (path.startsWith('/settings/model')) preloadRoute('settingsModel');
    else if (path.startsWith('/settings/gateway')) preloadRoute('settingsGateway');
    else if (path.startsWith('/settings/skills')) preloadRoute('settingsSkills');
    else if (path.startsWith('/settings/tools')) preloadRoute('settingsTools');
    else if (path.startsWith('/settings/appearance')) preloadRoute('settingsAppearance');
    else if (path.startsWith('/settings/system') || path.startsWith('/settings/about')) preloadRoute('settingsSystem');
    else preloadRoute('settingsAgent');
  }
};

let idlePreloadScheduled = false;

/**
 * Schedule background preloading of the most frequently visited route chunks
 * once the initial view has settled.
 */
export const scheduleIdleRoutePreloads = (): void => {
  if (idlePreloadScheduled || typeof window === 'undefined') return;
  idlePreloadScheduled = true;

  const run = () => {
    const keys: RouteLoaderKey[] = [
      'guid',
      'conversation',
      'team',
      'organization',
      'settingsSider',
      'settingsAgent',
      'approvals',
    ];
    for (const key of keys) {
      preloadRoute(key);
    }
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 2500 });
  } else {
    window.setTimeout(run, 1200);
  }
};
