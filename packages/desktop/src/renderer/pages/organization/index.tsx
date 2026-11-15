/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Spin } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import TeamPage from '@renderer/pages/team/TeamPage';
import OrganizationCanvasView from './OrganizationCanvasView';
import OrgChatView from './components/OrgChatView';
import { OrgMasterFolderModal } from './components/OrgMasterFolderModal';
import { useOrgStore } from './store/useOrgStore';

export const OrganizationPage: React.FC = () => {
  const { orgViewMode, hierarchy, projects, selectedProjectId, selectedTeamId } = useOrgStore();
  const [masterModalDismissed, setMasterModalDismissed] = useState(false);

  const shouldShowMasterModal = !hierarchy.rootCeo.workspacePath && !masterModalDismissed;

  const activeBackendTeamId = useMemo(() => {
    if (selectedProjectId) {
      const proj = projects.find((p) => p.id === selectedProjectId);
      if (proj?.backendTeamId) return proj.backendTeamId;
    }
    if (selectedTeamId) {
      for (const dept of hierarchy.departments) {
        const team = dept.teams.find((t) => t.id === selectedTeamId);
        if (team?.backendTeamId) return team.backendTeamId;
      }
    }
    return null;
  }, [selectedProjectId, selectedTeamId, projects, hierarchy.departments]);

  const { data: backendTeam, isLoading: isTeamLoading } = useSWR(
    activeBackendTeamId ? `team/${activeBackendTeamId}` : null,
    () => ipcBridge.team.get.invoke({ id: activeBackendTeamId! })
  );

  return (
    <>
      {orgViewMode === 'canvas' ? (
        <OrganizationCanvasView />
      ) : activeBackendTeamId && backendTeam ? (
        <TeamPage key={backendTeam.id} team={backendTeam} />
      ) : activeBackendTeamId && isTeamLoading ? (
        <div className='flex items-center justify-center h-full w-full'>
          <Spin loading />
        </div>
      ) : (
        <OrgChatView />
      )}
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
