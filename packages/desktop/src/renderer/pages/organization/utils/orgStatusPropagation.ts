/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OrgHierarchy, OrgProject, OrgNodeStatus } from '@/types/organization';

export interface OrgPropagationResult {
  /** Node IDs that are either directly working or have a working descendant */
  workingNodeIds: Set<string>;
  /** Node IDs with active error status */
  errorNodeIds: Set<string>;
  /** Node IDs with queued_next status */
  queuedNodeIds: Set<string>;
  /** Node IDs with recently_finished status */
  finishedNodeIds: Set<string>;
  /** Edge IDs along paths from Root CEO down to working members */
  workingEdgeIds: Set<string>;
  /** Total count of working agents */
  activeWorkingCount: number;
  /** Whether simultaneous working paths exceed performance threshold (e.g. 15) */
  exceedsAnimationLimit: boolean;
}

export function computeOrgStatusPropagation(
  hierarchy: OrgHierarchy,
  projects: OrgProject[],
  nodeStatuses: Record<string, OrgNodeStatus>
): OrgPropagationResult {
  const workingNodeIds = new Set<string>();
  const errorNodeIds = new Set<string>();
  const queuedNodeIds = new Set<string>();
  const finishedNodeIds = new Set<string>();
  const workingEdgeIds = new Set<string>();

  const isWorking = (id?: string) => Boolean(id && nodeStatuses[id] === 'working');
  const isError = (id?: string) => Boolean(id && nodeStatuses[id] === 'error');
  const isQueued = (id?: string) => Boolean(id && nodeStatuses[id] === 'queued_next');
  const isFinished = (id?: string) => Boolean(id && nodeStatuses[id] === 'recently_finished');

  let activeWorkingCount = 0;

  // 1. Check Root CEO direct agent status
  const ceoDirectWorking =
    isWorking(hierarchy.rootCeo.id) ||
    isWorking(hierarchy.rootCeo.ceoAgent?.id) ||
    isWorking(hierarchy.rootCeo.ceoAgent?.canonicalAgentId) ||
    isWorking(hierarchy.rootCeo.chiefOfStaffAgent?.id);

  if (ceoDirectWorking) {
    workingNodeIds.add(hierarchy.rootCeo.id);
    activeWorkingCount++;
  }

  // 2. Build map of shared members and their locations
  const sharedMemberLocations: Record<string, string[]> = {};
  hierarchy.departments.forEach((dept) => {
    dept.teams.forEach((team) => {
      team.specialistMembers.forEach((spec) => {
        if (!sharedMemberLocations[spec.canonicalAgentId]) {
          sharedMemberLocations[spec.canonicalAgentId] = [];
        }
        if (!sharedMemberLocations[spec.canonicalAgentId].includes(team.id)) {
          sharedMemberLocations[spec.canonicalAgentId].push(team.id);
        }
      });
    });
  });

  // 3. Scan Departments -> Teams -> Members
  hierarchy.departments.forEach((dept, deptIdx) => {
    let deptHasWorking = false;

    // Department CEO agent
    if (dept.departmentCeoAgent) {
      const dCeo = dept.departmentCeoAgent;
      if (isWorking(dCeo.id) || isWorking(dCeo.canonicalAgentId)) {
        deptHasWorking = true;
        workingNodeIds.add(dCeo.id);
        activeWorkingCount++;
      }
      if (isError(dCeo.id) || isError(dCeo.canonicalAgentId)) errorNodeIds.add(dCeo.id);
      if (isQueued(dCeo.id) || isQueued(dCeo.canonicalAgentId)) queuedNodeIds.add(dCeo.id);
      if (isFinished(dCeo.id) || isFinished(dCeo.canonicalAgentId)) finishedNodeIds.add(dCeo.id);
    }
    if (isWorking(dept.id) || (dept.pmAgentId && isWorking(dept.pmAgentId))) {
      deptHasWorking = true;
      activeWorkingCount++;
    }

    const deptProjects = projects.filter((p) => p.departmentId === dept.id);

    dept.teams.forEach((team) => {
      let teamHasWorking = false;

      // Check Team Lead & HR
      if (team.teamLeadAgent) {
        const lead = team.teamLeadAgent;
        if (isWorking(lead.id) || isWorking(lead.canonicalAgentId)) {
          teamHasWorking = true;
          workingNodeIds.add(lead.id);
          activeWorkingCount++;
        }
        if (isError(lead.id) || isError(lead.canonicalAgentId)) errorNodeIds.add(lead.id);
        if (isQueued(lead.id) || isQueued(lead.canonicalAgentId)) queuedNodeIds.add(lead.id);
        if (isFinished(lead.id) || isFinished(lead.canonicalAgentId)) finishedNodeIds.add(lead.id);
      }

      if (team.hrCoordinatorAgent) {
        const hr = team.hrCoordinatorAgent;
        if (isWorking(hr.id) || isWorking(hr.canonicalAgentId)) {
          teamHasWorking = true;
          workingNodeIds.add(hr.id);
          activeWorkingCount++;
        }
        if (isError(hr.id) || isError(hr.canonicalAgentId)) errorNodeIds.add(hr.id);
        if (isQueued(hr.id) || isQueued(hr.canonicalAgentId)) queuedNodeIds.add(hr.id);
        if (isFinished(hr.id) || isFinished(hr.canonicalAgentId)) finishedNodeIds.add(hr.id);
      }

      if (isWorking(team.id)) {
        teamHasWorking = true;
        activeWorkingCount++;
      }

      // Check Specialist Members (and flat team members)
      const specialists = team.specialistMembers || [];
      const flatMembers = (team.members || []).filter(
        (m) =>
          m.id !== team.teamLeadAgent?.id &&
          m.id !== team.hrCoordinatorAgent?.id &&
          !specialists.some((s) => s.id === m.id)
      );
      const allSpecs = [...specialists, ...flatMembers];

      allSpecs.forEach((member) => {
        const memberWorking = isWorking(member.id) || isWorking(member.canonicalAgentId);
        if (memberWorking) {
          teamHasWorking = true;
          workingNodeIds.add(member.id);
          workingNodeIds.add(`shared-${member.canonicalAgentId}`);
          activeWorkingCount++;

          // If this member is shared across multiple teams, propagate to all those teams and tethers
          const appearances = sharedMemberLocations[member.canonicalAgentId] || [];
          if (appearances.length > 1) {
            appearances.forEach((teamLocId) => {
              workingNodeIds.add(teamLocId);
              workingEdgeIds.add(`tether-${member.canonicalAgentId}->${teamLocId}`);
            });
          }
        }

        if (isError(member.id) || isError(member.canonicalAgentId)) {
          errorNodeIds.add(member.id);
        }
        if (isQueued(member.id) || isQueued(member.canonicalAgentId)) {
          queuedNodeIds.add(member.id);
        }
        if (isFinished(member.id) || isFinished(member.canonicalAgentId)) {
          finishedNodeIds.add(member.id);
        }
      });

      if (teamHasWorking) {
        workingNodeIds.add(team.id);
        deptHasWorking = true;

        // Find project associated with this team
        const linkedProject = deptProjects.find((p) => p.teamIds?.includes(team.id) || team.linkedProjectId === p.id);

        if (linkedProject) {
          workingNodeIds.add(`project-${linkedProject.id}`);
          workingEdgeIds.add(`edge-project-${linkedProject.id}->${team.id}`);
          workingEdgeIds.add(`edge-${dept.id}->project-${linkedProject.id}`);
        } else {
          workingEdgeIds.add(`edge-${dept.id}->${team.id}`);
        }
      }
    });

    if (deptHasWorking) {
      workingNodeIds.add(dept.id);
      workingNodeIds.add(hierarchy.rootCeo.id);
      workingEdgeIds.add(`edge-${hierarchy.rootCeo.id}->${dept.id}`);
    }
  });

  const exceedsAnimationLimit = workingEdgeIds.size > 15;

  return {
    workingNodeIds,
    errorNodeIds,
    queuedNodeIds,
    finishedNodeIds,
    workingEdgeIds,
    activeWorkingCount,
    exceedsAnimationLimit,
  };
}
