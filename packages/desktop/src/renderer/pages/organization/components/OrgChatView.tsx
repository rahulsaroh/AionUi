/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Button, Input, Tag, Tooltip, Message, Spin } from '@arco-design/web-react';
import {
  Send,
  NetworkTree,
  Robot,
  User,
  FolderClose,
  Peoples,
  Time,
  Plus,
  Loading,
  Clear,
  MessageOne,
  FolderOpen,
  Close,
} from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { useOrgStore } from '../store/useOrgStore';
import { OrgDelegationEngine } from '../utils/orgDelegationEngine';
import { OrgModelSelector } from './OrgModelSelector';
import { OrgMasterFolderModal } from './OrgMasterFolderModal';
import type { OrgConversation, OrgConversationMessage, OrgAgentModelConfig } from '@/types/organization';

export const OrgChatView: React.FC = () => {
  const { t } = useTranslation();
  const {
    hierarchy,
    conversations,
    selectedConversationId,
    setSelectedConversationId,
    setOrgViewMode,
    addOrgConversation,
    addDepartment,
    addSubTeam,
    addOrgProject,
    addTeamMember,
    updateNodeStatus,
    updateAgentModel,
    updateRootCeo,
  } = useOrgStore();

  const [inputPrompt, setInputPrompt] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [liveStepText, setLiveStepText] = useState<string | null>(null);
  const [isMasterModalOpen, setIsMasterModalOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Active conversation: selected from sidebar or the latest Root CEO conversation
  const activeConversation = useMemo<OrgConversation | undefined>(() => {
    if (selectedConversationId) {
      return conversations.find((c) => c.id === selectedConversationId);
    }
    // Default to the newest ceo_directive conversation if available
    return conversations.find((c) => c.type === 'ceo_directive');
  }, [conversations, selectedConversationId]);

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

  const currentTargetAgent = activeTargetAgent || hierarchy.rootCeo.ceoAgent;
  const currentAgentModel: OrgAgentModelConfig | undefined = currentTargetAgent.model || {
    modelId: 'claude-3-7-sonnet',
    providerId: 'anthropic',
  };

  const activeWorkspacePath = useMemo(() => {
    const raw = activeTargetAgent?.workspacePath || hierarchy.rootCeo.workspacePath;
    return raw && raw !== 'workspace' ? raw : null;
  }, [activeTargetAgent?.workspacePath, hierarchy.rootCeo.workspacePath]);

  const handlePickWorkspaceFolder = useCallback(() => {
    setIsMasterModalOpen(true);
  }, []);

  const handleClearWorkspaceFolder = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      updateRootCeo({ workspacePath: null });
      Message.info('Organization workspace unbound');
    },
    [updateRootCeo]
  );

  const handleSelectAgentModel = useCallback(
    (newModel: OrgAgentModelConfig) => {
      updateAgentModel(currentTargetAgent.id, newModel);
      Message.success(`Model set to ${newModel.modelName || newModel.modelId} for ${currentTargetAgent.name}`);
    },
    [currentTargetAgent.id, currentTargetAgent.name, updateAgentModel]
  );

  const messages = useMemo<OrgConversationMessage[]>(() => {
    return activeConversation?.messages ?? [];
  }, [activeConversation]);

  // Auto-scroll to bottom when messages update or during execution
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, liveStepText, isExecuting]);

  const handleSendMessage = useCallback(async () => {
    if (!inputPrompt.trim() || isExecuting) return;
    const prompt = inputPrompt.trim();
    setInputPrompt('');
    setIsExecuting(true);

    const isDirectAgent = activeConversation?.type === 'agent_direct' && !!activeTargetAgent;
    const targetAgent = activeTargetAgent || hierarchy.rootCeo.ceoAgent;
    const activeWorkspace = targetAgent.workspacePath || hierarchy.rootCeo.workspacePath || 'workspace';

    setLiveStepText(
      isDirectAgent
        ? `Communicating with ${targetAgent.name} [Model: ${targetAgent.model?.modelId || 'standard'}]...`
        : 'Evaluating directive at Global Executive HQ...'
    );
    updateNodeStatus(targetAgent.id, 'working');

    const userMessage: OrgConversationMessage = {
      id: `msg-${Date.now()}-u`,
      sender: 'Executive User',
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };

    const targetConvId =
      activeConversation?.id ??
      (isDirectAgent ? `conv-direct-${targetAgent.id}-${Date.now()}` : `conv-ceo-${Date.now()}`);
    const initialConvTitle =
      activeConversation?.title ??
      (isDirectAgent ? `Chat with ${targetAgent.name}` : `Directive: ${prompt.slice(0, 36)}...`);

    // Optimistically update conversation with user message
    const existingMessages = activeConversation?.messages ?? [];
    const interimConversation: OrgConversation = {
      id: targetConvId,
      title: initialConvTitle,
      type: isDirectAgent ? 'agent_direct' : 'ceo_directive',
      sourceNodeId: activeConversation?.sourceNodeId || 'root-ceo',
      targetNodeId: activeConversation?.targetNodeId || 'root-ceo',
      targetAgentId: targetAgent.id,
      targetRole: targetAgent.role,
      targetAgentName: targetAgent.name,
      targetAgentModel: targetAgent.model,
      timestamp: Date.now(),
      summary: prompt,
      messages: [...existingMessages, userMessage],
    };
    addOrgConversation(interimConversation);
    setSelectedConversationId(targetConvId);

    try {
      const engine = new OrgDelegationEngine(
        hierarchy,
        (step) => setLiveStepText(`${step.fromName} -> ${step.toName}: ${step.message}`),
        (streamText) => setLiveStepText(streamText.slice(-80)),
        updateNodeStatus
      );

      if (isDirectAgent) {
        const agentResponse = await engine.executeDirectMessage(targetAgent, prompt, activeWorkspace, true);

        const agentMessage: OrgConversationMessage = {
          id: `msg-${Date.now()}-a`,
          sender: targetAgent.name,
          role: 'assistant',
          content: agentResponse,
          timestamp: Date.now(),
        };

        const finalConversation: OrgConversation = {
          ...interimConversation,
          summary: agentResponse.slice(0, 80),
          messages: [...existingMessages, userMessage, agentMessage],
        };
        addOrgConversation(finalConversation);
        Message.success(`Response received from ${targetAgent.name}`);
      } else {
        const result = await engine.executeDirective(prompt, undefined, undefined, undefined, true);

        // Auto-instantiate any departments requested
        if (result.createdDepartments && result.createdDepartments.length > 0) {
          for (const dept of result.createdDepartments) {
            addDepartment(dept);
          }
        }

        // Auto-instantiate any teams requested
        if (result.createdTeams && result.createdTeams.length > 0) {
          for (const { departmentId, team } of result.createdTeams) {
            addSubTeam(departmentId, team);
          }
        }

        // Auto-instantiate any projects requested
        if (result.createdProjects && result.createdProjects.length > 0) {
          for (const proj of result.createdProjects) {
            addOrgProject(proj);
          }
        }

        // Auto-instantiate any specialists requested
        if (result.createdMembers && result.createdMembers.length > 0) {
          for (const { teamId, member } of result.createdMembers) {
            addTeamMember(teamId, member);
          }
        }

        const ceoMessage: OrgConversationMessage = {
          id: `msg-${Date.now()}-c`,
          sender: hierarchy.rootCeo.ceoAgent.name,
          role: 'ceo',
          content: result.finalSynthesis,
          timestamp: Date.now(),
        };

        const finalConversation: OrgConversation = {
          ...interimConversation,
          summary: result.finalSynthesis,
          targetNodeId: result.involvedDepartmentIds[0] || 'root-ceo',
          messages: [...existingMessages, userMessage, ceoMessage],
        };
        addOrgConversation(finalConversation);
        Message.success('Executive directive processed by Root CEO');
      }
    } catch (err) {
      const errorMsg: OrgConversationMessage = {
        id: `msg-${Date.now()}-err`,
        sender: targetAgent.name,
        role: 'system',
        content: `Halted: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      };
      addOrgConversation({
        ...interimConversation,
        messages: [...existingMessages, userMessage, errorMsg],
      });
      Message.error('Failed to complete execution');
    } finally {
      setIsExecuting(false);
      setLiveStepText(null);
      updateNodeStatus(targetAgent.id, 'recently_finished');
      setTimeout(() => updateNodeStatus(targetAgent.id, 'idle'), 3000);
    }
  }, [
    inputPrompt,
    isExecuting,
    activeConversation,
    activeTargetAgent,
    hierarchy,
    addDepartment,
    addSubTeam,
    addOrgProject,
    addTeamMember,
    addOrgConversation,
    setSelectedConversationId,
    updateNodeStatus,
  ]);

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
    setSelectedConversationId(null);
    setInputPrompt('');
  };

  return (
    <div className='flex flex-col h-full w-full bg-[var(--color-bg-1)] overflow-hidden select-text'>
      {/* Header */}
      <div className='h-54px px-20px border-b border-[var(--color-border-2)] bg-[var(--color-bg-2)] flex items-center justify-between shrink-0 select-none'>
        <div className='flex items-center gap-12px min-w-0'>
          <span className='size-34px rounded-10px bg-amber-500/15 text-amber-300 flex items-center justify-center text-18px shadow-sm shrink-0'>
            {activeTargetAgent ? <Robot size={18} theme='outline' className='text-primary' /> : '👑'}
          </span>
          <div className='flex flex-col min-w-0'>
            <div className='flex items-center gap-8px'>
              <span className='font-bold text-14px text-t-primary truncate'>
                {activeTargetAgent ? activeTargetAgent.name : hierarchy.rootCeo.ceoAgent.name}
              </span>
              <Tag
                size='small'
                color={activeTargetAgent ? 'arcoblue' : 'gold'}
                className='text-10px font-medium px-6px py-0.5px rounded-full'
              >
                {activeTargetAgent ? activeTargetAgent.title || activeTargetAgent.role : 'Root Executive HQ'}
              </Tag>
              {currentAgentModel?.modelId && (
                <Tag size='small' color='cyan' className='text-10px font-mono px-6px py-0.5px rounded-full'>
                  {currentAgentModel.modelId}
                </Tag>
              )}
              {isExecuting ? (
                <span className='flex items-center gap-4px text-10px font-mono text-emerald-400'>
                  <span className='size-6px rounded-full bg-emerald-400 animate-ping' />
                  <span>Executing...</span>
                </span>
              ) : (
                <span className='flex items-center gap-4px text-10px font-mono text-t-tertiary'>
                  <span className='size-6px rounded-full bg-emerald-500' />
                  <span>Ready</span>
                </span>
              )}
            </div>
            <div
              onClick={() => void handlePickWorkspaceFolder()}
              className='flex items-center gap-4px text-10px font-mono text-t-tertiary hover:text-primary transition-colors cursor-pointer truncate max-w-360px group'
              title='Click to bind or change organization workspace folder'
            >
              <FolderClose
                size={11}
                theme='outline'
                className={classNames('shrink-0', activeWorkspacePath ? 'text-amber-400' : 'text-t-tertiary')}
              />
              <span className='truncate'>{activeWorkspacePath || 'Click to bind Organization Folder'}</span>
              {activeWorkspacePath && (
                <span
                  onClick={handleClearWorkspaceFolder}
                  className='opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity ml-2px flex items-center'
                  title='Unbind folder'
                >
                  <Close size={10} theme='outline' />
                </span>
              )}
            </div>
          </div>
        </div>

        <div className='flex items-center gap-8px shrink-0'>
          <Button
            size='small'
            type='secondary'
            icon={<Plus size={13} theme='outline' />}
            onClick={handleNewConversation}
            className='!rounded-8px !text-12px'
          >
            {activeTargetAgent ? 'New Message' : 'New Directive'}
          </Button>

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

      {/* Message timeline */}
      <div ref={scrollRef} className='flex-1 overflow-y-auto p-24px flex flex-col gap-18px min-h-0'>
        {messages.length === 0 ? (
          <div className='my-auto flex flex-col items-center justify-center max-w-560px mx-auto text-center gap-16px select-none py-32px'>
            <span className='size-64px rounded-20px bg-gradient-to-tr from-amber-500/20 via-primary/15 to-emerald-500/20 flex items-center justify-center text-32px shadow-md border border-amber-500/30'>
              {activeTargetAgent ? <Robot size={32} theme='outline' className='text-primary' /> : '👑'}
            </span>
            <div className='flex flex-col gap-6px'>
              <h2 className='text-18px font-bold text-t-primary m-0'>
                {activeTargetAgent ? `Direct Line: ${activeTargetAgent.name}` : 'Global Executive Command'}
              </h2>
              <p className='text-13px text-t-secondary m-0 leading-relaxed'>
                {activeTargetAgent ? (
                  <>
                    Conversing directly with <strong>{activeTargetAgent.name}</strong> (
                    {activeTargetAgent.title || activeTargetAgent.role}). Powered by assigned AI Model:{' '}
                    <code className='text-primary font-mono'>
                      {activeTargetAgent.model?.modelId || 'claude-3-7-sonnet'}
                    </code>
                    .
                  </>
                ) : (
                  <>
                    You are directly conversing with the <strong>Root Organization CEO</strong>. Issue top-level
                    mandates, direct organizational structuring (such as creating departments, teams, projects, or
                    hiring specialists).
                  </>
                )}
              </p>
            </div>

            <div className='flex flex-col gap-8px w-full mt-8px'>
              <span className='text-11px font-mono text-t-tertiary uppercase tracking-wider'>
                {activeTargetAgent ? 'Suggested Directives' : 'Suggested Directives'}
              </span>
              <div className='flex flex-col gap-6px'>
                {(activeTargetAgent
                  ? [
                      'What are your active priorities and task status?',
                      'Review our workspace deliverables and suggest improvements',
                      'Prepare a sprint breakdown for our assigned tasks',
                    ]
                  : [
                      'Create department Engineering',
                      'Create department Growth Marketing',
                      'Create team Mobile in department Engineering',
                      'Hire specialist Performance Engineer to team Mobile with model gpt-4o',
                      'Create project iOS Redesign under department Engineering',
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
          messages.map((msg) => {
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
                      ? 'bg-primary/20 text-primary border border-primary/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  )}
                >
                  {isUser ? (
                    <User size={16} theme='outline' />
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
                        ? 'bg-primary/10 border-primary/25 text-t-primary rounded-tr-2px'
                        : 'bg-[var(--color-bg-2)] border-[var(--color-border-2)] text-t-primary rounded-tl-2px'
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Live execution indicator */}
        {isExecuting && (
          <div className='flex gap-12px max-w-800px w-full mr-auto'>
            <div className='size-32px rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center justify-center text-14px shrink-0 mt-2px shadow-sm'>
              {activeTargetAgent ? <Robot size={16} theme='outline' className='text-primary' /> : '👑'}
            </div>
            <div className='flex flex-col gap-4px max-w-[85%]'>
              <span className='text-11px font-mono text-t-tertiary px-2px'>
                {activeTargetAgent ? activeTargetAgent.name : hierarchy.rootCeo.ceoAgent.name} (
                {activeTargetAgent ? 'Responding...' : 'Delegating...'})
              </span>
              <div className='p-12px rounded-14px bg-[var(--color-bg-2)] border border-primary/30 text-t-primary rounded-tl-2px flex items-center gap-10px shadow-sm text-12px font-mono'>
                <Spin dot size={12} />
                <span className='text-primary truncate'>{liveStepText || 'Processing directive...'}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Send Box */}
      <div className='p-16px border-t border-[var(--color-border-2)] bg-[var(--color-bg-2)] shrink-0 select-none'>
        <div className='max-w-860px mx-auto flex flex-col gap-8px'>
          <div className='relative rounded-12px border border-[var(--color-border-2)] focus-within:border-primary bg-[var(--color-bg-1)] shadow-sm transition-colors overflow-hidden'>
            <Input.TextArea
              rows={3}
              value={inputPrompt}
              onChange={setInputPrompt}
              onKeyDown={handleKeyDown}
              disabled={isExecuting}
              placeholder={
                activeTargetAgent
                  ? `Message ${activeTargetAgent.name} directly (${activeTargetAgent.model?.modelId || 'claude-3-7-sonnet'})...`
                  : "Direct Root CEO (e.g. 'Create department Engineering', 'Hire specialist Performance Eng to team Mobile with model gpt-4o')..."
              }
              className='!border-none !bg-transparent !p-12px !text-13px resize-none'
              autoFocus
            />

            <div className='flex items-center justify-between px-12px py-6px border-t border-[var(--color-border-2)]/40 bg-[var(--color-bg-2)]/50'>
              <div className='flex items-center gap-8px min-w-0 flex-wrap'>
                <OrgModelSelector
                  currentModel={currentAgentModel}
                  onSelectModel={handleSelectAgentModel}
                  disabled={isExecuting}
                />

                <Tooltip
                  content={
                    activeWorkspacePath ? `Bound to: ${activeWorkspacePath}` : 'Bind organization workspace folder'
                  }
                >
                  <Button
                    size='small'
                    shape='round'
                    icon={<FolderOpen size={13} theme='outline' />}
                    onClick={() => void handlePickWorkspaceFolder()}
                    disabled={isExecuting}
                    className='!text-11px !h-26px !px-10px flex items-center gap-4px hover:!border-primary transition-colors'
                  >
                    <span className='truncate max-w-130px'>
                      {activeWorkspacePath
                        ? activeWorkspacePath.split(/[/\\]/).filter(Boolean).pop() || activeWorkspacePath
                        : 'Bind Folder'}
                    </span>
                    {activeWorkspacePath && (
                      <span
                        onClick={handleClearWorkspaceFolder}
                        className='ml-2px text-t-tertiary hover:text-red-400 flex items-center'
                        title='Unbind folder'
                      >
                        <Close size={11} theme='outline' />
                      </span>
                    )}
                  </Button>
                </Tooltip>

                <span className='hidden sm:inline text-10px font-mono text-t-tertiary truncate'>
                  Press <kbd className='px-4px py-1px rounded bg-fill-2 text-t-secondary'>Enter</kbd> to send,{' '}
                  <kbd className='px-4px py-1px rounded bg-fill-2 text-t-secondary'>Shift+Enter</kbd> for new line
                </span>
              </div>

              <Button
                type='primary'
                size='small'
                icon={<Send size={13} theme='outline' />}
                loading={isExecuting}
                disabled={!inputPrompt.trim() || isExecuting}
                onClick={() => void handleSendMessage()}
                className='!rounded-8px !px-14px !h-28px !font-medium shrink-0'
              >
                Send
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
