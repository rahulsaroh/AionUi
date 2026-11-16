/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import dagre from 'dagre';
import { type Node, type Edge, Position } from '@xyflow/react';

const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  rootCeo: { width: 360, height: 210 },
  department: { width: 320, height: 170 },
  project: { width: 280, height: 120 },
  team: { width: 280, height: 130 },
  sharedMember: { width: 220, height: 80 },
  sharedMemberHeader: { width: 560, height: 36 },
};

export function layoutOrgChart(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB'
): { nodes: Node[]; edges: Edge[] } {
  // Separate core hierarchy nodes (tiers 1-4) from shared-member bottom strip (tier 5)
  const coreNodes: Node[] = [];
  const sharedMemberNodes: Node[] = [];
  const headerNodes: Node[] = [];

  nodes.forEach((node) => {
    if (node.type === 'sharedMember') {
      sharedMemberNodes.push(node);
    } else if (node.type === 'sharedMemberHeader') {
      headerNodes.push(node);
    } else {
      coreNodes.push(node);
    }
  });

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: direction === 'TB' ? 60 : 70,
    ranksep: direction === 'TB' ? 90 : 80,
    align: 'DL',
  });

  const widthMap: Record<string, number> = {};
  const heightMap: Record<string, number> = {};

  coreNodes.forEach((node) => {
    const dim = NODE_DIMENSIONS[node.type || 'team'] || { width: 280, height: 140 };
    widthMap[node.id] = dim.width;
    heightMap[node.id] = dim.height;
    dagreGraph.setNode(node.id, { width: dim.width, height: dim.height });
  });

  // Only layout structural edges (ignore tether lines)
  edges.forEach((edge) => {
    if (edge.type !== 'tether') {
      const sourceNode = coreNodes.find((n) => n.id === edge.source);
      const targetNode = coreNodes.find((n) => n.id === edge.target);

      // If a department connects directly to a team without an intermediate project, ensure minlen = 2 so team stays in tier 4
      if (sourceNode?.type === 'department' && targetNode?.type === 'team') {
        dagreGraph.setEdge(edge.source, edge.target, { minlen: 2 });
      } else {
        dagreGraph.setEdge(edge.source, edge.target, { minlen: 1 });
      }
    }
  });

  dagre.layout(dagreGraph);

  const layoutedCoreNodes: Node[] = coreNodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id) || { x: 0, y: 0, width: 280, height: 140 };
    const width = nodeWithPosition.width || widthMap[node.id] || 280;
    const height = nodeWithPosition.height || heightMap[node.id] || 140;

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

  // Tier 5: Place the bottom strip manually below the lowest team rank
  const finalNodes: Node[] = [...layoutedCoreNodes];

  if (layoutedCoreNodes.length > 0 && (sharedMemberNodes.length > 0 || headerNodes.length > 0)) {
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    layoutedCoreNodes.forEach((node) => {
      const w = widthMap[node.id] || 280;
      const h = heightMap[node.id] || 140;
      if (node.position.x < minX) minX = node.position.x;
      if (node.position.x + w > maxX) maxX = node.position.x + w;
      if (node.position.y + h > maxY) maxY = node.position.y + h;
    });

    const centerX = (minX + maxX) / 2;
    const headerWidth = NODE_DIMENSIONS.sharedMemberHeader.width;
    const headerY = maxY + 80;

    // Header node position
    headerNodes.forEach((hNode) => {
      finalNodes.push({
        ...hNode,
        position: {
          x: centerX - headerWidth / 2,
          y: headerY,
        },
      });
    });

    // Shared member nodes row
    if (sharedMemberNodes.length > 0) {
      const cardWidth = NODE_DIMENSIONS.sharedMember.width;
      const cardGap = 20;
      const totalWidth = sharedMemberNodes.length * cardWidth + (sharedMemberNodes.length - 1) * cardGap;
      const startX = centerX - totalWidth / 2;
      const cardsY = headerNodes.length > 0 ? headerY + 54 : maxY + 90;

      sharedMemberNodes.forEach((sNode, idx) => {
        finalNodes.push({
          ...sNode,
          sourcePosition: Position.Top,
          targetPosition: Position.Bottom,
          position: {
            x: startX + idx * (cardWidth + cardGap),
            y: cardsY,
          },
        });
      });
    }
  } else {
    // If no core nodes or empty hierarchy, append any remaining
    finalNodes.push(...headerNodes, ...sharedMemberNodes);
  }

  return { nodes: finalNodes, edges };
}
