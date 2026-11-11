/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Drawer, Button, Tag, Tabs, Input, Message, Select, Spin } from '@arco-design/web-react';
import {
  Peoples,
  Workbench,
  Robot,
  Send,
  Time,
  FolderClose,
  MessageOne,
  Terminal,
  Edit,
  LinkOne,
  User,
  Plus,
  Remind,
} from '@icon-park/react';
import { useOrgStore } from '../store/useOrgStore';
import { ORG_THEME_PALETTE, computeLifecycleStatus } from '../utils/orgTheme';
import { OrgDelegationEngine } from '../utils/orgDelegationEngine';
import { validateWithinMaster } from '../utils/orgPathUtils';
import type { OrgProject, OrgAgentMember, OrgConversation, OrgConversationMessage } from '@/types/organization';

export type OrgNodeType = 'ceo' | 'department' | 'team' | 'project' | 'member';

type OrgInspectorDrawerProps = {
  selectedNodeId: string | null;
  selectedNodeType: OrgNodeType | null;
  visible: boolean;
  onClose: () => void;
  onOpenConversation?: (convId: string) => void;
  onEditDepartment?: (departmentId: string) => void;
  onEditProject?: (project: OrgProject) => void;
  onSetFolder?: (nodeId: string, nodeType: OrgNodeType) => void;
  initialDirective?: string;
  getPopupContainer?: () => HTMLElement;
};

function cleanErrorText(raw: string): string {
  try {
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      const jsonStr = raw.substring(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(jsonStr);
      const parts: string[] = [];
      if (parsed.code) parts.push(`[${parsed.code}]`);
      if (parsed.message) parts.push(parsed.message);
      if (parsed.detail) {
        parts.push(String(parsed.detail).split('\n')[0].slice(0, 180));
      }
      if (parts.length > 0) return parts.join(' - ');
    }
  } catch {
    // ignore
  }
  return raw.length > 240 ? `${raw.slice(0, 240)}...` : raw;
}

export const OrgInspectorDrawer: React.FC<OrgInspectorDrawerProps> = ({
  selectedNodeId,
  selectedNodeType,
  visible,
  onClose,
  onOpenConversation: _onOpenConversation,
  onEditDepartment,
  onEditProject,
  onSetFolder,
  initialDirective,
  getPopupContainer,
}) => {
  const {
    hierarchy,
    projects,
    conversations,
    nodeStatuses,
    addOrgConversation,
    updateNodeStatus,
    updateDepartment,
    updateTeamNode,
    addDepartment,
    addSubTeam,
    addTeamMember,
    updateRootCeo,
    setSelectedConversationId,
    setOrgViewMode,
    upsertOrgProject,
  } = useOrgStore();
  const [activeTab, setActiveTab] = useState<'conversations' | 'terminal' | 'members'>('conversations');
  const [directiveInput, setDirectiveInput] = useState('');
  const [expandedConvId, setExpandedConvId] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialDirective && visible) {
      setDirectiveInput(initialDirective);
    }
  }, [initialDirective, visible]);

  useEffect(() => {
    setActiveThreadId(null);
  }, [selectedNodeId]);

  const teamProjectForSelectedTeam = useMemo(() => {
    if (selectedNodeType !== 'team' || !selectedNodeId) return undefined;
    return projects.find((p) => p.teamIds.includes(selectedNodeId))?.id;
  }, [projects, selectedNodeType, selectedNodeId]);

  const nodeConversations = useMemo(() => {
    if (!selectedNodeId) return [];
    return conversations.filter(
      (c) =>
        c.sourceNodeId === selectedNodeId ||
        c.targetNodeId === selectedNodeId ||
        (selectedNodeType === 'ceo' && c.type === 'ceo_directive') ||
        (selectedNodeType === 'project' && c.projectId === selectedNodeId) ||
        (selectedNodeType === 'member' && (c.targetAgentId === selectedNodeId || c.agentId === selectedNodeId))
    );
  }, [conversations, selectedNodeId, selectedNodeType]);

  const activeConversation = useMemo(() => {
    if (activeThreadId) {
      const found = nodeConversations.find((c) => c.id === activeThreadId);
      if (found) return found;
    }
    return nodeConversations[0] || null;
  }, [activeThreadId, nodeConversations]);

  useEffect(() => {
    if (activeTab === 'conversations') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeConversation?.messages?.length, isExecuting, activeTab]);

  const handleStartDirectChat = useCallback(
    (agent: { id: string; name: string; title?: string }) => {
      const convId = `conv-direct-${agent.id}-${Date.now()}`;
      addOrgConversation({
        id: convId,
        title: `Direct Chat: ${agent.name}`,
        type: 'agent_direct',
        sourceNodeId: selectedNodeId || 'root-ceo',
        targetNodeId: selectedNodeId || 'root-ceo',
        targetAgentId: agent.id,
        targetAgentName: agent.name,
        timestamp: Date.now(),
        summary: `Direct 1:1 conversation with ${agent.name} (${agent.title || 'Specialist'})`,
        messages: [],
      });
      setSelectedConversationId(convId);
      setOrgViewMode('chat');
      onClose();
    },
    [addOrgConversation, onClose, selectedNodeId, setOrgViewMode, setSelectedConversationId]
  );

  let nodeTitle = 'Executive Node';
  let nodeRole = 'HQ';
  let lastActiveAt: number | null = null;
  let leaderName = '';
  let leaderTitle = '';
  let leaderRole = '';
  let nodeWorkspacePath: string | null = null;
  let specialists: Array<{ id: string; name: string; title?: string }> = [];
  let linkedProjects: Array<{ id: string; name: string; path?: string }> = [];
  let editableDepartmentId: string | null = null;
  let targetAgentMember: import('@/types/organization').OrgAgentMember | null = null;

  if (selectedNodeType === 'ceo' || selectedNodeId === 'root-ceo') {
    nodeTitle = hierarchy.rootCeo.name;
    nodeRole = 'Root Executive HQ';
    lastActiveAt = hierarchy.rootCeo.lastActiveAt;
    leaderName = hierarchy.rootCeo.ceoAgent.name;
    leaderTitle = hierarchy.rootCeo.ceoAgent.title || 'CEO';
    leaderRole = 'Root CEO';
    nodeWorkspacePath = hierarchy.rootCeo.workspacePath ?? null;
    targetAgentMember = hierarchy.rootCeo.ceoAgent;
    if (hierarchy.rootCeo.chiefOfStaffAgent) {
      specialists.push({
        id: hierarchy.rootCeo.chiefOfStaffAgent.id,
        name: hierarchy.rootCeo.chiefOfStaffAgent.name,
        title: hierarchy.rootCeo.chiefOfStaffAgent.title,
      });
    }
  } else if (selectedNodeType === 'department') {
    const dept = hierarchy.departments.find((d) => d.id === selectedNodeId);
    if (dept) {
      editableDepartmentId = dept.id;
      nodeTitle = dept.name;
      nodeRole = 'Department HQ';
      lastActiveAt = dept.lastActiveAt;
      leaderName = dept.departmentCeoAgent.name;
      leaderTitle = dept.departmentCeoAgent.title || 'Department Head';
      leaderRole = 'Department Head';
      nodeWorkspacePath = dept.workspacePath ?? null;
      targetAgentMember = dept.departmentCeoAgent;
      linkedProjects = dept.linkedProjects;
      dept.teams.forEach((teamNode) => {
        specialists.push({
          id: teamNode.teamLeadAgent.id,
          name: teamNode.teamLeadAgent.name,
          title: `Team Lead (${teamNode.name})`,
        });
        teamNode.specialistMembers.forEach((spec) => {
          specialists.push({
            id: spec.id,
            name: spec.name,
            title: spec.title || `${spec.role} (${teamNode.name})`,
          });
        });
      });
    }
  } else if (selectedNodeType === 'team') {
    for (const d of hierarchy.departments) {
      const teamNode = d.teams.find((team) => team.id === selectedNodeId);
      if (teamNode) {
        nodeTitle = teamNode.name;
        nodeRole = `Sub-Team (${d.name})`;
        lastActiveAt = teamNode.lastActiveAt;
        leaderName = teamNode.teamLeadAgent.name;
        leaderTitle = teamNode.teamLeadAgent.title || 'Team Manager';
        leaderRole = 'Team Lead';
        nodeWorkspacePath = teamNode.workspacePath ?? null;
        targetAgentMember = teamNode.teamLeadAgent;
        linkedProjects = projects
          .filter((project) => project.teamIds.includes(teamNode.id))
          .map((project) => ({ id: project.id, name: project.name, path: project.path }));
        if (linkedProjects.length === 0 && teamNode.linkedProjectName) {
          linkedProjects.push({ id: teamNode.linkedProjectId || teamNode.id, name: teamNode.linkedProjectName });
        }
        specialists = [
          {
            id: teamNode.hrCoordinatorAgent.id,
            name: teamNode.hrCoordinatorAgent.name,
            title: 'HR & Workload Coordinator',
          },
          ...teamNode.specialistMembers.map((s) => ({ id: s.id, name: s.name, title: s.title || s.role })),
        ];
        break;
      }
    }
  } else if (selectedNodeType === 'project') {
    const proj = projects.find((p) => p.id === selectedNodeId);
    if (proj) {
      nodeTitle = proj.name;
      nodeRole = 'Project';
      nodeWorkspacePath = proj.workspacePath ?? proj.path ?? null;
      linkedProjects = [{ id: proj.id, name: proj.name, path: proj.path || proj.workspacePath || undefined }];

      const parentDept = hierarchy.departments.find((d) => d.id === proj.departmentId);
      const parentTeam = parentDept?.teams.find((t) => proj.teamIds?.includes(t.id));

      if (parentTeam) {
        leaderName = parentTeam.teamLeadAgent.name;
        leaderTitle = parentTeam.teamLeadAgent.title || 'Team Lead';
        leaderRole = `Project Lead (${parentTeam.name})`;
        targetAgentMember = parentTeam.teamLeadAgent;
        specialists = parentTeam.specialistMembers.map((s) => ({ id: s.id, name: s.name, title: s.title || s.role }));
      } else if (parentDept) {
        leaderName = parentDept.departmentCeoAgent.name;
        leaderTitle = parentDept.departmentCeoAgent.title || 'Department Head';
        leaderRole = `Project Lead (${parentDept.name})`;
        targetAgentMember = parentDept.departmentCeoAgent;
      } else {
        leaderName = hierarchy.rootCeo.ceoAgent.name;
        leaderTitle = 'CEO';
        leaderRole = 'Project Overseer';
        targetAgentMember = hierarchy.rootCeo.ceoAgent;
      }
    }
  } else if (selectedNodeType === 'member') {
    let foundMember: OrgAgentMember | null = null;
    let foundTeamName = '';
    let foundWorkspace: string | null = null;

    if (hierarchy.rootCeo.chiefOfStaffAgent?.id === selectedNodeId) {
      foundMember = hierarchy.rootCeo.chiefOfStaffAgent;
      foundTeamName = 'Executive HQ';
      foundWorkspace = hierarchy.rootCeo.workspacePath ?? null;
    } else {
      for (const d of hierarchy.departments) {
        if (d.departmentCeoAgent?.id === selectedNodeId) {
          foundMember = d.departmentCeoAgent;
          foundTeamName = d.name;
          foundWorkspace = d.workspacePath ?? null;
          break;
        }
        for (const t of d.teams) {
          if (t.teamLeadAgent?.id === selectedNodeId) {
            foundMember = t.teamLeadAgent;
            foundTeamName = t.name;
            foundWorkspace = t.workspacePath ?? d.workspacePath ?? null;
            break;
          }
          if (t.hrCoordinatorAgent?.id === selectedNodeId) {
            foundMember = t.hrCoordinatorAgent;
            foundTeamName = t.name;
            foundWorkspace = t.workspacePath ?? d.workspacePath ?? null;
            break;
          }
          const spec = t.specialistMembers.find(
            (m) => m.id === selectedNodeId || m.canonicalAgentId === selectedNodeId
          );
          if (spec) {
            foundMember = spec;
            foundTeamName = t.name;
            foundWorkspace = spec.workspacePath ?? t.workspacePath ?? d.workspacePath ?? null;
            break;
          }
        }
        if (foundMember) break;
      }
    }

    if (foundMember) {
      nodeTitle = foundMember.name;
      nodeRole = foundMember.title || foundMember.role || 'Specialist';
      lastActiveAt = foundMember.lastActiveAt;
      leaderName = foundMember.name;
      leaderTitle = foundMember.title || foundMember.role || 'Specialist';
      leaderRole = foundTeamName ? `${foundMember.role} (${foundTeamName})` : foundMember.role || 'Specialist';
      nodeWorkspacePath = foundWorkspace;
      targetAgentMember = foundMember;
    }
  }

  const currentStatus = selectedNodeId ? nodeStatuses[selectedNodeId] || 'idle' : 'idle';
  const effectiveStatus = computeLifecycleStatus(lastActiveAt, currentStatus);
  const theme = ORG_THEME_PALETTE[effectiveStatus];

  const handleChangeFolder = async () => {
    if (!selectedNodeId || !selectedNodeType) return;
    try {
      const paths = await window.electronAPI.selectDirectory({ defaultPath: nodeWorkspacePath || undefined });
      const chosenPath = paths?.[0];
      if (!chosenPath) return;

      if (selectedNodeType === 'ceo' || selectedNodeId === 'root-ceo') {
        updateRootCeo({ workspacePath: chosenPath });
        Message.success(`Master organization workspace folder set to: ${chosenPath}`);
        return;
      }

      if (hierarchy.rootCeo.workspacePath) {
        const check = await validateWithinMaster(chosenPath, hierarchy.rootCeo.workspacePath);
        if (!check.valid) {
          Message.error(check.error || 'Folder must be inside the organization master folder');
          return;
        }
      }

      if (selectedNodeType === 'department') {
        const dept = hierarchy.departments.find((d) => d.id === selectedNodeId);
        if (dept) {
          await updateDepartment(dept.id, { workspacePath: chosenPath });
          Message.success(`Department workspace folder set to: ${chosenPath}`);
        }
      } else if (selectedNodeType === 'team') {
        for (const d of hierarchy.departments) {
          const teamNode = d.teams.find((t) => t.id === selectedNodeId);
          if (teamNode) {
            // eslint-disable-next-line no-await-in-loop
            await updateTeamNode(teamNode.id, { workspacePath: chosenPath });
            Message.success(`Team workspace folder set to: ${chosenPath}`);
            break;
          }
        }
      } else if (selectedNodeType === 'project') {
        const proj = projects.find((p) => p.id === selectedNodeId);
        if (proj) {
          upsertOrgProject({ ...proj, workspacePath: chosenPath, path: chosenPath });
          Message.success(`Project workspace folder set to: ${chosenPath}`);
        }
      }
    } catch (err) {
      console.error('[OrgInspectorDrawer] selectDirectory failed:', err);
    }
  };

  const handleDispatchDirective = async () => {
    if (!directiveInput.trim()) return;
    const prompt = directiveInput.trim();
    setDirectiveInput('');
    setIsExecuting(true);
    setExecutionLogs((prev) => [`[${new Date().toLocaleTimeString()}] Directive initiated: "${prompt}"`, ...prev]);
    updateNodeStatus(selectedNodeId, 'working');

    const engine = new OrgDelegationEngine(
      hierarchy,
      (step) => {
        setExecutionLogs((prev) => [
          `[${new Date(step.timestamp).toLocaleTimeString()}] (Depth ${step.depth}) ${step.fromName} -> ${step.toName}: ${step.message}`,
          ...prev,
        ]);
      },
      (text) => {
        setExecutionLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${text}`, ...prev]);
      },
      (nodeId, status) => {
        updateNodeStatus(nodeId, status);
      }
    );

    try {
      const targetProj = selectedNodeType === 'project' ? projects.find((p) => p.id === selectedNodeId) : undefined;
      const targetDeptId =
        selectedNodeType === 'department'
          ? selectedNodeId
          : selectedNodeType === 'project'
            ? targetProj?.departmentId
            : undefined;
      const targetTeamId =
        selectedNodeType === 'team'
          ? selectedNodeId
          : selectedNodeType === 'project'
            ? targetProj?.teamIds?.[0]
            : undefined;
      const targetProjectId = selectedNodeType === 'project' ? selectedNodeId : teamProjectForSelectedTeam;

      const existingMessages = activeConversation?.messages ?? [];
      const targetConvId = activeConversation?.id ?? `conv-${selectedNodeType}-${selectedNodeId}-${Date.now()}`;

      const userMessage: OrgConversationMessage = {
        id: `msg-${Date.now()}-u`,
        sender: 'You',
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      };

      const baseConv: OrgConversation = activeConversation ?? {
        id: targetConvId,
        title:
          activeConversation?.title ?? (selectedNodeType === 'ceo' ? 'Root CEO Directives' : `${nodeTitle} Thread`),
        projectId: targetProjectId,
        teamId: targetTeamId,
        type:
          selectedNodeType === 'ceo'
            ? 'ceo_directive'
            : selectedNodeType === 'department'
              ? 'dept_handoff'
              : selectedNodeType === 'member'
                ? 'agent_direct'
                : 'team_execution',
        sourceNodeId: selectedNodeId,
        targetNodeId: selectedNodeId || 'root-ceo',
        targetAgentName: leaderName,
        timestamp: Date.now(),
        messages: [],
      };

      const interimConv: OrgConversation = {
        ...baseConv,
        timestamp: Date.now(),
        messages: [...existingMessages, userMessage],
      };
      addOrgConversation(interimConv);
      setActiveThreadId(targetConvId);

      const result = await engine.executeDirective(
        prompt,
        targetDeptId,
        targetTeamId,
        targetProjectId,
        true // useRealExecution
      );
      if (result.createdDepartments && result.createdDepartments.length > 0) {
        for (const dept of result.createdDepartments) {
          addDepartment(dept);
        }
      }
      if (result.createdTeams && result.createdTeams.length > 0) {
        for (const { departmentId, team } of result.createdTeams) {
          addSubTeam(departmentId, team);
        }
      }
      if (result.createdProjects && result.createdProjects.length > 0) {
        for (const proj of result.createdProjects) {
          upsertOrgProject(proj);
        }
      }
      if (result.createdMembers && result.createdMembers.length > 0) {
        for (const { teamId, member } of result.createdMembers) {
          addTeamMember(teamId, member);
        }
      }
      if (result.success) {
        Message.success('Executive directive executed successfully!');
      }

      const agentMessage: OrgConversationMessage = {
        id: `msg-${Date.now()}-a`,
        sender: leaderName || 'Assistant',
        role: selectedNodeType === 'ceo' ? 'ceo' : 'lead',
        content:
          result.finalSynthesis ||
          (result.success ? 'Directive completed successfully.' : 'Directive finished without response output.'),
        timestamp: Date.now(),
      };

      const finalConv: OrgConversation = {
        ...interimConv,
        timestamp: Date.now(),
        summary: result.finalSynthesis || prompt,
        messages: [...existingMessages, userMessage, agentMessage],
      };
      addOrgConversation(finalConv);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      Message.error(`Directive execution halted: ${errorText}`);
      const targetConvId = activeConversation?.id ?? `conv-${selectedNodeType}-${selectedNodeId}-${Date.now()}`;
      const existingMessages = activeConversation?.messages ?? [];
      const userMessage: OrgConversationMessage = {
        id: `msg-${Date.now()}-u`,
        sender: 'You',
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      };
      const errMessage: OrgConversationMessage = {
        id: `msg-${Date.now()}-err`,
        sender: leaderName || 'System',
        role: 'system_error',
        content: `Inference Error: ${errorText}`,
        timestamp: Date.now(),
      };
      addOrgConversation({
        ...(activeConversation ?? {
          id: targetConvId,
          title: prompt.slice(0, 40),
          projectId: selectedNodeType === 'project' ? selectedNodeId : teamProjectForSelectedTeam,
          type: selectedNodeType === 'ceo' ? 'ceo_directive' : 'team_execution',
          sourceNodeId: selectedNodeId,
          targetNodeId: selectedNodeId || 'root-ceo',
          targetAgentName: leaderName,
        }),
        timestamp: Date.now(),
        messages: [...existingMessages, userMessage, errMessage],
      });
      setActiveThreadId(targetConvId);
    } finally {
      setIsExecuting(false);
      updateNodeStatus(selectedNodeId, 'recently_finished');
      setTimeout(() => updateNodeStatus(selectedNodeId, 'idle'), 4000);
      // Persist lastActiveAt so computeLifecycleStatus reflects recent use
      const now = Date.now();
      if (selectedNodeType === 'department' && selectedNodeId) {
        void updateDepartment(selectedNodeId, { lastActiveAt: now });
      } else if (selectedNodeType === 'team' && selectedNodeId) {
        void updateTeamNode(selectedNodeId, { lastActiveAt: now });
      }
    }
  };

  return (
    <Drawer
      title={
        <div className='flex flex-col gap-4px w-full min-w-0 pr-8px select-none overflow-hidden'>
          <div className='flex items-center justify-between gap-8px min-w-0 w-full'>
            <div className='flex items-center gap-6px min-w-0 flex-1 overflow-hidden'>
              <span className='size-22px rounded-6px bg-primary/10 text-primary flex items-center justify-center shrink-0'>
                {selectedNodeType === 'ceo' ? (
                  <Peoples size={13} theme='outline' fill='currentColor' />
                ) : selectedNodeType === 'department' ? (
                  <Workbench size={13} theme='outline' fill='currentColor' />
                ) : selectedNodeType === 'project' ? (
                  <FolderClose size={13} theme='outline' fill='currentColor' />
                ) : (
                  <User size={13} theme='outline' fill='currentColor' />
                )}
              </span>
              <span className='font-bold text-13px text-t-primary truncate min-w-0' title={nodeTitle}>
                {nodeTitle}
              </span>
              <Tag
                size='small'
                color='arcoblue'
                className='text-10px font-medium px-5px py-0.5px rounded-full shrink-0'
              >
                {nodeRole}
              </Tag>
            </div>
            <Tag
              size='small'
              style={{ borderColor: theme.borderColor, color: theme.textColor, backgroundColor: theme.backgroundColor }}
              className='text-10px font-medium px-5px py-0.5px rounded-full shrink-0'
            >
              {theme.badgeText}
            </Tag>
          </div>
          <div className='flex items-center justify-between gap-6px min-w-0 text-10px font-mono text-t-secondary'>
            <div className='flex items-center gap-6px min-w-0 flex-1 overflow-hidden'>
              <span className='truncate' title={`Chatting with: ${leaderRole} (${leaderName})`}>
                💬 {leaderRole}: <span className='text-t-primary font-medium'>{leaderName}</span>
              </span>
              {nodeWorkspacePath ? (
                <div
                  className='flex items-center gap-3px text-t-primary px-5px py-0.5px rounded bg-amber-500/10 border border-amber-500/20 shrink-0 max-w-160px'
                  title={nodeWorkspacePath}
                >
                  <FolderClose size={10} theme='outline' className='text-amber-400 shrink-0' />
                  <span className='truncate'>{nodeWorkspacePath}</span>
                </div>
              ) : null}
            </div>
            <div className='flex items-center gap-2px shrink-0'>
              {onSetFolder && (
                <Button
                  size='mini'
                  type='text'
                  icon={<LinkOne size={11} />}
                  onClick={handleChangeFolder}
                  disabled={!selectedNodeId}
                  className='!px-4px !text-10px'
                  title='Change Folder'
                />
              )}
              {selectedNodeType === 'department' && editableDepartmentId && (
                <Button
                  size='mini'
                  type='text'
                  icon={<Edit size={11} />}
                  onClick={() => onEditDepartment?.(editableDepartmentId)}
                  className='!px-4px !text-10px'
                  title='Quick Edit'
                />
              )}
            </div>
          </div>
        </div>
      }
      visible={visible && Boolean(selectedNodeId)}
      onCancel={onClose}
      width={480}
      zIndex={100}
      getPopupContainer={getPopupContainer}
      className='org-inspector-drawer'
      wrapClassName='org-inspector-drawer-wrapper'
      headerStyle={{ height: 'auto', minHeight: '52px', padding: '10px 16px', overflow: 'hidden' }}
      bodyStyle={{ padding: '12px 16px', overflowX: 'hidden' }}
      footer={
        <div className='flex items-center gap-8px w-full min-w-0'>
          <Input
            value={directiveInput}
            onChange={setDirectiveInput}
            onPressEnter={() => void handleDispatchDirective()}
            placeholder={
              selectedNodeType === 'ceo'
                ? "Ask Root CEO, plan structure, or type 'Create department Engineering'..."
                : selectedNodeType === 'project'
                  ? `Dispatch directive to ${nodeTitle} team...`
                  : selectedNodeType === 'member'
                    ? `Message ${leaderName}...`
                    : `Dispatch directive to ${leaderName}...`
            }
            disabled={isExecuting}
            className='flex-1 min-w-0 !rounded-8px text-12px'
          />
          <Button
            type='primary'
            loading={isExecuting}
            icon={<Send size={13} />}
            onClick={() => void handleDispatchDirective()}
            className='shrink-0 !rounded-8px !px-14px'
          >
            Send
          </Button>
        </div>
      }
    >
      <div className='flex flex-col gap-12px min-w-0 pr-2px pb-16px'>
        <div className='p-12px rounded-10px bg-fill-2 border border-[var(--color-border-2)] flex items-center justify-between'>
          <div className='flex items-center gap-10px min-w-0'>
            <span className='size-32px rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-13px shrink-0'>
              <Workbench size={16} theme='outline' />
            </span>
            <div className='flex flex-col min-w-0'>
              <span className='text-13px font-bold text-t-primary truncate'>{leaderName}</span>
              <span className='text-11px text-t-secondary truncate'>{leaderTitle}</span>
            </div>
          </div>
          <div className='flex items-center gap-4px text-10px font-mono text-t-tertiary shrink-0'>
            <Time size={12} theme='outline' />
            <span>
              {lastActiveAt
                ? new Date(lastActiveAt).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'Dormant (7d+)'}
            </span>
          </div>
        </div>

        <Button
          type='outline'
          size='small'
          icon={<MessageOne size={13} theme='outline' />}
          onClick={() => {
            if (activeConversation) {
              setSelectedConversationId(activeConversation.id);
              setOrgViewMode('chat');
              onClose();
            } else if (targetAgentMember) {
              handleStartDirectChat(targetAgentMember);
            } else {
              handleStartDirectChat({ id: selectedNodeId, name: leaderName, title: leaderTitle });
            }
          }}
          className='w-full !rounded-8px !text-12px !py-6px !font-medium'
        >
          Open in Full Chat with {leaderName}
        </Button>

        {linkedProjects.length > 0 && (
          <div className='flex flex-col gap-6px'>
            <span className='text-10px font-semibold uppercase tracking-wider text-t-tertiary'>
              Operating Projects ({linkedProjects.length})
            </span>
            <div className='flex items-center gap-6px flex-wrap'>
              {linkedProjects.map((p) => {
                const project = projects.find((item) => item.id === p.id);
                return (
                  <Button
                    key={p.id}
                    size='mini'
                    className='!h-auto !px-8px !py-3px !rounded-6px !bg-fill-1 !border !border-[var(--color-border-2)] !text-11px !font-mono !text-t-primary'
                    icon={<FolderClose size={12} theme='outline' className='text-amber-400' />}
                    onClick={() => {
                      if (project) onEditProject?.(project);
                    }}
                    title={p.path || p.name}
                  >
                    <span className='max-w-220px truncate'>{p.name}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        <Tabs
          activeTab={activeTab}
          onChange={(key) => setActiveTab(key as 'conversations' | 'terminal' | 'members')}
          type='rounded'
          className='w-full'
        >
          <Tabs.TabPane
            key='conversations'
            title={
              <span className='flex items-center gap-5px text-12px'>
                <MessageOne size={13} theme='outline' />
                <span>Chat ({activeConversation?.messages?.length || 0})</span>
              </span>
            }
          >
            <div className='flex flex-col gap-10px mt-8px min-w-0'>
              {/* Thread switcher bar */}
              <div className='flex items-center justify-between gap-6px p-6px px-8px rounded-8px bg-fill-1 border border-[var(--color-border-2)]'>
                <div className='flex items-center gap-6px flex-1 min-w-0'>
                  <span className='text-10px uppercase tracking-wider text-t-tertiary shrink-0 font-semibold'>
                    Thread:
                  </span>
                  {nodeConversations.length > 1 ? (
                    <Select
                      size='mini'
                      value={activeConversation?.id}
                      onChange={(val) => setActiveThreadId(val)}
                      className='flex-1 min-w-0 !h-24px'
                      bordered={false}
                    >
                      {nodeConversations.map((c) => (
                        <Select.Option key={c.id} value={c.id}>
                          <span className='truncate'>
                            {c.title || 'Untitled'} ({c.messages?.length || 0} msgs)
                          </span>
                        </Select.Option>
                      ))}
                    </Select>
                  ) : (
                    <span className='text-11px font-medium text-t-primary truncate min-w-0'>
                      {activeConversation?.title || 'Active Thread'} ({activeConversation?.messages?.length || 0} msgs)
                    </span>
                  )}
                </div>
                <Button
                  size='mini'
                  type='text'
                  icon={<Plus size={11} />}
                  onClick={() => {
                    const newId = `conv-${selectedNodeType}-${selectedNodeId}-${Date.now()}`;
                    setActiveThreadId(newId);
                    Message.info('Started a new thread. Type your message below.');
                  }}
                  title='Start a new conversation thread'
                  className='!text-11px !px-6px !h-22px shrink-0 text-primary'
                >
                  New Thread
                </Button>
              </div>

              {/* Message stream */}
              {!activeConversation?.messages || activeConversation.messages.length === 0 ? (
                <div className='py-28px text-center flex flex-col items-center gap-6px text-t-tertiary'>
                  <MessageOne size={24} className='opacity-30' />
                  <span className='text-12px font-medium text-t-secondary'>No messages in this thread</span>
                  <span className='text-11px max-w-260px'>
                    Send directives or questions in the chatbar below to converse with {leaderName}.
                  </span>
                </div>
              ) : (
                <div className='flex flex-col gap-10px min-w-0'>
                  {activeConversation.messages.map((m) => {
                    const isUser = m.role === 'user' || m.sender === 'You' || m.sender === 'Executive User';
                    const isError =
                      m.role === 'system_error' ||
                      m.content.includes('Inference Error') ||
                      m.content.includes('USER_LLM_PROVIDER_GATEWAY_ERROR');

                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col gap-3px min-w-0 ${isUser ? 'items-end' : 'items-start'}`}
                      >
                        <div className='flex items-center gap-6px text-10px text-t-tertiary px-4px'>
                          {!isUser && <Robot size={11} className='text-primary shrink-0' />}
                          <span className='font-medium'>{isUser ? 'You' : m.sender}</span>
                          <span>•</span>
                          <span className='font-mono'>
                            {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        <div
                          className={`max-w-[94%] rounded-12px text-12px px-12px py-8px break-words leading-relaxed ${
                            isUser
                              ? 'bg-primary/15 border border-primary/30 text-t-primary rounded-br-2px'
                              : isError
                                ? 'bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-bl-2px font-mono text-11px'
                                : 'bg-fill-2 border border-[var(--color-border-2)] text-t-primary rounded-bl-2px'
                          }`}
                        >
                          {isError ? (
                            <div className='flex flex-col gap-4px'>
                              <div className='flex items-center gap-5px text-rose-400 font-semibold'>
                                <Remind size={13} className='shrink-0' />
                                <span>Model Provider Error</span>
                              </div>
                              <div className='whitespace-pre-wrap text-10px leading-normal'>
                                {cleanErrorText(m.content)}
                              </div>
                            </div>
                          ) : (
                            <div className='whitespace-pre-wrap'>{m.content}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {isExecuting && (
                <div className='flex items-center gap-8px p-10px rounded-10px bg-fill-2 border border-primary/30 text-primary text-12px animate-pulse'>
                  <Spin size={12} />
                  <span className='text-11px font-mono truncate'>
                    {executionLogs[0] || `Executing directive with ${leaderName}...`}
                  </span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </Tabs.TabPane>

          <Tabs.TabPane
            key='terminal'
            title={
              <span className='flex items-center gap-5px text-12px'>
                <Terminal size={13} theme='outline' />
                <span>Live Logs ({executionLogs.length})</span>
              </span>
            }
          >
            <div className='p-10px rounded-8px bg-slate-950 font-mono text-11px text-emerald-300 min-h-160px max-h-260px overflow-y-auto flex flex-col gap-4px border border-slate-800 mt-8px'>
              {executionLogs.length === 0 ? (
                <span className='text-slate-500 italic'>No live telemetry events logged.</span>
              ) : (
                executionLogs.map((log, idx) => (
                  <div key={idx} className='leading-tight'>
                    {log}
                  </div>
                ))
              )}
            </div>
          </Tabs.TabPane>

          <Tabs.TabPane
            key='members'
            title={
              <span className='flex items-center gap-5px text-12px'>
                <Peoples size={13} theme='outline' />
                <span>Roster ({specialists.length})</span>
              </span>
            }
          >
            <div className='flex flex-col gap-6px mt-8px'>
              {specialists.map((spec) => (
                <div
                  key={spec.id}
                  className='p-8px rounded-8px bg-fill-1 border border-[var(--color-border-2)] flex items-center justify-between text-12px hover:bg-fill-2 transition-colors'
                >
                  <div className='flex items-center gap-8px min-w-0'>
                    <Robot size={14} theme='outline' className='text-primary shrink-0' />
                    <div className='flex flex-col min-w-0'>
                      <span className='font-medium text-t-primary truncate'>{spec.name}</span>
                      <span className='text-10px text-t-tertiary truncate max-w-160px font-mono'>{spec.title}</span>
                    </div>
                  </div>
                  <Button
                    size='mini'
                    type='text'
                    icon={<MessageOne size={12} theme='outline' />}
                    onClick={() => handleStartDirectChat(spec)}
                    className='!rounded-6px !text-11px'
                  >
                    Chat
                  </Button>
                </div>
              ))}
            </div>
          </Tabs.TabPane>
        </Tabs>
      </div>
    </Drawer>
  );
};

export default React.memo(OrgInspectorDrawer);
