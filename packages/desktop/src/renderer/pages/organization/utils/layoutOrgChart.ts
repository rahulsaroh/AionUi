/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import dagre from 'dagre';
import { type Node, type Edge, Position } from '@xyflow/react';

export function layoutOrgChart(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB'
): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: direction === 'TB' ? 70 : 80,
    ranksep: direction === 'TB' ? 100 : 90,
    align: 'DL',
  });

  nodes.forEach((node) => {
    let width = 320;
    let height = 200;
    if (node.type === 'rootCeo') {
      width = 360;
      height = 240;
    } else if (node.type === 'department') {
      width = 330;
      height = 210;
    } else if (node.type === 'team') {
      width = 290;
      height = 190;
    }
    dagreGraph.setNode(node.id, { width, height });
  });

  // Only layout structural edges (ignore tether lines)
  edges.forEach((edge) => {
    if (edge.type !== 'tether') {
      dagreGraph.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(dagreGraph);

  const layoutedNodes: Node[] = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id) || { x: 0, y: 0, width: 320, height: 200 };
    const width = nodeWithPosition.width || 320;
    const height = nodeWithPosition.height || 200;

    return {
      ...node,
      targetPosition: direction === 'LR' ? Position.Left : Position.Top,
      sourcePosition: direction === 'LR' ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
