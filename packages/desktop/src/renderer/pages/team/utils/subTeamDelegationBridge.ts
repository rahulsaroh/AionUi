/**
 * Sub-Team Delegation Bridge & Hierarchical Orchestration
 * Enforces Scoped Visibility (1-level down) and Recursion Safeguards (MAX_DELEGATION_DEPTH = 5).
 */

import type { TTeam } from '@/common/types/team/teamTypes';
import { ipcBridge } from '@/common';

export const MAX_DELEGATION_DEPTH = 5;

export type DelegationRequest = {
  subTeamId: string;
  taskDirective: string;
  contextFiles?: string[];
};

export type DelegationResult = {
  success: boolean;
  subTeamId: string;
  subTeamName: string;
  summary: string;
  artifactPaths: string[];
  depth: number;
  error?: string;
};

/**
 * Returns direct child sub-teams (1 level down) for a parent team.
 * Never exposes grandchild or cousin teams, maintaining strict hierarchical encapsulation.
 */
export function getDirectChildTeams(parentTeamId: string, allTeams: TTeam[]): TTeam[] {
  if (!parentTeamId || !allTeams) return [];
  return allTeams.filter((t) => t.parentId === parentTeamId);
}

/**
 * Constructs the scoped visibility and delegation tool directive prompt
 * for a parent team leader agent.
 */
export function buildSubTeamDelegationDirective(
  parentTeam: TTeam,
  allTeams: TTeam[],
  currentDepth = 0
): string {
  if (currentDepth >= MAX_DELEGATION_DEPTH) {
    return '';
  }

  const childTeams = getDirectChildTeams(parentTeam.id, allTeams);
  if (childTeams.length === 0) {
    return '';
  }

  const listItems = childTeams.map((child, idx) => {
    const roleStr = child.departmentRole ? ` [Role: ${child.departmentRole}]` : '';
    const descStr = child.description ? ` - ${child.description}` : '';
    const wsStr = child.workspace ? ` (Workspace: ${child.workspace})` : '';
    return `  ${idx + 1}. "${child.name}" (ID: ${child.id})${roleStr}${wsStr}${descStr}`;
  });

  return `<!-- SUB_TEAM_DELEGATION_BRIDGE_START -->
[Hierarchical Sub-Teams / Direct Child Departments]
You are the Leader of Team "${parentTeam.name}".
You have ${childTeams.length} specialized sub-teams under your direct hierarchical command (1 level down):
${listItems.join('\n')}

[Sub-Team Delegation Tool & Scoped Visibility]
You can assign autonomous tasks to any of your direct sub-teams above.
Hierarchical Encapsulation: You only delegate to your immediate child sub-teams. Sub-teams manage their own specialists.
To delegate a task, output the following structured directive:
[DELEGATE_TO_SUB_TEAM: {"subTeamId": "<sub_team_id>", "taskDirective": "<clear instructions for the sub-team>", "contextFiles": ["<optional_file_path>"]}]

Current Hierarchy Depth: ${currentDepth} (Max allowed depth: ${MAX_DELEGATION_DEPTH}).
<!-- SUB_TEAM_DELEGATION_BRIDGE_END -->`;
}

/**
 * Parses delegation requests from an agent's response message text.
 */
export function parseSubTeamDelegationRequests(text: string): DelegationRequest[] {
  if (!text || !text.includes('[DELEGATE_TO_SUB_TEAM:')) {
    return [];
  }

  const results: DelegationRequest[] = [];
  const regex = /\[DELEGATE_TO_SUB_TEAM:\s*(\{[\s\S]*?\})\s*\]/g;
  let match: RegExpExecArray | null = regex.exec(text);

  while (match !== null) {
    try {
      const payload = JSON.parse(match[1]) as Record<string, unknown>;
      if (typeof payload.subTeamId === 'string' && typeof payload.taskDirective === 'string') {
        const contextFiles = Array.isArray(payload.contextFiles)
          ? payload.contextFiles.filter((f): f is string => typeof f === 'string')
          : undefined;
        results.push({
          subTeamId: payload.subTeamId.trim(),
          taskDirective: payload.taskDirective.trim(),
          contextFiles,
        });
      }
    } catch {
      // Ignore malformed JSON blocks
    }
    match = regex.exec(text);
  }

  return results;
}

/**
 * Dispatches an isolated execution session to a child sub-team's leader agent,
 * enforcing recursion limits and scoped child visibility.
 */
export async function executeSubTeamDelegation(params: {
  parentTeam: TTeam;
  allTeams: TTeam[];
  request: DelegationRequest;
  currentDepth?: number;
}): Promise<DelegationResult> {
  const { parentTeam, allTeams, request, currentDepth = 0 } = params;

  if (currentDepth >= MAX_DELEGATION_DEPTH) {
    return {
      success: false,
      subTeamId: request.subTeamId,
      subTeamName: 'Unknown',
      summary: '',
      artifactPaths: [],
      depth: currentDepth,
      error: `Recursion safeguard triggered: Reached MAX_DELEGATION_DEPTH (${MAX_DELEGATION_DEPTH}).`,
    };
  }

  // Validate scoped visibility: must be an immediate child of parentTeam
  const childTeam = allTeams.find(
    (t) => t.id === request.subTeamId && t.parentId === parentTeam.id
  );

  if (!childTeam) {
    return {
      success: false,
      subTeamId: request.subTeamId,
      subTeamName: 'Unknown',
      summary: '',
      artifactPaths: [],
      depth: currentDepth,
      error: `Hierarchical violation: Team "${request.subTeamId}" is not a direct child of "${parentTeam.name}".`,
    };
  }

  const nextDepth = currentDepth + 1;
  const childDirective = buildSubTeamDelegationDirective(childTeam, allTeams, nextDepth);
  const promptToSend = childDirective
    ? `${childDirective}\n\n[Delegated Task Directive from Parent Department "${parentTeam.name}"]:\n${request.taskDirective}`
    : `[Delegated Task Directive from Parent Department "${parentTeam.name}"]:\n${request.taskDirective}`;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('subteam:delegation', {
        detail: {
          type: 'start',
          sourceTeamId: parentTeam.id,
          targetSubTeamId: childTeam.id,
          taskDirective: request.taskDirective,
        },
      })
    );
  }

  try {
    const ack = await ipcBridge.team.sendMessage.invoke({
      team_id: childTeam.id,
      input: promptToSend,
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('subteam:delegation', {
          detail: {
            type: 'complete',
            sourceTeamId: parentTeam.id,
            targetSubTeamId: childTeam.id,
            success: true,
          },
        })
      );
    }

    return {
      success: true,
      subTeamId: childTeam.id,
      subTeamName: childTeam.name,
      summary: `Task successfully delegated to child team "${childTeam.name}" (Message ID: ${ack.message_id ?? 'queued'}).`,
      artifactPaths: [],
      depth: nextDepth,
    };
  } catch (err) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('subteam:delegation', {
          detail: {
            type: 'complete',
            sourceTeamId: parentTeam.id,
            targetSubTeamId: childTeam.id,
            success: false,
          },
        })
      );
    }
    return {
      success: false,
      subTeamId: childTeam.id,
      subTeamName: childTeam.name,
      summary: '',
      artifactPaths: [],
      depth: nextDepth,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
