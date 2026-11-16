/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { getMemberAccentColor } from '../utils/orgTheme';

export interface SharedMemberTetherEdgeData {
  canonicalId?: string;
  memberColor?: string;
  isHighlighted?: boolean;
  isDimmed?: boolean;
  isWorking?: boolean;
}

export const SharedMemberTetherEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style = {},
}) => {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.35,
  });

  const edgeData = (data || {}) as SharedMemberTetherEdgeData;
  const canonicalId = edgeData.canonicalId || id;
  const memberColor = edgeData.memberColor || getMemberAccentColor(canonicalId);

  const isHighlighted = Boolean(edgeData.isHighlighted);
  const isDimmed = Boolean(edgeData.isDimmed) && !isHighlighted;
  const isWorking = Boolean(edgeData.isWorking);

  const opacity = isHighlighted ? 1 : isDimmed ? 0.06 : 0.22;
  const strokeWidth = isHighlighted || isWorking ? 2.5 : 1.5;

  return (
    <g className='shared-tether-edge' style={{ pointerEvents: 'none' }}>
      {/* Outer subtle glow line (visible when highlighted or working) */}
      {(isHighlighted || isWorking) && (
        <path
          d={edgePath}
          fill='none'
          stroke={memberColor}
          strokeWidth={6}
          strokeLinecap='round'
          opacity={0.3}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Dashed tether line */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: memberColor,
          strokeWidth,
          strokeDasharray: '6 4',
          opacity,
          animation: isHighlighted || isWorking ? 'tetherDash 1.2s linear infinite' : undefined,
          filter: isHighlighted ? `drop-shadow(0 0 6px ${memberColor})` : undefined,
          transition: 'opacity 0.3s ease, stroke-width 0.3s ease',
          pointerEvents: 'none',
        }}
      />
    </g>
  );
};

export default React.memo(SharedMemberTetherEdge);
