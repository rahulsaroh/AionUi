/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { Tag } from '@arco-design/web-react';
import { LoadingOne } from '@icon-park/react';
import { useOrgTelemetryStore } from '../store/useOrgTelemetryStore';

export const DelegationEdge: React.FC<EdgeProps> = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
}) => {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16,
  });

  const { getActiveHandoff } = useOrgTelemetryStore();
  const handoff = getActiveHandoff(source, target);

  const isInFlight = handoff?.status === 'in_flight';
  const isCompleted = handoff?.status === 'completed';

  const edgeStyle: React.CSSProperties = {
    ...style,
    strokeWidth: isInFlight ? 3 : 2,
    stroke: isInFlight ? '#f59e0b' : isCompleted ? '#10b981' : 'var(--color-border-3, #94a3b8)',
    strokeDasharray: isInFlight ? '8 6' : undefined,
    animation: isInFlight ? 'delegationPulse 1s linear infinite' : undefined,
    filter: isInFlight ? 'drop-shadow(0 0 6px rgba(245, 158, 11, 0.6))' : undefined,
    transition: 'stroke 0.3s ease, stroke-width 0.3s ease',
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={edgeStyle} markerEnd={markerEnd} />
      {isInFlight && handoff && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className='nodrag nopan z-20'
          >
            <div className='flex items-center gap-6px px-8px py-3px rounded-full bg-amber-500/90 text-white shadow-lg text-11px font-mono backdrop-blur-sm border border-solid border-amber-300 animate-bounce'>
              <LoadingOne theme='outline' size={12} className='animate-spin' />
              <span className='font-semibold'>Delegating:</span>
              <span className='max-w-160px truncate' title={handoff.taskDirective}>
                {handoff.taskDirective}
              </span>
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export default React.memo(DelegationEdge);
