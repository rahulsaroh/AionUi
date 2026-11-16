/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { memberHandbook } from '@/common/adapter/ipcBridge';
import type { TTeam } from '@/common/types/team/teamTypes';
import type { OrgAgentMember, OrgHierarchy } from '@/types/organization';

export type BackfillResult = {
  totalChecked: number;
  createdCount: number;
  skippedCount: number;
  errors: string[];
};

type MemberCandidate = {
  memberKey: string;
  memberName: string;
  role?: string;
  seedPrompt?: string;
  model?: string;
};

export async function backfillMissingHandbooks(options?: {
  hierarchy?: OrgHierarchy;
  orgMembers?: OrgAgentMember[];
  teams?: TTeam[];
  userId?: string;
}): Promise<BackfillResult> {
  const candidates: Map<string, MemberCandidate> = new Map();

  // 1. Gather Workplace team members
  try {
    let teams = options?.teams;
    if (!teams) {
      const res = await ipcBridge.team.list.invoke({ user_id: options?.userId || 'system_default_user' });
      if (Array.isArray(res)) {
        teams = res;
      }
    }

    if (teams && Array.isArray(teams)) {
      for (const t of teams) {
        if (!t?.id || !Array.isArray(t.assistants)) continue;
        for (const ast of t.assistants) {
          if (!ast?.slot_id) continue;
          const memberKey = `team:${t.id}:${ast.slot_id}`;
          candidates.set(memberKey, {
            memberKey,
            memberName: ast.assistant_name || 'Teammate',
            role: ast.role || 'teammate',
            model: ast.model,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[backfillMissingHandbooks] Failed to list workplace teams:', err);
  }

  // 2. Gather Org agents from hierarchy
  if (options?.hierarchy) {
    const h = options.hierarchy;
    if (h.rootCeo) {
      const ceo = h.rootCeo.ceoAgent;
      const memberKey = `org:${ceo?.id || 'root-ceo'}`;
      candidates.set(memberKey, {
        memberKey,
        memberName: ceo?.name || h.rootCeo.name || 'Chief Executive Officer',
        role: ceo?.role || 'CEO',
        seedPrompt: ceo?.systemPrompt,
        model: ceo?.model?.modelId,
      });
      if (h.rootCeo.chiefOfStaffAgent) {
        const cos = h.rootCeo.chiefOfStaffAgent;
        const cosKey = `org:${cos.id}`;
        candidates.set(cosKey, {
          memberKey: cosKey,
          memberName: cos.name,
          role: cos.role || 'Chief of Staff',
          seedPrompt: cos.systemPrompt,
          model: cos.model?.modelId,
        });
      }
    }

    if (Array.isArray(h.departments)) {
      for (const dept of h.departments) {
        if (dept.departmentCeoAgent) {
          const key = `org:${dept.departmentCeoAgent.id}`;
          candidates.set(key, {
            memberKey: key,
            memberName: dept.departmentCeoAgent.name,
            role: dept.departmentCeoAgent.role || 'Department Head',
            seedPrompt: dept.departmentCeoAgent.systemPrompt,
            model: dept.departmentCeoAgent.model?.modelId,
          });
        }
        if (dept.pmAgent) {
          const key = `org:${dept.pmAgent.id}`;
          candidates.set(key, {
            memberKey: key,
            memberName: dept.pmAgent.name,
            role: dept.pmAgent.role || 'Project Manager',
            seedPrompt: dept.pmAgent.systemPrompt,
            model: dept.pmAgent.model?.modelId,
          });
        }
        if (Array.isArray(dept.teams)) {
          for (const team of dept.teams) {
            if (team.teamLeadAgent) {
              const key = `org:${team.teamLeadAgent.id}`;
              candidates.set(key, {
                memberKey: key,
                memberName: team.teamLeadAgent.name,
                role: team.teamLeadAgent.role || 'Team Lead',
                seedPrompt: team.teamLeadAgent.systemPrompt,
                model: team.teamLeadAgent.model?.modelId,
              });
            }
            if (team.hrCoordinatorAgent) {
              const key = `org:${team.hrCoordinatorAgent.id}`;
              candidates.set(key, {
                memberKey: key,
                memberName: team.hrCoordinatorAgent.name,
                role: team.hrCoordinatorAgent.role || 'HR Coordinator',
                seedPrompt: team.hrCoordinatorAgent.systemPrompt,
                model: team.hrCoordinatorAgent.model?.modelId,
              });
            }
            if (Array.isArray(team.specialistMembers)) {
              for (const member of team.specialistMembers) {
                const key = `org:${member.id}`;
                candidates.set(key, {
                  memberKey: key,
                  memberName: member.name,
                  role: member.role || 'Specialist',
                  seedPrompt: member.systemPrompt,
                  model: member.model?.modelId,
                });
              }
            }
          }
        }
      }
    }
  }

  // 3. Flat org members if provided
  if (Array.isArray(options?.orgMembers)) {
    for (const m of options.orgMembers) {
      const key = `org:${m.id}`;
      if (!candidates.has(key)) {
        candidates.set(key, {
          memberKey: key,
          memberName: m.name,
          role: m.role || 'Specialist',
          seedPrompt: m.systemPrompt,
          model: m.model?.modelId,
        });
      }
    }
  }

  let createdCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  for (const candidate of candidates.values()) {
    try {
      const status = await memberHandbook.getStatus({
        memberKey: candidate.memberKey,
        memberName: candidate.memberName,
      });

      if (status.exists && status.status === 'created') {
        skippedCount++;
      } else {
        await memberHandbook.create({
          memberKey: candidate.memberKey,
          memberName: candidate.memberName,
          role: candidate.role,
          seedPrompt: candidate.seedPrompt,
          model: candidate.model,
        });
        createdCount++;
      }
    } catch (err) {
      const msg = `Failed for ${candidate.memberName} (${candidate.memberKey}): ${String(err)}`;
      errors.push(msg);
      console.warn('[backfillMissingHandbooks]', msg);
    }
  }

  return {
    totalChecked: candidates.size,
    createdCount,
    skippedCount,
    errors,
  };
}
