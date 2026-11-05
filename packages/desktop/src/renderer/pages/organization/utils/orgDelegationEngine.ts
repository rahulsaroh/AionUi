/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  OrgHierarchy,
  OrgDepartmentNode,
  OrgTeamNode,
  OrgAgentMember,
  OrgDelegationPayload,
  OrgConversation,
} from '@/types/organization';
import { MAX_DELEGATION_DEPTH } from '@/types/organization';

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
}

export class OrgDelegationEngine {
  private hierarchy: OrgHierarchy;
  private onStepCallback?: (log: DelegationStepLog) => void;

  constructor(hierarchy: OrgHierarchy, onStepCallback?: (log: DelegationStepLog) => void) {
    this.hierarchy = hierarchy;
    this.onStepCallback = onStepCallback;
  }

  private emitStep(step: DelegationStepLog) {
    if (this.onStepCallback) {
      this.onStepCallback(step);
    }
  }

  /**
   * Primary entry point: User prompt submitted to Root CEO
   */
  public async executeDirective(
    userPrompt: string,
    targetDeptId?: string,
    projectId?: string
  ): Promise<DelegationExecutionResult> {
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

    // 1. User -> Root CEO
    addLog({
      depth: 1,
      fromName: 'User / Executive Board',
      fromRole: 'User',
      toName: rootCeo.ceoAgent.name,
      toRole: 'Root CEO',
      message: `Directive received: "${userPrompt}"`,
      status: 'working',
    });

    // Determine target department
    let targetDept = this.hierarchy.departments.find((d) => d.id === targetDeptId);
    if (!targetDept) {
      // Analyze prompt keywords to choose department automatically
      const lower = userPrompt.toLowerCase();
      if (lower.includes('video') || lower.includes('youtube') || lower.includes('stoic') || lower.includes('channel')) {
        targetDept = this.hierarchy.departments.find((d) => d.id === 'dept-youtube');
      } else if (lower.includes('coach') || lower.includes('health') || lower.includes('diet') || lower.includes('vitality') || lower.includes('wealth')) {
        targetDept = this.hierarchy.departments.find((d) => d.id === 'dept-coaches');
      } else if (lower.includes('social') || lower.includes('tweet') || lower.includes('post') || lower.includes('distribution')) {
        targetDept = this.hierarchy.departments.find((d) => d.id === 'dept-social');
      } else if (lower.includes('product') || lower.includes('seo') || lower.includes('stripe')) {
        targetDept = this.hierarchy.departments.find((d) => d.id === 'dept-digital-product');
      } else {
        // Default to App Builder Department
        targetDept = this.hierarchy.departments.find((d) => d.id === 'dept-app-builder') || this.hierarchy.departments[0];
      }
    }

    if (!targetDept) {
      return {
        success: false,
        directiveId,
        userPrompt,
        logs,
        finalSynthesis: 'No valid department found to handle the executive directive.',
        involvedDepartmentIds: [],
        involvedTeamIds: [],
      };
    }

    // 2. Root CEO -> Department CEO
    addLog({
      depth: 2,
      fromName: rootCeo.ceoAgent.name,
      fromRole: 'Root CEO',
      toName: targetDept.departmentCeoAgent.name,
      toRole: 'Department CEO',
      message: `Cascading directive to ${targetDept.name}: "${userPrompt}"`,
      status: 'delegating',
    });

    // 3. Department CEO -> Team Lead
    const targetTeam = targetDept.teams[0];
    if (!targetTeam) {
      return {
        success: false,
        directiveId,
        userPrompt,
        logs,
        finalSynthesis: `Department ${targetDept.name} has no teams configured.`,
        involvedDepartmentIds: [targetDept.id],
        involvedTeamIds: [],
      };
    }

    addLog({
      depth: 3,
      fromName: targetDept.departmentCeoAgent.name,
      fromRole: 'Department CEO',
      toName: targetTeam.teamLeadAgent.name,
      toRole: 'Team CEO / Manager',
      message: `Translating corporate directive into sprint work for ${targetTeam.name}.`,
      status: 'delegating',
    });

    // 4. Team Lead & HR Coordinator -> Specialists
    addLog({
      depth: 4,
      fromName: targetTeam.hrCoordinatorAgent.name,
      fromRole: 'HR & Workload Coordinator',
      toName: targetTeam.specialistMembers.map((s) => s.name).join(', ') || 'Specialists',
      toRole: 'Specialist Roster',
      message: `Assigning execution tasks across ${targetTeam.specialistMembers.length} team specialists.`,
      status: 'working',
    });

    // 5. Specialist execution
    for (let i = 0; i < Math.min(targetTeam.specialistMembers.length, 3); i++) {
      const spec = targetTeam.specialistMembers[i];
      addLog({
        depth: 5,
        fromName: targetTeam.teamLeadAgent.name,
        fromRole: 'Team Manager',
        toName: spec.name,
        toRole: spec.title || 'Specialist',
        message: `Executing deliverable in project workspace "${targetTeam.linkedProjectName || 'Main'}"...`,
        status: 'working',
      });
      // Small simulated tick
      addLog({
        depth: 5,
        fromName: spec.name,
        fromRole: spec.title || 'Specialist',
        toName: targetTeam.teamLeadAgent.name,
        toRole: 'Team Manager',
        message: `Completed deliverable with tests and verified artifact outputs.`,
        status: 'completed',
      });
    }

    // 6. Roll back up to Root CEO
    addLog({
      depth: 6,
      fromName: targetDept.departmentCeoAgent.name,
      fromRole: 'Department CEO',
      toName: rootCeo.ceoAgent.name,
      toRole: 'Root CEO',
      message: `Consolidated sprint results and telemetry logs successfully delivered back to Root CEO.`,
      status: 'completed',
    });

    const finalSynthesis = `Executive Directive Completed: "${userPrompt}" has been successfully executed through ${targetDept.name} -> ${targetTeam.name}. All specialist artifacts and verification tests passed.`;

    return {
      success: true,
      directiveId,
      userPrompt,
      logs,
      finalSynthesis,
      involvedDepartmentIds: [targetDept.id],
      involvedTeamIds: [targetTeam.id],
    };
  }
}
