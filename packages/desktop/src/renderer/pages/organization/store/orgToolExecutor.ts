/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  getOrgStoreSnapshot,
  updateApprovedLineupInStore,
  recordApprovedLineupInStore,
  type ApprovedLineupRecord,
} from './useOrgStore';
import { updateNodeStatus, updateActivityTicker } from './useOrgTelemetryStore';
import { validateOrgFolder } from '../utils/orgPathUtils';
import { createProjectBackendTeam } from './orgBackendTeam';
import type {
  ITeamRunStateResponse,
  ITeamMailboxMessage,
  ITeamTaskItem,
  ITeamSlotWork,
} from '@/common/types/team/teamTypes';
import type { OrgDepartmentNode, OrgProject, OrgAgentMember, OrgNodeStatus } from '@/types/organization';

export interface StructureProposal {
  id?: string;
  departments: Array<{
    name: string;
    folder: string;
    description?: string;
    projects?: Array<{
      name: string;
      folder: string;
      description?: string;
    }>;
  }>;
  suggestedMembers?: Array<{
    name: string;
    role: string;
  }>;
}

type ProposalListener = (proposal: StructureProposal) => void;
const proposalListeners = new Set<ProposalListener>();

export function onStructureProposed(listener: ProposalListener): () => void {
  proposalListeners.add(listener);
  return () => {
    proposalListeners.delete(listener);
  };
}

export function emitStructureProposed(proposal: StructureProposal): void {
  for (const listener of proposalListeners) {
    try {
      listener(proposal);
    } catch (err) {
      console.error('[OrgToolExecutor] Error in proposal listener:', err);
    }
  }
}

export type AskUserPayload = {
  asked: boolean;
  question: string;
  members?: unknown;
  suggestedMembers?: unknown;
  projectId?: string;
  project_id?: string;
};

type AskUserListener = (payload: AskUserPayload) => void;
const askUserListeners = new Set<AskUserListener>();

export function onAskUser(listener: AskUserListener): () => void {
  askUserListeners.add(listener);
  return () => {
    askUserListeners.delete(listener);
  };
}

export function emitAskUser(payload: AskUserPayload): void {
  for (const listener of askUserListeners) {
    try {
      listener(payload);
    } catch (err) {
      console.error('[OrgToolExecutor] Error in ask_user listener:', err);
    }
  }
}

/**
 * Executes an organizational tool call against the renderer store.
 * Returns structured results with created entity IDs.
 */
function isNetworkRefused(err: unknown): boolean {
  if (!err) return false;
  const msg = String(err);
  if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) return true;
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  if (cause?.code === 'ECONNREFUSED' || String(cause).includes('ECONNREFUSED')) return true;
  return false;
}

export async function executeOrgToolInStore(
  tool: string,
  args: Record<string, any>,
  meta?: { role?: string; deptId?: string; projectId?: string; deptWorkspacePath?: string }
): Promise<any> {
  const store = getOrgStoreSnapshot();

  switch (tool) {
    case 'list_org': {
      const depts = store.hierarchy.departments.map((d) => ({
        id: d.id,
        name: d.name,
        workspacePath: d.workspacePath,
        description: d.description,
        projects: store.projects
          .filter((p) => p.departmentId === d.id)
          .map((p) => ({
            id: p.id,
            name: p.name,
            workspacePath: p.workspacePath,
            goal: p.goal,
            memberIds: p.memberIds || [],
          })),
      }));

      const projs = store.projects.map((p) => ({
        id: p.id,
        name: p.name,
        departmentId: p.departmentId,
        workspacePath: p.workspacePath,
        goal: p.goal,
        memberIds: p.memberIds || [],
      }));

      const members = (store.members || []).map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        skills: m.skills,
      }));

      return {
        masterRoot: store.hierarchy.rootCeo.workspacePath || null,
        departments: depts,
        projects: projs,
        members,
        departmentsCount: depts.length,
        projectsCount: projs.length,
        membersCount: members.length,
      };
    }

    case 'create_department': {
      const name = String(args.name || '').trim();
      const folder = String(args.folder || '').trim();
      const description = args.description ? String(args.description) : undefined;

      if (!name || !folder) {
        throw new Error('create_department requires "name" and "folder".');
      }

      // Check duplicate name
      if (store.hierarchy.departments.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`A department with name "${name}" already exists.`);
      }

      const masterRoot = store.hierarchy.rootCeo.workspacePath || (await ipcBridge.org.getMasterRoot()) || undefined;

      if (!masterRoot) {
        throw new Error('Cannot create department: No master root configured (fail closed).');
      }

      const check = await validateOrgFolder(folder, masterRoot, 'department');
      if (!check.valid) {
        throw new Error(`Invalid department folder "${folder}": ${check.error || 'outside root'}`);
      }

      const deptId = `dept-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const resolvedFolder = check.resolvedPath || folder;

      const newDept: OrgDepartmentNode = {
        id: deptId,
        name,
        description,
        workspacePath: resolvedFolder,
        parentDepartmentId: null,
        lastActiveAt: null,
        teams: [],
        linkedProjects: [],
        departmentCeoAgent: {
          id: `agent-${deptId}`,
          canonicalAgentId: `c-${deptId}`,
          name: `${name} Head`,
          role: 'department_head',
          status: 'idle',
          assignedTeamIds: [],
          workspacePath: resolvedFolder,
          lastActiveAt: null,
        },
        status: 'idle',
      };

      const nextHierarchy = {
        ...store.hierarchy,
        departments: [...store.hierarchy.departments, newDept],
        lastUpdated: Date.now(),
      };

      store.hierarchy = nextHierarchy;
      try {
        localStorage.setItem('aionui:org-hierarchy', JSON.stringify(nextHierarchy));
        void ipcBridge.org.saveData('aionui:org-hierarchy', JSON.stringify(nextHierarchy)).catch(() => {});
      } catch {}

      return {
        id: newDept.id,
        name: newDept.name,
        folder: newDept.workspacePath,
        created: true,
      };
    }

    case 'create_project': {
      const departmentId = String(args.departmentId || meta?.deptId || '').trim();
      const name = String(args.name || '').trim();
      const folder = String(args.folder || '').trim();
      const goal = args.goal ? String(args.goal) : undefined;
      const memberIds = Array.isArray(args.memberIds) ? args.memberIds : [];

      if (!departmentId || !name || !folder) {
        throw new Error('create_project requires "departmentId", "name", and "folder".');
      }

      const dept = store.hierarchy.departments.find((d) => d.id === departmentId);
      if (!dept) {
        throw new Error(`Parent department "${departmentId}" not found.`);
      }

      const masterRoot = store.hierarchy.rootCeo.workspacePath || (await ipcBridge.org.getMasterRoot()) || undefined;
      const parentRoot = dept.workspacePath || masterRoot;

      if (!parentRoot) {
        throw new Error('Cannot create project: No parent folder configured (fail closed).');
      }

      const check = await validateOrgFolder(folder, parentRoot, 'project');
      if (!check.valid) {
        throw new Error(`Invalid project folder "${folder}": ${check.error || 'outside parent boundary'}`);
      }

      const projId = `proj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const resolvedFolder = check.resolvedPath || folder;

      // Initialize real AionCore backend team for this project
      const backendTeamId = await createProjectBackendTeam({
        name,
        workspacePath: resolvedFolder,
        description: goal,
        masterRoot,
      });

      const newProj: OrgProject = {
        id: projId,
        name,
        departmentId,
        workspacePath: resolvedFolder,
        path: resolvedFolder,
        goal,
        memberIds,
        status: 'active',
        teamIds: [],
        backendTeamId,
      };

      const nextProjects = [...store.projects, newProj];
      const nextHierarchy = {
        ...store.hierarchy,
        departments: store.hierarchy.departments.map((d) =>
          d.id === departmentId
            ? {
                ...d,
                linkedProjects: [
                  ...(d.linkedProjects || []),
                  { id: newProj.id, name: newProj.name, path: newProj.workspacePath || undefined },
                ],
              }
            : d
        ),
        lastUpdated: Date.now(),
      };

      store.projects = nextProjects;
      store.hierarchy = nextHierarchy;
      try {
        localStorage.setItem('aionui:org-projects', JSON.stringify(nextProjects));
        localStorage.setItem('aionui:org-hierarchy', JSON.stringify(nextHierarchy));
        void ipcBridge.org.saveData('aionui:org-projects', JSON.stringify(nextProjects)).catch(() => {});
        void ipcBridge.org.saveData('aionui:org-hierarchy', JSON.stringify(nextHierarchy)).catch(() => {});
      } catch {}

      return {
        id: newProj.id,
        name: newProj.name,
        departmentId: newProj.departmentId,
        folder: newProj.workspacePath,
        backendTeamId: newProj.backendTeamId,
        created: true,
      };
    }

    case 'hire_member': {
      const name = String(args.name || '').trim();
      const role = String(args.role || '').trim();
      const skills = Array.isArray(args.skills) ? args.skills : [];
      const systemPrompt = args.systemPrompt ? String(args.systemPrompt) : undefined;

      if (!name || !role) {
        throw new Error('hire_member requires "name" and "role".');
      }

      const memberId = `m-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const newMember: OrgAgentMember = {
        id: memberId,
        canonicalAgentId: `c-${memberId}`,
        name,
        role,
        skills,
        systemPrompt,
        status: 'idle',
        assignedTeamIds: [],
        lastActiveAt: null,
      };

      const currentMembers = store.members || [];
      const nextMembers = [...currentMembers, newMember];
      store.members = nextMembers;
      try {
        localStorage.setItem('aionui:org-members', JSON.stringify(nextMembers));
        void ipcBridge.org.saveData('aionui:org-members', JSON.stringify(nextMembers)).catch(() => {});
        void ipcBridge.org.saveMembers(nextMembers).catch(() => {});
      } catch {}

      return {
        id: newMember.id,
        name: newMember.name,
        role: newMember.role,
        skills: newMember.skills,
        created: true,
      };
    }

    case 'assign_member': {
      const projectId = String(args.projectId || '').trim();
      const memberId = String(args.memberId || '').trim();

      if (!projectId || !memberId) {
        throw new Error('assign_member requires "projectId" and "memberId".');
      }

      const proj = store.projects.find((p) => p.id === projectId);
      if (!proj) {
        throw new Error(`Project "${projectId}" not found.`);
      }

      const member = (store.members || []).find((m) => m.id === memberId);
      if (!member) {
        throw new Error(`Member "${memberId}" not found in shared pool.`);
      }

      const currentIds = proj.memberIds || [];
      if (!currentIds.includes(memberId)) {
        const nextProjects = store.projects.map((p) =>
          p.id === projectId ? { ...p, memberIds: [...currentIds, memberId] } : p
        );
        store.projects = nextProjects;
        try {
          localStorage.setItem('aionui:org-projects', JSON.stringify(nextProjects));
          void ipcBridge.org.saveData('aionui:org-projects', JSON.stringify(nextProjects)).catch(() => {});
        } catch {}
      }

      return {
        success: true,
        projectId,
        memberId,
        assigned: true,
      };
    }

    case 'assign_task': {
      const target = String(args.project_id || args.target || meta?.projectId || '').trim();
      const taskText = String(args.text || args.task || '').trim();

      if (!target || !taskText) {
        throw new Error('assign_task requires "project_id" (or "target") and "text" (or "task").');
      }

      const dept = store.hierarchy.departments.find(
        (d) => d.id === target || d.name.toLowerCase() === target.toLowerCase()
      );
      const proj = store.projects.find((p) => p.id === target || p.name.toLowerCase() === target.toLowerCase());

      const resolvedTargetId = dept ? dept.id : proj ? proj.id : target;
      const targetName = dept ? dept.name : proj ? proj.name : target;

      const matchedProj =
        proj ||
        (args.projectId
          ? store.projects.find((p) => p.id === String(args.projectId).trim())
          : args.project_id
            ? store.projects.find((p) => p.id === String(args.project_id).trim())
            : undefined);

      const isTargetingProject = Boolean(
        proj || args.projectId || args.project_id || store.projects.some((p) => p.id === resolvedTargetId)
      );

      const resolvedProjectId = matchedProj?.id || args.projectId || args.project_id;
      const backendTeamId = matchedProj?.backendTeamId;

      if (isTargetingProject && !backendTeamId) {
        return {
          success: false,
          error:
            'Project has no backend team configured. Create or repair the project team first before assigning tasks.',
          dispatched: false,
          target: resolvedTargetId,
          targetName,
          projectId: resolvedProjectId,
          status: 'error',
        };
      }

      let enrichedText = taskText;
      const approvedLineupId =
        typeof args.approved_lineup_id === 'string' && args.approved_lineup_id.trim()
          ? args.approved_lineup_id.trim()
          : typeof args.approved_lineup === 'string' &&
              (store.approvedLineups || []).some((r) => r.id === args.approved_lineup.trim())
            ? args.approved_lineup.trim()
            : undefined;

      const hasLineupArg = Boolean(args.approved_lineup_id || args.approved_lineup);

      let matchedRecord: ApprovedLineupRecord | undefined;

      if (hasLineupArg) {
        const approvedRecords = store.approvedLineups || [];
        if (approvedLineupId) {
          matchedRecord = approvedRecords.find((r) => r.id === approvedLineupId);
        } else if (args.approved_lineup) {
          // Fallback match by JSON comparison
          matchedRecord = approvedRecords.find((record) => {
            if (!record) return false;
            try {
              return JSON.stringify(record.lineup) === JSON.stringify(args.approved_lineup);
            } catch {
              return false;
            }
          });
        }

        // Validate: must exist, not expired (24h), and project match if projectId is set on record
        const now = Date.now();
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        const isExpired = matchedRecord ? now - matchedRecord.approvedAt > ONE_DAY_MS : true;
        const projectMismatch = Boolean(
          matchedRecord?.projectId && resolvedProjectId && matchedRecord.projectId !== resolvedProjectId
        );

        if (!matchedRecord || isExpired || projectMismatch) {
          return {
            success: false,
            error: 'approved_lineup not recognized: ask the user to approve the lineup again',
            dispatched: false,
            target: resolvedTargetId,
            targetName,
            projectId: resolvedProjectId,
            status: 'error',
          };
        }

        // Valid match! Build approval lines from stored record (not model-supplied text)
        const storedLineup = matchedRecord.lineup;
        let approvalStr = '';
        if (Array.isArray(storedLineup)) {
          approvalStr = storedLineup
            .map((item) => {
              if (typeof item === 'string') {
                return item.startsWith('User approved:') ? item : `User approved: ${item}`;
              }
              if (item && typeof item === 'object') {
                const name = (item as { name?: string }).name || 'Specialist';
                const assistant =
                  (item as { assistant?: string }).assistant ||
                  (item as { assistant_id?: string }).assistant_id ||
                  (item as { role?: string }).role ||
                  'default';
                return `User approved: add ${name} using ${assistant}`;
              }
              return 'User approved: add member';
            })
            .join('\n');
        } else if (typeof storedLineup === 'string') {
          approvalStr = storedLineup.startsWith('User approved:') ? storedLineup : `User approved: ${storedLineup}`;
        }

        if (approvalStr) {
          enrichedText = `${enrichedText}\n\n${approvalStr}`;
        }
      }

      if (backendTeamId) {
        try {
          await ipcBridge.team.sendMessage.invoke({
            team_id: backendTeamId,
            input: enrichedText,
          });
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
            dispatched: false,
            target: resolvedTargetId,
            targetName,
            task: enrichedText,
            projectId: resolvedProjectId,
            backendTeamId,
            status: 'error',
          };
        }
      }

      if (matchedRecord) {
        const patch: Partial<ApprovedLineupRecord> = { usedAt: Date.now() };
        if (resolvedProjectId && !matchedRecord.projectId) {
          patch.projectId = resolvedProjectId;
        }
        updateApprovedLineupInStore(matchedRecord.id, patch);
      }

      updateNodeStatus(resolvedTargetId, 'delegating');
      updateActivityTicker(resolvedTargetId, {
        message: `Delegated task to ${targetName}: ${enrichedText}`,
        timestamp: Date.now(),
        status: 'delegating',
      });

      return {
        success: true,
        dispatched: true,
        target: resolvedTargetId,
        targetName,
        task: enrichedText,
        projectId: resolvedProjectId,
        backendTeamId,
        status: backendTeamId ? 'dispatched_to_team' : 'delegated',
      };
    }

    case 'get_project_status': {
      const projectId = String(args.project_id || args.projectId || args.target || meta?.projectId || '').trim();
      if (!projectId) {
        throw new Error('get_project_status requires "project_id".');
      }
      const proj = store.projects.find((p) => p.id === projectId || p.name.toLowerCase() === projectId.toLowerCase());
      if (!proj) {
        throw new Error(`Project "${projectId}" not found.`);
      }
      const teamId = proj.backendTeamId;
      if (!teamId) {
        return {
          projectId: proj.id,
          projectName: proj.name,
          status: proj.status,
          summary: `Project "${proj.name}" is active (no backend team attached).`,
        };
      }

      const [runState, mailbox]: [ITeamRunStateResponse | null, ITeamMailboxMessage[]] = await Promise.all([
        ipcBridge.team.getRunState.invoke({ team_id: teamId }).catch((): null => null),
        ipcBridge.team.listMailbox.invoke({ team_id: teamId, limit: 10 }).catch((): ITeamMailboxMessage[] => []),
      ]);

      const activeRun = runState?.active_run;
      const slotWork: ITeamSlotWork[] = runState?.slot_work || activeRun?.slot_work || [];
      const activeSlots = slotWork.filter((s: ITeamSlotWork) => s.state === 'running' || s.state === 'starting');

      const recentMessages = (mailbox || []).slice(0, 5).map((m: ITeamMailboxMessage) => ({
        from: m.from_agent_id,
        to: m.to_agent_id,
        type: m.msg_type,
        summary: m.summary || (m.content ? m.content.slice(0, 100) : ''),
      }));

      const summary = `Project "${proj.name}" (Team ID: ${teamId}): Run status is "${activeRun?.status || 'idle'}". ${activeSlots.length} active agent slot(s). ${mailbox.length} message(s) in mailbox.`;

      return {
        projectId: proj.id,
        projectName: proj.name,
        backendTeamId: teamId,
        runStatus: activeRun?.status || 'idle',
        activeSlots: activeSlots.map((s: ITeamSlotWork) => ({ slot_id: s.slot_id, role: s.role, state: s.state })),
        recentMessages,
        summary,
      };
    }

    case 'list_project_tasks': {
      const projectId = String(args.project_id || args.projectId || args.target || meta?.projectId || '').trim();
      if (!projectId) {
        throw new Error('list_project_tasks requires "project_id".');
      }
      const proj = store.projects.find((p) => p.id === projectId || p.name.toLowerCase() === projectId.toLowerCase());
      if (!proj) {
        throw new Error(`Project "${projectId}" not found.`);
      }
      const teamId = proj.backendTeamId;
      if (!teamId) {
        return {
          projectId: proj.id,
          projectName: proj.name,
          tasks: [],
          summary: `Project "${proj.name}" has no backend team attached.`,
        };
      }

      const tasks: ITeamTaskItem[] = await ipcBridge.team.listTasks
        .invoke({ team_id: teamId, limit: 50 })
        .catch((): ITeamTaskItem[] => []);
      const taskList = tasks.map((t: ITeamTaskItem) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        owner: t.owner,
        blocked_by: t.blocked_by,
      }));

      const completed = taskList.filter((t) => t.status === 'completed').length;
      const inProgress = taskList.filter((t) => t.status === 'in_progress').length;
      const blocked = taskList.filter((t) => t.status === 'blocked').length;
      const pending = taskList.filter((t) => t.status === 'pending').length;

      const summary = `Project "${proj.name}" has ${taskList.length} tasks: ${completed} completed, ${inProgress} in progress, ${blocked} blocked, ${pending} pending.`;

      return {
        projectId: proj.id,
        projectName: proj.name,
        backendTeamId: teamId,
        tasks: taskList,
        summary,
      };
    }

    case 'propose_structure': {
      const departments = Array.isArray(args.departments) ? args.departments : [];
      const suggestedMembers = Array.isArray(args.suggestedMembers) ? args.suggestedMembers : [];
      const proposalId = args.id || `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      emitStructureProposed({
        id: proposalId,
        departments,
        suggestedMembers,
      });

      return {
        success: true,
        proposed: true,
        proposalId,
        departmentsCount: departments.length,
        message: 'Organizational proposal presented to user. Waiting for approval.',
      };
    }

    case 'get_status': {
      const activeDepts = store.hierarchy.departments.length;
      const activeProjs = store.projects.length;
      const activeMembers = (store.members || []).length;

      return {
        status: 'healthy',
        masterRoot: store.hierarchy.rootCeo.workspacePath || null,
        departmentsCount: activeDepts,
        projectsCount: activeProjs,
        membersCount: activeMembers,
        nodeStatuses: store.nodeStatuses,
      };
    }

    case 'ask_user': {
      const question = String(args.question || '').trim();
      if (!question) {
        throw new Error('ask_user requires "question".');
      }

      updateActivityTicker('root-ceo', {
        message: `CEO asks user: ${question}`,
        timestamp: Date.now(),
      });

      const payload: AskUserPayload = {
        asked: true,
        question,
        members: args.suggestedMembers || args.members,
        suggestedMembers: args.suggestedMembers || args.members,
        projectId: args.projectId || args.project_id,
        project_id: args.projectId || args.project_id,
      };

      emitAskUser(payload);

      return payload;
    }

    default:
      throw new Error(`Unsupported organizational tool: "${tool}".`);
  }
}

/**
 * Handles user answer to an ask_user question.
 * When the question context was about recruiting members, records an approved lineup
 * and returns the answer text appended with approved_lineup_id=<id>.
 */
export function handleUserAnswerAsk(
  questionPayload: {
    question?: string;
    members?: unknown;
    suggestedMembers?: unknown;
    projectId?: string;
    project_id?: string;
  },
  userAnswer: string
): { answer: string; approvedLineupId?: string } {
  const members = questionPayload.suggestedMembers || questionPayload.members;
  const trimmed = userAnswer.trim();
  const hasAffirmativeStart = /^(yes|yeah|yep|sure|ok|okay|approve|approved|go ahead|proceed)\b/i.test(trimmed);
  const hasCaveat = /\b(but|except|not|don't|dont|without|skip|instead|only)\b/i.test(trimmed);
  const isApproved = hasAffirmativeStart && !hasCaveat;
  const projectId = questionPayload.projectId || questionPayload.project_id;

  if (members && isApproved) {
    const lineupId = recordApprovedLineupInStore(members, undefined, projectId);
    return {
      answer: `${trimmed} approved_lineup_id=${lineupId}`,
      approvedLineupId: lineupId,
    };
  }

  return { answer: userAnswer };
}

let bridgeListenerRegistered = false;

/**
 * Initializes the bridge listener in the renderer so Electron main process tool
 * calls are executed directly in the renderer's organizational state store.
 */
export function setupOrgToolBridgeListener(): () => void {
  if (bridgeListenerRegistered) {
    return () => {};
  }
  if (typeof ipcBridge?.org?.onExecuteToolCall !== 'function') {
    return () => {};
  }
  bridgeListenerRegistered = true;

  const unsubscribe = ipcBridge.org.onExecuteToolCall(async (payload) => {
    try {
      const result = await executeOrgToolInStore(payload.tool, payload.args, payload.meta);
      ipcBridge.org.sendToolResponse({
        callId: payload.callId,
        success: true,
        result,
      });
    } catch (err) {
      ipcBridge.org.sendToolResponse({
        callId: payload.callId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return () => {
    bridgeListenerRegistered = false;
    unsubscribe();
  };
}
