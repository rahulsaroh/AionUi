/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { OrgAgentMember } from '@/types/organization';
import AgentMemberPill from './AgentMemberPill';

export interface SharedMemberNodeData {
  member: OrgAgentMember;
  departmentsServed: string[];
  sharedCount: number;
  onSelectMember?: (memberId: string) => void;
  onHoverMember?: (canonicalId: string | null) => void;
}

export const SharedMemberNode: React.FC<{ data: SharedMemberNodeData; selected?: boolean }> = ({
  data,
  selected = false,
}) => {
  return (
    <AgentMemberPill
      member={data.member}
      departmentsServed={data.departmentsServed}
      sharedCount={data.sharedCount}
      variant='card'
      isHighlighted={selected}
      onHover={data.onHoverMember}
      onClick={() => data.onSelectMember?.(data.member.id)}
    />
  );
};

export default React.memo(SharedMemberNode);
