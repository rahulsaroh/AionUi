/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { getOrgStoreSnapshot } from './useOrgStore';
import { updateNodeStatus, updateActivityTicker } from './useOrgTelemetryStore';
import { validateOrgFolder } from '../utils/orgPathUtils';
import type {
  OrgDepartmentNode,
  OrgProject,
  OrgAgentMember,
  OrgNodeStatus,
} from '@/types/organization';

export interface StructureProposal {
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

/**
 * Executes an organizational tool call against the renderer store.
 * Returns structured results with created entity IDs.
 */
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

      const masterRoot =
        store.hierarchy.rootCeo.workspacePath || (await ipcBridge.org.getMasterRoot()) || undefined;

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

      const masterRoot =
        store.hierarchy.rootCeo.workspacePath || (await ipcBridge.org.getMasterRoot()) || undefined;
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
      const target = String(args.target || '').trim();
      const task = String(args.task || '').trim();

      if (!target || !task) {
        throw new Error('assign_task requires "target" and "task".');
      }

      const dept = store.hierarchy.departments.find(
        (d) => d.id === target || d.name.toLowerCase() === target.toLowerCase()
      );
      const proj = store.projects.find(
        (p) => p.id === target || p.name.toLowerCase() === target.toLowerCase()
      );

      const resolvedTargetId = dept ? dept.id : proj ? proj.id : target;
      const targetName = dept ? dept.name : proj ? proj.name : target;

      updateNodeStatus(resolvedTargetId, 'delegating');
      updateActivityTicker(resolvedTargetId, {
        message: `Delegated task to ${targetName}: ${task}`,
        timestamp: Date.now(),
        status: 'delegating',
      });

      return {
        success: true,
        target: resolvedTargetId,
        targetName,
        task,
        status: 'delegated',
      };
    }

    case 'propose_structure': {
      const departments = Array.isArray(args.departments) ? args.departments : [];
      const suggestedMembers = Array.isArray(args.suggestedMembers) ? args.suggestedMembers : [];

      emitStructureProposed({
        departments,
        suggestedMembers,
      });

      return {
        success: true,
        proposed: true,
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

      return {
        asked: true,
        question,
      };
    }

    default:
      throw new Error(`Unsupported organizational tool: "${tool}".`);
  }
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
