/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Avatar, Tooltip } from '@arco-design/web-react';
import { Robot } from '@icon-park/react';
import type { TeamAssistant } from '@/common/types/team/teamTypes';

type AgentMemberPillProps = {
  assistant: TeamAssistant;
  isActive?: boolean;
};

export const AgentMemberPill: React.FC<AgentMemberPillProps> = ({ assistant, isActive = false }) => {
  const isLeader = assistant.role === 'leader';
  const name = assistant.assistant_name || 'Specialist';
  const roleHint = isLeader ? 'Leader (Aion CLI)' : assistant.whenToUseHint || 'Specialist';

  return (
    <Tooltip content={`${name} - ${roleHint}`} position='top'>
      <div
        className={`group relative flex items-center gap-6px px-8px py-3px rounded-full text-11px transition-all select-none border border-solid ${
          isActive
            ? 'bg-cyan-500/15 border-cyan-400 text-cyan-200 animate-pulse'
            : isLeader
              ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
              : 'bg-fill-2 border-[var(--color-border-2)] text-t-secondary hover:text-t-primary hover:bg-fill-3'
        }`}
      >
        <Avatar size={16} shape='circle' className={isLeader ? 'bg-blue-600' : 'bg-gray-600'}>
          {assistant.icon ? (
            <img src={assistant.icon} alt={name} className='size-full object-cover' />
          ) : (
            <Robot size={10} theme='outline' fill='currentColor' />
          )}
        </Avatar>
        <span className='max-w-70px truncate font-medium'>{name}</span>
        {isActive && (
          <span className='size-6px rounded-full bg-cyan-400 animate-ping absolute -top-1 -right-1' />
        )}
      </div>
    </Tooltip>
  );
};

export default React.memo(AgentMemberPill);
