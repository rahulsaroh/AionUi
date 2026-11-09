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
}

export interface AgentExecutionOptions {
  agent: OrgAgentMember;
  systemPrompt: string;
  userDirective: string;
  workspacePath: string;
  onStreamUpdate: (text: string) => void;
}

type UpdateNodeStatus = (nodeId: string, status: OrgNodeStatus) => void;

export const MAX_DELEGATION_DEPTH = 6;

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
   * Executes a single agent step against the real AionUi backend (conversation runner).
   * Runs inside the agent's bound `workspacePath` as the working directory.
   */
  private async runOrgAgentStep(opts: AgentExecutionOptions): Promise<string> {
    const rawWorkspace = opts.workspacePath || this.hierarchy.rootCeo.workspacePath;
    let effectiveWorkspace = rawWorkspace && rawWorkspace !== 'workspace' ? rawWorkspace : '';

    // Path Guard Enforcement: verify workspace boundaries against organization root
    const allowedRoot = this.hierarchy.rootCeo.workspacePath;
    if (allowedRoot && effectiveWorkspace && effectiveWorkspace !== 'workspace') {
      try {
        const scopeCheck = await ipcBridge.org.assertWithinScope(effectiveWorkspace, allowedRoot);
        if (!scopeCheck.allowed) {
          console.warn(
            `[OrgDelegationEngine:pathGuard] Workspace "${effectiveWorkspace}" outside allowed root "${allowedRoot}":`,
            scopeCheck.reason
          );
          effectiveWorkspace = scopeCheck.resolved || allowedRoot;
        }
      } catch (err) {
        console.warn('[OrgDelegationEngine:pathGuard] scope check error:', err);
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
          } else {
            resolvedModel = { id: opts.agent.model.providerId, use_model: opts.agent.model.modelId };
          }
        }
        if (!resolvedModel && opts.agent.model?.modelId) {
          const matchedProvider = enabledProviders.find((p) => p.models?.includes(opts.agent.model!.modelId));
          if (matchedProvider) {
            resolvedModel = { id: matchedProvider.id, use_model: opts.agent.model.modelId };
          }
        }
        if (!resolvedModel && enabledProviders.length > 0) {
          const p = enabledProviders.find((prov) => prov.models && prov.models.length > 0) || enabledProviders[0];
          resolvedModel = {
            id: p.id,
            use_model: opts.agent.model?.modelId || (p.models && p.models[0]) || 'default',
          };
        }
      } catch {
        // Non-fatal provider resolution fallback
      }

      // 3. Create real conversation session (server generates canonical UUID)
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
      const createdConv = (await ipcBridge.conversation.create.invoke(createPayload as any)) as { id?: string } | null;
      const convId = createdConv?.id;
      if (!convId) {
        throw new Error('Failed to create conversation: backend returned no conversation id');
      }

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

      const promptToSend = `[Role Persona: You are ${opts.agent.name}, acting as "${opts.agent.role}" (${opts.agent.title || 'Team Member'}). Assigned Model: ${resolvedModel?.use_model || opts.agent.model?.modelId || 'default'}. Instructions: ${opts.systemPrompt || opts.agent.systemPrompt || 'Coordinate and answer directly as this organizational member.'}]\n\n${opts.userDirective}`;

      await ipcBridge.conversation.sendMessage.invoke({
        conversation_id: convId,
        input: promptToSend,
      });

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
    useRealExecution = true
  ): Promise<string> {
    this.simulationMode = !useRealExecution;
    const rawPath = workspacePath || agent.workspacePath || this.hierarchy.rootCeo.workspacePath;
    const resolvedPath = rawPath && rawPath !== 'workspace' ? rawPath : '';

    this.updateNodeStatus?.(agent.id, 'working');
    try {
      const response = await this.runOrgAgentStep({
        agent,
        systemPrompt:
          agent.systemPrompt ||
          `You are ${agent.name}, role "${agent.role}" (${agent.title || 'Team Member'}). Assigned AI Model: ${agent.model?.modelId || 'default'}. You are talking directly with the user. Answer accurately and perform tasks aligned with your expertise.`,
        userDirective: userPrompt,
        workspacePath: resolvedPath,
        onStreamUpdate: (text) => this.onAgentStream?.(text),
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
    // Intent check A: Direct Department Creation Request
    // -------------------------------------------------------------
    const deptCreationMatch = userPrompt.match(
      /(?:create|add|new|setup|set up|start|instantiate|build)\s+(?:a\s+|an\s+)?department(?:\s+(?:called|named|for))?\s+[:"']?([A-Za-z0-9\s&/_-]+?)(?:["']|$|\.|\n)/i
    );
    if (deptCreationMatch && deptCreationMatch[1]?.trim()) {
      const deptName = deptCreationMatch[1].trim().replace(/^["']|["']$/g, '');
      const newDept = createDepartmentShell(deptName);
      if (rootCeo.workspacePath) {
        newDept.workspacePath = getDefaultDeptPath(rootCeo.workspacePath, deptName);
      }

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
    const projectCreationMatch = userPrompt.match(
      /(?:create|add|new|setup|set up|start)\s+(?:a\s+|an\s+)?project(?:\s+(?:called|named))?\s+[:"']?([A-Za-z0-9\s&/_-]+?)(?:["']\s+|\s+)?(?:in|under|for|to)\s+(?:department\s+)?[:"']?([A-Za-z0-9\s&/_-]+?)(?:["']|$|\.|\n)/i
    );

    let explicitProjectName: string | null = null;
    let explicitProjectDeptTarget: OrgDepartmentNode | undefined;

    if (projectCreationMatch) {
      explicitProjectName = projectCreationMatch[1]?.trim()?.replace(/^["']|["']$/g, '') || null;
      const deptTargetName =
        projectCreationMatch[2]
          ?.trim()
          ?.replace(/^["']|["']$/g, '')
          .toLowerCase() || '';
      explicitProjectDeptTarget = this.hierarchy.departments.find(
        (d) =>
          d.id.toLowerCase() === deptTargetName ||
          d.name.toLowerCase().includes(deptTargetName) ||
          deptTargetName.includes(d.name.toLowerCase())
      );
    } else {
      const shortProjectMatch = userPrompt.match(
        /(?:create|add|new)\s+(?:a\s+|an\s+)?project(?:\s+(?:called|named))?\s+[:"']?([A-Za-z0-9\s&/_-]+?)(?:["']|$|\.|\n)/i
      );
      if (shortProjectMatch && shortProjectMatch[1]?.trim()) {
        explicitProjectName = shortProjectMatch[1].trim().replace(/^["']|["']$/g, '');
        explicitProjectDeptTarget =
          (targetDeptId ? this.hierarchy.departments.find((d) => d.id === targetDeptId) : undefined) ||
          (this.hierarchy.departments.length > 0 ? this.hierarchy.departments[0] : undefined);
      }
    }

    if (explicitProjectName && explicitProjectDeptTarget) {
      const newProjectId = `proj-${Date.now()}`;
      const newProject: OrgProject = {
        id: newProjectId,
        name: explicitProjectName,
        departmentId: explicitProjectDeptTarget.id,
        teamIds: explicitProjectDeptTarget.teams.length > 0 ? [explicitProjectDeptTarget.teams[0].id] : [],
        description: `Project initialized via Root CEO directive: "${userPrompt}"`,
        status: 'active',
        path: rootCeo.workspacePath ? getDefaultProjectPath(rootCeo.workspacePath, explicitProjectName) : undefined,
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
    const memberCreationMatch = userPrompt.match(
      /(?:create|add|new|hire|recruit)\s+(?:a\s+|an\s+)?(?:member|specialist|bot|agent|engineer|designer|manager)(?:\s+(?:called|named))?\s+[:"']?([A-Za-z0-9\s&/_-]+?)(?:["']\s+|\s+)?(?:(?:as|role)\s+[:"']?([A-Za-z0-9\s&/_-]+?)(?:["']\s+|\s+)?)?(?:to|in|for|under)\s+(?:team\s+)?[:"']?([A-Za-z0-9\s&/_-]+?)(?:["']|$|\.|\n)/i
    );

    let explicitMemberName: string | null = null;
    let explicitMemberRole: string = 'specialist';
    let explicitTeamTarget: OrgTeamNode | undefined;

    if (memberCreationMatch) {
      explicitMemberName = memberCreationMatch[1]?.trim()?.replace(/^["']|["']$/g, '') || null;
      explicitMemberRole = memberCreationMatch[2]?.trim()?.replace(/^["']|["']$/g, '') || 'specialist';
      const teamTargetName =
        memberCreationMatch[3]
          ?.trim()
          ?.replace(/^["']|["']$/g, '')
          .toLowerCase() || '';
      explicitTeamTarget = this.hierarchy.departments
        .flatMap((d) => d.teams)
        .find(
          (t) =>
            t.id.toLowerCase() === teamTargetName ||
            t.name.toLowerCase().includes(teamTargetName) ||
            teamTargetName.includes(t.name.toLowerCase())
        );
    } else {
      const shortMemberMatch = userPrompt.match(
        /(?:add|hire|create|recruit)\s+(?:specialist|member|bot|agent)\s+[:"']?([A-Za-z0-9\s&/_-]+?)(?:["']|$|\.|\n)/i
      );
      if (shortMemberMatch && shortMemberMatch[1]?.trim()) {
        explicitMemberName = shortMemberMatch[1].trim().replace(/^["']|["']$/g, '');
        explicitTeamTarget =
          (targetTeamId
            ? this.hierarchy.departments.flatMap((d) => d.teams).find((t) => t.id === targetTeamId)
            : undefined) || this.hierarchy.departments.flatMap((d) => d.teams)[0];
      }
    }

    if (explicitMemberName && explicitTeamTarget) {
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
