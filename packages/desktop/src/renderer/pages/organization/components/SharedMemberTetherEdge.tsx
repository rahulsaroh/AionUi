/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

export const SharedMemberTetherEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
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

  return (
    <g className='shared-tether-edge'>
      {/* Outer subtle glow */}
      <path
        d={edgePath}
        fill='none'
        stroke='rgba(148, 163, 184, 0.25)'
        strokeWidth={6}
        strokeLinecap='round'
      />
      {/* Dotted tether line */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: '#94A3B8',
          strokeWidth: 2,
          strokeDasharray: '6 4',
          animation: 'dash 1.5s linear infinite',
        }}
      />
    </g>
  );
};

export default React.memo(SharedMemberTetherEdge);
