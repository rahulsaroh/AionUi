/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Drawer, Button, Tag, Tabs, Typography, Spin, Tooltip, Message } from '@arco-design/web-react';
import { FolderClose, Peoples, Play, AlarmClock, MessageOne, Copy, Workbench, Robot, Right } from '@icon-park/react';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import type { TTeam, TeamAssistant } from '@/common/types/team/teamTypes';
import { useOrgTelemetryStore } from '../store/useOrgTelemetryStore';

type OrgInspectorDrawerProps = {
  team: TTeam | null;
  visible: boolean;
  onClose: () => void;
  onRunTask: (team: TTeam) => void;
};

export const OrgInspectorDrawer: React.FC<OrgInspectorDrawerProps> = ({ team, visible, onClose, onRunTask }) => {
  const navigate = useNavigate();
  const { getNodeStatus, getActivity } = useOrgTelemetryStore();
  const status = team ? getNodeStatus(team.id) : 'idle';
  const activity = team ? getActivity(team.id) : undefined;

  if (!team) return null;

  const handleCopyPath = () => {
    if (team.workspace) {
      navigator.clipboard.writeText(team.workspace);
      Message.success('Workspace folder path copied to clipboard');
    }
  };

  const handleOpenFolder = () => {
    if (team.workspace) {
      ipcBridge.shell.showItemInFolder.invoke(team.workspace).catch((err: unknown) => {
        Message.error(`Could not open folder: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  };

  const leader = team.assistants?.find((a) => a.role === 'leader') || team.assistants?.[0];
  const specialists = (team.assistants || []).filter((a) => a.slot_id !== leader?.slot_id);

  return (
    <Drawer
      title={
        <div className='flex items-center justify-between w-full pr-12px'>
          <div className='flex items-center gap-8px min-w-0'>
            <span className='size-24px rounded-6px bg-primary/10 text-primary flex items-center justify-center shrink-0'>
              <Peoples size={14} theme='outline' fill='currentColor' />
            </span>
            <span className='font-semibold text-15px truncate'>{team.name}</span>
            <Tag size='small' color='arcoblue'>
              {team.departmentRole || 'Department'}
            </Tag>
          </div>
          <Tag
            color={
              status === 'thinking'
                ? 'cyan'
                : status === 'delegating'
                  ? 'gold'
                  : status === 'completed'
                    ? 'green'
                    : status === 'error'
                      ? 'red'
                      : 'gray'
            }
          >
            {status.toUpperCase()}
          </Tag>
        </div>
      }
      visible={visible}
      onCancel={onClose}
      width={460}
      footer={
        <div className='flex items-center justify-between gap-12px w-full'>
          <Button type='outline' icon={<Play theme='outline' size={14} />} onClick={() => onRunTask(team)}>
            Dispatch Task
          </Button>
          <Button
            type='primary'
            icon={<MessageOne theme='outline' size={14} />}
            onClick={() => {
              onClose();
              void navigate(`/team/${team.id}`);
            }}
          >
            Open Full Team Workspace
          </Button>
        </div>
      }
    >
      <div className='flex flex-col gap-16px h-full overflow-y-auto pr-4px'>
        {/* Department Overview Card */}
        <div className='p-12px rounded-8px bg-fill-2 border border-[var(--color-border-2)] flex flex-col gap-8px'>
          <div className='text-12px text-t-secondary leading-relaxed'>
            {team.description || 'Autonomous multi-agent corporate department.'}
          </div>

          {/* Workspace Path */}
          <div className='flex items-center justify-between gap-8px text-11px font-mono bg-fill-3 px-8px py-4px rounded-6px'>
            <span className='truncate text-t-secondary' title={team.workspace}>
              {team.workspace || 'Default isolated workspace'}
            </span>
            <div className='flex items-center gap-4px shrink-0'>
              <Tooltip content='Copy Path'>
                <Button size='mini' type='text' icon={<Copy size={12} />} onClick={handleCopyPath} />
              </Tooltip>
              <Tooltip content='Open in Explorer'>
                <Button size='mini' type='text' icon={<FolderClose size={12} />} onClick={handleOpenFolder} />
              </Tooltip>
            </div>
          </div>

          {/* Live Activity Ticker */}
          {activity && (
            <div className='text-11px font-mono text-cyan-400 bg-black/40 px-8px py-6px rounded-6px flex items-center gap-6px'>
              <span className='font-bold'>&gt;</span>
              <span className='truncate flex-1'>{activity.message}</span>
            </div>
          )}
        </div>

        {/* Tabs: Stream Logs, Specialists Roster, Pipeline Inbox */}
        <Tabs defaultActiveTab='roster' type='rounded' size='small'>
          {/* Specialists Roster */}
          <Tabs.TabPane key='roster' title={`Specialists (${team.assistants?.length || 0})`}>
            <div className='flex flex-col gap-10px pt-8px'>
              {leader && (
                <div className='p-10px rounded-8px bg-blue-500/10 border border-blue-500/20 flex flex-col gap-4px'>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-6px font-semibold text-13px text-blue-300'>
                      <Workbench size={14} />
                      <span>{leader.assistant_name}</span>
                    </div>
                    <Tag size='small' color='blue'>
                      Leader (Aion CLI)
                    </Tag>
                  </div>
                  <div className='text-11px text-t-secondary'>
                    Coordinates specialists and delegates cross-department directives.
                  </div>
                </div>
              )}

              {specialists.map((spec: TeamAssistant) => (
                <div
                  key={spec.slot_id}
                  className='p-10px rounded-8px bg-fill-2 border border-[var(--color-border-2)] flex flex-col gap-6px'
                >
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-6px font-medium text-13px'>
                      <Robot size={14} className='text-t-secondary' />
                      <span>{spec.assistant_name}</span>
                    </div>
                    <span className='text-10px font-mono text-t-tertiary'>{spec.assistant_backend}</span>
                  </div>
                  <div className='text-11px text-t-secondary'>
                    {spec.whenToUseHint || 'Domain specialist for department tasks.'}
                  </div>
                </div>
              ))}
            </div>
          </Tabs.TabPane>

          {/* Live Recent Chat Logs */}
          <Tabs.TabPane key='logs' title='Live Stream Logs'>
            <div className='flex flex-col gap-8px pt-8px'>
              {activity ? (
                <div className='p-10px rounded-6px bg-fill-2 border border-[var(--color-border-2)] text-12px flex flex-col gap-4px'>
                  <div className='flex justify-between text-10px font-semibold text-t-tertiary'>
                    <span className='uppercase text-cyan-400'>STATUS UPDATE</span>
                    <span>{new Date(activity.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className='whitespace-pre-wrap font-mono text-11px text-t-primary'>&gt; {activity.message}</div>
                </div>
              ) : (
                <div className='text-center py-24px text-12px text-t-tertiary italic'>
                  No recent execution events recorded for this department. Dispatched directives will stream live here.
                </div>
              )}
            </div>
          </Tabs.TabPane>

          {/* Cron & Pipeline Inbox */}
          <Tabs.TabPane key='pipeline' title='Pipeline & Schedules'>
            <div className='flex flex-col gap-10px pt-8px'>
              <div className='p-10px rounded-8px bg-fill-2 border border-[var(--color-border-2)] flex items-center justify-between'>
                <div className='flex items-center gap-6px text-12px'>
                  <AlarmClock size={14} className='text-primary' />
                  <span>Autonomous Cron Schedule:</span>
                </div>
                <span className='text-11px font-mono text-t-secondary'>
                  {team.created_at ? 'Event-Driven (Adaptive)' : 'None'}
                </span>
              </div>
              <div className='text-11px text-t-tertiary'>
                Tasks dispatched through parent delegation bridges write directives to the `.pipeline/inbox/` directory
                of this department's workspace.
              </div>
            </div>
          </Tabs.TabPane>
        </Tabs>
      </div>
    </Drawer>
  );
};

export default React.memo(OrgInspectorDrawer);
