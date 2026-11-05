/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Drawer, Button, Tag, Tabs, Input, Message } from '@arco-design/web-react';
import {
  Peoples,
  Workbench,
  Robot,
  Send,
  Time,
  FolderClose,
  MessageOne,
  Terminal,
} from '@icon-park/react';
import { useOrgStore } from '../store/useOrgStore';
import { ORG_THEME_PALETTE, computeLifecycleStatus } from '../utils/orgTheme';
import { OrgDelegationEngine } from '../utils/orgDelegationEngine';

interface OrgInspectorDrawerProps {
  selectedNodeId: string | null;
  selectedNodeType: 'ceo' | 'department' | 'team' | null;
  visible: boolean;
  onClose: () => void;
  onOpenConversation?: (convId: string) => void;
}

export const OrgInspectorDrawer: React.FC<OrgInspectorDrawerProps> = ({
  selectedNodeId,
  selectedNodeType,
  visible,
  onClose,
  onOpenConversation,
}) => {
  const { hierarchy, conversations, nodeStatuses, addOrgConversation, updateNodeStatus } =
    useOrgStore();
  const [activeTab, setActiveTab] = useState<'conversations' | 'terminal' | 'members'>('conversations');
  const [directiveInput, setDirectiveInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);

  if (!visible || !selectedNodeId) return null;

  // Resolve node data
  let nodeTitle = 'Executive Node';
  let nodeRole = 'HQ';
  let lastActiveAt: number | null = null;
  let leaderName = '';
  let leaderTitle = '';
  let specialists: Array<{ id: string; name: string; title?: string }> = [];
  let linkedProjects: Array<{ id: string; name: string }> = [];

  if (selectedNodeType === 'ceo' || selectedNodeId === 'root-ceo') {
    nodeTitle = hierarchy.rootCeo.name;
    nodeRole = 'Root Executive HQ';
    lastActiveAt = hierarchy.rootCeo.lastActiveAt;
    leaderName = hierarchy.rootCeo.ceoAgent.name;
    leaderTitle = hierarchy.rootCeo.ceoAgent.title || 'CEO';
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
      nodeTitle = dept.name;
      nodeRole = 'Department HQ';
      lastActiveAt = dept.lastActiveAt;
      leaderName = dept.departmentCeoAgent.name;
      leaderTitle = dept.departmentCeoAgent.title || 'Department Head';
      linkedProjects = dept.linkedProjects;
      dept.teams.forEach((t) => {
        specialists.push({
          id: t.id,
          name: t.name,
          title: `Team Lead: ${t.teamLeadAgent.name}`,
        });
      });
    }
  } else if (selectedNodeType === 'team') {
    for (const d of hierarchy.departments) {
      const t = d.teams.find((team) => team.id === selectedNodeId);
      if (t) {
        nodeTitle = t.name;
        nodeRole = `Sub-Team (${d.name})`;
        lastActiveAt = t.lastActiveAt;
        leaderName = t.teamLeadAgent.name;
        leaderTitle = t.teamLeadAgent.title || 'Team Manager';
        if (t.linkedProjectName) {
          linkedProjects.push({ id: t.linkedProjectId || t.id, name: t.linkedProjectName });
        }
        specialists = t.specialistMembers.map((s) => ({
          id: s.id,
          name: s.name,
          title: s.title || s.role,
        }));
        break;
      }
    }
  }

  const currentStatus = nodeStatuses[selectedNodeId] || 'idle';
  const effectiveStatus = computeLifecycleStatus(lastActiveAt, currentStatus);
  const theme = ORG_THEME_PALETTE[effectiveStatus];

  // Filter isolated conversations
  const nodeConversations = conversations.filter(
    (c) =>
      c.sourceNodeId === selectedNodeId ||
      c.targetNodeId === selectedNodeId ||
      (selectedNodeType === 'ceo' && c.type === 'ceo_directive')
  );

  const handleDispatchDirective = async () => {
    if (!directiveInput.trim()) return;
    const prompt = directiveInput.trim();
    setDirectiveInput('');
    setIsExecuting(true);
    setExecutionLogs((prev) => [
      `[${new Date().toLocaleTimeString()}] Directive initiated: "${prompt}"`,
      ...prev,
    ]);

    updateNodeStatus(selectedNodeId, 'working');

    const engine = new OrgDelegationEngine(hierarchy, (step) => {
      setExecutionLogs((prev) => [
        `[${new Date(step.timestamp).toLocaleTimeString()}] (Depth ${step.depth}) ${step.fromName} -> ${step.toName}: ${step.message}`,
        ...prev,
      ]);
    });

    try {
      const result = await engine.executeDirective(prompt, selectedNodeType === 'department' ? selectedNodeId : undefined);
      if (result.success) {
        Message.success('Executive directive executed successfully!');
        // Record org conversation
        addOrgConversation({
          id: `conv-exec-${Date.now()}`,
          title: `Directive: ${prompt.slice(0, 45)}...`,
          type: selectedNodeType === 'ceo' ? 'ceo_directive' : 'dept_handoff',
          sourceNodeId: selectedNodeId,
          targetNodeId: result.involvedDepartmentIds[0] || 'dept-app-builder',
          timestamp: Date.now(),
          summary: result.finalSynthesis,
          messages: [
            {
              id: `msg-${Date.now()}-1`,
              sender: leaderName,
              role: 'lead',
              content: prompt,
              timestamp: Date.now(),
            },
            {
              id: `msg-${Date.now()}-2`,
              sender: 'Org Delegation Engine',
              role: 'system',
              content: result.finalSynthesis,
              timestamp: Date.now(),
            },
          ],
        });
      }
    } catch (err) {
      Message.error(`Directive execution halted: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsExecuting(false);
      updateNodeStatus(selectedNodeId, 'recently_finished');
      setTimeout(() => updateNodeStatus(selectedNodeId, 'idle'), 4000);
    }
  };

  return (
    <Drawer
      title={
        <div className='flex items-center justify-between w-full pr-12px select-none'>
          <div className='flex items-center gap-8px min-w-0'>
            <span className='size-24px rounded-6px bg-primary/10 text-primary flex items-center justify-center shrink-0'>
              <Peoples size={14} theme='outline' fill='currentColor' />
            </span>
            <span className='font-bold text-14px text-t-primary truncate' title={nodeTitle}>
              {nodeTitle}
            </span>
            <Tag size='small' color='arcoblue' className='text-10px font-medium'>
              {nodeRole}
            </Tag>
          </div>

          <Tag
            size='small'
            style={{
              borderColor: theme.borderColor,
              color: theme.textColor,
              backgroundColor: theme.backgroundColor,
            }}
            className='text-10px font-medium px-5px py-0.5px rounded-full'
          >
            {theme.badgeText}
          </Tag>
        </div>
      }
      visible={visible}
      onCancel={onClose}
      width={480}
      footer={
        <div className='flex items-center gap-8px w-full'>
          <Input
            value={directiveInput}
            onChange={setDirectiveInput}
            onPressEnter={() => void handleDispatchDirective()}
            placeholder={`Dispatch directive to ${leaderName}...`}
            disabled={isExecuting}
            className='!rounded-8px text-12px'
          />
          <Button
            type='primary'
            loading={isExecuting}
            icon={<Send size={13} />}
            onClick={() => void handleDispatchDirective()}
            className='!rounded-8px !px-12px'
          >
            Send
          </Button>
        </div>
      }
    >
      <div className='flex flex-col gap-14px h-full overflow-y-auto pr-2px'>
        {/* Leader Summary Pill */}
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
                ? new Date(lastActiveAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : 'Dormant (7d+)'}
            </span>
          </div>
        </div>

        {/* Linked Projects Section */}
        {linkedProjects.length > 0 && (
          <div className='flex flex-col gap-6px'>
            <span className='text-10px font-semibold uppercase tracking-wider text-t-tertiary'>
              Operating Projects ({linkedProjects.length})
            </span>
            <div className='flex items-center gap-6px flex-wrap'>
              {linkedProjects.map((p) => (
                <div
                  key={p.id}
                  className='flex items-center gap-5px px-8px py-3px rounded-6px bg-fill-1 border border-[var(--color-border-2)] text-11px font-mono text-t-primary'
                >
                  <FolderClose size={12} theme='outline' className='text-amber-400' />
                  <span>{p.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <Tabs
          activeTab={activeTab}
          onChange={(key) => setActiveTab(key as any)}
          type='rounded'
          className='w-full'
        >
          <Tabs.TabPane
            key='conversations'
            title={
              <span className='flex items-center gap-5px text-12px'>
                <MessageOne size={13} theme='outline' />
                <span>Org Threads ({nodeConversations.length})</span>
              </span>
            }
          >
            <div className='flex flex-col gap-8px mt-8px'>
              {nodeConversations.length === 0 ? (
                <div className='py-24px text-center text-12px text-t-tertiary italic'>
                  No historical organization threads for this node yet.
                </div>
              ) : (
                nodeConversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => onOpenConversation?.(conv.id)}
                    className='p-10px rounded-8px bg-fill-1 hover:bg-fill-2 border border-[var(--color-border-2)] cursor-pointer transition-colors flex flex-col gap-4px'
                  >
                    <div className='flex items-center justify-between'>
                      <span className='text-12px font-semibold text-t-primary truncate'>
                        {conv.title}
                      </span>
                      <span className='text-10px font-mono text-t-tertiary shrink-0'>
                        {new Date(conv.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {conv.summary && (
                      <span className='text-11px text-t-secondary line-clamp-2'>
                        {conv.summary}
                      </span>
                    )}
                  </div>
                ))
              )}
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
                  className='p-8px rounded-8px bg-fill-1 border border-[var(--color-border-2)] flex items-center justify-between text-12px'
                >
                  <div className='flex items-center gap-8px min-w-0'>
                    <Robot size={14} theme='outline' className='text-primary shrink-0' />
                    <span className='font-medium text-t-primary truncate'>{spec.name}</span>
                  </div>
                  <span className='text-11px text-t-tertiary truncate max-w-160px font-mono'>
                    {spec.title}
                  </span>
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
