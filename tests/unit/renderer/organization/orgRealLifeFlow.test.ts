/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ipcBridge } from '@/common';
import {
  joinOrgPath,
  validateWithinMaster,
  getDefaultDeptPath,
  getDefaultTeamPath,
  getDefaultProjectPath,
} from '@/renderer/pages/organization/utils/orgPathUtils';
import { OrgDelegationEngine, type DelegationStepLog } from '@/renderer/pages/organization/utils/orgDelegationEngine';
import type {
  OrgHierarchy,
  OrgDepartmentNode,
  OrgTeamNode,
  OrgAgentMember,
  OrgProject,
  OrgConversation,
  OrgConversationMessage,
} from '@/types/organization';

describe('Real-Life Organization Mode Test: End-to-End Enterprise Flow', () => {
  const masterRoot = path.join(os.tmpdir(), 'kilo', 'real-life-org-test');
  const now = Date.now();

  let hierarchy: OrgHierarchy;
  let engineeringDept: OrgDepartmentNode;
  let productDept: OrgDepartmentNode;
  let operationsDept: OrgDepartmentNode;

  let engHead: OrgAgentMember;
  let prodHead: OrgAgentMember;
  let opsHead: OrgAgentMember;

  let apiGatewayLead: OrgAgentMember;
  let backendSpecialist: OrgAgentMember;
  let devopsSpecialist: OrgAgentMember;

  let portalLead: OrgAgentMember;
  let uxSpecialist: OrgAgentMember;

  let apiGatewayProject: OrgProject;
  let cloudInfraProject: OrgProject;
  let customerPortalProject: OrgProject;
  let analyticsProject: OrgProject;
  let auditProject: OrgProject;

  const conversationsStore: OrgConversation[] = [];

  beforeAll(() => {
    vi.spyOn(ipcBridge.org, 'assertWithinScope').mockImplementation(async (targetPath: string, allowedRoot: string) => {
      const { assertWithinScope } = await import('@process/services/org/pathGuard');
      return assertWithinScope(targetPath, allowedRoot);
    });

    // 1. Analyze and verify real master folder structure on disk
    if (!fs.existsSync(masterRoot)) {
      fs.mkdirSync(masterRoot, { recursive: true });
    }
    if (!fs.existsSync(path.join(masterRoot, 'README.md'))) {
      fs.writeFileSync(path.join(masterRoot, 'README.md'), '# Enterprise Root\n');
    }
    for (const sub of ['api-gateway', 'cloud-infra']) {
      const p = path.join(masterRoot, 'departments', 'engineering', 'projects', sub);
      fs.mkdirSync(p, { recursive: true });
      if (!fs.existsSync(path.join(p, 'README.md'))) {
        fs.writeFileSync(path.join(p, 'README.md'), `# ${sub}\n`);
      }
    }
    for (const sub of ['customer-portal', 'analytics-dashboard']) {
      const p = path.join(masterRoot, 'departments', 'product', 'projects', sub);
      fs.mkdirSync(p, { recursive: true });
      if (!fs.existsSync(path.join(p, 'README.md'))) {
        fs.writeFileSync(path.join(p, 'README.md'), `# ${sub}\n`);
      }
    }
    const auditPath = path.join(masterRoot, 'departments', 'operations', 'projects', 'compliance-audit');
    fs.mkdirSync(auditPath, { recursive: true });
    if (!fs.existsSync(path.join(auditPath, 'README.md'))) {
      fs.writeFileSync(path.join(auditPath, 'README.md'), '# compliance-audit\n');
    }

    expect(fs.existsSync(masterRoot)).toBe(true);
    const rootFiles = fs.readdirSync(masterRoot);
    expect(rootFiles).toContain('departments');
    expect(rootFiles).toContain('README.md');

    // 2. Build full real-life organizational hierarchy bound to disk paths
    engHead = {
      id: 'agent-head-eng',
      canonicalAgentId: 'canonical-head-eng',
      name: 'Dr. Marcus Thorne',
      role: 'department_head',
      title: 'VP of Engineering',
      assignedTeamIds: ['team-api-gateway'],
      lastActiveAt: now,
      status: 'idle',
      workspacePath: path.join(masterRoot, 'departments', 'engineering'),
    };

    prodHead = {
      id: 'agent-head-prod',
      canonicalAgentId: 'canonical-head-prod',
      name: 'Maya Lin',
      role: 'department_head',
      title: 'VP of Product',
      assignedTeamIds: ['team-customer-portal'],
      lastActiveAt: now,
      status: 'idle',
      workspacePath: path.join(masterRoot, 'departments', 'product'),
    };

    opsHead = {
      id: 'agent-head-ops',
      canonicalAgentId: 'canonical-head-ops',
      name: 'Carlos Mendez',
      role: 'department_head',
      title: 'VP of Operations',
      assignedTeamIds: [],
      lastActiveAt: now,
      status: 'idle',
      workspacePath: path.join(masterRoot, 'departments', 'operations'),
    };

    apiGatewayLead = {
      id: 'agent-lead-gateway',
      canonicalAgentId: 'canonical-lead-gateway',
      name: 'Devon Cross',
      role: 'team_lead',
      title: 'Engineering Lead & Project Head',
      assignedTeamIds: ['team-api-gateway'],
      lastActiveAt: now,
      status: 'idle',
      workspacePath: path.join(masterRoot, 'departments', 'engineering', 'projects', 'api-gateway'),
    };

    backendSpecialist = {
      id: 'agent-spec-backend',
      canonicalAgentId: 'canonical-spec-backend',
      name: 'Aria Sterling',
      role: 'specialist',
      title: 'Senior Backend Architect',
      assignedTeamIds: ['team-api-gateway'],
      lastActiveAt: now,
      status: 'idle',
      workspacePath: path.join(masterRoot, 'departments', 'engineering', 'projects', 'api-gateway'),
    };

    devopsSpecialist = {
      id: 'agent-spec-devops',
      canonicalAgentId: 'canonical-spec-devops',
      name: 'Kaelen Voss',
      role: 'specialist',
      title: 'Cloud DevOps Specialist',
      assignedTeamIds: ['team-api-gateway'],
      lastActiveAt: now,
      status: 'idle',
      workspacePath: path.join(masterRoot, 'departments', 'engineering', 'projects', 'cloud-infra'),
    };

    portalLead = {
      id: 'agent-lead-portal',
      canonicalAgentId: 'canonical-lead-portal',
      name: 'Rachel Green',
      role: 'project_manager',
      title: 'Product Lead & Project Head',
      assignedTeamIds: ['team-customer-portal'],
      lastActiveAt: now,
      status: 'idle',
      workspacePath: path.join(masterRoot, 'departments', 'product', 'projects', 'customer-portal'),
    };

    uxSpecialist = {
      id: 'agent-spec-ux',
      canonicalAgentId: 'canonical-spec-ux',
      name: 'Chloe Bennett',
      role: 'specialist',
      title: 'Lead UX Designer',
      assignedTeamIds: ['team-customer-portal'],
      lastActiveAt: now,
      status: 'idle',
      workspacePath: path.join(masterRoot, 'departments', 'product', 'projects', 'customer-portal'),
    };

    const apiGatewayTeam: OrgTeamNode = {
      id: 'team-api-gateway',
      departmentId: 'dept-engineering',
      name: 'API Gateway & Cloud Team',
      teamLeadAgent: apiGatewayLead,
      hrCoordinatorAgent: {
        id: 'agent-hr-eng',
        canonicalAgentId: 'canonical-hr-eng',
        name: 'Tanya Gomez',
        role: 'hr_coordinator',
        assignedTeamIds: ['team-api-gateway'],
        lastActiveAt: now,
        status: 'idle',
      },
      specialistMembers: [backendSpecialist, devopsSpecialist],
      linkedProjectId: 'proj-api-gateway',
      linkedProjectName: 'api-gateway',
      workspacePath: path.join(masterRoot, 'departments', 'engineering', 'projects', 'api-gateway'),
      lastActiveAt: now,
      status: 'idle',
    };

    const customerPortalTeam: OrgTeamNode = {
      id: 'team-customer-portal',
      departmentId: 'dept-product',
      name: 'Customer Experience Team',
      teamLeadAgent: portalLead,
      hrCoordinatorAgent: {
        id: 'agent-hr-prod',
        canonicalAgentId: 'canonical-hr-prod',
        name: 'Liam Neale',
        role: 'hr_coordinator',
        assignedTeamIds: ['team-customer-portal'],
        lastActiveAt: now,
        status: 'idle',
      },
      specialistMembers: [uxSpecialist],
      linkedProjectId: 'proj-customer-portal',
      linkedProjectName: 'customer-portal',
      workspacePath: path.join(masterRoot, 'departments', 'product', 'projects', 'customer-portal'),
      lastActiveAt: now,
      status: 'idle',
    };

    apiGatewayProject = {
      id: 'proj-api-gateway',
      name: 'api-gateway',
      departmentId: 'dept-engineering',
      teamIds: ['team-api-gateway'],
      status: 'active',
      workspacePath: path.join(masterRoot, 'departments', 'engineering', 'projects', 'api-gateway'),
    };

    cloudInfraProject = {
      id: 'proj-cloud-infra',
      name: 'cloud-infra',
      departmentId: 'dept-engineering',
      teamIds: ['team-api-gateway'],
      status: 'active',
      workspacePath: path.join(masterRoot, 'departments', 'engineering', 'projects', 'cloud-infra'),
    };

    customerPortalProject = {
      id: 'proj-customer-portal',
      name: 'customer-portal',
      departmentId: 'dept-product',
      teamIds: ['team-customer-portal'],
      status: 'active',
      workspacePath: path.join(masterRoot, 'departments', 'product', 'projects', 'customer-portal'),
    };

    analyticsProject = {
      id: 'proj-analytics',
      name: 'analytics-dashboard',
      departmentId: 'dept-product',
      teamIds: ['team-customer-portal'],
      status: 'active',
      workspacePath: path.join(masterRoot, 'departments', 'product', 'projects', 'analytics-dashboard'),
    };

    auditProject = {
      id: 'proj-audit',
      name: 'compliance-audit',
      departmentId: 'dept-operations',
      teamIds: [],
      status: 'active',
      workspacePath: path.join(masterRoot, 'departments', 'operations', 'projects', 'compliance-audit'),
    };

    engineeringDept = {
      id: 'dept-engineering',
      name: 'Engineering',
      parentDepartmentId: 'root-ceo',
      departmentCeoAgent: engHead,
      teams: [apiGatewayTeam],
      linkedProjects: ['proj-api-gateway', 'proj-cloud-infra'],
      workspacePath: path.join(masterRoot, 'departments', 'engineering'),
      lastActiveAt: now,
      status: 'idle',
    };

    productDept = {
      id: 'dept-product',
      name: 'Product & Design',
      parentDepartmentId: 'root-ceo',
      departmentCeoAgent: prodHead,
      teams: [customerPortalTeam],
      linkedProjects: ['proj-customer-portal', 'proj-analytics'],
      workspacePath: path.join(masterRoot, 'departments', 'product'),
      lastActiveAt: now,
      status: 'idle',
    };

    operationsDept = {
      id: 'dept-operations',
      name: 'Operations & Compliance',
      parentDepartmentId: 'root-ceo',
      departmentCeoAgent: opsHead,
      teams: [],
      linkedProjects: ['proj-audit'],
      workspacePath: path.join(masterRoot, 'departments', 'operations'),
      lastActiveAt: now,
      status: 'idle',
    };

    hierarchy = {
      rootCeo: {
        id: 'root-ceo',
        name: 'Executive Leadership HQ',
        parentId: null,
        workspacePath: masterRoot,
        lastActiveAt: now,
        status: 'idle',
        ceoAgent: {
          id: 'agent-root-ceo',
          canonicalAgentId: 'canonical-root-ceo',
          name: 'Elena Vance',
          role: 'ceo',
          title: 'Chief Executive Officer',
          assignedTeamIds: [],
          lastActiveAt: now,
          status: 'idle',
          workspacePath: masterRoot,
        },
        chiefOfStaffAgent: {
          id: 'agent-chief-of-staff',
          canonicalAgentId: 'canonical-chief-of-staff',
          name: 'Julian Sterling',
          role: 'chief_of_staff',
          title: 'Chief of Staff',
          assignedTeamIds: [],
          lastActiveAt: now,
          status: 'idle',
          workspacePath: masterRoot,
        },
      },
      departments: [engineeringDept, productDept, operationsDept],
      lastUpdated: now,
    };
  });

  // --------------------------------------------------------------------------
  // Phase 1: Folder Selection, Analysis and Scoping Validation
  // --------------------------------------------------------------------------
  describe('Phase 1: Folder Selection, Analysis and Master Folder Binding', () => {
    it('analyzes master folder and verifies disk integrity of all departments and projects', () => {
      expect(hierarchy.rootCeo.workspacePath).toBe(masterRoot);

      // Verify all department folders exist on disk
      expect(fs.existsSync(engineeringDept.workspacePath!)).toBe(true);
      expect(fs.existsSync(productDept.workspacePath!)).toBe(true);
      expect(fs.existsSync(operationsDept.workspacePath!)).toBe(true);

      // Verify all project folders and files exist on disk
      expect(fs.existsSync(apiGatewayProject.workspacePath!)).toBe(true);
      expect(fs.existsSync(path.join(apiGatewayProject.workspacePath!, 'README.md'))).toBe(true);
      expect(fs.existsSync(cloudInfraProject.workspacePath!)).toBe(true);
      expect(fs.existsSync(customerPortalProject.workspacePath!)).toBe(true);
      expect(fs.existsSync(analyticsProject.workspacePath!)).toBe(true);
      expect(fs.existsSync(auditProject.workspacePath!)).toBe(true);
    });

    it('validates that all department and project folders are strictly within master folder scope', async () => {
      const engCheck = await validateWithinMaster(engineeringDept.workspacePath!, masterRoot);
      expect(engCheck.valid).toBe(true);

      const prodCheck = await validateWithinMaster(productDept.workspacePath!, masterRoot);
      expect(prodCheck.valid).toBe(true);

      const gatewayProjCheck = await validateWithinMaster(apiGatewayProject.workspacePath!, masterRoot);
      expect(gatewayProjCheck.valid).toBe(true);

      const portalProjCheck = await validateWithinMaster(customerPortalProject.workspacePath!, masterRoot);
      expect(portalProjCheck.valid).toBe(true);
    });

    it('rejects external or unapproved folders outside the master organization root', async () => {
      const rogueCheck = await validateWithinMaster('C:\\Windows\\System32', masterRoot);
      expect(rogueCheck.valid).toBe(false);
      expect(rogueCheck.error).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Phase 2: Chat with Root CEO (Strategic Directive Delegation Across Departments)
  // --------------------------------------------------------------------------
  describe('Phase 2: Strategic Directive Chat with Root CEO', () => {
    it('processes strategic directive, delegates across departments/teams, and synthesizes results', async () => {
      const stepLogs: DelegationStepLog[] = [];
      const nodeStatusMap = new Map<string, string>();

      const engine = new OrgDelegationEngine(
        hierarchy,
        (step) => stepLogs.push(step),
        undefined,
        (nodeId, status) => nodeStatusMap.set(nodeId, status)
      );

      const directivePrompt =
        'Deploy high performance API Gateway for Engineering and ensure Customer Portal integration';

      const result = await engine.executeDirective(directivePrompt, undefined, undefined, undefined, false);

      expect(result.success).toBe(true);
      expect(result.directiveId).toBeDefined();
      expect(result.involvedDepartmentIds.length).toBeGreaterThan(0);
      expect(result.logs.length).toBeGreaterThan(3);

      // Verify the delegation chain: Root CEO -> Department Head -> Team Lead -> Specialists
      const rootCeoStep = stepLogs.find((s) => s.fromRole === 'Root CEO');
      expect(rootCeoStep).toBeDefined();
      expect(rootCeoStep?.fromName).toBe('Elena Vance');

      const deptStep = stepLogs.find((s) => s.fromRole === 'Department CEO');
      expect(deptStep).toBeDefined();

      const teamStep = stepLogs.find((s) => s.fromRole === 'Team Manager');
      expect(teamStep).toBeDefined();

      // Verify synthesis returned to user
      expect(result.finalSynthesis).toBeTruthy();

      // Record conversation into history
      const ceoConversation: OrgConversation = {
        id: `conv-ceo-${Date.now()}`,
        title: `Directive: ${directivePrompt.slice(0, 32)}...`,
        type: 'ceo_directive',
        sourceNodeId: 'root-ceo',
        targetNodeId: result.involvedDepartmentIds[0],
        timestamp: Date.now(),
        messages: [
          {
            id: 'msg-user-1',
            sender: 'User',
            role: 'user',
            content: directivePrompt,
            timestamp: Date.now(),
          },
          {
            id: 'msg-ceo-1',
            sender: 'Elena Vance',
            role: 'ceo',
            content: result.finalSynthesis,
            timestamp: Date.now(),
          },
        ],
      };
      conversationsStore.push(ceoConversation);
      expect(conversationsStore.length).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 3: Direct 1:1 Chat with Department Head
  // --------------------------------------------------------------------------
  describe('Phase 3: Direct 1:1 Chat with Department Head', () => {
    it('chats directly with Engineering VP Dr. Marcus Thorne and receives department-level response', async () => {
      const nodeStatusMap = new Map<string, string>();
      const engine = new OrgDelegationEngine(hierarchy, undefined, undefined, (nodeId, status) =>
        nodeStatusMap.set(nodeId, status)
      );

      const prompt =
        'Please provide the Q4 engineering roadmap and project allocations for api-gateway and cloud-infra.';
      const response = await engine.executeDirectMessage(engHead, prompt, engHead.workspacePath!, false);

      expect(response).toBeTruthy();
      expect(response).toContain('Dr. Marcus Thorne');
      expect(nodeStatusMap.get(engHead.id)).toBe('recently_finished');

      // Record into conversation store
      const deptConversation: OrgConversation = {
        id: `conv-dept-${Date.now()}`,
        title: `Chat with Dr. Marcus Thorne`,
        type: 'agent_direct',
        sourceNodeId: 'root-ceo',
        targetNodeId: engineeringDept.id,
        targetAgentId: engHead.id,
        targetRole: engHead.role,
        targetAgentName: engHead.name,
        timestamp: Date.now(),
        messages: [
          { id: 'msg-u-2', sender: 'User', role: 'user', content: prompt, timestamp: Date.now() },
          { id: 'msg-a-2', sender: engHead.name, role: engHead.role, content: response, timestamp: Date.now() },
        ],
      };
      conversationsStore.push(deptConversation);
      expect(conversationsStore.length).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 4: Direct 1:1 Chat with Project Head / Team Lead
  // --------------------------------------------------------------------------
  describe('Phase 4: Direct 1:1 Chat with Project Head / Team Lead', () => {
    it('chats with Engineering Lead Devon Cross for api-gateway project', async () => {
      const nodeStatusMap = new Map<string, string>();
      const engine = new OrgDelegationEngine(hierarchy, undefined, undefined, (nodeId, status) =>
        nodeStatusMap.set(nodeId, status)
      );

      const prompt = 'Review the api-gateway architecture and confirm status of microservice rate limiting.';
      const response = await engine.executeDirectMessage(
        apiGatewayLead,
        prompt,
        apiGatewayProject.workspacePath!,
        false
      );

      expect(response).toBeTruthy();
      expect(response).toContain('Devon Cross');
      expect(nodeStatusMap.get(apiGatewayLead.id)).toBe('recently_finished');

      const projectConversation: OrgConversation = {
        id: `conv-proj-${Date.now()}`,
        title: `Chat with Devon Cross (api-gateway)`,
        type: 'agent_direct',
        projectId: apiGatewayProject.id,
        sourceNodeId: engineeringDept.id,
        targetNodeId: 'team-api-gateway',
        targetAgentId: apiGatewayLead.id,
        targetRole: apiGatewayLead.role,
        targetAgentName: apiGatewayLead.name,
        timestamp: Date.now(),
        messages: [
          { id: 'msg-u-3', sender: 'User', role: 'user', content: prompt, timestamp: Date.now() },
          {
            id: 'msg-a-3',
            sender: apiGatewayLead.name,
            role: apiGatewayLead.role,
            content: response,
            timestamp: Date.now(),
          },
        ],
      };
      conversationsStore.push(projectConversation);
      expect(conversationsStore.length).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 5: Direct 1:1 Chat with Specialist Team Member
  // --------------------------------------------------------------------------
  describe('Phase 5: Direct 1:1 Chat with Team Specialist', () => {
    it('chats with Senior Backend Architect Aria Sterling about implementation details', async () => {
      const nodeStatusMap = new Map<string, string>();
      const engine = new OrgDelegationEngine(hierarchy, undefined, undefined, (nodeId, status) =>
        nodeStatusMap.set(nodeId, status)
      );

      const prompt = 'Implement JWT token authentication middleware and route handlers in api-gateway.';
      const response = await engine.executeDirectMessage(
        backendSpecialist,
        prompt,
        backendSpecialist.workspacePath!,
        false
      );

      expect(response).toBeTruthy();
      expect(response).toContain('Aria Sterling');
      expect(nodeStatusMap.get(backendSpecialist.id)).toBe('recently_finished');

      const specialistConversation: OrgConversation = {
        id: `conv-spec-${Date.now()}`,
        title: `Chat with Aria Sterling (Senior Backend Architect)`,
        type: 'agent_direct',
        projectId: apiGatewayProject.id,
        sourceNodeId: 'team-api-gateway',
        targetNodeId: backendSpecialist.id,
        targetAgentId: backendSpecialist.id,
        targetRole: backendSpecialist.role,
        targetAgentName: backendSpecialist.name,
        timestamp: Date.now(),
        messages: [
          { id: 'msg-u-4', sender: 'User', role: 'user', content: prompt, timestamp: Date.now() },
          {
            id: 'msg-a-4',
            sender: backendSpecialist.name,
            role: backendSpecialist.role,
            content: response,
            timestamp: Date.now(),
          },
        ],
      };
      conversationsStore.push(specialistConversation);
      expect(conversationsStore.length).toBe(4);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 6: Multi-Department & Team Coherence Validation
  // --------------------------------------------------------------------------
  describe('Phase 6: Multi-Department and Cross-Team Coherence', () => {
    it('verifies complete organizational conversation log and cross-functional team separation', () => {
      expect(conversationsStore.length).toBe(4);

      // Verify Root CEO directive chat
      const ceoChat = conversationsStore.find((c) => c.type === 'ceo_directive');
      expect(ceoChat).toBeDefined();
      expect(ceoChat?.messages.length).toBe(2);

      // Verify Department Head chat
      const deptChat = conversationsStore.find((c) => c.targetRole === 'department_head');
      expect(deptChat).toBeDefined();
      expect(deptChat?.targetAgentName).toBe('Dr. Marcus Thorne');

      // Verify Project Head chat
      const projChat = conversationsStore.find((c) => c.targetRole === 'team_lead');
      expect(projChat).toBeDefined();
      expect(projChat?.projectId).toBe('proj-api-gateway');

      // Verify Specialist chat
      const specChat = conversationsStore.find((c) => c.targetRole === 'specialist');
      expect(specChat).toBeDefined();
      expect(specChat?.targetAgentName).toBe('Aria Sterling');

      // Verify departments maintain independent project memberships
      expect(engineeringDept.linkedProjects).toContain('proj-api-gateway');
      expect(engineeringDept.linkedProjects).toContain('proj-cloud-infra');
      expect(productDept.linkedProjects).toContain('proj-customer-portal');
      expect(operationsDept.linkedProjects).toContain('proj-audit');
    });
  });
});
