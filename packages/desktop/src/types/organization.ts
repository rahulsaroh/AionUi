/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type OrgScope = 'workplace' | 'organization';

export type OrgNodeStatus =
  | 'working'
  | 'department_standby'
  | 'queued_next'
  | 'recently_finished'
  | 'idle'
  | 'dormant';

export type OrgAgentRole =
  | 'ceo'
  | 'chief_of_staff'
  | 'department_head'
  | 'team_lead'
  | 'hr_coordinator'
  | 'specialist';

export interface OrgAgentMember {
  id: string;
  canonicalAgentId: string;
  name: string;
  role: OrgAgentRole | string;
  title?: string;
  icon?: string;
  assistant_backend?: string;
  assignedTeamIds: string[];
  lastActiveAt: number | null;
  status: OrgNodeStatus;
  busyInDepartmentId?: string | null;
  busyInDepartmentName?: string | null;
}

export interface OrgTeamNode {
  id: string;
  departmentId: string;
  name: string;
  teamLeadAgent: OrgAgentMember;
  hrCoordinatorAgent: OrgAgentMember;
  specialistMembers: OrgAgentMember[];
  linkedProjectId?: string;
  linkedProjectName?: string;
  lastActiveAt: number | null;
  status: OrgNodeStatus;
  description?: string;
}

export interface OrgDepartmentNode {
  id: string;
  name: string;
  parentDepartmentId: string | null;
  departmentCeoAgent: OrgAgentMember;
  teams: OrgTeamNode[];
  subDepartmentIds?: string[];
  linkedProjects: Array<{ id: string; name: string; path?: string }>;
  cronSchedule?: { id: string; schedule: string; taskDirective: string; enabled: boolean };
  lastActiveAt: number | null;
  status: OrgNodeStatus;
  description?: string;
}

export interface RootCEO {
  id: string;
  name: string;
  parentId: null;
  ceoAgent: OrgAgentMember;
  chiefOfStaffAgent?: OrgAgentMember;
  lastActiveAt: number | null;
  status: OrgNodeStatus;
}

export interface OrgHierarchy {
  rootCeo: RootCEO;
  departments: OrgDepartmentNode[];
  lastUpdated: number;
}

export interface OrgProject {
  id: string;
  name: string;
  departmentId: string;
  teamId?: string;
  description?: string;
  status?: 'active' | 'completed' | 'queued';
  path?: string;
}

export interface OrgConversationMessage {
  id: string;
  sender: string;
  role: string;
  content: string;
  timestamp: number;
}

export interface OrgConversation {
  id: string;
  title: string;
  type: 'ceo_directive' | 'dept_handoff' | 'team_execution';
  sourceNodeId: string;
  targetNodeId: string;
  timestamp: number;
  summary?: string;
  messages: OrgConversationMessage[];
}

export interface OrgCronJob {
  id: string;
  departmentId: string;
  name: string;
  cronExpression: string;
  taskDirective: string;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
}

export interface OrgDelegationPayload {
  directiveId: string;
  fromNodeId: string;
  toNodeId: string;
  directive: string;
  projectId?: string;
  depth: number;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  contextSummary?: string;
}

export const MAX_DELEGATION_DEPTH = 6;
