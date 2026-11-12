/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Button, Input, Message, Spin, Dropdown, Menu } from '@arco-design/web-react';
import { Send, NetworkTree, Robot, User, FolderClose, Peoples, Time, Plus, Loading, Close } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { useOrgStore } from '../store/useOrgStore';
import { OrgModelSelector } from './OrgModelSelector';
import { runAgentTurn, buildAgentSystemContext, type OrgChatTarget } from '../utils/agentTurn';
import { OrgMasterFolderModal } from './OrgMasterFolderModal';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import { computeAutoTitle } from '../utils/orgCoherence';
import type {
  OrgConversation,
  OrgConversationMessage,
  OrgAgentModelConfig,
  OrgCreatedEntityRef,
} from '@/types/organization';

export interface OrgChatErrorPanelProps {
  error: string | null;
  onDismiss: () => void;
}

export const OrgChatErrorPanel: React.FC<OrgChatErrorPanelProps> = ({ error, onDismiss }) => {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <div
      role='alert'
      className='mx-24px mt-16px flex items-center justify-between gap-8px rounded-8px border border-red-500/30 bg-red-500/10 px-12px py-8px text-12px text-red-300 shrink-0'
    >
      <span className='truncate'>
        {t('team.organization.openChatFailed', {
          defaultValue: 'Could not open this chat: {{error}}',
          error,
        })}
      </span>
      <Button
        type='text'
        size='mini'
        className='!text-red-300 hover:!text-red-200 shrink-0'
        aria-label={t('team.organization.dismiss', { defaultValue: 'Dismiss' })}
        onClick={onDismiss}
      >
        <Close size={12} theme='outline' />
      </Button>
    </div>
  );
};

export const OrgChatView: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    hierarchy,
    projects,
    conversations,
    selectedConversationId,
    setSelectedConversationId,
    setOrgViewMode,
    setSelectedDepartment,
    setSelectedTeam,
    setSelectedProject,
    addOrgConversation,
    addDepartment,
    addSubTeam,
    addOrgProject,
    addTeamMember,
    updateNodeStatus,
    updateAgentModel,
    updateRootCeo,
    openChatError,
    clearOpenChatError,
  } = useOrgStore();

  const [inputPrompt, setInputPrompt] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [liveStepText, setLiveStepText] = useState<string | null>(null);
  const [isMasterModalOpen, setIsMasterModalOpen] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string>('');
  const [errorState, setErrorState] = useState<{ message: string; threadId: string } | null>(null);
  const [draftsByThreadId, setDraftsByThreadId] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cancelRef = useRef<(() => Promise<void>) | null>(null);

  // Active conversation: selected from sidebar or the latest Root CEO conversation
  const activeConversation = useMemo<OrgConversation | undefined>(() => {
    if (selectedConversationId) {
      return conversations.find((c) => c.id === selectedConversationId);
    }
    // Default to the newest ceo_directive conversation if available
    return conversations
      .filter((c) => c.type === 'ceo_directive' && !c.projectId)
      .toSorted((a, b) => b.timestamp - a.timestamp)[0];
  }, [conversations, selectedConversationId]);

  // Bound project if active conversation is targeted to a specific project
  const activeProject = useMemo(() => {
    if (!activeConversation?.projectId) return undefined;
    return projects.find((p) => p.id === activeConversation.projectId);
  }, [activeConversation?.projectId, projects]);

  const activeDept = useMemo(() => {
    if (activeProject) {
      return hierarchy.departments.find((d) => d.id === activeProject.departmentId);
    }
    if (activeConversation?.targetNodeId && activeConversation.targetNodeId !== 'root-ceo') {
      return hierarchy.departments.find((d) => d.id === activeConversation.targetNodeId);
    }
    return undefined;
  }, [activeProject, activeConversation?.targetNodeId, hierarchy.departments]);

  const activeTeam = useMemo(() => {
    if (activeConversation?.teamId) {
      for (const dept of hierarchy.departments) {
        const team = dept.teams.find((t) => t.id === activeConversation.teamId);
        if (team) return team;
      }
    }
    if (activeProject && activeProject.teamIds && activeProject.teamIds.length > 0) {
      for (const dept of hierarchy.departments) {
        const team = dept.teams.find((t) => activeProject.teamIds.includes(t.id));
        if (team) return team;
      }
    }
    return undefined;
  }, [activeConversation?.teamId, activeProject, hierarchy.departments]);

  const activeProjectHead = useMemo(() => {
    if (!activeProject) return undefined;
    if (activeTeam?.teamLeadAgent) return activeTeam.teamLeadAgent;
    if (activeProject.teamIds.length > 0 && activeDept) {
      const team = activeDept.teams.find((t) => activeProject.teamIds.includes(t.id));
      if (team?.teamLeadAgent) return team.teamLeadAgent;
    }
    return activeDept?.departmentCeoAgent || activeDept?.pmAgent;
  }, [activeProject, activeDept, activeTeam]);

  // Specific agent target if this is a direct 1:1 chat
  const activeTargetAgent = useMemo<import('@/types/organization').OrgAgentMember | undefined>(() => {
    if (!activeConversation?.targetAgentId) return undefined;
    const targetId = activeConversation.targetAgentId;
    if (hierarchy.rootCeo.ceoAgent.id === targetId) return hierarchy.rootCeo.ceoAgent;
    if (hierarchy.rootCeo.chiefOfStaffAgent?.id === targetId) return hierarchy.rootCeo.chiefOfStaffAgent;
    for (const dept of hierarchy.departments) {
      if (dept.departmentCeoAgent.id === targetId) return dept.departmentCeoAgent;
      if (dept.pmAgent?.id === targetId) return dept.pmAgent;
      for (const team of dept.teams) {
        if (team.teamLeadAgent.id === targetId) return team.teamLeadAgent;
        if (team.hrCoordinatorAgent.id === targetId) return team.hrCoordinatorAgent;
        const spec = team.specialistMembers.find((m) => m.id === targetId);
        if (spec) return spec;
      }
    }
    return undefined;
  }, [activeConversation?.targetAgentId, hierarchy]);

  const { providers, getAvailableModels, formatModelLabel } = useModelProviderList();

  const firstAvailableConfiguredModel = useMemo<OrgAgentModelConfig | undefined>(() => {
    for (const provider of providers ?? []) {
      const models = getAvailableModels(provider);
      if (models.length > 0) {
        return {
          providerId: provider.id,
          modelId: models[0],
          modelName: formatModelLabel ? formatModelLabel(provider, models[0]) : models[0],
        };
      }
    }
    return undefined;
  }, [providers, getAvailableModels, formatModelLabel]);

  const currentTargetAgent =
    activeTargetAgent ||
    activeProjectHead ||
    activeTeam?.teamLeadAgent ||
    activeDept?.departmentCeoAgent ||
    hierarchy.rootCeo.ceoAgent;

  const currentAgentModel: OrgAgentModelConfig | undefined = useMemo(() => {
    // 1. Explicit model on current target agent (skip stale hardcoded seed — Step 1e)
    if (currentTargetAgent.model?.modelId && currentTargetAgent.model.modelId !== 'claude-3-7-sonnet') {
      return currentTargetAgent.model;
    }

    // 2. Custom or assigned model on Root CEO (skip stale hardcoded seed — Step 1e)
    if (hierarchy.rootCeo.ceoAgent.model?.modelId && hierarchy.rootCeo.ceoAgent.model.modelId !== 'claude-3-7-sonnet') {
      return hierarchy.rootCeo.ceoAgent.model;
    }

    // 3. First available model from user's configured providers
    if (firstAvailableConfiguredModel) {
      return firstAvailableConfiguredModel;
    }

    // 4. No model configured — return undefined so the UI can show a prompt
    return undefined;
  }, [currentTargetAgent, hierarchy.rootCeo.ceoAgent.model, firstAvailableConfiguredModel]);

  const activeWorkspacePath = useMemo(() => {
    const raw =
      activeProject?.workspacePath ||
      activeProject?.path ||
      activeTargetAgent?.workspacePath ||
      activeTeam?.workspacePath ||
      activeDept?.workspacePath ||
      hierarchy.rootCeo.workspacePath;
    return raw && raw !== 'workspace' ? raw : null;
  }, [activeProject, activeTargetAgent, activeTeam, activeDept, hierarchy.rootCeo.workspacePath]);

  // Unified target for the active thread. Every send goes through runAgentTurn
  // with this target; the CEO is just another target type.
  const activeChatTarget = useMemo<OrgChatTarget>(() => {
    const rootCeoId = hierarchy.rootCeo.ceoAgent.id;
    if (!activeConversation) return { type: 'ceo', id: rootCeoId };
    if (activeConversation.targetAgentId === rootCeoId || activeConversation.targetNodeId === 'root-ceo') {
      return { type: 'ceo', id: rootCeoId };
    }
    if (activeConversation.projectId) {
      return { type: 'project_head', id: activeConversation.projectId };
    }
    if (activeDept && activeConversation.targetAgentId === activeDept.departmentCeoAgent.id) {
      return { type: 'department_head', id: activeDept.id };
    }
    return { type: 'member', id: currentTargetAgent.id };
  }, [activeConversation, activeDept, currentTargetAgent.id, hierarchy.rootCeo.ceoAgent.id]);

  const isCeoChat = activeChatTarget.type === 'ceo';

  // Synchronize inputPrompt with per-thread draft
  const activeThreadId = activeConversation?.id;
  useEffect(() => {
    if (activeThreadId) {
      setInputPrompt(draftsByThreadId[activeThreadId] ?? '');
    }
  }, [activeThreadId]);

  const handleInputChange = (val: string) => {
    setInputPrompt(val);
    if (activeThreadId) {
      setDraftsByThreadId((prev) => ({ ...prev, [activeThreadId]: val }));
    }
  };

  const handleOpenWorkspaceFolder = useCallback(async () => {
    if (!activeWorkspacePath) {
      setIsMasterModalOpen(true);
      return;
    }
    try {
      await ipcBridge.shell.openFolderWith.invoke({ folder_path: activeWorkspacePath, tool: 'explorer' });
    } catch (err) {
      console.warn('[OrgChatView] Failed to open workspace folder:', err);
      Message.error(t('team.organization.openFolderFailed', { defaultValue: 'Could not open the working folder' }));
    }
  }, [activeWorkspacePath, t]);

  const handleClearWorkspaceFolder = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      updateRootCeo({ workspacePath: null });
      Message.info(t('team.organization.workspaceUnbound', { defaultValue: 'Organization workspace unbound' }));
    },
    [updateRootCeo, t]
  );

  const handleSelectCreatedEntity = useCallback(
    (ref: OrgCreatedEntityRef) => {
      if (ref.type === 'department') {
        setSelectedDepartment(ref.id);
        setSelectedTeam(null);
        setSelectedProject(null);
      } else if (ref.type === 'project') {
        setSelectedProject(ref.id);
      } else if (ref.type === 'team') {
        if (ref.departmentId) setSelectedDepartment(ref.departmentId);
        setSelectedTeam(ref.id);
        setSelectedProject(null);
      } else if (ref.departmentId) {
        // Member refs carry their team id in departmentId.
        setSelectedTeam(ref.departmentId);
      }
      setOrgViewMode('canvas');
      void navigate('/organization');
    },
    [navigate, setOrgViewMode, setSelectedDepartment, setSelectedProject, setSelectedTeam]
  );

  const handleSelectAgentModel = useCallback(
    (newModel: OrgAgentModelConfig) => {
      updateAgentModel(currentTargetAgent.id, newModel);
      Message.success(
        t('team.organization.modelSet', {
          defaultValue: 'Model set to {{model}} for {{agent}}',
          model: newModel.modelName || newModel.modelId,
          agent: currentTargetAgent.name,
        })
      );
    },
    [currentTargetAgent.id, currentTargetAgent.name, updateAgentModel, t]
  );

  const messages = useMemo<OrgConversationMessage[]>(() => {
    return activeConversation?.messages ?? [];
  }, [activeConversation]);

  // Auto-scroll to bottom when messages update or during execution
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, liveStepText, isExecuting, streamingContent]);

  const stopExecution = useCallback(async () => {
    // Cancel the underlying ACP conversation(s)
    if (cancelRef.current) {
      await cancelRef.current();
      cancelRef.current = null;
    }
    abortControllerRef.current?.abort();
    setIsExecuting(false);
    setLiveStepText(null);
    setStreamingContent('');
    updateNodeStatus(currentTargetAgent.id, 'recently_finished');
    setTimeout(() => updateNodeStatus(currentTargetAgent.id, 'idle'), 3000);
  }, [currentTargetAgent.id, updateNodeStatus]);

  const retryExecution = useCallback(async () => {
    if (!activeConversation || !errorState) return;
    setErrorState(null);
    // Find the last user message and re-execute with it (no duplicate)
    const lastUserMsg = [...activeConversation.messages].toReversed().find((m) => m.role === 'user');
    if (lastUserMsg) {
      // Remove the error message from the conversation first
      const messagesWithoutError = activeConversation.messages.filter((m) => m.id !== errorState.threadId);
      // Update conversation with messages minus error
      addOrgConversation({
        ...activeConversation,
        messages: messagesWithoutError,
      });
      // Execute with the existing user message
      await executeTurn(lastUserMsg.content, lastUserMsg);
    }
  }, [activeConversation, errorState]);

  // Core execution logic that can reuse an existing user message (for retry)
  const executeTurn = useCallback(
    async (prompt: string, existingUserMessage?: OrgConversationMessage) => {
      if (isExecuting) return;
      setIsExecuting(true);
      setStreamingContent('');
      setErrorState(null);
      abortControllerRef.current = new AbortController();
      setDraftsByThreadId((prev) => {
        const next = { ...prev };
        if (activeThreadId) delete next[activeThreadId];
        return next;
      });

      // Step 1b: auto-title from first user message (first 40 chars, trimmed)
      const isNewChatTitle =
        !activeConversation?.title ||
        activeConversation.title === t('team.organization.newChat', { defaultValue: 'New chat' });
      const autoTitle = isNewChatTitle ? computeAutoTitle(prompt, activeConversation?.title) : undefined;

      const isCeoDirective = isCeoChat;

      const targetAgent = currentTargetAgent;
      const activeWorkspace =
        activeWorkspacePath ||
        activeProject?.workspacePath ||
        activeProject?.path ||
        activeTeam?.workspacePath ||
        targetAgent.workspacePath ||
        hierarchy.rootCeo.workspacePath ||
        'workspace';

      const systemContext = isCeoDirective
        ? ''
        : buildAgentSystemContext({
            agent: targetAgent,
            projectName: activeProject?.name,
            projectGoal: activeProject?.goal || activeProject?.description,
            workspacePath: activeWorkspace,
            departmentName: activeDept?.name,
            roleLabel: targetAgent.title || targetAgent.role,
          });

      setLiveStepText(
        isCeoDirective
          ? t('team.organization.evaluatingDirective', {
              defaultValue: 'Evaluating directive at Global Executive HQ...',
            })
          : t('team.organization.communicatingWithAgent', {
              defaultValue: 'Communicating with {{agent}} [Model: {{model}}]...',
              agent: targetAgent.name,
              model: currentAgentModel?.modelName || currentAgentModel?.modelId || 'standard',
            })
      );
      updateNodeStatus(targetAgent.id, 'working');

      // Use existing user message or create new one
      const userMessage = existingUserMessage ?? {
        id: `msg-${Date.now()}-u`,
        sender: 'User',
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      };

      const targetConvId =
        activeConversation?.id ??
        (activeProject
          ? `conv-proj-${activeProject.id}-${Date.now()}`
          : activeTeam
            ? `conv-team-${activeTeam.id}-${Date.now()}`
            : activeTargetAgent
              ? `conv-direct-${targetAgent.id}-${Date.now()}`
              : `conv-ceo-${Date.now()}`);
      const initialConvTitle =
        // Step 1b: auto-title from first user message
        autoTitle ??
        activeConversation?.title ??
        (activeProject
          ? `${activeProject.name} - Chat`
          : activeTeam
            ? `${activeTeam.name} - Chat`
            : activeTargetAgent
              ? `Chat with ${targetAgent.name}`
              : `Directive: ${prompt.slice(0, 36)}...`);

      // Optimistically update conversation with user message
      const existingMessages = activeConversation?.messages ?? [];
      // Filter out any existing error messages
      const cleanMessages = existingMessages.filter((m) => m.role !== 'system' || !m.content.includes('Halted:'));
      const interimConversation: OrgConversation = {
        id: targetConvId,
        title: initialConvTitle,
        type:
          activeProject || activeTeam
            ? 'team_execution'
            : activeTargetAgent
              ? 'agent_direct'
              : activeConversation?.type || 'ceo_directive',
        sourceNodeId: activeConversation?.sourceNodeId || activeTeam?.id || activeDept?.id || 'root-ceo',
        targetNodeId: activeConversation?.targetNodeId || activeTeam?.id || activeDept?.id || 'root-ceo',
        projectId: activeProject?.id,
        teamId: activeConversation?.teamId || activeTeam?.id || activeProject?.teamIds?.[0],
        targetAgentId: targetAgent.id,
        targetRole: targetAgent.role,
        targetAgentName: targetAgent.name,
        targetAgentModel: targetAgent.model,
        backendConversationId: activeConversation?.backendConversationId,
        timestamp: Date.now(),
        summary: prompt,
        messages: [...cleanMessages, userMessage],
      };
      addOrgConversation(interimConversation);
      setSelectedConversationId(targetConvId);

      try {
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        let accumulatedText = '';
        let finalSynthesis = '';
        let createdEntitiesMsg: OrgConversationMessage | null = null;

        // Unified execution: CEO, project head, team lead and member all go
        // through runAgentTurn with the active thread's target.
        const { events, cancel } = runAgentTurn({
          hierarchy,
          projects,
          threadId: targetConvId,
          target: activeChatTarget,
          userText: prompt,
          agent: targetAgent,
          workspacePath: activeWorkspace,
          systemContext,
          conversation: activeConversation ?? null,
          isCeo: isCeoDirective,
          onNodeStatusUpdate: updateNodeStatus,
          signal: abortController.signal,
        });

        // Store cancel function for Stop button
        cancelRef.current = cancel;

        for await (const event of events) {
          switch (event.type) {
            case 'step':
              if (event.data.step) {
                setLiveStepText(`${event.data.step.fromName} -> ${event.data.step.toName}: ${event.data.step.message}`);
              }
              break;
            case 'text-delta':
              if (event.data.text) {
                accumulatedText += event.data.text;
                setStreamingContent(accumulatedText);
              }
              break;
            case 'created-entities':
              if (event.data.createdEntities) {
                const { departments, teams, projects: createdProjects, members } = event.data.createdEntities;
                // Apply to store
                if (departments?.length) {
                  for (const dept of departments) addDepartment(dept);
                }
                if (teams?.length) {
                  for (const { departmentId, team } of teams) addSubTeam(departmentId, team);
                }
                if (createdProjects?.length) {
                  for (const proj of createdProjects) addOrgProject(proj);
                }
                if (members?.length) {
                  for (const { teamId, member } of members) addTeamMember(teamId, member);
                }

                // Create "Created:" card message
                const createdParts: string[] = [];
                if (departments?.length)
                  createdParts.push(
                    `${departments.length} department(s): ${departments.map((d) => d.name).join(', ')}`
                  );
                if (teams?.length)
                  createdParts.push(`${teams.length} team(s): ${teams.map((t) => t.team.name).join(', ')}`);
                if (createdProjects?.length)
                  createdParts.push(
                    `${createdProjects.length} project(s): ${createdProjects.map((p) => p.name).join(', ')}`
                  );
                if (members?.length)
                  createdParts.push(`${members.length} member(s): ${members.map((m) => m.member.name).join(', ')}`);

                if (createdParts.length > 0) {
                  const entityRefs: import('@/types/organization').OrgCreatedEntityRef[] = [];
                  if (departments?.length) {
                    departments.forEach((d) =>
                      entityRefs.push({ type: 'department', id: d.id, name: d.name, departmentId: d.id })
                    );
                  }
                  if (teams?.length) {
                    teams.forEach((t) =>
                      entityRefs.push({
                        type: 'team',
                        id: t.team.id,
                        name: t.team.name,
                        departmentId: t.departmentId,
                      })
                    );
                  }
                  if (createdProjects?.length) {
                    createdProjects.forEach((p) =>
                      entityRefs.push({ type: 'project', id: p.id, name: p.name, departmentId: p.departmentId })
                    );
                  }
                  if (members?.length) {
                    members.forEach((m) =>
                      entityRefs.push({
                        type: 'member',
                        id: m.member.id,
                        name: m.member.name,
                        departmentId: m.teamId,
                      })
                    );
                  }

                  createdEntitiesMsg = {
                    id: `msg-${Date.now()}-created`,
                    sender: 'System',
                    role: 'system',
                    content: `${t('team.organization.createdEntities', { defaultValue: 'Created:' })}\n${createdParts.join('\n')}`,
                    timestamp: Date.now(),
                    createdEntities: entityRefs,
                  };
                }
              }
              break;
            case 'error':
              throw new Error(event.data.error || 'Unknown error');
            case 'done':
              finalSynthesis = event.data.finalSynthesis || accumulatedText;
              break;
          }
        }

        if (abortController.signal.aborted) {
          return;
        }

        const agentMessage: OrgConversationMessage = {
          id: `msg-${Date.now()}-a`,
          sender: targetAgent.name,
          role: 'assistant',
          content: finalSynthesis || accumulatedText,
          timestamp: Date.now(),
        };

        const finalConversation: OrgConversation = {
          ...interimConversation,
          summary: (finalSynthesis || accumulatedText).slice(0, 80),
          targetNodeId: activeDept?.id || interimConversation.targetNodeId,
          projectId: activeProject?.id,
          teamId: activeConversation?.teamId || activeProject?.teamIds?.[0],
          messages: [...cleanMessages, userMessage, ...(createdEntitiesMsg ? [createdEntitiesMsg] : []), agentMessage],
        };
        addOrgConversation(finalConversation);
        Message.success(
          t('team.organization.responseReceived', {
            defaultValue: 'Response received from {{agent}}',
            agent: targetAgent.name,
          })
        );
      } catch (err) {
        if (abortControllerRef.current?.signal.aborted) {
          // User stopped execution, don't show error
          return;
        }
        const errorMsg: OrgConversationMessage = {
          id: `msg-${Date.now()}-err`,
          sender: targetAgent.name,
          role: 'system',
          content: `${t('team.organization.halted', { defaultValue: 'Halted:' })} ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        };
        addOrgConversation({
          ...interimConversation,
          messages: [...cleanMessages, userMessage, errorMsg],
        });
        setErrorState({ message: err instanceof Error ? err.message : String(err), threadId: targetConvId });
        // No error toast - error shown inline in thread
      } finally {
        setIsExecuting(false);
        setLiveStepText(null);
        setStreamingContent('');
        updateNodeStatus(targetAgent.id, 'recently_finished');
        setTimeout(() => updateNodeStatus(targetAgent.id, 'idle'), 3000);
      }
    },
    [
      isExecuting,
      activeConversation,
      activeChatTarget,
      activeTargetAgent,
      activeProject,
      activeTeam,
      activeDept,
      activeWorkspacePath,
      currentTargetAgent,
      currentAgentModel,
      projects,
      hierarchy,
      addDepartment,
      addSubTeam,
      addOrgProject,
      addTeamMember,
      addOrgConversation,
      setSelectedConversationId,
      updateNodeStatus,
      t,
    ]
  );

  const handleSendMessage = useCallback(async () => {
    if (!inputPrompt.trim() || isExecuting) return;
    const prompt = inputPrompt.trim();
    setInputPrompt('');
    await executeTurn(prompt);
  }, [inputPrompt, isExecuting, executeTurn]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleQuickPrompt = (text: string) => {
    setInputPrompt(text);
  };

  const handleNewConversation = () => {
    if (activeProject) {
      const newConvId = `conv-proj-${activeProject.id}-${Date.now()}`;
      addOrgConversation({
        id: newConvId,
        title: `${activeProject.name} - Chat`,
        type: 'team_execution',
        sourceNodeId: activeProject.teamIds?.[0] || activeDept?.id || 'root-ceo',
        targetNodeId: activeProject.teamIds?.[0] || activeDept?.id || 'root-ceo',
        projectId: activeProject.id,
        teamId: activeProject.teamIds?.[0],
        timestamp: Date.now(),
        summary: '',
        messages: [],
      });
      setSelectedConversationId(newConvId);
      setInputPrompt('');
      setDraftsByThreadId((prev) => {
        const next = { ...prev };
        delete next[newConvId];
        return next;
      });
      return;
    }
    if (activeTeam) {
      const newConvId = `conv-team-${activeTeam.id}-${Date.now()}`;
      addOrgConversation({
        id: newConvId,
        title: `${activeTeam.name} - Chat`,
        type: 'team_execution',
        sourceNodeId: activeTeam.id,
        targetNodeId: activeTeam.id,
        teamId: activeTeam.id,
        timestamp: Date.now(),
        summary: '',
        messages: [],
      });
      setSelectedConversationId(newConvId);
      setInputPrompt('');
      setDraftsByThreadId((prev) => {
        const next = { ...prev };
        delete next[newConvId];
        return next;
      });
      return;
    }
    // New CEO chat
    const newConvId = `conv-ceo-${Date.now()}`;
    addOrgConversation({
      id: newConvId,
      title: t('team.organization.newCeoChat', { defaultValue: 'New CEO Chat' }),
      type: 'ceo_directive',
      sourceNodeId: 'root-ceo',
      targetNodeId: 'root-ceo',
      timestamp: Date.now(),
      summary: '',
      messages: [],
    });
    setSelectedConversationId(newConvId);
    setInputPrompt('');
    setDraftsByThreadId((prev) => {
      const next = { ...prev };
      delete next[newConvId];
      return next;
    });
  };

  const placeholderText = isCeoChat
    ? t('team.organization.tellRootCeoPlaceholder', { defaultValue: 'Tell your Root CEO what you want done...' })
    : activeProject
      ? `Message ${activeProjectHead?.name || 'Project Lead'} about ${activeProject.name} (${currentAgentModel?.modelName || currentAgentModel?.modelId || 'Default Model'})...`
      : activeTeam
        ? `Message ${activeTeam.teamLeadAgent.name} for ${activeTeam.name} (${currentAgentModel?.modelName || currentAgentModel?.modelId || 'Default Model'})...`
        : activeTargetAgent
          ? `Message ${activeTargetAgent.name} directly (${currentAgentModel?.modelName || currentAgentModel?.modelId || 'Default Model'})...`
          : `Direct Root CEO (${currentAgentModel?.modelName || currentAgentModel?.modelId || 'Default Model'}) - issue strategic directives or manage structure...`;

  const runStatus: 'idle' | 'running' | 'error' = isExecuting ? 'running' : errorState ? 'error' : 'idle';
  const runStatusLabel =
    runStatus === 'running'
      ? t('team.organization.statusRunning', { defaultValue: 'Running' })
      : runStatus === 'error'
        ? t('team.organization.statusError', { defaultValue: 'Error' })
        : t('team.organization.statusIdle', { defaultValue: 'Idle' });

  return (
    <div className='flex flex-col h-full w-full bg-[var(--color-bg-1)] overflow-hidden select-text'>
      {/* Header */}
      <div className='h-54px px-20px border-b border-[var(--color-border-2)] bg-[var(--color-bg-2)] flex items-center justify-between shrink-0 select-none'>
        <div className='flex items-center gap-12px min-w-0'>
          <span className='size-34px rounded-10px bg-amber-500/15 text-amber-300 flex items-center justify-center text-18px shadow-sm shrink-0'>
            {isCeoChat ? '👑' : <Robot size={18} theme='outline' className='text-primary' />}
          </span>
          <div className='flex flex-col min-w-0 gap-2px'>
            <div className='flex items-center gap-8px min-w-0'>
              <span className='font-bold text-14px text-t-primary truncate' title={currentTargetAgent.name}>
                {currentTargetAgent.name}
              </span>
              <span className='text-12px text-t-secondary px-6px py-0.5px rounded-full bg-fill-2 border border-[var(--color-border-2)] truncate'>
                {currentTargetAgent.title || currentTargetAgent.role}
              </span>
              <OrgModelSelector
                currentModel={currentAgentModel}
                onSelectModel={handleSelectAgentModel}
                disabled={isExecuting}
              />
              <span
                className='flex items-center gap-4px text-12px font-mono shrink-0'
                aria-label={`${t('team.organization.status', { defaultValue: 'Status' })}: ${runStatusLabel}`}
              >
                <span
                  className={classNames('size-6px rounded-full', {
                    'bg-emerald-500': runStatus === 'idle',
                    'bg-emerald-400 animate-pulse': runStatus === 'running',
                    'bg-red-400': runStatus === 'error',
                  })}
                />
                <span
                  className={classNames({
                    'text-t-tertiary': runStatus === 'idle',
                    'text-emerald-400': runStatus === 'running',
                    'text-red-400': runStatus === 'error',
                  })}
                >
                  {runStatusLabel}
                </span>
              </span>
            </div>
            <div
              role='button'
              tabIndex={0}
              onClick={() => void handleOpenWorkspaceFolder()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void handleOpenWorkspaceFolder();
                }
              }}
              aria-label={
                activeWorkspacePath
                  ? t('team.organization.openFolder', { defaultValue: 'Open working folder' })
                  : t('team.organization.bindFolderClick', { defaultValue: 'Click to bind Organization Folder' })
              }
              className='flex items-center gap-4px text-12px font-mono text-t-tertiary hover:text-primary transition-colors cursor-pointer truncate max-w-420px group'
              title={activeWorkspacePath || t('team.organization.bindFolderClick', { defaultValue: 'Bind folder' })}
            >
              <FolderClose
                size={12}
                theme='outline'
                className={classNames('shrink-0', activeWorkspacePath ? 'text-amber-400' : 'text-t-tertiary')}
              />
              <span className='truncate'>
                {activeWorkspacePath ||
                  t('team.organization.bindFolderClick', { defaultValue: 'Click to bind Organization Folder' })}
              </span>
              {activeWorkspacePath && (
                <span
                  role='button'
                  tabIndex={0}
                  aria-label={t('team.organization.unbindFolder', { defaultValue: 'Unbind folder' })}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClearWorkspaceFolder(e);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      handleClearWorkspaceFolder(e);
                    }
                  }}
                  className='opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity ml-2px flex items-center'
                  title={t('team.organization.unbindFolder', { defaultValue: 'Unbind folder' })}
                >
                  <Close size={10} theme='outline' />
                </span>
              )}
            </div>
          </div>
        </div>

        <div className='flex items-center gap-8px shrink-0'>
          <Dropdown
            trigger='click'
            position='br'
            droplist={
              <Menu>
                <Menu.Item key='new-ceo-chat' onClick={handleNewConversation}>
                  {t('team.organization.newCeoChat', { defaultValue: 'New CEO Chat' })}
                </Menu.Item>
                {activeProject && (
                  <Menu.Item
                    key='new-project-chat'
                    onClick={() => {
                      const newConvId = `conv-proj-${activeProject!.id}-${Date.now()}`;
                      addOrgConversation({
                        id: newConvId,
                        title: `${activeProject!.name} - Chat`,
                        type: 'team_execution',
                        sourceNodeId: activeProject!.teamIds?.[0] || activeDept?.id || 'root-ceo',
                        targetNodeId: activeProject!.teamIds?.[0] || activeDept?.id || 'root-ceo',
                        projectId: activeProject!.id,
                        teamId: activeProject!.teamIds?.[0],
                        timestamp: Date.now(),
                        summary: '',
                        messages: [],
                      });
                      setSelectedConversationId(newConvId);
                      setInputPrompt('');
                    }}
                  >
                    {t('team.organization.newProjectChat', { defaultValue: 'New Project Chat' })}
                  </Menu.Item>
                )}
                {activeTeam && (
                  <Menu.Item
                    key='new-team-chat'
                    onClick={() => {
                      const newConvId = `conv-team-${activeTeam!.id}-${Date.now()}`;
                      addOrgConversation({
                        id: newConvId,
                        title: `${activeTeam!.name} - Chat`,
                        type: 'team_execution',
                        sourceNodeId: activeTeam!.id,
                        targetNodeId: activeTeam!.id,
                        teamId: activeTeam!.id,
                        timestamp: Date.now(),
                        summary: '',
                        messages: [],
                      });
                      setSelectedConversationId(newConvId);
                      setInputPrompt('');
                    }}
                  >
                    {t('team.organization.newTeamChat', { defaultValue: 'New Team Chat' })}
                  </Menu.Item>
                )}
                {activeTargetAgent && (
                  <Menu.Item
                    key='new-direct-chat'
                    onClick={() => {
                      const newConvId = `conv-direct-${currentTargetAgent.id}-${Date.now()}`;
                      addOrgConversation({
                        id: newConvId,
                        title: t('team.organization.newDirectChat', {
                          defaultValue: 'Chat with {{name}}',
                          name: currentTargetAgent.name,
                        }),
                        type: 'agent_direct',
                        sourceNodeId: 'root-ceo',
                        targetNodeId: currentTargetAgent.id,
                        targetAgentId: currentTargetAgent.id,
                        timestamp: Date.now(),
                        summary: '',
                        messages: [],
                      });
                      setSelectedConversationId(newConvId);
                      setInputPrompt('');
                    }}
                  >
                    {t('team.organization.newMessage', { defaultValue: 'New Message' })}
                  </Menu.Item>
                )}
              </Menu>
            }
          >
            <Button
              size='small'
              type='secondary'
              icon={<Plus size={13} theme='outline' />}
              onClick={handleNewConversation}
              className='!rounded-8px !text-12px'
            >
              {activeProject
                ? t('team.organization.newProjectChat', { defaultValue: 'New Project Chat' })
                : activeTeam
                  ? t('team.organization.newTeamChat', { defaultValue: 'New Team Chat' })
                  : activeTargetAgent
                    ? t('team.organization.newMessage', { defaultValue: 'New Message' })
                    : t('team.organization.newCeoChat', { defaultValue: 'New CEO Chat' })}
            </Button>
          </Dropdown>

          <Button
            size='small'
            type='primary'
            icon={<NetworkTree size={14} theme='outline' />}
            onClick={() => setOrgViewMode('canvas')}
            className='!rounded-8px !text-12px'
          >
            🗺️ 2D Canvas
          </Button>
        </div>
      </div>

      {/* Inline open-chat error (set when the sidebar cannot resolve a target) */}
      <OrgChatErrorPanel error={openChatError} onDismiss={clearOpenChatError} />

      {/* Message timeline */}
      <div ref={scrollRef} className='flex-1 overflow-y-auto p-24px flex flex-col gap-18px min-h-0'>
        {messages.length === 0 ? (
          <div className='my-auto flex flex-col items-center justify-center max-w-560px mx-auto text-center gap-16px select-none py-32px'>
            <span className='size-64px rounded-20px bg-gradient-to-tr from-amber-500/20 via-primary/15 to-emerald-500/20 flex items-center justify-center text-32px shadow-md border border-amber-500/30'>
              {activeProject ? (
                <FolderClose size={32} theme='outline' className='text-amber-400' />
              ) : activeTeam ? (
                <Peoples size={32} theme='outline' className='text-primary' />
              ) : activeTargetAgent ? (
                <Robot size={32} theme='outline' className='text-primary' />
              ) : (
                '👑'
              )}
            </span>
            <div className='flex flex-col gap-6px'>
              <h2 className='text-18px font-bold text-t-primary m-0'>
                {activeProject
                  ? t('team.organization.projectWorkspace', {
                      defaultValue: 'Project Workspace: {{name}}',
                      name: activeProject.name,
                    })
                  : activeTeam
                    ? t('team.organization.teamWorkspace', {
                        defaultValue: 'Team Workspace: {{name}}',
                        name: activeTeam.name,
                      })
                    : activeTargetAgent
                      ? t('team.organization.directLine', {
                          defaultValue: 'Direct Line: {{name}}',
                          name: activeTargetAgent.name,
                        })
                      : t('team.organization.globalExecutiveCommand', { defaultValue: 'Global Executive Command' })}
              </h2>
              <p className='text-13px text-t-secondary m-0 leading-relaxed'>
                {activeProject ? (
                  <>
                    {t('team.organization.conversingWithProjectLead', {
                      defaultValue:
                        'Conversing with <strong>{{lead}}</strong> in project workspace <code>{{workspace}}</code>. Interact directly with code, tasks, and project deliverables.',
                      lead: activeProjectHead?.name || 'Project Lead',
                      workspace: activeWorkspacePath || 'bound workspace',
                    })}
                  </>
                ) : activeTeam ? (
                  <>
                    {t('team.organization.conversingWithTeamLead', {
                      defaultValue:
                        'Conversing with <strong>{{lead}}</strong> for team <strong>{{team}}</strong>. Powered by assigned AI Model: <code>{{model}}</code>.',
                      lead: activeTeam.teamLeadAgent.name,
                      team: activeTeam.name,
                      model: currentAgentModel?.modelName || currentAgentModel?.modelId || 'Default Model',
                    })}
                  </>
                ) : activeTargetAgent ? (
                  <>
                    {t('team.organization.conversingWithAgent', {
                      defaultValue:
                        'Conversing directly with <strong>{{name}}</strong> ({{role}}). Powered by assigned AI Model: <code>{{model}}</code>.',
                      name: activeTargetAgent.name,
                      role: activeTargetAgent.title || activeTargetAgent.role,
                      model: currentAgentModel?.modelName || currentAgentModel?.modelId || 'Default Model',
                    })}
                  </>
                ) : (
                  <>
                    {t('team.organization.conversingWithRootCeo', {
                      defaultValue:
                        'You are directly conversing with the <strong>Root Organization CEO</strong>. Issue top-level mandates, direct organizational structuring (such as creating departments, teams, projects, or hiring specialists).',
                    })}
                  </>
                )}
              </p>
            </div>

            <div className='flex flex-col gap-8px w-full mt-8px'>
              <span className='text-11px font-mono text-t-tertiary uppercase tracking-wider'>
                {t('team.organization.suggestedTopics', { defaultValue: 'Suggested Topics' })}
              </span>
              <div className='flex flex-col gap-6px'>
                {(activeProject
                  ? [
                      t('team.organization.suggestReviewProject', {
                        defaultValue: 'Review the project files and architecture',
                      }),
                      t('team.organization.suggestProjectDeliverables', {
                        defaultValue: 'What are the key deliverables and status for this project?',
                      }),
                      t('team.organization.suggestImplementFeature', {
                        defaultValue: 'Help me implement the next feature for this project',
                      }),
                    ]
                  : activeTeam
                    ? [
                        t('team.organization.suggestTeamPriorities', {
                          defaultValue: 'What are your active priorities and task status?',
                        }),
                        t('team.organization.suggestTeamDeliverables', {
                          defaultValue: 'Review our team deliverables and suggest improvements',
                        }),
                        t('team.organization.suggestSprintBreakdown', {
                          defaultValue: 'Prepare a sprint breakdown for our assigned tasks',
                        }),
                      ]
                    : activeTargetAgent
                      ? [
                          t('team.organization.suggestAgentPriorities', {
                            defaultValue: 'What are your active priorities and task status?',
                          }),
                          t('team.organization.suggestAgentDeliverables', {
                            defaultValue: 'Review our workspace deliverables and suggest improvements',
                          }),
                          t('team.organization.suggestAgentSprint', {
                            defaultValue: 'Prepare a sprint breakdown for our assigned tasks',
                          }),
                        ]
                      : [
                          t('team.organization.suggestCreateDeptEngineering', {
                            defaultValue: 'Create department Engineering',
                          }),
                          t('team.organization.suggestCreateDeptMarketing', {
                            defaultValue: 'Create department Growth Marketing',
                          }),
                          t('team.organization.suggestCreateTeamMobile', {
                            defaultValue: 'Create team Mobile in department Engineering',
                          }),
                          t('team.organization.suggestHireSpecialist', {
                            defaultValue: 'Hire specialist Performance Engineer to team Mobile with model gpt-4o',
                          }),
                          t('team.organization.suggestCreateProject', {
                            defaultValue: 'Create project iOS Redesign under department Engineering',
                          }),
                        ]
                ).map((suggestion) => (
                  <button
                    key={suggestion}
                    type='button'
                    onClick={() => handleQuickPrompt(suggestion)}
                    className='w-full px-14px py-8px rounded-10px bg-fill-2 hover:bg-fill-3 border border-[var(--color-border-2)] text-left text-12px text-t-primary hover:border-primary/40 transition-all cursor-pointer flex items-center justify-between group'
                  >
                    <span>{suggestion}</span>
                    <span className='text-primary opacity-0 group-hover:opacity-100 text-11px font-mono transition-opacity'>
                      Use ›
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={classNames(
                    'flex gap-12px max-w-800px w-full',
                    isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'
                  )}
                >
                  {/* Avatar */}
                  <div
                    className={classNames(
                      'size-32px rounded-full flex items-center justify-center text-14px shrink-0 mt-2px shadow-sm',
                      isUser
                        ? 'bg-message-user text-primary border border-primary/20'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    )}
                  >
                    {isUser ? (
                      <User size={16} theme='outline' />
                    ) : activeProject ? (
                      <FolderClose size={16} theme='outline' className='text-amber-400' />
                    ) : activeTeam ? (
                      <Peoples size={16} theme='outline' className='text-primary' />
                    ) : activeTargetAgent ? (
                      <Robot size={16} theme='outline' className='text-primary' />
                    ) : (
                      '👑'
                    )}
                  </div>

                  {/* Bubble */}
                  <div
                    className={classNames(
                      'flex flex-col gap-4px min-w-0 max-w-[85%]',
                      isUser ? 'items-end' : 'items-start'
                    )}
                  >
                    <div className='flex items-center gap-6px text-11px font-mono text-t-tertiary select-none px-2px'>
                      <span className='font-semibold text-t-secondary'>{msg.sender}</span>
                      <span>•</span>
                      <span>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div
                      className={classNames(
                        'p-14px rounded-14px text-13px leading-relaxed border shadow-sm select-text whitespace-pre-wrap break-words',
                        isUser
                          ? 'bg-message-user border-primary/15 text-t-primary rounded-tr-2px'
                          : msg.role === 'system'
                            ? 'bg-orange-500/10 border-orange-500/30 text-orange-400 rounded-tl-2px'
                            : 'bg-[var(--color-bg-2)] border-[var(--color-border-2)] text-t-primary rounded-tl-2px'
                      )}
                    >
                      {msg.content}
                      {msg.createdEntities && msg.createdEntities.length > 0 && (
                        <div className='mt-8px flex flex-col gap-4px'>
                          {msg.createdEntities.map((ref) => (
                            <button
                              key={`${ref.type}-${ref.id}`}
                              type='button'
                              onClick={() => handleSelectCreatedEntity(ref)}
                              className='flex items-center gap-4px text-left text-12px text-primary hover:underline'
                              aria-label={ref.name}
                            >
                              <span className='truncate'>{ref.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Live execution indicator */}
            {isExecuting && (
              <div className='flex gap-12px max-w-800px w-full mr-auto'>
                <div className='size-32px rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center justify-center text-14px shrink-0 mt-2px shadow-sm'>
                  {activeProject ? (
                    <FolderClose size={16} theme='outline' className='text-amber-400' />
                  ) : activeTeam ? (
                    <Peoples size={16} theme='outline' className='text-primary' />
                  ) : activeTargetAgent ? (
                    <Robot size={16} theme='outline' className='text-primary' />
                  ) : (
                    '👑'
                  )}
                </div>
                <div className='flex flex-col gap-4px max-w-[85%]'>
                  <span className='text-11px font-mono text-t-tertiary px-2px'>
                    {currentTargetAgent.name} (
                    {isCeoChat
                      ? t('team.organization.delegating', { defaultValue: 'Delegating...' })
                      : t('team.organization.responding', { defaultValue: 'Responding...' })}
                    )
                  </span>
                  <div className='p-12px rounded-14px bg-[var(--color-bg-2)] border border-primary/30 text-t-primary rounded-tl-2px flex items-center gap-10px shadow-sm text-12px font-mono'>
                    <Spin dot size={12} />
                    <span className='text-primary truncate'>
                      {streamingContent ||
                        liveStepText ||
                        t('team.organization.processingDirective', { defaultValue: 'Processing directive...' })}
                    </span>
                    <Button
                      size='small'
                      type='text'
                      icon={<Close size={14} theme='outline' />}
                      onClick={stopExecution}
                      className='!text-11px ml-auto text-emerald-400 hover:text-emerald-300'
                    >
                      {t('team.organization.stop', { defaultValue: 'Stop' })}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Inline error with retry */}
            {errorState && !isExecuting && (
              <div className='flex gap-12px max-w-800px w-full mr-auto'>
                <div className='size-32px rounded-full bg-red-500/20 text-red-400 border border-red-500/30 flex items-center justify-center text-14px shrink-0 mt-2px shadow-sm'>
                  <Robot size={16} theme='outline' className='text-red-400' />
                </div>
                <div className='flex flex-col gap-4px max-w-[85%]'>
                  <div className='p-12px rounded-14px bg-red-500/10 border border-red-500/30 text-red-400 rounded-tl-2px flex items-center gap-10px shadow-sm text-12px font-mono'>
                    <span className='truncate'>{errorState.message}</span>
                    <Button
                      size='small'
                      type='primary'
                      icon={<Loading size={12} theme='outline' />}
                      onClick={retryExecution}
                      className='!text-11px ml-auto'
                    >
                      {t('team.organization.retry', { defaultValue: 'Retry' })}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Send Box */}
      <div className='p-16px border-t border-[var(--color-border-2)] bg-[var(--color-bg-2)] shrink-0 select-none'>
        <div className='max-w-860px mx-auto flex flex-col gap-8px'>
          {/* Show a "Connect a model" prompt if no model is configured */}
          {!currentAgentModel && (
            <div className='flex items-center gap-10px px-14px py-8px rounded-10px bg-orange-500/10 border border-orange-500/30 text-13px text-orange-400'>
              <span className='flex-1'>
                {t('team.organization.noModelConfigured', {
                  defaultValue: 'No AI model connected. Connect a model in Settings to start chatting.',
                })}
              </span>
              <Button
                size='small'
                type='secondary'
                onClick={() => void navigate('/settings/model')}
                className='!text-12px shrink-0'
              >
                {t('team.organization.goToSettings', { defaultValue: 'Open Settings' })}
              </Button>
            </div>
          )}
          <div className='relative rounded-12px border border-[var(--color-border-2)] focus-within:border-primary bg-[var(--color-bg-1)] shadow-sm transition-colors overflow-hidden'>
            <Input.TextArea
              rows={3}
              value={inputPrompt}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={isExecuting || !currentAgentModel}
              placeholder={placeholderText}
              className='!border-none !bg-transparent !p-12px !text-13px resize-none'
              autoFocus
            />

            <div className='flex items-center justify-between px-12px py-6px border-t border-[var(--color-border-2)]/40 bg-[var(--color-bg-2)]/50'>
              <div className='flex items-center gap-8px min-w-0 flex-wrap'>
                <span className='hidden sm:inline text-12px font-mono text-t-tertiary truncate'>
                  Press <kbd className='px-4px py-1px rounded bg-fill-2 text-t-secondary'>Enter</kbd> to send,{' '}
                  <kbd className='px-4px py-1px rounded bg-fill-2 text-t-secondary'>Shift+Enter</kbd> for new line
                </span>
              </div>

              <Button
                type='primary'
                size='small'
                icon={isExecuting ? <Close size={13} theme='outline' /> : <Send size={13} theme='outline' />}
                loading={false}
                disabled={!inputPrompt.trim() || isExecuting || !currentAgentModel}
                onClick={() => void (isExecuting ? stopExecution() : handleSendMessage())}
                className='!rounded-8px !px-14px !h-28px !font-medium shrink-0'
              >
                {isExecuting
                  ? t('team.organization.stop', { defaultValue: 'Stop' })
                  : t('team.organization.send', { defaultValue: 'Send' })}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <OrgMasterFolderModal visible={isMasterModalOpen} onClose={() => setIsMasterModalOpen(false)} />
    </div>
  );
};

export default React.memo(OrgChatView);
