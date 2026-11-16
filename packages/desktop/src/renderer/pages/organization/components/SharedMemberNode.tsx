/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { OrgAgentMember } from '@/types/organization';
import AgentMemberPill from './AgentMemberPill';

export interface SharedMemberNodeData {
  member: OrgAgentMember;
  departmentsServed: string[];
  sharedCount: number;
  isDimmed?: boolean;
  onSelectMember?: (memberId: string) => void;
  onHoverMember?: (canonicalId: string | null) => void;
}

export const SharedMemberNode: React.FC<{ data: SharedMemberNodeData; selected?: boolean }> = ({
  data,
  selected = false,
}) => {
  return (
    <div className='relative'>
      {/* Top source handle for upward tethers to teams/projects */}
      <Handle
        type='source'
        position={Position.Top}
        className='!bg-indigo-400 !w-8px !h-8px !border-2 !border-slate-900 hover:!scale-125 transition-transform'
      />
      <AgentMemberPill
        member={data.member}
        departmentsServed={data.departmentsServed}
        sharedCount={data.sharedCount}
        variant='card'
        isHighlighted={selected}
        onHover={data.onHoverMember}
        onClick={() => data.onSelectMember?.(data.member.id)}
      />
      <Handle type='target' position={Position.Bottom} className='!opacity-0 !pointer-events-none' />
    </div>
  );
};

export function areSharedMemberPropsEqual(
  prev: { data: SharedMemberNodeData; selected?: boolean },
  next: { data: SharedMemberNodeData; selected?: boolean }
): boolean {
  if (prev.selected !== next.selected) return false;
  const p = prev.data;
  const n = next.data;
  if (p.isDimmed !== n.isDimmed) return false;
  if (p.member !== n.member) return false;
  if (p.member.name !== n.member.name) return false;
  if (p.member.icon !== n.member.icon) return false;
  if ((p.member as { avatar?: string }).avatar !== (n.member as { avatar?: string }).avatar) return false;
  if (p.member.status !== n.member.status) return false;
  if (p.member.role !== n.member.role) return false;
  if (p.sharedCount !== n.sharedCount) return false;
  if (p.departmentsServed.length !== n.departmentsServed.length) return false;
  if (p.departmentsServed.some((d, idx) => d !== n.departmentsServed[idx])) return false;
  return true;
}

export default React.memo(SharedMemberNode, areSharedMemberPropsEqual);
