/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { LoadingOne } from '@icon-park/react';
import { useOrgTelemetryStore } from '../store/useOrgTelemetryStore';
import { getDepartmentAccent } from '../utils/orgTheme';

export interface DelegationEdgeData {
  deptIndex?: number;
  deptColor?: string;
  isPathHighlighted?: boolean;
  isDimmed?: boolean;
  isWorkingPath?: boolean;
  exceedsAnimationLimit?: boolean;
}

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
  data,
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

  const edgeData = (data || {}) as DelegationEdgeData;
  const deptAccent = getDepartmentAccent(edgeData.deptIndex ?? 0, edgeData.deptColor);
  const baseColor = edgeData.deptColor || deptAccent.border;

  const isHighlighted = Boolean(edgeData.isPathHighlighted);
  const isDimmed = Boolean(edgeData.isDimmed) && !isHighlighted;
  const isWorking = Boolean(edgeData.isWorkingPath) || isInFlight;

  // Department-tinted color with soft glow
  let strokeColor = isCompleted ? '#10B981' : baseColor;
  let strokeWidth = isHighlighted || isWorking ? 3 : 2;
  let filterGlow =
    isHighlighted || isWorking ? `drop-shadow(0 0 8px ${baseColor})` : `drop-shadow(0 0 3px ${deptAccent.glow})`;

  if (isInFlight) {
    strokeColor = '#F59E0B';
    strokeWidth = 3;
    filterGlow = 'drop-shadow(0 0 8px rgba(245, 158, 11, 0.7))';
  }

  // Precedence: a working path is never dimmed below 0.85
  const edgeOpacity = isWorking ? 1 : isDimmed ? 0.25 : 0.85;

  const edgeStyle: React.CSSProperties = {
    ...style,
    stroke: strokeColor,
    strokeWidth,
    opacity: edgeOpacity,
    strokeDasharray: isWorking || isInFlight ? '8 6' : undefined,
    animation:
      (isWorking || isInFlight) && !edgeData.exceedsAnimationLimit
        ? 'travelingEdgeLight 1.2s linear infinite'
        : undefined,
    filter: filterGlow,
    pointerEvents: 'none',
    transition: 'stroke 0.3s ease, stroke-width 0.3s ease, opacity 0.3s ease, filter 0.3s ease',
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
