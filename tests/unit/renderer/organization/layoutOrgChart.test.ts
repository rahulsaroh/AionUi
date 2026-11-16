/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { layoutOrgChart } from '@/renderer/pages/organization/utils/layoutOrgChart';
import { generateSharedMemberTethers, type SharedMemberPoolItem } from '@/renderer/pages/organization/utils/orgTethers';
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

  it('positions project nodes underneath a department', () => {
    const rawNodes: Node[] = [
      { id: 'dept-1', type: 'department', data: { label: 'App Development' }, position: { x: 0, y: 0 } },
      { id: 'project-1', type: 'project', data: { label: 'General' }, position: { x: 0, y: 0 } },
      { id: 'project-2', type: 'project', data: { label: 'AI GYM MENTOR' }, position: { x: 0, y: 0 } },
    ];
    const rawEdges: Edge[] = [
      { id: 'dept->proj1', source: 'dept-1', target: 'project-1' },
      { id: 'dept->proj2', source: 'dept-1', target: 'project-2' },
    ];

    const result = layoutOrgChart(rawNodes, rawEdges, 'TB');

    expect(result.nodes.length).toBe(3);
    const deptNode = result.nodes.find((n) => n.id === 'dept-1')!;
    const proj1 = result.nodes.find((n) => n.id === 'project-1')!;
    const proj2 = result.nodes.find((n) => n.id === 'project-2')!;

    expect(deptNode.position.y).toBeLessThan(proj1.position.y);
    expect(deptNode.position.y).toBeLessThan(proj2.position.y);
    // Project boxes are placed side-by-side under the department
    expect(proj1.position.x).not.toBe(proj2.position.x);
  });

  it('positions 5 tiers properly: CEO -> Dept -> Project -> Team -> Shared Members bottom strip', () => {
    const rawNodes: Node[] = [
      { id: 'ceo', type: 'rootCeo', data: { label: 'CEO' }, position: { x: 0, y: 0 } },
      { id: 'dept-1', type: 'department', data: { label: 'Engineering' }, position: { x: 0, y: 0 } },
      { id: 'proj-1', type: 'project', data: { label: 'Core Platform' }, position: { x: 0, y: 0 } },
      { id: 'team-1', type: 'team', data: { label: 'Backend Team' }, position: { x: 0, y: 0 } },
      { id: 'shared-header', type: 'sharedMemberHeader', data: {}, position: { x: 0, y: 0 } },
      { id: 'shared-designer', type: 'sharedMember', data: { label: 'Designer' }, position: { x: 0, y: 0 } },
      { id: 'shared-qa', type: 'sharedMember', data: { label: 'QA Engineer' }, position: { x: 0, y: 0 } },
    ];

    const rawEdges: Edge[] = [
      { id: 'ceo->dept', source: 'ceo', target: 'dept-1', type: 'delegation' },
      { id: 'dept->proj', source: 'dept-1', target: 'proj-1', type: 'delegation' },
      { id: 'proj->team', source: 'proj-1', target: 'team-1', type: 'delegation' },
      { id: 'tether-1', source: 'shared-designer', target: 'team-1', type: 'tether' },
      { id: 'tether-2', source: 'shared-qa', target: 'team-1', type: 'tether' },
    ];

    const result = layoutOrgChart(rawNodes, rawEdges, 'TB');

    expect(result.nodes.length).toBe(7);

    const ceoNode = result.nodes.find((n) => n.id === 'ceo')!;
    const deptNode = result.nodes.find((n) => n.id === 'dept-1')!;
    const projNode = result.nodes.find((n) => n.id === 'proj-1')!;
    const teamNode = result.nodes.find((n) => n.id === 'team-1')!;
    const headerNode = result.nodes.find((n) => n.id === 'shared-header')!;
    const designerNode = result.nodes.find((n) => n.id === 'shared-designer')!;
    const qaNode = result.nodes.find((n) => n.id === 'shared-qa')!;

    // Verify 5-tier vertical hierarchy: CEO < Dept < Project < Team < Header < Shared Members
    expect(ceoNode.position.y).toBeLessThan(deptNode.position.y);
    expect(deptNode.position.y).toBeLessThan(projNode.position.y);
    expect(projNode.position.y).toBeLessThan(teamNode.position.y);
    expect(teamNode.position.y).toBeLessThan(headerNode.position.y);
    expect(headerNode.position.y).toBeLessThan(designerNode.position.y);

    // Shared members are placed side-by-side in the bottom strip
    expect(designerNode.position.y).toBe(qaNode.position.y);
    expect(designerNode.position.x).not.toBe(qaNode.position.x);
  });

  it('generates consistent colored tether edges for shared members across teams', () => {
    const sharedPool: SharedMemberPoolItem[] = [
      {
        canonicalId: 'canonical-designer',
        member: { id: 'm-1', name: 'Designer' },
        count: 3,
        departments: ['Engineering', 'Marketing'],
        teamIds: ['team-alpha', 'team-beta', 'team-gamma'],
      },
      {
        canonicalId: 'canonical-architect',
        member: { id: 'm-2', name: 'Architect' },
        count: 2,
        departments: ['Engineering', 'Infrastructure'],
        teamIds: ['team-alpha', 'team-delta'],
      },
    ];

    const existingNodeIds = new Set(['team-alpha', 'team-beta', 'team-gamma', 'team-delta']);

    const tethers = generateSharedMemberTethers(sharedPool, existingNodeIds);

    // 3 teams for designer + 2 teams for architect = 5 tethers total
    expect(tethers.length).toBe(5);

    // Designer tethers
    const designerTethers = tethers.filter((e) => (e.data as any)?.canonicalId === 'canonical-designer');
    expect(designerTethers.length).toBe(3);
    const designerColor = (designerTethers[0].data as any)?.memberColor;
    expect(designerColor).toBeDefined();

    // All tethers for this member must share the exact same color
    designerTethers.forEach((edge) => {
      expect((edge.data as any)?.memberColor).toBe(designerColor);
      expect(edge.source).toBe('shared-canonical-designer');
      expect(edge.targetHandle).toBe('bottom-target');
      expect(edge.zIndex).toBe(-1);
    });

    // Targets must match the teams
    const targetTeams = designerTethers.map((e) => e.target);
    expect(targetTeams).toEqual(['team-alpha', 'team-beta', 'team-gamma']);

    // Architect tethers
    const architectTethers = tethers.filter((e) => (e.data as any)?.canonicalId === 'canonical-architect');
    expect(architectTethers.length).toBe(2);
    const architectColor = (architectTethers[0].data as any)?.memberColor;
    architectTethers.forEach((edge) => {
      expect((edge.data as any)?.memberColor).toBe(architectColor);
      expect(edge.source).toBe('shared-canonical-architect');
    });
  });
});
