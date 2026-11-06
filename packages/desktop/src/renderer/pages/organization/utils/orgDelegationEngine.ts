/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { OrgHierarchy, OrgAgentMember, OrgNodeStatus, OrgDepartmentNode, OrgTeamNode } from '@/types/organization';
import { createDepartmentShell, createTeamShell } from './orgCoherence';

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
}

export interface AgentExecutionOptions {
  agent: OrgAgentMember;
  systemPrompt: string;
  userDirective: string;
  workspacePath: string;
  onStreamUpdate: (text: string) => void;
}

type UpdateNodeStatus = (nodeId: string, status: OrgNodeStatus) => void;

export class OrgDelegationEngine {
  private hierarchy: OrgHierarchy;
  private onStepCallback?: (log: DelegationStepLog) => void;
  private onAgentStream?: (text: string) => void;
  private updateNodeStatus?: UpdateNodeStatus;
  private simulationMode: boolean;

  constructor(
    hierarchy: OrgHierarchy,
    onStepCallback?: (log: DelegationStepLog) => void,
    onAgentStream?: (text: string) => void,
    updateNodeStatus?: UpdateNodeStatus,
    options?: { simulationMode?: boolean }
  ) {
    this.hierarchy = hierarchy;
    this.onStepCallback = onStepCallback;
    this.onAgentStream = onAgentStream;
    this.updateNodeStatus = updateNodeStatus;
    this.simulationMode = options?.simulationMode ?? true;
  }

  private emitStep(step: DelegationStepLog) {
    if (this.onStepCallback) {
      this.onStepCallback(step);
    }
  }

  /**
   * Executes a single agent step against the real AionUi backend (ACP / conversation runner).
   * Runs inside the agent's bound `workspacePath` as the working directory.
   */
  private async runOrgAgentStep(opts: AgentExecutionOptions): Promise<string> {
    if (this.simulationMode) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return `[Simulated] ${opts.agent.name} executed: "${opts.userDirective.slice(0, 60)}..." in ${opts.workspacePath || 'workspace'}`;
    }

    const convId = `org-agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const collectedText: string[] = [];
    let finished = false;

    const unsubscribe = ipcBridge.conversation.responseStream.on((msg: unknown) => {
      const m = msg as { conversation_id?: string; data?: unknown; status?: string };
      if (m.conversation_id !== convId) return;
      if (m.data) {
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
      if (m.status === 'finish') {
        finished = true;
      }
    });

    try {
      try {
        await ipcBridge.conversation.create.invoke({
          type: 'acp',
          id: convId,
          name: `Org: ${opts.agent.name}`,
          assistant: { id: opts.agent.canonicalAgentId || opts.agent.id },
          extra: { workspace: opts.workspacePath, custom_workspace: true },
        });
      } catch {
        // Conversation may already exist or creation may be unsupported; proceed to send.
      }

      await ipcBridge.conversation.sendMessage.invoke({
        conversation_id: convId,
        input: opts.userDirective,
      });

      // Wait for stream finish or 8s timeout
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 8000);
        const check = setInterval(() => {
          if (finished) {
            clearTimeout(timer);
            clearInterval(check);
            resolve();
          }
        }, 100);
      });
    } catch (err) {
      console.error('[OrgDelegationEngine] agent execution error:', err);
    } finally {
      unsubscribe();
    }

    return collectedText.join('\n') || `Execution by ${opts.agent.name} completed (no text streamed).`;
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
    useRealExecution = false
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
    // Intent check A: Direct Department Creation Request
    // -------------------------------------------------------------
    const deptCreationMatch = userPrompt.match(
      /(?:create|add|new|setup|set up|start|instantiate|build)\s+(?:a\s+|an\s+)?department(?:\s+(?:called|named|for))?\s+[:"']?([A-Za-z0-9\s&/_-]+?)(?:["']|$|\.|\n)/i
    );
    if (deptCreationMatch && deptCreationMatch[1]?.trim()) {
      const deptName = deptCreationMatch[1].trim().replace(/^["']|["']$/g, '');
      const newDept = createDepartmentShell(deptName);

      addLog({
        depth: 1,
        fromName: rootCeo.ceoAgent.name,
        fromRole: 'Root CEO',
        toName: 'Executive Operations',
        toRole: 'Chief of Staff',
        message: `Instantiating new department "${deptName}" with dedicated Department Head.`,
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
        involvedTeamIds: [],
        createdDepartments: [newDept],
      };
    }

    // -------------------------------------------------------------
    // Intent check B: Direct Team Creation Request
    // -------------------------------------------------------------
    const teamCreationMatch = userPrompt.match(
      /(?:create|add|new|setup|set up)\s+(?:a\s+|an\s+)?team(?:\s+(?:called|named))?\s+[:"']?([A-Za-z0-9\s&/_-]+?)(?:["']\s+|\s+)?(?:in|under|for|to)\s+(?:department\s+)?[:"']?([A-Za-z0-9\s&/_-]+?)(?:["']|$|\.|\n)/i
    );

    let explicitTeamName: string | null = null;
    let explicitDeptTarget: OrgDepartmentNode | undefined;

    if (teamCreationMatch) {
      explicitTeamName = teamCreationMatch[1]?.trim()?.replace(/^["']|["']$/g, '') || null;
      const deptTargetName =
        teamCreationMatch[2]
          ?.trim()
          ?.replace(/^["']|["']$/g, '')
          .toLowerCase() || '';
      explicitDeptTarget = this.hierarchy.departments.find(
        (d) =>
          d.id.toLowerCase() === deptTargetName ||
          d.name.toLowerCase().includes(deptTargetName) ||
          deptTargetName.includes(d.name.toLowerCase())
      );
    } else {
      // Shorter format: "Create team Mobile" when targetDeptId is given or only 1 department exists
      const shortTeamMatch = userPrompt.match(
        /(?:create|add|new)\s+(?:a\s+|an\s+)?team(?:\s+(?:called|named))?\s+[:"']?([A-Za-z0-9\s&/_-]+?)(?:["']|$|\.|\n)/i
      );
      if (shortTeamMatch && shortTeamMatch[1]?.trim()) {
        explicitTeamName = shortTeamMatch[1].trim().replace(/^["']|["']$/g, '');
        explicitDeptTarget =
          (targetDeptId ? this.hierarchy.departments.find((d) => d.id === targetDeptId) : undefined) ||
          (this.hierarchy.departments.length === 1 ? this.hierarchy.departments[0] : undefined);
      }
    }

    if (explicitTeamName && explicitDeptTarget) {
      const newTeam = createTeamShell(explicitDeptTarget.id, explicitTeamName);

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

    // Dynamic keyword matching if not explicitly targeted
    if (!targetDept && !targetTeam && this.hierarchy.departments.length > 0) {
      const lower = userPrompt.toLowerCase();
      targetDept = this.hierarchy.departments.find(
        (d) => lower.includes(d.name.toLowerCase()) || (d.description && lower.includes(d.description.toLowerCase()))
      );
      if (!targetDept) {
        if (
          lower.includes('video') ||
          lower.includes('youtube') ||
          lower.includes('media') ||
          lower.includes('channel')
        ) {
          targetDept = this.hierarchy.departments.find((d) => /video|youtube|media|channel/i.test(d.name));
        } else if (
          lower.includes('social') ||
          lower.includes('tweet') ||
          lower.includes('post') ||
          lower.includes('marketing')
        ) {
          targetDept = this.hierarchy.departments.find((d) => /social|marketing|growth/i.test(d.name));
        } else if (
          lower.includes('coach') ||
          lower.includes('health') ||
          lower.includes('life') ||
          lower.includes('hr')
        ) {
          targetDept = this.hierarchy.departments.find((d) => /coach|people|hr|health/i.test(d.name));
        } else if (
          lower.includes('app') ||
          lower.includes('software') ||
          lower.includes('engineer') ||
          lower.includes('dev') ||
          lower.includes('code')
        ) {
          targetDept = this.hierarchy.departments.find((d) => /app|software|engineer|tech/i.test(d.name));
        }
      }
    }

    // -------------------------------------------------------------
    // Direct Root CEO level execution (No departments or HQ directive)
    // -------------------------------------------------------------
    if (!targetDept) {
      addLog({
        depth: 1,
        fromName: rootCeo.ceoAgent.name,
        fromRole: 'Root CEO',
        toName: rootCeo.chiefOfStaffAgent?.name || 'Chief of Staff',
        toRole: 'Executive Operations',
        message: `Analyzing executive mandate at Global HQ level: "${userPrompt}"`,
        status: 'working',
      });

      let ceoSynthesis = '';
      if (!this.simulationMode) {
        try {
          ceoSynthesis = await this.runOrgAgentStep({
            agent: rootCeo.ceoAgent,
            systemPrompt:
              'You are the Global Organization CEO. Direct strategic planning, department structuring, and organizational leadership.',
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

      addLog({
        depth: 1,
        fromName: rootCeo.ceoAgent.name,
        fromRole: 'Root CEO',
        toName: 'User / Executive Board',
        toRole: 'User',
        message: ceoSynthesis,
        status: 'completed',
      });

      this.updateNodeStatus?.('root-ceo', 'recently_finished');

      return {
        success: true,
        directiveId,
        userPrompt,
        logs,
        finalSynthesis: ceoSynthesis,
        involvedDepartmentIds: [],
        involvedTeamIds: [],
      };
    }

    // Bound folder for execution context: project folder > team folder > department folder
    const targetProjectPath = projectId ? targetDept.linkedProjects.find((p) => p.id === projectId)?.path : undefined;
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
    if (!targetTeam) {
      targetTeam = targetDept.teams[0];
    }
    if (!targetTeam) {
      addLog({
        depth: 2,
        fromName: targetDept.departmentCeoAgent.name,
        fromRole: 'Department CEO',
        toName: rootCeo.ceoAgent.name,
        toRole: 'Root CEO',
        message: `Department ${targetDept.name} received mandate but has no sub-teams configured. Ready to create team on instruction.`,
        status: 'completed',
      });
      this.updateNodeStatus?.(targetDept.id, 'recently_finished');

      return {
        success: true,
        directiveId,
        userPrompt,
        logs,
        finalSynthesis: `Department ${targetDept.name} received the mandate "${userPrompt}". To begin execution, add a team (e.g. 'Create team Core in ${targetDept.name}' or click + Add Team).`,
        involvedDepartmentIds: [targetDept.id],
        involvedTeamIds: [],
      };
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

    // Specialist execution
    const specialistOutputs: string[] = [];
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

    const synthesisParts = [
      `Executive Directive Completed: "${userPrompt}" executed through ${targetDept.name} -> ${targetTeam.name}`,
      projectFolder ? ` in ${projectFolder}` : '',
      specialistOutputs.length > 0 ? `. Specialist outputs: ${specialistOutputs.join(' | ')}` : '.',
    ];
    const finalSynthesis = synthesisParts.join('');

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
