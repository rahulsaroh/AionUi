/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ICreateTeamParams, TeamAssistantInput } from '@/common/adapter/teamMapper';
import { assistantRuntimeKey, type Assistant } from '@/common/types/agent/assistantTypes';
import { resolveDefaultTeamAgentModel } from '@renderer/pages/team/components/teamCreateModelResolver';
import { resolveCurrentUserId } from '@renderer/hooks/system/currentUserId';
import { validateWithinMaster } from '../utils/orgPathUtils';

export type CreateProjectBackendTeamParams = {
  name: string;
  workspacePath: string;
  description?: string;
  preferredAssistantId?: string;
  masterRoot?: string | null;
  userId?: string;
};

function isNetworkRefused(err: unknown): boolean {
  if (!err) return false;
  const msg = String(err);
  if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) return true;
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  if (cause?.code === 'ECONNREFUSED' || String(cause).includes('ECONNREFUSED')) return true;
  return false;
}

/**
 * Select an enabled, team-selectable assistant to lead a new project team.
 * Prefers Claude or Gemini assistants, then lead/manager profiles, then any available assistant.
 */
export async function pickLeadAssistant(preferredAssistantId?: string): Promise<Assistant> {
  let assistants: Assistant[] = [];
  try {
    assistants = ((await ipcBridge.assistants.list.invoke()) as Assistant[]) || [];
  } catch (err) {
    if (isNetworkRefused(err)) {
      throw new Error('AionCore backend is not reachable', { cause: err });
    }
    throw err;
  }

  if (!assistants || assistants.length === 0) {
    throw new Error('No assistants available in system to lead the team.');
  }

  if (preferredAssistantId) {
    const directMatch = assistants.find((a) => a.id === preferredAssistantId);
    if (directMatch) return directMatch;
  }

  const teamEligible = assistants.filter((a) => a.enabled !== false && a.team_selectable !== false);
  const candidates = teamEligible.length > 0 ? teamEligible : assistants;

  const preferred =
    candidates.find((a) => a.id.toLowerCase().includes('claude') || a.name.toLowerCase().includes('claude')) ||
    candidates.find((a) => a.id.toLowerCase().includes('gemini') || a.name.toLowerCase().includes('gemini')) ||
    candidates.find((a) => a.id.toLowerCase().includes('lead') || a.name.toLowerCase().includes('manager')) ||
    candidates[0];

  return preferred;
}

/**
 * Creates an AionCore team for an Organization project.
 * Validates workspace within the master root, resolves the lead assistant and model,
 * and calls ipcBridge.team.create. Fails visibly if creation fails.
 */
export async function createProjectBackendTeam(params: CreateProjectBackendTeamParams): Promise<string> {
  const trimmedName = params.name.trim();
  const trimmedPath = params.workspacePath.trim();

  if (!trimmedName) {
    throw new Error('Project name is required to create a backend team.');
  }
  if (!trimmedPath) {
    throw new Error('Project workspace path is required to create a backend team.');
  }

  // Validate workspace is within the organization master root
  const masterRoot = params.masterRoot ?? (await ipcBridge.org.getMasterRoot());
  if (masterRoot) {
    const check = await validateWithinMaster(trimmedPath, masterRoot);
    if (!check.valid) {
      throw new Error(`Project workspace is outside the master root: ${check.error || trimmedPath}`);
    }
  }

  const lead = await pickLeadAssistant(params.preferredAssistantId);
  const model = await resolveDefaultTeamAgentModel({
    assistant_id: lead.id,
    assistant_backend: assistantRuntimeKey(lead),
  });

  const agentInput: TeamAssistantInput = {
    role: 'leader',
    assistant_name: lead.name,
    assistant_id: lead.id,
    model,
  };

  const userId = params.userId ?? (await resolveCurrentUserId()) ?? 'system_default_user';

  const createPayload: ICreateTeamParams = {
    user_id: userId,
    name: trimmedName,
    workspace: trimmedPath,
    workspace_mode: 'shared',
    description: params.description?.trim(),
    agents: [agentInput],
  };

  let newTeam: unknown;
  try {
    newTeam = await ipcBridge.team.create.invoke(createPayload);
  } catch (err) {
    if (isNetworkRefused(err)) {
      throw new Error('AionCore backend is not reachable', { cause: err });
    }
    throw err;
  }

  const result = newTeam as { __bridgeError?: boolean; message?: string; id?: string };

  if (result.__bridgeError || !result.id) {
    throw new Error(`Failed to create team backend: ${result.message || 'Team creation rejected by backend'}`);
  }

  return result.id;
}
