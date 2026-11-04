/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { layoutOrgChart } from '@/renderer/pages/organization/utils/layoutOrgChart';
import type { Node, Edge } from '@xyflow/react';

describe('layoutOrgChart', () => {
  it('positions nodes in a hierarchical Top-to-Bottom tree', () => {
    const rawNodes: Node[] = [
      { id: 'hq', data: { label: 'HQ' }, position: { x: 0, y: 0 } },
      { id: 'eng', data: { label: 'Engineering' }, position: { x: 0, y: 0 } },
      { id: 'product', data: { label: 'Product' }, position: { x: 0, y: 0 } },
    ];
    const rawEdges: Edge[] = [
      { id: 'hq->eng', source: 'hq', target: 'eng' },
      { id: 'hq->product', source: 'hq', target: 'product' },
    ];

    const result = layoutOrgChart(rawNodes, rawEdges, 'TB');

    expect(result.nodes.length).toBe(3);
    expect(result.edges.length).toBe(2);

    const hqNode = result.nodes.find((n) => n.id === 'hq')!;
    const engNode = result.nodes.find((n) => n.id === 'eng')!;
    const prodNode = result.nodes.find((n) => n.id === 'product')!;

    // In TB mode, HQ (parent) should be placed above children (smaller Y)
    expect(hqNode.position.y).toBeLessThan(engNode.position.y);
    expect(hqNode.position.y).toBeLessThan(prodNode.position.y);
  });

  it('positions nodes in a Left-to-Right tree', () => {
    const rawNodes: Node[] = [
      { id: 'hq', data: { label: 'HQ' }, position: { x: 0, y: 0 } },
      { id: 'eng', data: { label: 'Engineering' }, position: { x: 0, y: 0 } },
    ];
    const rawEdges: Edge[] = [{ id: 'hq->eng', source: 'hq', target: 'eng' }];

    const result = layoutOrgChart(rawNodes, rawEdges, 'LR');

    expect(result.nodes.length).toBe(2);
    const hqNode = result.nodes.find((n) => n.id === 'hq')!;
    const engNode = result.nodes.find((n) => n.id === 'eng')!;

    // In LR mode, HQ (parent) should be placed to the left of child (smaller X)
    expect(hqNode.position.x).toBeLessThan(engNode.position.x);
  });
});
