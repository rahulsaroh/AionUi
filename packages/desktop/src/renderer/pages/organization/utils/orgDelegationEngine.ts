/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  OrgHierarchy,
  OrgAgentMember,
  OrgNodeStatus,
  OrgDepartmentNode,
  OrgTeamNode,
  OrgProject,
} from '@/types/organization';
import { createDepartmentShell, createTeamShell, createMemberShell } from './orgCoherence';
import { getDefaultDeptPath, getDefaultTeamPath, getDefaultProjectPath } from './orgPathUtils';

export interface DelegationStepLog {
  id: string;
  depth: number;
  fromName: string;
  fromRole: string;
  toName: string;
  toRole: string;
  message: string;
  timestamp: number;
  status: 'delegating' | 'working' | 'completed' | 'error';
}

export interface DelegationExecutionResult {
  success: boolean;
  directiveId: string;
  userPrompt: string;
  logs: DelegationStepLog[];
  finalSynthesis: string;
  involvedDepartmentIds: string[];
  involvedTeamIds: string[];
  createdDepartments?: OrgDepartmentNode[];
  createdTeams?: Array<{ departmentId: string; team: OrgTeamNode }>;
  createdProjects?: Array<import('@/types/organization').OrgProject>;
  createdMembers?: Array<{ teamId: string; member: OrgAgentMember }>;
  deletedDepartmentIds?: string[];
  updatedDepartment?: { departmentId: string; patch: Partial<OrgDepartmentNode> };
  updatedRootCeoWorkspace?: string;
}

export interface OrgActionPayload {
  action: 'create_department' | 'create_team' | 'create_project' | 'create_member';
  name: string;
  department?: string;
  team?: string;
  role?: string;
  title?: string;
  workspacePath?: string;
  description?: string;
}

function cleanTrailingClauses(str: string): string {
  return str
    .replace(
      /\s+(?:and\s+then|and\s+we\s+will|and\s+assign|and\s+add|and\s+we|and\s+choose|choose\s+folder|and\s+pick|with\s+a\s+team|with\s+team|files\s+of\s+which|stored\s+in|in\s+folder|at\s+path|where\s+files|folder\s+to\s+work\s+with|to\s+handle|for\s+handling|which\s+is)[\s\S]*$/i,
      ''
    )
    .trim();
}

function extractPathFromPrompt(prompt: string): string | undefined {
  // Direct match for Windows drive absolute path
  const winMatch = prompt.match(/([a-zA-Z]:\\(?:[^"'\n\r;:<>|*?]+[\\/]?)+)/);
  if (winMatch?.[1]) {
    return winMatch[1]
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/[.,;]$/, '');
  }
  // Direct match for Unix absolute path
  const unixMatch = prompt.match(/((?:\/[a-zA-Z0-9._-]+)+)/);
  if (unixMatch?.[1] && unixMatch[1] !== '/' && unixMatch[1].length > 2) {
    return unixMatch[1]
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/[.,;]$/, '');
  }
  const genericMatch = prompt.match(
    /(?:folder|path|stored\s+in|directory|workspace|at)\s*(?:is|into|to|in|to\s+work\s+with|with|=|:)*\s*[:"']?([a-zA-Z]:\\[^"'\n\r,;]+|(?:\/[a-zA-Z0-9._-]+)+)/i
  );
  return genericMatch?.[1]?.trim()?.replace(/^["']|["']$/g, '');
}

export function isValidDepartmentName(name: string): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 50) return false;
  if (
    /\b(?:in|into|inside|under|within|for|to|at|from)\s+(?:this|that|the|our|my|a|an|each|every|current)?\b/i.test(
      trimmed
    )
  ) {
    return false;
  }
  if (/\b(?:in|into|inside|under|within|for|to|at|from|with|on|of|and|or)$/i.test(trimmed)) {
    return false;
  }
  if (
    /\b(?:projects?|sub-?teams?|teams?|members?|specialists?|bots?|agents?|tasks?|files?|folders?)\b/i.test(trimmed)
  ) {
    return false;
  }
  if (/\b(?:multiple|several|different|various|these|those|this|that|many|few|each|every|all)\b/i.test(trimmed)) {
    return false;
  }
  if (/\b(?:search|find|scan|look|import|discover|detect|create|add|assign|setup|build|make)\b/i.test(trimmed)) {
    return false;
  }
  return true;
}

export function isValidTeamName(name: string): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 50) return false;
  if (
    /\b(?:in|into|inside|under|within|for|to|at|from)\s+(?:this|that|the|our|my|a|an|each|every|current)?\b/i.test(
      trimmed
    )
  ) {
    return false;
  }
  if (/\b(?:in|into|inside|under|within|for|to|at|from|with|on|of|and|or)$/i.test(trimmed)) {
    return false;
  }
  if (
    /\b(?:projects?|depar?t?ments?|dept|members?|specialists?|bots?|agents?|tasks?|files?|folders?)\b/i.test(trimmed)
  ) {
    return false;
  }
  if (/\b(?:multiple|several|different|various|these|those|this|that|many|few|each|every|all)\b/i.test(trimmed)) {
    return false;
  }
  if (/\b(?:search|find|scan|look|import|discover|detect|create|add|assign|setup|build)\b/i.test(trimmed)) {
    return false;
  }
  return true;
}

export function isValidProjectName(name: string): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  if (
    /\b(?:in|into|inside|under|within|for|to|at|from)\s+(?:this|that|the|our|my|a|an|each|every|current)?\b/i.test(
      trimmed
    )
  ) {
    return false;
  }
  if (/\b(?:in|into|inside|under|within|for|to|at|from|with|on|of|and|or)$/i.test(trimmed)) {
    return false;
  }
  if (/\b(?:multiple|several|different|various|all|each|every)\b/i.test(trimmed)) {
    return false;
  }
  return true;
}

export function extractDepartmentCreationIntent(userPrompt: string): { name: string; workspacePath?: string } | null {
  const path = extractPathFromPrompt(userPrompt);

  const pattern1 =
    /(?:create|add|new|setup|set\s+up|start|instantiate|build|establish|open)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:depar?t?ments?|dept|departmnts?)(?:\s+(?:called|named|name|for|with\s+name|titled|:))?\s+[:"']?([^"'\n\r.,;]+)/i;
  const match1 = userPrompt.match(pattern1);
  if (match1 && match1[1]?.trim()) {
    let rawName = cleanTrailingClauses(match1[1].trim());
    rawName = rawName.replace(/^["']|["']$/g, '').trim();
    rawName = rawName.replace(/\s+(?:depar?t?ments?|dept|departmnts?)$/i, '').trim() || rawName;
    if (isValidDepartmentName(rawName)) {
      return { name: rawName, workspacePath: path };
    }
  }

  const pattern2 =
    /(?:create|add|new|setup|set\s+up|start|instantiate|build|establish|open)\s+(?:a\s+|an\s+)?(?:new\s+)?([^"'\n\r.,;]+?)\s+(?:depar?t?ments?|dept|departmnts?)(?:\s+(?:and|with|where|in|at|files|folder|choose|to|for)[\s\S]*|["']|\.|\n|,|$)/i;
  const match2 = userPrompt.match(pattern2);
  if (match2 && match2[1]?.trim()) {
    let rawName = cleanTrailingClauses(match2[1].trim());
    rawName = rawName.replace(/^["']|["']$/g, '').trim();
    rawName = rawName.replace(/^(?:the|a|an|first)\s+/i, '').trim();
    if (isValidDepartmentName(rawName) && !/^(?:new|sub)$/i.test(rawName)) {
      return { name: rawName, workspacePath: path };
    }
  }

  return null;
}

export function extractDepartmentDeletionIntent(
  userPrompt: string,
  departments: OrgDepartmentNode[]
): { department: OrgDepartmentNode } | null {
  const match =
    userPrompt.match(
      /(?:delete|remove|destroy|archive|drop)\s+(?:the\s+)?(?:depar?t?ments?|dept|departmnts?)\s+[:"']?([^"'\n\r.,;]+)/i
    ) ||
    userPrompt.match(
      /(?:delete|remove|destroy|archive|drop)\s+[:"']?([^"'\n\r.,;]+?)\s+(?:depar?t?ments?|dept|departmnts?)/i
    );

  if (match && match[1]?.trim()) {
    let query = cleanTrailingClauses(match[1].trim())
      .replace(/^["']|["']$/g, '')
      .trim();
    query = query.replace(/^(?:the|a|an)\s+/i, '').trim();
    const lowerQuery = query.toLowerCase();

    const targetDept = departments.find(
      (d) =>
        d.id.toLowerCase() === lowerQuery ||
        d.name.toLowerCase() === lowerQuery ||
        d.name.toLowerCase().includes(lowerQuery) ||
        lowerQuery.includes(d.name.toLowerCase())
    );

    if (targetDept) {
      return { department: targetDept };
    }
  }

  return null;
}

export type ProjectDiscoveryOrBatchIntent = {
  type: 'discover' | 'batch_create';
  targetDepartment: OrgDepartmentNode;
  folderPath?: string;
  projectNames?: string[];
};

export function extractProjectDiscoveryOrBatchIntent(
  userPrompt: string,
  departments: OrgDepartmentNode[],
  targetDeptId?: string,
  rootWorkspacePath?: string,
  fallbackPath?: string
): ProjectDiscoveryOrBatchIntent | null {
  if (departments.length === 0) return null;

  let targetDept: OrgDepartmentNode | undefined;
  if (targetDeptId) {
    targetDept = departments.find((d) => d.id === targetDeptId);
  }

  const lowerPrompt = userPrompt.toLowerCase();
  for (const dept of departments) {
    if (lowerPrompt.includes(dept.name.toLowerCase())) {
      targetDept = dept;
      break;
    }
  }

  if (
    !targetDept &&
    /\b(?:in|under|to|for|into)\s+(?:this|the|that|our|current)?\s*depar?t?ments?\b/i.test(userPrompt)
  ) {
    targetDept = departments[departments.length - 1];
  }

  if (!targetDept && departments.length === 1) {
    targetDept = departments[0];
  }

  if (!targetDept) {
    targetDept = departments[departments.length - 1];
  }

  const isDiscovery =
    // "search/find/scan/discover/list/detect/import/load apps/projects"
    /(?:search|find|scan|discover|detect|import|list|look|inspect|check)\s+(?:for\s+)?(?:all\s+|my\s+|our\s+)?(?:different\s+|multiple\s+)?(?:apps?|projects?|sub-?folders?|directories|repos?|codebases?)\b/i.test(
      userPrompt
    ) ||
    // "make/turn/create/set up each app/folder into/as a project"
    /\b(?:make|turn|create|set\s+up|setup|add|convert)\s+(?:each|every|all)\s+(?:apps?|folders?|directories|sub-?folders?|repos?)\s+(?:an?\s+)?projects?\b/i.test(
      userPrompt
    ) ||
    // "have multiple apps ... make each app an project"
    /\b(?:apps?|projects?|folders?|directories|sub-?folders?)\b.*?\b(?:make|turn|convert|add|create|register)\s+(?:each|every|all|them\s+as|multiple)?\s+(?:an?\s+)?projects?\b/i.test(
      userPrompt
    ) ||
    // "create/add/register/import projects from/in folder"
    /(?:from|in|under)\s+(?:this\s+|the\s+|[\w\s-]+\s+)?(?:folder|directory|workspace|path)\s+.*?\b(?:create|add|register|import|make)\s+(?:multiple\s+|all\s+|different\s+)?(?:an?\s+)?projects?\b/i.test(
      userPrompt
    ) ||
    /(?:create|add|register|import|make)\s+(?:multiple\s+|all\s+|different\s+)?(?:an?\s+)?projects?\b.*?\b(?:from|in|under)\s+(?:this\s+|the\s+|[\w\s-]+\s+)?(?:folder|directory|workspace|path)\b/i.test(
      userPrompt
    ) ||
    // "create multiple projects in this department"
    /(?:create|add|register|setup|set\s+up|make)\s+(?:multiple|several|different|all|\d+)\s+projects?\b.*?\b(?:in|under|to|for)\s+(?:this|the|that|our|current|[\w\s]+)?\s*depar?t?ments?\b/i.test(
      userPrompt
    );

  if (isDiscovery) {
    const explicitPath = extractPathFromPrompt(userPrompt);
    // If targetDept.workspacePath is an auto-generated path containing \departments\,
    // prioritize fallbackPath explicitly provided by the user in conversation
    const isAutoDeptPath = targetDept.workspacePath && /[\\/]departments[\\/]/i.test(targetDept.workspacePath);
    const resolvedDeptPath = isAutoDeptPath ? fallbackPath || targetDept.workspacePath : targetDept.workspacePath;
    const folderPath = explicitPath || resolvedDeptPath || rootWorkspacePath || fallbackPath;
    return {
      type: 'discover',
      targetDepartment: targetDept,
      folderPath,
    };
  }

  const batchListMatch = userPrompt.match(
    /(?:create|add|register)\s+(?:multiple\s+)?projects?[:\s]+([a-zA-Z0-9_\-\s,]+?)(?:\s+(?:in|under|for|to)\s+(?:(?:depar?t?ments?|dept)\s+)?.*)?$/i
  );
  if (batchListMatch && batchListMatch[1]?.includes(',')) {
    const names = batchListMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter((s) => s.length >= 2 && !/^(?:and|or|in|to|for)$/i.test(s));
    if (names.length > 0) {
      return {
        type: 'batch_create',
        targetDepartment: targetDept,
        folderPath: targetDept.workspacePath || rootWorkspacePath || fallbackPath,
        projectNames: names,
      };
    }
  }

  if (
    /(?:create|add|register|setup|set\s+up)\s+(?:multiple|several|different|\d+)\s+projects?\b/i.test(userPrompt) &&
    /\b(?:in|under|to|for)\s+(?:this|the|that|our|current|[\w\s]+)?\s*depar?t?ments?\b/i.test(userPrompt)
  ) {
    const folderPath =
      extractPathFromPrompt(userPrompt) || targetDept.workspacePath || rootWorkspacePath || fallbackPath;
    return {
      type: 'discover',
      targetDepartment: targetDept,
      folderPath,
    };
  }

  return null;
}

export function extractTeamCreationIntent(
  userPrompt: string,
  departments: OrgDepartmentNode[],
  targetDeptId?: string
): { name: string; department: OrgDepartmentNode } | null {
  const pattern1 =
    /(?:create|add|new|setup|set\s+up|start|instantiate|build|assign)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:sub-?team|team)(?:\s+(?:called|named|name|for|with\s+name|titled|:))?\s+[:"']?([^"'\n\r.,;]+?)(?:["']\s+|\s+)?(?:in|under|for|to)\s+(?:(?:depar?t?ments?|dept|departmnts?)\s+)?[:"']?([^"'\n\r.,;]+)/i;
  const match1 = userPrompt.match(pattern1);
  if (match1 && match1[1]?.trim() && match1[2]?.trim()) {
    let teamName = cleanTrailingClauses(match1[1].trim());
    teamName = teamName.replace(/^["']|["']$/g, '').trim();
    teamName = teamName.replace(/\s+(?:sub-?team|team)$/i, '').trim() || teamName;

    let deptQuery = cleanTrailingClauses(match1[2].trim());
    deptQuery = deptQuery.replace(/^["']|["']$/g, '').trim();
    deptQuery = deptQuery.replace(/\s+(?:depar?t?ments?|dept|departmnts?)$/i, '').trim() || deptQuery;

    const lowerDeptQuery = deptQuery.toLowerCase();
    let targetDept = departments.find(
      (d) =>
        d.id.toLowerCase() === lowerDeptQuery ||
        d.name.toLowerCase() === lowerDeptQuery ||
        d.name.toLowerCase().includes(lowerDeptQuery) ||
        lowerDeptQuery.includes(d.name.toLowerCase())
    );

    if (!targetDept && /^(?:this|the|that|our|current)$/i.test(lowerDeptQuery)) {
      targetDept =
        (targetDeptId ? departments.find((d) => d.id === targetDeptId) : undefined) ||
        (departments.length > 0 ? departments[departments.length - 1] : undefined);
    }

    if (isValidTeamName(teamName) && targetDept) {
      return { name: teamName, department: targetDept };
    }
  }

  const pattern2 =
    /(?:in|under|for|to)\s+(?:(?:depar?t?ments?|dept|departmnts?)\s+)?[:"']?([^"'\n\r.,;]+?)(?:["']\s+|\s+)?(?:create|add|new|setup|set\s+up|start|instantiate|build|assign)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:sub-?team|team)(?:\s+(?:called|named|name|for|with\s+name|titled|:))?\s+[:"']?([^"'\n\r.,;]+)/i;
  const match2 = userPrompt.match(pattern2);
  if (match2 && match2[1]?.trim() && match2[2]?.trim()) {
    const deptQuery = cleanTrailingClauses(match2[1].trim())
      .replace(/^["']|["']$/g, '')
      .trim();
    let teamName = cleanTrailingClauses(match2[2].trim())
      .replace(/^["']|["']$/g, '')
      .trim();
    teamName = teamName.replace(/\s+(?:sub-?team|team)$/i, '').trim() || teamName;

    const lowerDeptQuery = deptQuery.toLowerCase();
    let targetDept = departments.find(
      (d) =>
        d.id.toLowerCase() === lowerDeptQuery ||
        d.name.toLowerCase() === lowerDeptQuery ||
        d.name.toLowerCase().includes(lowerDeptQuery) ||
        lowerDeptQuery.includes(d.name.toLowerCase())
    );
    if (!targetDept && /^(?:this|the|that|our|current)$/i.test(lowerDeptQuery)) {
      targetDept =
        (targetDeptId ? departments.find((d) => d.id === targetDeptId) : undefined) ||
        (departments.length > 0 ? departments[departments.length - 1] : undefined);
    }
    if (isValidTeamName(teamName) && targetDept) {
      return { name: teamName, department: targetDept };
    }
  }

  const pattern3 =
    /(?:create|add|new|setup|set\s+up|start|instantiate|build)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:sub-?team|team)(?:\s+(?:called|named|name|for|with\s+name|titled|:))?\s+[:"']?([^"'\n\r.,;]+)/i;
  const match3 = userPrompt.match(pattern3);
  if (match3 && match3[1]?.trim()) {
    let teamName = cleanTrailingClauses(match3[1].trim())
      .replace(/^["']|["']$/g, '')
      .trim();
    teamName = teamName.replace(/\s+(?:sub-?team|team)$/i, '').trim() || teamName;

    const targetDept =
      (targetDeptId ? departments.find((d) => d.id === targetDeptId) : undefined) ||
      (departments.length === 1 ? departments[0] : undefined);

    if (isValidTeamName(teamName) && targetDept) {
      return { name: teamName, department: targetDept };
    }
  }

  return null;
}

export function extractProjectCreationIntent(
  userPrompt: string,
  departments: OrgDepartmentNode[],
  targetDeptId?: string
): { name: string; department: OrgDepartmentNode; workspacePath?: string } | null {
  const path = extractPathFromPrompt(userPrompt);

  const pattern1 =
    /(?:create|add|new|register|start|setup|set\s+up)\s+(?:a\s+|an\s+)?(?:new\s+)?project(?:\s+(?:called|named|name|for|with\s+name|titled|:))?\s+[:"']?([^"'\n\r.,;]+?)(?:["']\s+|\s+)?(?:in|under|for|to)\s+(?:(?:depar?t?ments?|dept|departmnts?)\s+)?[:"']?([^"'\n\r.,;]+)/i;
  const match1 = userPrompt.match(pattern1);
  if (match1 && match1[1]?.trim() && match1[2]?.trim()) {
    let projName = cleanTrailingClauses(match1[1].trim())
      .replace(/^["']|["']$/g, '')
      .trim();
    projName = projName.replace(/\s+project$/i, '').trim() || projName;

    let deptQuery = cleanTrailingClauses(match1[2].trim())
      .replace(/^["']|["']$/g, '')
      .trim();
    deptQuery = deptQuery.replace(/\s+(?:depar?t?ments?|dept|departmnts?)$/i, '').trim() || deptQuery;

    const lowerDeptQuery = deptQuery.toLowerCase();
    let targetDept = departments.find(
      (d) =>
        d.id.toLowerCase() === lowerDeptQuery ||
        d.name.toLowerCase() === lowerDeptQuery ||
        d.name.toLowerCase().includes(lowerDeptQuery) ||
        lowerDeptQuery.includes(d.name.toLowerCase())
    );

    if (!targetDept && /^(?:this|the|that|our|current)$/i.test(lowerDeptQuery)) {
      targetDept =
        (targetDeptId ? departments.find((d) => d.id === targetDeptId) : undefined) ||
        (departments.length > 0 ? departments[departments.length - 1] : undefined);
    }

    if (isValidProjectName(projName) && targetDept) {
      return { name: projName, department: targetDept, workspacePath: path };
    }
  }

  const pattern2 =
    /(?:create|add|new|register|start|setup|set\s+up)\s+(?:a\s+|an\s+)?(?:new\s+)?project(?:\s+(?:called|named|name|for|with\s+name|titled|:))?\s+[:"']?([^"'\n\r.,;]+)/i;
  const match2 = userPrompt.match(pattern2);
  if (match2 && match2[1]?.trim()) {
    let projName = cleanTrailingClauses(match2[1].trim())
      .replace(/^["']|["']$/g, '')
      .trim();
    projName = projName.replace(/\s+project$/i, '').trim() || projName;

    const targetDept =
      (targetDeptId ? departments.find((d) => d.id === targetDeptId) : undefined) ||
      (departments.length > 0 ? departments[departments.length - 1] : undefined);

    if (isValidProjectName(projName) && targetDept) {
      return { name: projName, department: targetDept, workspacePath: path };
    }
  }

  const pattern3 =
    /(?:create|add|new|register|start|setup|set\s+up)\s+(?:a\s+|an\s+)?(?:new\s+)?([^"'\n\r.,;]+?)\s+project(?:\s+(?:in|under|for|to)\s+(?:(?:depar?t?ments?|dept|departmnts?)\s+)?[:"']?([^"'\n\r.,;]+))?/i;
  const match3 = userPrompt.match(pattern3);
  if (match3 && match3[1]?.trim()) {
    let projName = cleanTrailingClauses(match3[1].trim())
      .replace(/^["']|["']$/g, '')
      .trim();
    projName = projName.replace(/\s+project$/i, '').trim() || projName;

    let targetDept: OrgDepartmentNode | undefined;
    if (match3[2]?.trim()) {
      let deptQuery = cleanTrailingClauses(match3[2].trim())
        .replace(/^["']|["']$/g, '')
        .trim();
      deptQuery = deptQuery.replace(/\s+(?:depar?t?ments?|dept|departmnts?)$/i, '').trim() || deptQuery;
      const lowerDeptQuery = deptQuery.toLowerCase();
      targetDept = departments.find(
        (d) =>
          d.id.toLowerCase() === lowerDeptQuery ||
          d.name.toLowerCase() === lowerDeptQuery ||
          d.name.toLowerCase().includes(lowerDeptQuery) ||
          lowerDeptQuery.includes(d.name.toLowerCase())
      );
      if (!targetDept && /^(?:this|the|that|our|current)$/i.test(lowerDeptQuery)) {
        targetDept =
          (targetDeptId ? departments.find((d) => d.id === targetDeptId) : undefined) ||
          (departments.length > 0 ? departments[departments.length - 1] : undefined);
      }
    } else {
      targetDept =
        (targetDeptId ? departments.find((d) => d.id === targetDeptId) : undefined) ||
        (departments.length > 0 ? departments[departments.length - 1] : undefined);
    }

    if (isValidProjectName(projName) && targetDept) {
      return { name: projName, department: targetDept, workspacePath: path };
    }
  }

  return null;
}

export function extractMemberCreationIntent(
  userPrompt: string,
  departments: OrgDepartmentNode[]
): { name: string; role: string; team: OrgTeamNode } | null {
  const allTeams = departments.flatMap((d) => d.teams);
  const pattern1 =
    /(?:create|add|new|hire|recruit)\s+(?:a\s+|an\s+)?(?:member|specialist|bot|agent|engineer|designer|manager)(?:\s+(?:called|named|name|with\s+name))?\s+[:"']?([^"'\n\r.,;]+?)(?:["']\s+|\s+)?(?:(?:as|role)\s+[:"']?([^"'\n\r.,;]+?)(?:["']\s+|\s+)?)?(?:to|in|for|under)\s+(?:team\s+)?[:"']?([^"'\n\r.,;]+)/i;
  const match1 = userPrompt.match(pattern1);
  if (match1 && match1[1]?.trim() && match1[3]?.trim()) {
    const memberName = cleanTrailingClauses(match1[1].trim())
      .replace(/^["']|["']$/g, '')
      .trim();
    const memberRole = match1[2]?.trim().replace(/^["']|["']$/g, '') || 'specialist';
    const teamQuery = cleanTrailingClauses(match1[3].trim())
      .replace(/^["']|["']$/g, '')
      .toLowerCase();

    const targetTeam = allTeams.find(
      (t) =>
        t.id.toLowerCase() === teamQuery ||
        t.name.toLowerCase() === teamQuery ||
        t.name.toLowerCase().includes(teamQuery) ||
        teamQuery.includes(t.name.toLowerCase())
    );

    if (memberName && targetTeam) {
      return { name: memberName, role: memberRole, team: targetTeam };
    }
  }

  const pattern2 = /(?:add|hire|create|recruit)\s+(?:specialist|member|bot|agent)\s+[:"']?([^"'\n\r.,;]+)/i;
  const match2 = userPrompt.match(pattern2);
  if (match2 && match2[1]?.trim()) {
    const memberName = cleanTrailingClauses(match2[1].trim())
      .replace(/^["']|["']$/g, '')
      .trim();
    if (memberName && allTeams.length > 0) {
      return { name: memberName, role: 'specialist', team: allTeams[0] };
    }
  }

  return null;
}

export function parseOrgActions(rawText: string): { actions: OrgActionPayload[]; cleanText: string } {
  const actions: OrgActionPayload[] = [];
  let cleanText = rawText;

  const blockRegex = /```(?:org-action|json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(rawText)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && typeof item === 'object' && typeof item.action === 'string' && typeof item.name === 'string') {
          actions.push(item as OrgActionPayload);
        }
      }
      cleanText = cleanText.replace(match[0], '').trim();
    } catch {
      // Ignore non-matching block
    }
  }

  if (actions.length === 0) {
    const rawJsonMatch = rawText.match(/\[\s*\{\s*"action"\s*:[\s\S]*?\}\s*\]/);
    if (rawJsonMatch) {
      try {
        const parsed = JSON.parse(rawJsonMatch[0]);
        for (const item of parsed) {
          if (item && typeof item === 'object' && typeof item.action === 'string' && typeof item.name === 'string') {
            actions.push(item as OrgActionPayload);
          }
        }
        cleanText = cleanText.replace(rawJsonMatch[0], '').trim();
      } catch {
        // Ignore JSON parse failure
      }
    }
  }

  return { actions, cleanText };
}

export interface AgentExecutionOptions {
  agent: OrgAgentMember;
  systemPrompt: string;
  userDirective: string;
  workspacePath: string;
  onStreamUpdate: (text: string) => void;
  conversationId?: string;
  /** True when the workspace path was explicitly requested for this step (not inherited/fallback). */
  workspaceExplicit?: boolean;
}

type UpdateNodeStatus = (nodeId: string, status: OrgNodeStatus) => void;

export const MAX_DELEGATION_DEPTH = 6;

export class OrgDelegationEngine {
  private hierarchy: OrgHierarchy;
  private onStepCallback?: (log: DelegationStepLog) => void;
  private onAgentStream?: (text: string) => void;
  private updateNodeStatus?: UpdateNodeStatus;
  private simulationMode: boolean;
  private projects: OrgProject[] = [];
  public lastBackendConversationId?: string;

  constructor(
    hierarchy: OrgHierarchy,
    onStepCallback?: (log: DelegationStepLog) => void,
    onAgentStream?: (text: string) => void,
    updateNodeStatus?: UpdateNodeStatus,
    options?: { simulationMode?: boolean; projects?: OrgProject[] }
  ) {
    this.hierarchy = hierarchy;
    this.onStepCallback = onStepCallback;
    this.onAgentStream = onAgentStream;
    this.updateNodeStatus = updateNodeStatus;
    this.simulationMode = options?.simulationMode ?? true;
    this.projects = options?.projects ?? [];
  }

  private emitStep(step: DelegationStepLog) {
    if (this.onStepCallback) {
      this.onStepCallback(step);
    }
  }

  /**
   * Executes a single agent step against the real AionUi backend (conversation runner).
   * Runs inside the agent's bound `workspacePath` as the working directory.
   */
  private async runOrgAgentStep(opts: AgentExecutionOptions): Promise<string> {
    const rawWorkspace = opts.workspacePath || this.hierarchy.rootCeo.workspacePath;
    let effectiveWorkspace = rawWorkspace && rawWorkspace !== 'workspace' ? rawWorkspace : '';

    // Path Guard Enforcement: when an organization root is bound, never run an agent
    // outside it. If the check throws, fail closed (treat as not allowed).
    // Choice: abort with a clear error for explicitly requested out-of-scope paths
    // (user/step asked to run there); fall back to allowedRoot only when the path
    // was inherited/empty so routine work can still proceed inside the org root.
    const allowedRoot = this.hierarchy.rootCeo.workspacePath;
    if (allowedRoot && effectiveWorkspace && effectiveWorkspace !== 'workspace') {
      try {
        const scopeCheck = await ipcBridge.org.assertWithinScope(effectiveWorkspace, allowedRoot);
        if (!scopeCheck.allowed) {
          const reason = scopeCheck.reason || 'path outside allowed root';
          console.warn(
            `[OrgDelegationEngine:pathGuard] Workspace "${effectiveWorkspace}" outside allowed root "${allowedRoot}":`,
            reason
          );
          if (opts.workspaceExplicit) {
            throw new Error(
              `Workspace "${effectiveWorkspace}" is outside the organization root "${allowedRoot}": ${reason}`
            );
          }
          // Inherited/implicit path fell outside scope: fall back to the allowed root.
          effectiveWorkspace = allowedRoot;
        } else if (scopeCheck.resolved) {
          effectiveWorkspace = scopeCheck.resolved;
        }
      } catch (err) {
        if (opts.workspaceExplicit) {
          throw err instanceof Error ? err : new Error(String(err));
        }
        // Fail closed for inherited paths when scope cannot be verified.
        console.warn(
          '[OrgDelegationEngine:pathGuard] scope check failed closed for inherited workspace:',
          err
        );
        effectiveWorkspace = allowedRoot;
      }
    }

    const isCustomWorkspace = Boolean(effectiveWorkspace);

    if (this.simulationMode) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return `[Simulated] ${opts.agent.name} (${opts.agent.model?.modelId || 'default model'}) executed: "${opts.userDirective.slice(0, 60)}..." in ${effectiveWorkspace || 'default workspace'}`;
    }

    const collectedText: string[] = [];
    let finished = false;
    let lastActivity = Date.now();
    let unsubscribe: (() => void) | undefined;
    let runError: string | null = null;

    try {
      // 1. Resolve real available assistant from backend
      let assistantId = opts.agent.canonicalAgentId || opts.agent.id;
      try {
        const assistants = (await ipcBridge.assistants.list.invoke()) ?? [];
        const enabled = assistants.filter((a) => a.enabled !== false);
        const preferred =
          enabled.find((a) => a.source === 'generated' && a.agent?.type === 'aionrs') ??
          enabled.find((a) => a.agent?.type === 'aionrs') ??
          enabled.find((a) => a.id.includes('aionrs'));
        if (preferred?.id) {
          assistantId = preferred.id;
        }
      } catch {
        // Fallback to bare:aionrs
        assistantId = 'bare:aionrs';
      }

      // 2. Resolve model from configured App Settings
      let resolvedModel: { id: string; use_model: string } | undefined;
      try {
        const providers = (await ipcBridge.mode.listProviders.invoke()) ?? [];
        const enabledProviders = providers.filter((p) => p.enabled !== false);

        if (opts.agent.model?.providerId && opts.agent.model?.modelId) {
          const matchedProvider = enabledProviders.find((p) => p.id === opts.agent.model?.providerId);
          if (matchedProvider) {
            resolvedModel = { id: matchedProvider.id, use_model: opts.agent.model.modelId };
          }
        }
        if (!resolvedModel && opts.agent.model?.modelId) {
          const matchedProvider = enabledProviders.find((p) => p.models?.includes(opts.agent.model!.modelId));
          if (matchedProvider) {
            resolvedModel = { id: matchedProvider.id, use_model: opts.agent.model.modelId };
          }
        }
        // Fall back to Root CEO's assigned model if configured
        if (!resolvedModel && this.hierarchy.rootCeo.ceoAgent.model?.modelId) {
          const ceoModel = this.hierarchy.rootCeo.ceoAgent.model;
          const matchedProvider = enabledProviders.find(
            (p) => (ceoModel.providerId && p.id === ceoModel.providerId) || p.models?.includes(ceoModel.modelId)
          );
          if (matchedProvider) {
            resolvedModel = { id: matchedProvider.id, use_model: ceoModel.modelId };
          }
        }
        // Fall back to first available model from user's enabled providers
        if (!resolvedModel && enabledProviders.length > 0) {
          const p = enabledProviders.find((prov) => prov.models && prov.models.length > 0) || enabledProviders[0];
          resolvedModel = {
            id: p.id,
            use_model: (p.models && p.models[0]) || opts.agent.model?.modelId || 'default',
          };
        }
        // Final fallback to agent's custom model definition
        if (!resolvedModel && opts.agent.model?.modelId) {
          resolvedModel = {
            id: opts.agent.model.providerId || 'default',
            use_model: opts.agent.model.modelId,
          };
        }
      } catch {
        // Non-fatal provider resolution fallback
      }

      // 3. Resolve or create real conversation session
      let convId = opts.conversationId;
      if (!convId) {
        const createPayload: Record<string, unknown> = {
          name: `Org: ${opts.agent.name}`,
          assistant: { id: assistantId },
          extra: {
            workspace: effectiveWorkspace,
            custom_workspace: isCustomWorkspace,
          },
        };
        if (resolvedModel) {
          createPayload.model = resolvedModel;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const createdConv = (await ipcBridge.conversation.create.invoke(createPayload as any)) as {
          id?: string;
        } | null;
        convId = createdConv?.id;
        if (!convId) {
          throw new Error('Failed to create conversation: backend returned no conversation id');
        }
      }
      this.lastBackendConversationId = convId;

      unsubscribe = ipcBridge.conversation.responseStream.on((msg: unknown) => {
        const m = msg as { conversation_id?: string; data?: unknown; type?: string; status?: string };
        if (m.conversation_id !== convId) return;
        if (m.type === 'error' || m.status === 'error') {
          const errText = typeof m.data === 'string' ? m.data : JSON.stringify(m.data);
          collectedText.push(`\n[Inference Error: ${errText}]`);
          finished = true;
        } else if (m.data) {
          const text =
            typeof m.data === 'string'
              ? m.data
              : ((m.data as { content?: string; text?: string })?.content ??
                (m.data as { content?: string; text?: string })?.text ??
                '');
          if (text) {
            collectedText.push(text);
            opts.onStreamUpdate(text);
            this.onAgentStream?.(text);
          }
        }
        if (m.status === 'finish' || m.type === 'finish') {
          finished = true;
        }
        lastActivity = Date.now();
      });

      const promptToSend = opts.conversationId
        ? opts.userDirective
        : `[Role Persona: You are ${opts.agent.name}, acting as "${opts.agent.role}" (${opts.agent.title || 'Team Member'}). Assigned Model: ${resolvedModel?.use_model || opts.agent.model?.modelId || 'default'}. Instructions: ${opts.systemPrompt || opts.agent.systemPrompt || 'Coordinate and answer directly as this organizational member.'}]\n\n${opts.userDirective}`;

      try {
        await ipcBridge.conversation.sendMessage.invoke({
          conversation_id: convId,
          input: promptToSend,
        });
      } catch (sendErr) {
        if (opts.conversationId) {
          // If previous session is stale, create fresh session and retry
          const createPayload: Record<string, unknown> = {
            name: `Org: ${opts.agent.name}`,
            assistant: { id: assistantId },
            extra: {
              workspace: effectiveWorkspace,
              custom_workspace: isCustomWorkspace,
            },
          };
          if (resolvedModel) createPayload.model = resolvedModel;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const freshConv = (await ipcBridge.conversation.create.invoke(createPayload as any)) as {
            id?: string;
          } | null;
          if (freshConv?.id) {
            convId = freshConv.id;
            this.lastBackendConversationId = convId;
            const fullPrompt = `[Role Persona: You are ${opts.agent.name}, acting as "${opts.agent.role}" (${opts.agent.title || 'Team Member'}). Assigned Model: ${resolvedModel?.use_model || opts.agent.model?.modelId || 'default'}. Instructions: ${opts.systemPrompt || opts.agent.systemPrompt || 'Coordinate and answer directly as this organizational member.'}]\n\n${opts.userDirective}`;
            await ipcBridge.conversation.sendMessage.invoke({
              conversation_id: convId,
              input: fullPrompt,
            });
          } else {
            throw sendErr;
          }
        } else {
          throw sendErr;
        }
      }

      // Wait for stream finish or 120s inactivity timeout
      await new Promise<void>((resolve, reject) => {
        const inactivityCheck = setInterval(() => {
          if (finished) {
            clearInterval(inactivityCheck);
            resolve();
            return;
          }
          if (Date.now() - lastActivity > 120000) {
            clearInterval(inactivityCheck);
            reject(new Error('Org agent step timed out: no stream activity for 120s'));
          }
        }, 500);
      });
    } catch (err) {
      console.warn('[OrgDelegationEngine] LLM invocation warning:', err);
      runError = err instanceof Error ? err.message : String(err);
    } finally {
      unsubscribe?.();
    }

    if (collectedText.length > 0) {
      return collectedText.join('');
    }

    if (runError) {
      return `Hello! I am ${opts.agent.name} (${opts.agent.title || opts.agent.role}). I received your directive: "${opts.userDirective}".\n\n(Notice: Model provider connection reported: ${runError}. Please configure your API key or active model under Settings -> Model).`;
    }

    return `Hello! I am ${opts.agent.name} (${opts.agent.title || opts.agent.role}). I am ready and on duty. How can I assist you with our team's objectives?`;
  }

  /**
   * Direct 1:1 conversation with any specific agent in the organization
   */
  public async executeDirectMessage(
    agent: OrgAgentMember,
    userPrompt: string,
    workspacePath?: string,
    useRealExecution = true,
    systemPromptOverride?: string,
    conversationId?: string
  ): Promise<string> {
    this.simulationMode = !useRealExecution;
    const explicitWorkspace =
      typeof workspacePath === 'string' && workspacePath.trim() !== '' && workspacePath !== 'workspace';
    const rawPath = workspacePath || agent.workspacePath || this.hierarchy.rootCeo.workspacePath;
    const resolvedPath = rawPath && rawPath !== 'workspace' ? rawPath : '';

    this.updateNodeStatus?.(agent.id, 'working');
    try {
      const response = await this.runOrgAgentStep({
        agent,
        systemPrompt:
          systemPromptOverride ||
          agent.systemPrompt ||
          `You are ${agent.name}, role "${agent.role}" (${agent.title || 'Team Member'}). Assigned AI Model: ${agent.model?.modelId || 'default'}. You are talking directly with the user. Answer accurately and perform tasks aligned with your expertise.`,
        userDirective: userPrompt,
        workspacePath: resolvedPath,
        onStreamUpdate: (text) => this.onAgentStream?.(text),
        conversationId,
        workspaceExplicit: explicitWorkspace,
      });
      return response;
    } finally {
      this.updateNodeStatus?.(agent.id, 'recently_finished');
    }
  }

  /**
   * Primary entry point: User prompt submitted to a node (CEO / Department / Team).
   *
   * @param userPrompt - user's task directive
   * @param targetDeptId - when set, delegate directly to this department (skips Root CEO routing)
   * @param targetTeamId - when set, delegate directly to this team (Team Lead orchestrates members)
   * @param projectId - bound project folder to execute inside
   * @param useRealExecution - when false, uses synthetic simulation (default: true)
   */
  public async executeDirective(
    userPrompt: string,
    targetDeptId?: string,
    targetTeamId?: string,
    projectId?: string,
    useRealExecution = false,
    fallbackPath?: string
  ): Promise<DelegationExecutionResult> {
    this.simulationMode = !useRealExecution;
    const directiveId = `dir-${Date.now()}`;
    const logs: DelegationStepLog[] = [];

    const rootCeo = this.hierarchy.rootCeo;
    const addLog = (log: Omit<DelegationStepLog, 'id' | 'timestamp'>) => {
      const fullLog: DelegationStepLog = {
        ...log,
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: Date.now(),
      };
      logs.push(fullLog);
      this.emitStep(fullLog);
      return fullLog;
    };

    // Step 1: User -> Root CEO
    addLog({
      depth: 1,
      fromName: 'User / Executive Board',
      fromRole: 'User',
      toName: rootCeo.ceoAgent.name,
      toRole: 'Root CEO',
      message: `Directive received: "${userPrompt}"`,
      status: 'working',
    });

    this.updateNodeStatus?.('root-ceo', 'working');

    // -------------------------------------------------------------
    // Intent check 0: Folder / Workspace Access Inquiry
    // -------------------------------------------------------------
    const folderInquiryMatch = userPrompt.match(
      /(?:how\s+(?:can|do)\s+i\s+.*(?:folder|directory|files|workspace)|(?:give|set|attach|bind|provide|load)\s+(?:you\s+)?(?:a\s+)?(?:folder|directory|workspace))/i
    );
    if (folderInquiryMatch) {
      addLog({
        depth: 1,
        fromName: rootCeo.ceoAgent.name,
        fromRole: 'Root CEO',
        toName: 'User / Executive Board',
        toRole: 'User',
        message: 'Providing instructions for binding local organization folder.',
        status: 'completed',
      });
      this.updateNodeStatus?.('root-ceo', 'recently_finished');

      const boundPath = rootCeo.workspacePath;
      const explanation = boundPath
        ? `Global Organization CEO: Our organization is currently bound to the folder:\n\`${boundPath}\`\n\nTo change or update the root folder:\n1. Click the **"Bind Folder"** button right next to the model selector in the bottom chat bar (or in the header).\n2. Alternatively, switch to **🗺️ 2D Canvas**, click on **Root CEO**, and select **Edit** to configure the directory path.\n\nAll departments and teams automatically inherit this directory as their working root!`
        : `Global Organization CEO: You can give me and our AI bots full access to your organization's files in two quick ways:\n\n1. **Bottom Chat Bar**: Click the **"Bind Folder"** button right next to the model selector at the bottom of this chat bar.\n2. **Top Header**: Click the folder button next to my title in the header above.\n3. **2D Canvas View**: Switch to the **🗺️ 2D Canvas**, click on **Root CEO** (or any Department / Team), and select **Edit** to set its workspace folder.\n\nOnce bound, our AI agents can read docs, analyze codebases, create projects, and perform work directly inside that directory!`;

      return {
        success: true,
        directiveId,
        userPrompt,
        logs,
        finalSynthesis: explanation,
        involvedDepartmentIds: [],
        involvedTeamIds: [],
      };
    }

    // -------------------------------------------------------------
    // Intent check 0B: Department Decommission / Removal Request
    // -------------------------------------------------------------
    const deleteDeptIntent = extractDepartmentDeletionIntent(userPrompt, this.hierarchy.departments);
    if (deleteDeptIntent && deleteDeptIntent.department) {
      const targetDept = deleteDeptIntent.department;
      this.hierarchy.departments = this.hierarchy.departments.filter((d) => d.id !== targetDept.id);

      addLog({
        depth: 1,
        fromName: rootCeo.ceoAgent.name,
        fromRole: 'Root CEO',
        toName: 'Executive Operations',
        toRole: 'Chief of Staff',
        message: `Decommissioning department "${targetDept.name}" and unlinking its resources.`,
        status: 'completed',
      });

      this.updateNodeStatus?.('root-ceo', 'recently_finished');

      return {
        success: true,
        directiveId,
        userPrompt,
        logs,
        finalSynthesis: `Global Organization CEO: I have decommissioned the "${targetDept.name}" department and unlinked its associated resources.`,
        involvedDepartmentIds: [targetDept.id],
        involvedTeamIds: [],
        deletedDepartmentIds: [targetDept.id],
      };
    }

    // -------------------------------------------------------------
    // Intent check 0C: Project Discovery & Batch Creation Request
    // -------------------------------------------------------------
    const batchOrDiscovery = extractProjectDiscoveryOrBatchIntent(
      userPrompt,
      this.hierarchy.departments,
      targetDeptId,
      rootCeo.workspacePath,
      fallbackPath
    );
    if (batchOrDiscovery) {
      const targetDept = batchOrDiscovery.targetDepartment;
      let targetFolder = batchOrDiscovery.folderPath;
      let createdProjects: OrgProject[] = [];
      const createdTeams: Array<{ departmentId: string; team: OrgTeamNode }> = [];

      if (batchOrDiscovery.type === 'discover') {
        if (!targetFolder) {
          addLog({
            depth: 1,
            fromName: rootCeo.ceoAgent.name,
            fromRole: 'Root CEO',
            toName: 'User / Executive Board',
            toRole: 'User',
            message: `Department "${targetDept.name}" requested project discovery but no workspace folder is bound yet.`,
            status: 'completed',
          });
          return {
            success: false,
            directiveId,
            userPrompt,
            logs,
            finalSynthesis: `Global Organization CEO: I am ready to scan and discover all apps and projects for the "${targetDept.name}" department. Please specify or bind the folder path to scan (e.g. 'search projects in G:\\My Drive\\Life\\Money\\Apps').`,
            involvedDepartmentIds: [targetDept.id],
            involvedTeamIds: [],
          };
        }

        addLog({
          depth: 1,
          fromName: rootCeo.ceoAgent.name,
          fromRole: 'Root CEO',
          toName: targetDept.departmentCeoAgent.name,
          toRole: 'Department CEO',
          message: `Scanning workspace folder "${targetFolder}" to discover projects for department "${targetDept.name}".`,
          status: 'working',
        });

        // Ensure department has at least one active team to lead these projects
        if (targetDept.teams.length === 0) {
          const defaultTeam = createTeamShell(targetDept.id, 'Core');
          defaultTeam.workspacePath = targetFolder;
          targetDept.teams.push(defaultTeam);
          createdTeams.push({ departmentId: targetDept.id, team: defaultTeam });
        }

        let discovered: Array<{ name: string; path: string; description?: string }> = [];
        try {
          discovered = await ipcBridge.org.discoverProjects(targetFolder);
        } catch {
          discovered = [];
        }

        // If no projects found in targetFolder, try fallbackPath from conversation history
        if (discovered.length === 0 && fallbackPath && fallbackPath !== targetFolder) {
          try {
            const fallbackDiscovered = await ipcBridge.org.discoverProjects(fallbackPath);
            if (fallbackDiscovered.length > 0) {
              targetFolder = fallbackPath;
              discovered = fallbackDiscovered;
            }
          } catch {
            // ignore
          }
        }

        if (discovered.length > 0) {
          createdProjects = discovered.map((p, idx) => ({
            id: `proj-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 5)}`,
            name: p.name,
            departmentId: targetDept.id,
            teamIds: targetDept.teams.length > 0 ? [targetDept.teams[0].id] : [],
            description: p.description || `Discovered project from "${p.path}"`,
            status: 'active',
            path: p.path,
            workspacePath: p.path,
          }));

          for (const proj of createdProjects) {
            targetDept.linkedProjects.push({ id: proj.id, name: proj.name, path: proj.path });
          }

          // Persist targetFolder as department and root workspace
          targetDept.workspacePath = targetFolder;
          if (!rootCeo.workspacePath) {
            rootCeo.workspacePath = targetFolder;
          }

          addLog({
            depth: 2,
            fromName: targetDept.departmentCeoAgent.name,
            fromRole: 'Department CEO',
            toName: 'User / Executive Board',
            toRole: 'User',
            message: `Discovered and registered ${createdProjects.length} projects under department "${targetDept.name}".`,
            status: 'completed',
          });

          this.updateNodeStatus?.('root-ceo', 'recently_finished');

          return {
            success: true,
            directiveId,
            userPrompt,
            logs,
            finalSynthesis: `Global Organization CEO: I have scanned \`${targetFolder}\` and established ${createdProjects.length} projects under the "${targetDept.name}" department:\n\n${createdProjects.map((p) => `• **${p.name}** (\`${p.path}\`)`).join('\n')}\n\nYou can now chat under any project on the sidebar specifically with its project head.`,
            involvedDepartmentIds: [targetDept.id],
            involvedTeamIds: targetDept.teams.map((t) => t.id),
            createdProjects,
            createdTeams: createdTeams.length > 0 ? createdTeams : undefined,
            updatedDepartment: { departmentId: targetDept.id, patch: { workspacePath: targetFolder } },
            updatedRootCeoWorkspace: targetFolder,
          };
        } else if (!this.simulationMode) {
          addLog({
            depth: 2,
            fromName: targetDept.departmentCeoAgent.name,
            fromRole: 'Department CEO',
            toName: 'User / Executive Board',
            toRole: 'User',
            message: `Scanned folder "${targetFolder}" but no app or project subdirectories were found.`,
            status: 'completed',
          });
          return {
            success: false,
            directiveId,
            userPrompt,
            logs,
            finalSynthesis: `Global Organization CEO: I scanned \`${targetFolder}\`, but did not find any app directories. Please check that the folder path is correct (e.g. 'search projects in G:\\My Drive\\Life\\Money\\Apps').`,
            involvedDepartmentIds: [targetDept.id],
            involvedTeamIds: [],
          };
        } else if (this.simulationMode) {
          const sampleProjects = ['Web App', 'API Service', 'Mobile Client'];
          createdProjects = sampleProjects.map((name, idx) => {
            const projPath = getDefaultProjectPath(targetFolder, name);
            return {
              id: `proj-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 5)}`,
              name,
              departmentId: targetDept.id,
              teamIds: targetDept.teams.length > 0 ? [targetDept.teams[0].id] : [],
              description: `Project initialized in "${targetFolder}"`,
              status: 'active',
              path: projPath,
              workspacePath: projPath,
            };
          });

          for (const proj of createdProjects) {
            targetDept.linkedProjects.push({ id: proj.id, name: proj.name, path: proj.path });
          }

          targetDept.workspacePath = targetFolder;
          if (!rootCeo.workspacePath) {
            rootCeo.workspacePath = targetFolder;
          }

          addLog({
            depth: 2,
            fromName: targetDept.departmentCeoAgent.name,
            fromRole: 'Department CEO',
            toName: 'User / Executive Board',
            toRole: 'User',
            message: `Initialized ${createdProjects.length} projects under department "${targetDept.name}".`,
            status: 'completed',
          });

          this.updateNodeStatus?.('root-ceo', 'recently_finished');

          return {
            success: true,
            directiveId,
            userPrompt,
            logs,
            finalSynthesis: `Global Organization CEO: Initialized ${createdProjects.length} projects under the "${targetDept.name}" department in \`${targetFolder}\`:\n\n${createdProjects.map((p) => `• **${p.name}** (\`${p.path}\`)`).join('\n')}\n\nYou can now chat under any project on the sidebar specifically with its project head.`,
            involvedDepartmentIds: [targetDept.id],
            involvedTeamIds: targetDept.teams.map((t) => t.id),
            createdProjects,
            createdTeams: createdTeams.length > 0 ? createdTeams : undefined,
            updatedDepartment: { departmentId: targetDept.id, patch: { workspacePath: targetFolder } },
            updatedRootCeoWorkspace: targetFolder,
          };
        }
      } else if (batchOrDiscovery.type === 'batch_create' && batchOrDiscovery.projectNames) {
        if (targetDept.teams.length === 0 && targetFolder) {
          const defaultTeam = createTeamShell(targetDept.id, 'Core');
          defaultTeam.workspacePath = targetFolder;
          targetDept.teams.push(defaultTeam);
          createdTeams.push({ departmentId: targetDept.id, team: defaultTeam });
        }
        createdProjects = batchOrDiscovery.projectNames.map((name, idx) => {
          const projPath = targetFolder ? getDefaultProjectPath(targetFolder, name) : undefined;
          return {
            id: `proj-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 5)}`,
            name,
            departmentId: targetDept.id,
            teamIds: targetDept.teams.length > 0 ? [targetDept.teams[0].id] : [],
            description: `Project initialized via Root CEO directive: "${userPrompt}"`,
            status: 'active',
            path: projPath,
            workspacePath: projPath,
          };
        });

        for (const proj of createdProjects) {
          targetDept.linkedProjects.push({ id: proj.id, name: proj.name, path: proj.path });
        }

        if (targetFolder) {
          targetDept.workspacePath = targetFolder;
          if (!rootCeo.workspacePath) {
            rootCeo.workspacePath = targetFolder;
          }
        }

        addLog({
          depth: 1,
          fromName: rootCeo.ceoAgent.name,
          fromRole: 'Root CEO',
          toName: targetDept.departmentCeoAgent.name,
          toRole: 'Department CEO',
          message: `Provisioned ${createdProjects.length} projects in department "${targetDept.name}".`,
          status: 'completed',
        });

        this.updateNodeStatus?.('root-ceo', 'recently_finished');

        return {
          success: true,
          directiveId,
          userPrompt,
          logs,
          finalSynthesis: `Global Organization CEO: Provisioned ${createdProjects.length} projects in "${targetDept.name}":\n\n${createdProjects.map((p) => `• **${p.name}**`).join('\n')}`,
          involvedDepartmentIds: [targetDept.id],
          involvedTeamIds: targetDept.teams.map((t) => t.id),
          createdProjects,
          createdTeams: createdTeams.length > 0 ? createdTeams : undefined,
          updatedDepartment: targetFolder
            ? { departmentId: targetDept.id, patch: { workspacePath: targetFolder } }
            : undefined,
          updatedRootCeoWorkspace: targetFolder && !rootCeo.workspacePath ? targetFolder : undefined,
        };
      }
    }

    // -------------------------------------------------------------
    // Intent check A: Direct Department Creation Request
    // -------------------------------------------------------------
    const deptIntent = extractDepartmentCreationIntent(userPrompt);
    if (deptIntent && deptIntent.name) {
      const deptName = deptIntent.name;
      const newDept = createDepartmentShell(deptName);
      if (deptIntent.workspacePath) {
        newDept.workspacePath = deptIntent.workspacePath;
        if (!rootCeo.workspacePath) {
          rootCeo.workspacePath = deptIntent.workspacePath;
        }
      } else if (rootCeo.workspacePath) {
        newDept.workspacePath = getDefaultDeptPath(rootCeo.workspacePath, deptName);
      }

      // Auto-provision default Core team so department is immediately operational
      const defaultTeam = createTeamShell(newDept.id, 'Core');
      if (newDept.workspacePath) {
        defaultTeam.workspacePath = newDept.workspacePath;
      }
      newDept.teams.push(defaultTeam);
      const createdTeams = [{ departmentId: newDept.id, team: defaultTeam }];

      addLog({
        depth: 1,
        fromName: rootCeo.ceoAgent.name,
        fromRole: 'Root CEO',
        toName: 'Executive Operations',
        toRole: 'Chief of Staff',
        message: `Instantiating new department "${deptName}" with dedicated Department Head and core execution team.`,
        status: 'working',
      });

      addLog({
        depth: 1,
        fromName: rootCeo.ceoAgent.name,
        fromRole: 'Root CEO',
        toName: 'User / Executive Board',
        toRole: 'User',
        message: `Department "${deptName}" successfully instantiated. Ready for team configurations and project assignments.`,
        status: 'completed',
      });

      this.updateNodeStatus?.('root-ceo', 'recently_finished');

      return {
        success: true,
        directiveId,
        userPrompt,
        logs,
        finalSynthesis: `Global Organization CEO: I have established the "${deptName}" department with a dedicated Department Head. You can now configure sub-teams, bind workspaces, or issue directives to this department.`,
        involvedDepartmentIds: [newDept.id],
        involvedTeamIds: [defaultTeam.id],
        createdDepartments: [newDept],
        createdTeams,
        updatedDepartment: newDept.workspacePath
          ? { departmentId: newDept.id, patch: { workspacePath: newDept.workspacePath } }
          : undefined,
        updatedRootCeoWorkspace: !rootCeo.workspacePath && newDept.workspacePath ? newDept.workspacePath : undefined,
      };
    }

    // -------------------------------------------------------------
    // Intent check B: Direct Team Creation Request
    // -------------------------------------------------------------
    const teamIntent = extractTeamCreationIntent(userPrompt, this.hierarchy.departments, targetDeptId);
    if (teamIntent && teamIntent.name && teamIntent.department) {
      const explicitTeamName = teamIntent.name;
      const explicitDeptTarget = teamIntent.department;
      const newTeam = createTeamShell(explicitDeptTarget.id, explicitTeamName);
      if (rootCeo.workspacePath) {
        newTeam.workspacePath = getDefaultTeamPath(rootCeo.workspacePath, explicitDeptTarget.name, explicitTeamName);
      }

      addLog({
        depth: 1,
        fromName: rootCeo.ceoAgent.name,
        fromRole: 'Root CEO',
        toName: explicitDeptTarget.departmentCeoAgent.name,
        toRole: 'Department CEO',
        message: `Directing creation of Sub-Team "${explicitTeamName}" under ${explicitDeptTarget.name}.`,
        status: 'working',
      });

      addLog({
        depth: 2,
        fromName: explicitDeptTarget.departmentCeoAgent.name,
        fromRole: 'Department CEO',
        toName: 'User / Executive Board',
        toRole: 'User',
        message: `Sub-Team "${explicitTeamName}" created with dedicated Team Lead and HR Coordinator.`,
        status: 'completed',
      });

      this.updateNodeStatus?.('root-ceo', 'recently_finished');

      return {
        success: true,
        directiveId,
        userPrompt,
        logs,
        finalSynthesis: `Global Organization CEO: Created sub-team "${explicitTeamName}" under the "${explicitDeptTarget.name}" department. Equipped with a Team Lead and HR Coordinator.`,
        involvedDepartmentIds: [explicitDeptTarget.id],
        involvedTeamIds: [newTeam.id],
        createdTeams: [{ departmentId: explicitDeptTarget.id, team: newTeam }],
      };
    }

    // -------------------------------------------------------------
    // Intent check C: Project Creation Request
    // -------------------------------------------------------------
    const projectIntent = extractProjectCreationIntent(userPrompt, this.hierarchy.departments, targetDeptId);
    if (projectIntent && projectIntent.name && projectIntent.department) {
      const explicitProjectName = projectIntent.name;
      const explicitProjectDeptTarget = projectIntent.department;
      const newProjectId = `proj-${Date.now()}`;
      const projectPath =
        projectIntent.workspacePath ||
        (rootCeo.workspacePath ? getDefaultProjectPath(rootCeo.workspacePath, explicitProjectName) : undefined);

      const newProject: OrgProject = {
        id: newProjectId,
        name: explicitProjectName,
        departmentId: explicitProjectDeptTarget.id,
        teamIds: explicitProjectDeptTarget.teams.length > 0 ? [explicitProjectDeptTarget.teams[0].id] : [],
        description: `Project initialized via Root CEO directive: "${userPrompt}"`,
        status: 'active',
        path: projectPath,
        workspacePath: projectPath,
      };

      addLog({
        depth: 1,
        fromName: rootCeo.ceoAgent.name,
        fromRole: 'Root CEO',
        toName: explicitProjectDeptTarget.departmentCeoAgent.name,
        toRole: 'Department CEO',
        message: `Allocating new strategic project "${explicitProjectName}" to department "${explicitProjectDeptTarget.name}".`,
        status: 'working',
      });

      addLog({
        depth: 2,
        fromName: explicitProjectDeptTarget.departmentCeoAgent.name,
        fromRole: 'Department CEO',
        toName: 'User / Executive Board',
        toRole: 'User',
        message: `Project "${explicitProjectName}" successfully registered and assigned.`,
        status: 'completed',
      });

      this.updateNodeStatus?.('root-ceo', 'recently_finished');

      return {
        success: true,
        directiveId,
        userPrompt,
        logs,
        finalSynthesis: `Global Organization CEO: Project "${explicitProjectName}" has been created under department "${explicitProjectDeptTarget.name}".`,
        involvedDepartmentIds: [explicitProjectDeptTarget.id],
        involvedTeamIds: newProject.teamIds,
        createdProjects: [newProject],
      };
    }

    // -------------------------------------------------------------
    // Intent check D: Member / Specialist / Bot Creation Request
    // -------------------------------------------------------------
    const memberIntent = extractMemberCreationIntent(userPrompt, this.hierarchy.departments);
    if (memberIntent && memberIntent.name && memberIntent.team) {
      const explicitMemberName = memberIntent.name;
      const explicitMemberRole = memberIntent.role || 'specialist';
      const explicitTeamTarget = memberIntent.team;
      // Check if user requested a specific model (e.g. "with model gpt-4o" or "using claude-3-7-sonnet")
      const modelMatch = userPrompt.match(
        /(?:with|using|model)\s+(claude-[a-z0-9.-]+|gpt-[a-z0-9.-]+|gemini-[a-z0-9.-]+|deepseek-[a-z0-9.-]+|qwen[a-z0-9.-]*)/i
      );
      const chosenModelId = modelMatch ? modelMatch[1] : 'claude-3-7-sonnet';

      const newMember = createMemberShell(
        explicitMemberName,
        explicitMemberRole,
        `${explicitMemberName} (${explicitMemberRole})`,
        explicitTeamTarget.id,
        chosenModelId
      );

      addLog({
        depth: 1,
        fromName: rootCeo.ceoAgent.name,
        fromRole: 'Root CEO',
        toName: explicitTeamTarget.hrCoordinatorAgent.name,
        toRole: 'HR & Workload Coordinator',
        message: `Provisioning AI bot specialist "${explicitMemberName}" [Model: ${chosenModelId}] to team "${explicitTeamTarget.name}".`,
        status: 'working',
      });

      addLog({
        depth: 2,
        fromName: explicitTeamTarget.hrCoordinatorAgent.name,
        fromRole: 'HR & Workload Coordinator',
        toName: 'User / Executive Board',
        toRole: 'User',
        message: `Specialist "${explicitMemberName}" successfully on-boarded and assigned to ${explicitTeamTarget.name}.`,
        status: 'completed',
      });

      this.updateNodeStatus?.('root-ceo', 'recently_finished');

      return {
        success: true,
        directiveId,
        userPrompt,
        logs,
        finalSynthesis: `Global Organization CEO: Recruited AI specialist "${explicitMemberName}" [Model: ${chosenModelId}] into team "${explicitTeamTarget.name}".`,
        involvedDepartmentIds: [explicitTeamTarget.departmentId],
        involvedTeamIds: [explicitTeamTarget.id],
        createdMembers: [{ teamId: explicitTeamTarget.id, member: newMember }],
      };
    }

    // Resolve target department / team
    let targetDept = targetDeptId ? this.hierarchy.departments.find((d) => d.id === targetDeptId) : undefined;
    let targetTeam = targetTeamId
      ? this.hierarchy.departments.flatMap((d) => d.teams).find((t) => t.id === targetTeamId)
      : undefined;

    if (targetTeam && !targetDept) {
      targetDept = this.hierarchy.departments.find((d) => d.teams.some((t) => t.id === targetTeamId));
    }
    if (targetTeam && targetDept && !targetDept.teams.some((t) => t.id === targetTeamId)) {
      targetTeam = undefined;
    }

    // Dynamic semantic matching if not explicitly targeted
    if (!targetDept && !targetTeam && this.hierarchy.departments.length > 0) {
      const lower = userPrompt.toLowerCase();
      const promptTokens = lower.split(/[\s,.;:!?/\\-_()[\]{}"]+/).filter((t) => t.length >= 2);

      let bestScore = 0;
      let bestDept: OrgDepartmentNode | undefined;

      for (const dept of this.hierarchy.departments) {
        let score = 0;
        const deptName = dept.name.toLowerCase();
        const deptDesc = (dept.description || '').toLowerCase();

        // Direct department name inclusion
        if (lower.includes(deptName)) score += 50;

        // Keyword overlap with name and description
        for (const token of promptTokens) {
          if (deptName.includes(token)) score += 15;
          if (deptDesc.includes(token)) score += 8;
        }

        // Keyword overlap with teams & specialists
        for (const team of dept.teams) {
          const teamName = team.name.toLowerCase();
          if (lower.includes(teamName)) score += 25;
          for (const token of promptTokens) {
            if (teamName.includes(token)) score += 10;
          }
          for (const spec of team.specialistMembers) {
            const specTitle = (spec.title || '').toLowerCase();
            const specRole = (spec.role || '').toLowerCase();
            for (const token of promptTokens) {
              if (specTitle.includes(token) || specRole.includes(token)) score += 6;
            }
          }
        }

        // Domain synonyms fallback
        if (
          /video|youtube|media|channel|film|audio|stream/i.test(deptName) &&
          /video|youtube|media|channel|film|audio|stream/i.test(lower)
        ) {
          score += 20;
        }
        if (
          /social|marketing|growth|tweet|post|instagram|tiktok/i.test(deptName) &&
          /social|marketing|growth|tweet|post|instagram|tiktok/i.test(lower)
        ) {
          score += 20;
        }
        if (
          /app|software|engineer|tech|code|dev|program/i.test(deptName) &&
          /app|software|engineer|tech|code|dev|program/i.test(lower)
        ) {
          score += 20;
        }
        if (
          /coach|health|life|people|hr|wellness/i.test(deptName) &&
          /coach|health|life|people|hr|wellness/i.test(lower)
        ) {
          score += 20;
        }

        if (score > bestScore) {
          bestScore = score;
          bestDept = dept;
        }
      }

      if (bestScore > 0 && bestDept) {
        targetDept = bestDept;
      }
    }

    // -------------------------------------------------------------
    // -------------------------------------------------------------
    // Direct Root CEO level execution (No departments or HQ directive)
    // -------------------------------------------------------------
    const isStructureDirective =
      /(?:create|add|new|setup|set\s+up|build|register|search|find|scan|import|discover|recruit|hire)\s+.*?\b(?:projects?|depar?t?ments?|sub-?teams?|teams?|specialists?|members?|bots?|agents?)\b/i.test(
        userPrompt
      ) ||
      /\b(?:projects?|sub-?teams?|teams?|specialists?|members?)\b.*?\b(?:in|under|to|for)\s+(?:this|the|that|our|current)?\s*depar?t?ments?/i.test(
        userPrompt
      );

    if (!targetDept || isStructureDirective) {
      addLog({
        depth: 1,
        fromName: rootCeo.ceoAgent.name,
        fromRole: 'Root CEO',
        toName: rootCeo.chiefOfStaffAgent?.name || 'Chief of Staff',
        toRole: 'Executive Operations',
        message: `Analyzing executive mandate at Global HQ level: "${userPrompt}"`,
        status: 'working',
      });

      const deptSummary = this.hierarchy.departments
        .map((d) => `- ${d.name} (id: ${d.id}, teams: ${d.teams.map((t) => t.name).join(', ') || 'none'})`)
        .join('\n');

      const ceoSystemPrompt = `You are the Global Organization CEO (${rootCeo.ceoAgent.name}).
You have full executive authority to direct strategy and establish or modify the organization's structure.

Current Organization Structure:
${deptSummary || 'No departments established yet.'}
Root Workspace: ${rootCeo.workspacePath || 'None configured'}

When the user asks you to create or set up departments, teams, projects, or team members, you MUST execute the action by outputting an \`\`\`org-action code block containing a JSON array of actions:
\`\`\`org-action
[
  { "action": "create_department", "name": "Department Name", "workspacePath": "optional/path", "description": "brief description" },
  { "action": "create_team", "department": "Department Name", "name": "Team Name", "description": "brief description" },
  { "action": "create_project", "department": "Department Name", "team": "optional Team Name", "name": "Project Name", "workspacePath": "optional/path" },
  { "action": "create_member", "team": "Team Name", "name": "Specialist Name", "role": "specialist", "title": "Role Title" }
]
\`\`\`

Always provide an executive confirmation message explaining the structure you created or plan to lead.
Never reply saying you cannot create departments or that you need more info if the user explicitly asked to create one. Output the \`\`\`org-action block and confirm the creation.`;

      let ceoSynthesis = '';
      if (!this.simulationMode) {
        try {
          ceoSynthesis = await this.runOrgAgentStep({
            agent: rootCeo.ceoAgent,
            systemPrompt: ceoSystemPrompt,
            userDirective: userPrompt,
            workspacePath: rootCeo.workspacePath || '',
            onStreamUpdate: (text) => this.onAgentStream?.(text),
          });
        } catch {
          ceoSynthesis = `Executive strategic roadmap formulated by ${rootCeo.ceoAgent.name}.`;
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 800));
        ceoSynthesis = `Global Organization CEO: Executive directive acknowledged for "${userPrompt}". I have evaluated the organizational requirements. You can instruct me to instantiate departments (e.g. 'Create department Engineering') or use the '+ Add Department' button on the canvas to begin building the team structure.`;
      }

      const { actions, cleanText } = parseOrgActions(ceoSynthesis);
      const createdDepartments: OrgDepartmentNode[] = [];
      const createdTeams: Array<{ departmentId: string; team: OrgTeamNode }> = [];
      const createdProjects: OrgProject[] = [];
      const createdMembers: Array<{ teamId: string; member: OrgAgentMember }> = [];
      const involvedDepartmentIds: string[] = [];
      const involvedTeamIds: string[] = [];

      for (const action of actions) {
        if (action.action === 'create_department' && action.name?.trim()) {
          const deptName = action.name.trim();
          const existing = this.hierarchy.departments.find((d) => d.name.toLowerCase() === deptName.toLowerCase());
          if (!existing) {
            const newDept = createDepartmentShell(deptName);
            if (action.workspacePath) {
              newDept.workspacePath = action.workspacePath;
            } else if (rootCeo.workspacePath) {
              newDept.workspacePath = getDefaultDeptPath(rootCeo.workspacePath, deptName);
            }
            if (action.description) {
              newDept.description = action.description;
            }
            createdDepartments.push(newDept);
            this.hierarchy.departments.push(newDept);
            involvedDepartmentIds.push(newDept.id);
            addLog({
              depth: 1,
              fromName: rootCeo.ceoAgent.name,
              fromRole: 'Root CEO',
              toName: 'Executive Operations',
              toRole: 'Chief of Staff',
              message: `Instantiating new department "${deptName}" via executive action.`,
              status: 'working',
            });
            addLog({
              depth: 1,
              fromName: rootCeo.ceoAgent.name,
              fromRole: 'Root CEO',
              toName: 'User / Executive Board',
              toRole: 'User',
              message: `Department "${deptName}" successfully instantiated.`,
              status: 'completed',
            });
          }
        } else if (action.action === 'create_team' && action.name?.trim()) {
          const teamName = action.name.trim();
          const deptQuery = (action.department || '').toLowerCase();
          const targetDeptCandidate =
            this.hierarchy.departments.find(
              (d) =>
                d.id.toLowerCase() === deptQuery ||
                d.name.toLowerCase() === deptQuery ||
                d.name.toLowerCase().includes(deptQuery) ||
                (deptQuery && deptQuery.includes(d.name.toLowerCase()))
            ) ||
            (this.hierarchy.departments.length > 0
              ? this.hierarchy.departments[this.hierarchy.departments.length - 1]
              : undefined);

          if (targetDeptCandidate) {
            const newTeam = createTeamShell(targetDeptCandidate.id, teamName);
            if (action.workspacePath) {
              newTeam.workspacePath = action.workspacePath;
            } else if (rootCeo.workspacePath) {
              newTeam.workspacePath = getDefaultTeamPath(rootCeo.workspacePath, targetDeptCandidate.name, teamName);
            }
            if (action.description) {
              newTeam.description = action.description;
            }
            targetDeptCandidate.teams.push(newTeam);
            createdTeams.push({ departmentId: targetDeptCandidate.id, team: newTeam });
            involvedDepartmentIds.push(targetDeptCandidate.id);
            involvedTeamIds.push(newTeam.id);
            addLog({
              depth: 1,
              fromName: rootCeo.ceoAgent.name,
              fromRole: 'Root CEO',
              toName: targetDeptCandidate.departmentCeoAgent.name,
              toRole: 'Department CEO',
              message: `Creating sub-team "${teamName}" in department "${targetDeptCandidate.name}".`,
              status: 'completed',
            });
          }
        } else if (action.action === 'create_project' && action.name?.trim()) {
          const projName = action.name.trim();
          const deptQuery = (action.department || '').toLowerCase();
          const targetDeptCandidate =
            (deptQuery
              ? this.hierarchy.departments.find(
                  (d) =>
                    d.id.toLowerCase() === deptQuery ||
                    d.name.toLowerCase() === deptQuery ||
                    d.name.toLowerCase().includes(deptQuery) ||
                    (deptQuery && deptQuery.includes(d.name.toLowerCase()))
                )
              : undefined) ||
            targetDept ||
            (this.hierarchy.departments.length > 0
              ? this.hierarchy.departments[this.hierarchy.departments.length - 1]
              : undefined);

          if (targetDeptCandidate) {
            const newProjPath =
              action.workspacePath ||
              (rootCeo.workspacePath ? getDefaultProjectPath(rootCeo.workspacePath, projName) : undefined);
            const newProj: OrgProject = {
              id: `proj-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
              name: projName,
              departmentId: targetDeptCandidate.id,
              teamIds: targetDeptCandidate.teams.length > 0 ? [targetDeptCandidate.teams[0].id] : [],
              description: action.description || `Project initialized via Root CEO directive: "${userPrompt}"`,
              status: 'active',
              path: newProjPath,
              workspacePath: newProjPath,
            };
            createdProjects.push(newProj);
            targetDeptCandidate.linkedProjects.push({ id: newProj.id, name: newProj.name, path: newProj.path });
            involvedDepartmentIds.push(targetDeptCandidate.id);
            addLog({
              depth: 1,
              fromName: rootCeo.ceoAgent.name,
              fromRole: 'Root CEO',
              toName: targetDeptCandidate.departmentCeoAgent.name,
              toRole: 'Department CEO',
              message: `Allocating new strategic project "${projName}" to department "${targetDeptCandidate.name}".`,
              status: 'completed',
            });
          }
        } else if (action.action === 'create_member' && action.name?.trim()) {
          const memberName = action.name.trim();
          const teamQuery = (action.team || '').toLowerCase();
          const allTeams = this.hierarchy.departments.flatMap((d) => d.teams);
          const targetTeamCandidate =
            allTeams.find(
              (t) =>
                t.id.toLowerCase() === teamQuery ||
                t.name.toLowerCase() === teamQuery ||
                t.name.toLowerCase().includes(teamQuery) ||
                (teamQuery && teamQuery.includes(t.name.toLowerCase()))
            ) || (allTeams.length > 0 ? allTeams[0] : undefined);

          if (targetTeamCandidate) {
            const newMember = createMemberShell(
              memberName,
              action.role || 'specialist',
              action.title || `${memberName} (${action.role || 'specialist'})`,
              targetTeamCandidate.id
            );
            targetTeamCandidate.specialistMembers.push(newMember);
            createdMembers.push({ teamId: targetTeamCandidate.id, member: newMember });
            involvedDepartmentIds.push(targetTeamCandidate.departmentId);
            involvedTeamIds.push(targetTeamCandidate.id);
            addLog({
              depth: 2,
              fromName: targetTeamCandidate.teamLeadAgent.name,
              fromRole: 'Team Lead',
              toName: 'Executive Operations',
              toRole: 'Operations',
              message: `Recruited specialist "${memberName}" into team "${targetTeamCandidate.name}".`,
              status: 'completed',
            });
          }
        }
      }

      const displaySynthesis =
        cleanText ||
        (actions.length > 0
          ? `Global Organization CEO: Executed organizational restructuring (${actions.map((a) => `${a.action}: ${a.name}`).join(', ')}).`
          : ceoSynthesis);

      addLog({
        depth: 1,
        fromName: rootCeo.ceoAgent.name,
        fromRole: 'Root CEO',
        toName: 'User / Executive Board',
        toRole: 'User',
        message: displaySynthesis,
        status: 'completed',
      });

      this.updateNodeStatus?.('root-ceo', 'recently_finished');

      return {
        success: true,
        directiveId,
        userPrompt,
        logs,
        finalSynthesis: displaySynthesis,
        involvedDepartmentIds,
        involvedTeamIds,
        createdDepartments: createdDepartments.length > 0 ? createdDepartments : undefined,
        createdTeams: createdTeams.length > 0 ? createdTeams : undefined,
        createdProjects: createdProjects.length > 0 ? createdProjects : undefined,
        createdMembers: createdMembers.length > 0 ? createdMembers : undefined,
      };
    }

    // Bound folder for execution context: project folder > team folder > department folder
    const foundProject = projectId
      ? this.projects.find((p) => p.id === projectId) || targetDept.linkedProjects.find((p) => p.id === projectId)
      : undefined;
    const targetProjectPath = foundProject
      ? ('workspacePath' in foundProject ? (foundProject as OrgProject).workspacePath : undefined) || foundProject.path
      : undefined;
    const projectFolder = targetProjectPath || targetTeam?.workspacePath || targetDept.workspacePath || '';

    // Step 2: Root CEO -> Department CEO
    addLog({
      depth: 2,
      fromName: rootCeo.ceoAgent.name,
      fromRole: 'Root CEO',
      toName: targetDept.departmentCeoAgent.name,
      toRole: 'Department CEO',
      message: `Assigning mandate to ${targetDept.name}: "${userPrompt}"`,
      status: 'working',
    });

    this.updateNodeStatus?.(targetDept.departmentCeoAgent.id, 'working');
    this.updateNodeStatus?.(targetDept.id, 'department_standby');

    // Resolve target team (first team of dept unless explicitly targeted)
    let newlyCreatedTeams: Array<{ departmentId: string; team: OrgTeamNode }> | undefined;
    if (!targetTeam) {
      targetTeam = targetDept.teams[0];
    }
    if (!targetTeam) {
      targetTeam = createTeamShell(targetDept.id, 'Core');
      targetTeam.workspacePath = projectFolder || targetDept.workspacePath;
      targetDept.teams.push(targetTeam);
      newlyCreatedTeams = [{ departmentId: targetDept.id, team: targetTeam }];
      addLog({
        depth: 2,
        fromName: targetDept.departmentCeoAgent.name,
        fromRole: 'Department CEO',
        toName: rootCeo.ceoAgent.name,
        toRole: 'Root CEO',
        message: `Department ${targetDept.name} established core execution team "Core" to lead work.`,
        status: 'working',
      });
    }

    // Department CEO -> Team Lead
    addLog({
      depth: 2,
      fromName: targetDept.departmentCeoAgent.name,
      fromRole: 'Department CEO',
      toName: targetTeam.teamLeadAgent.name,
      toRole: 'Team CEO / Manager',
      message: `Translating directive into sprint work for ${targetTeam.name} (folder: ${projectFolder || 'unbound'}).`,
      status: 'delegating',
    });

    this.updateNodeStatus?.(targetDept.id, 'department_standby');
    this.updateNodeStatus?.(targetDept.departmentCeoAgent.id, 'department_standby');
    this.updateNodeStatus?.(targetTeam.teamLeadAgent.id, 'working');
    this.updateNodeStatus?.(targetTeam.id, 'department_standby');

    // Team Lead & HR -> Specialists
    addLog({
      depth: 3,
      fromName: targetTeam.hrCoordinatorAgent.name,
      fromRole: 'HR & Workload Coordinator',
      toName: targetTeam.specialistMembers.map((s) => s.name).join(', ') || 'Specialists',
      toRole: 'Specialist Roster',
      message: `Assigning execution across ${targetTeam.specialistMembers.length} specialists inside ${projectFolder || 'workspace'}...`,
      status: 'working',
    });

    this.updateNodeStatus?.(targetTeam.hrCoordinatorAgent.id, 'department_standby');
    this.updateNodeStatus?.(targetTeam.id, 'department_standby');

    // Specialist or Team Lead execution
    const specialistOutputs: string[] = [];
    if (targetTeam.specialistMembers.length === 0) {
      const leadAgent = targetTeam.teamLeadAgent || targetDept.departmentCeoAgent;
      this.updateNodeStatus?.(leadAgent.id, 'working');
      addLog({
        depth: 4,
        fromName: targetDept.departmentCeoAgent.name,
        fromRole: 'Department CEO',
        toName: leadAgent.name,
        toRole: leadAgent.title || 'Team Manager',
        message: `Executing deliverable in project workspace "${targetTeam.linkedProjectName || projectFolder || 'Main'}"...`,
        status: 'working',
      });
      try {
        const leadOutput = await this.runOrgAgentStep({
          agent: leadAgent,
          systemPrompt: `You are ${leadAgent.name}, leading ${targetTeam.name}. Operating in workspace: ${projectFolder}. Coordinate and address the user's directive directly.`,
          userDirective: userPrompt,
          workspacePath: projectFolder,
          onStreamUpdate: (text) => {
            this.onAgentStream?.(text);
          },
        });
        if (leadOutput) {
          specialistOutputs.push(leadOutput);
        }
        this.updateNodeStatus?.(leadAgent.id, 'recently_finished');
        addLog({
          depth: 4,
          fromName: leadAgent.name,
          fromRole: leadAgent.title || 'Team Manager',
          toName: targetDept.departmentCeoAgent.name,
          toRole: 'Department CEO',
          message: leadOutput || `Completed deliverable in ${projectFolder || 'workspace'}.`,
          status: 'completed',
        });
      } catch (err) {
        addLog({
          depth: 4,
          fromName: leadAgent.name,
          fromRole: leadAgent.title || 'Team Manager',
          toName: targetDept.departmentCeoAgent.name,
          toRole: 'Department CEO',
          message: `Error: ${err instanceof Error ? err.message : String(err)}`,
          status: 'error',
        });
      }
    } else {
      for (let i = 0; i < Math.min(targetTeam.specialistMembers.length, 3); i++) {
        const spec = targetTeam.specialistMembers[i];

        this.updateNodeStatus?.(spec.id, 'queued_next');

        addLog({
          depth: 4,
          fromName: targetTeam.teamLeadAgent.name,
          fromRole: 'Team Manager',
          toName: spec.name,
          toRole: spec.title || 'Specialist',
          message: `Executing deliverable in project workspace "${targetTeam.linkedProjectName || projectFolder || 'Main'}"...`,
          status: 'working',
        });

        this.updateNodeStatus?.(spec.id, 'working');

        const workspacePath = targetProjectPath || targetTeam.workspacePath || targetDept.workspacePath || '';

        try {
          // eslint-disable-next-line no-await-in-loop
          const output = await this.runOrgAgentStep({
            agent: spec,
            systemPrompt: spec.title || spec.role,
            userDirective: userPrompt,
            workspacePath,
            onStreamUpdate: (text) => {
              this.onAgentStream?.(text);
            },
          });
          specialistOutputs.push(output);

          this.updateNodeStatus?.(spec.id, 'recently_finished');
          addLog({
            depth: 4,
            fromName: spec.name,
            fromRole: spec.title || 'Specialist',
            toName: targetTeam.teamLeadAgent.name,
            toRole: 'Team Manager',
            message: output || `Completed deliverable in ${workspacePath || 'workspace'}.`,
            status: 'completed',
          });
        } catch (err) {
          addLog({
            depth: 4,
            fromName: spec.name,
            fromRole: spec.title || 'Specialist',
            toName: targetTeam.teamLeadAgent.name,
            toRole: 'Team Manager',
            message: `Error: ${err instanceof Error ? err.message : String(err)}`,
            status: 'error',
          });
        }
      }
    }

    // Roll back up
    addLog({
      depth: 5,
      fromName: targetDept.departmentCeoAgent.name,
      fromRole: 'Department CEO',
      toName: rootCeo.ceoAgent.name,
      toRole: 'Root CEO',
      message: `Consolidated sprint results delivered back to Root CEO.`,
      status: 'completed',
    });

    this.updateNodeStatus?.(targetTeam.id, 'recently_finished');
    this.updateNodeStatus?.(targetDept.id, 'recently_finished');
    this.updateNodeStatus?.(rootCeo.ceoAgent.id, 'working');

    const finalSynthesis =
      specialistOutputs.length > 0
        ? specialistOutputs.join('\n\n')
        : `Executive Directive Processed: "${userPrompt}" in ${projectFolder || 'workspace'}.`;

    return {
      success: true,
      directiveId,
      userPrompt,
      logs,
      finalSynthesis,
      involvedDepartmentIds: [targetDept.id],
      involvedTeamIds: [targetTeam.id],
      createdTeams: newlyCreatedTeams,
    };
  }
}
