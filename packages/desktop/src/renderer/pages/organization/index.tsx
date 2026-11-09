/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import OrganizationCanvasView from './OrganizationCanvasView';
import OrgChatView from './components/OrgChatView';
import { OrgMasterFolderModal } from './components/OrgMasterFolderModal';
import { useOrgStore } from './store/useOrgStore';

export const OrganizationPage: React.FC = () => {
  const { orgViewMode, hierarchy } = useOrgStore();
  const [masterModalDismissed, setMasterModalDismissed] = useState(false);

  const shouldShowMasterModal = !hierarchy.rootCeo.workspacePath && !masterModalDismissed;

  return (
    <>
      {orgViewMode === 'canvas' ? <OrganizationCanvasView /> : <OrgChatView />}
      <OrgMasterFolderModal
        visible={shouldShowMasterModal}
        onClose={() => setMasterModalDismissed(true)}
        mandatory={true}
      />
    </>
  );
};

export default OrganizationPage;
export { OrganizationCanvasView, OrgChatView };
export * from './types';
