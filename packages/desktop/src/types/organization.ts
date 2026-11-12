/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type OrgScope = 'workplace' | 'organization';

export type OrgNodeStatus = 'working' | 'department_standby' | 'queued_next' | 'recently_finished' | 'idle' | 'dormant';

export type OrgAgentRole =
  | 'ceo'
  | 'chief_of_staff'
  | 'department_head'
  | 'project_manager'
  | 'team_lead'
  | 'hr_coordinator'
  | 'specialist';

export interface OrgAgentModelConfig {
  providerId?: string;
  modelId: string;
  modelName?: string;
}

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
  /** Persistent local disk directory bound to this entity (if any). */
  workspacePath?: string | null;
  /** Specific AI model assigned to this agent */
  model?: OrgAgentModelConfig;
  /** Custom system prompt or instructions for this role */
  systemPrompt?: string;
  /** Professional skills and capabilities of this agent */
  skills?: string[];
}

export interface OrgTeamNode {
  id: string;
  departmentId: string;
  name: string;
  teamLeadAgent: OrgAgentMember;
  hrCoordinatorAgent: OrgAgentMember;
  specialistMembers: OrgAgentMember[];
  /** Flat team membership (includes leads, HR and specialists). */
  members?: OrgAgentMember[];
  linkedProjectId?: string;
  linkedProjectName?: string;
  lastActiveAt: number | null;
  status: OrgNodeStatus;
  description?: string;
  /** Persistent local disk directory bound to this team. */
  workspacePath?: string | null;
}

export interface OrgDepartmentNode {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  order?: number;
  parentDepartmentId: string | null;
  departmentCeoAgent: OrgAgentMember;
  /** Default project manager for this department (pmAgentId === pmAgent.id). */
  pmAgent?: OrgAgentMember;
  pmAgentId?: string;
  teams: OrgTeamNode[];
  subDepartmentIds?: string[];
  linkedProjects: Array<{ id: string; name: string; path?: string }>;
  cronSchedule?: { id: string; schedule: string; taskDirective: string; enabled: boolean };
  lastActiveAt: number | null;
  status: OrgNodeStatus;
  description?: string;
  /** Persistent local disk directory bound to this department. */
  workspacePath?: string | null;
}

export interface RootCEO {
  id: string;
  name: string;
  parentId: null;
  ceoAgent: OrgAgentMember;
  chiefOfStaffAgent?: OrgAgentMember;
  lastActiveAt: number | null;
  status: OrgNodeStatus;
  /** Persistent local disk directory bound to the root organization. */
  workspacePath?: string | null;
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
  teamIds: string[];
  /** IDs of agents from the global member pool assigned to this project. */
  memberIds?: string[];
  goal?: string;
  description?: string;
  context?: { repos?: string[]; skills?: string[]; notes?: string };
  status: 'active' | 'dormant' | 'done';
  path?: string;
  /** Persistent local disk directory bound to this project (canonical folder path). */
  workspacePath?: string | null;
}

export interface OrgStorageBundle {
  hierarchy: OrgHierarchy;
  projects: OrgProject[];
  members: OrgAgentMember[];
  cronJobs: OrgCronJob[];
  conversations?: OrgConversation[];
  activeScope?: OrgScope;
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
  /** Chat belongs to exactly one project. */
  projectId?: string;
  /** Optional team that handled the chat. */
  teamId?: string;
  /** Optional agent that handled the chat. */
  agentId?: string;
  /** Underlying backend conversation ID for conversational continuity across turns. */
  backendConversationId?: string;
  type: 'ceo_directive' | 'dept_handoff' | 'team_execution' | 'agent_direct';
  sourceNodeId: string;
  targetNodeId: string;
  targetAgentId?: string;
  targetRole?: OrgAgentRole | string;
  targetAgentName?: string;
  targetAgentModel?: OrgAgentModelConfig;
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
