/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Edge } from '@xyflow/react';
import { getMemberAccentColor } from './orgTheme';

export interface SharedMemberPoolItem {
  canonicalId: string;
  member: any;
  count: number;
  departments: string[];
  teamIds: string[];
}

export function generateSharedMemberTethers(
  sharedPoolMembers: SharedMemberPoolItem[],
  existingNodeIds: Set<string>
): Edge[] {
  const tethers: Edge[] = [];

  sharedPoolMembers.forEach((sharedItem) => {
    const memberColor = getMemberAccentColor(sharedItem.canonicalId);

    sharedItem.teamIds.forEach((targetTeamId) => {
      if (existingNodeIds.has(targetTeamId)) {
        tethers.push({
          id: `tether-${sharedItem.canonicalId}->${targetTeamId}`,
          source: `shared-${sharedItem.canonicalId}`,
          target: targetTeamId,
          targetHandle: 'bottom-target',
          type: 'tether',
          zIndex: -1,
          data: {
            canonicalId: sharedItem.canonicalId,
            memberColor,
          },
        });
      }
    });
  });

  return tethers;
}
