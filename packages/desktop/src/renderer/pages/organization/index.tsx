/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import OrganizationCanvasView from './OrganizationCanvasView';
import OrgChatView from './components/OrgChatView';
import { useOrgStore } from './store/useOrgStore';

export const OrganizationPage: React.FC = () => {
  const { orgViewMode } = useOrgStore();

  if (orgViewMode === 'canvas') {
    return <OrganizationCanvasView />;
  }

  return <OrgChatView />;
};

export default OrganizationPage;
export { OrganizationCanvasView, OrgChatView };
export * from './types';
