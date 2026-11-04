/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Message, Spin, Empty } from '@arco-design/web-react';
import { useNavigate } from 'react-router-dom';
import { useSWRConfig } from 'swr';
import { useTeamList } from '@/renderer/pages/team/hooks/useTeamList';
import {
  normalizeTeamsHierarchy,
  wouldCreateCycle,
  getDescendantTeamIds,
} from '@/renderer/pages/team/utils/teamStorage';
import { ipcBridge } from '@/common';
import type { TTeam } from '@/common/types/team/teamTypes';
import DepartmentNode from './components/DepartmentNode';
import DelegationEdge from './components/DelegationEdge';
import OrgCanvasToolbar from './components/OrgCanvasToolbar';
import OrgInspectorDrawer from './components/OrgInspectorDrawer';
import QuickRunTaskModal from './components/QuickRunTaskModal';
import OrgSeedModal from './components/OrgSeedModal';
import TeamCreateModal from '@/renderer/pages/team/components/TeamCreateModal';
import { layoutOrgChart } from './utils/layoutOrgChart';

const nodeTypes: NodeTypes = {
  department: DepartmentNode,
};

const edgeTypes: EdgeTypes = {
  delegation: DelegationEdge,
};

const CanvasInner: React.FC = () => {
  const { teams: rawTeams = [] } = useTeamList();
  const { mutate } = useSWRConfig();
  const navigate = useNavigate();
  const { fitView } = useReactFlow();

  const [direction, setDirection] = useState<'TB' | 'LR'>('TB');
  const [collapsedBranchIds, setCollapsedBranchIds] = useState<Set<string>>(new Set());
  const [selectedTeam, setSelectedTeam] = useState<TTeam | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [runTaskTeam, setRunTaskTeam] = useState<TTeam | null>(null);
  const [isCreateSubTeamOpen, setIsCreateSubTeamOpen] = useState(false);
  const [parentForNewSubTeam, setParentForNewSubTeam] = useState<string | null>(null);
  const [isSeedModalOpen, setIsSeedModalOpen] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Normalize hierarchy
  const normalizedTeams = useMemo(() => {
    return normalizeTeamsHierarchy(rawTeams);
  }, [rawTeams]);

  // Compute hidden node IDs based on collapsed branches
  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set<string>();
    collapsedBranchIds.forEach((collapsedId) => {
      const descendants = getDescendantTeamIds(normalizedTeams, collapsedId);
      descendants.forEach((dId) => hidden.add(dId));
    });
    return hidden;
  }, [normalizedTeams, collapsedBranchIds]);

  const handleToggleCollapse = useCallback((teamId: string) => {
    setCollapsedBranchIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  }, []);

  const handleToggleExpandAll = useCallback(() => {
    if (collapsedBranchIds.size > 0) {
      setCollapsedBranchIds(new Set());
    } else {
      const allParentIds = normalizedTeams.filter((t) => (t.subTeamIds?.length || 0) > 0).map((t) => t.id);
      setCollapsedBranchIds(new Set(allParentIds));
    }
  }, [collapsedBranchIds.size, normalizedTeams]);

  const handleOpenChat = useCallback(
    (teamId: string) => {
      void navigate(`/team/${teamId}`);
    },
    [navigate]
  );

  const handleAddSubTeam = useCallback((teamId: string) => {
    setParentForNewSubTeam(teamId);
    setIsCreateSubTeamOpen(true);
  }, []);

  const handleSelectNode = useCallback((team: TTeam) => {
    setSelectedTeam(team);
    setIsInspectorOpen(true);
  }, []);

  // Build Graph Nodes and Edges
  useEffect(() => {
    if (normalizedTeams.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const teamMap = new Map<string, TTeam>(normalizedTeams.map((t) => [t.id, t]));

    // Calculate levels
    const levelMap = new Map<string, number>();
    function getLevel(team: TTeam): number {
      if (levelMap.has(team.id)) return levelMap.get(team.id)!;
      if (!team.parentId || !teamMap.has(team.parentId)) {
        levelMap.set(team.id, 0);
        return 0;
      }
      const parent = teamMap.get(team.parentId)!;
      const lvl = getLevel(parent) + 1;
      levelMap.set(team.id, lvl);
      return lvl;
    }
    normalizedTeams.forEach(getLevel);

    // Filter visible teams
    const visibleTeams = normalizedTeams.filter((t) => !hiddenNodeIds.has(t.id));

    // Construct raw nodes
    const rawNodes: Node[] = visibleTeams.map((t) => {
      const hasChildren = (t.subTeamIds?.length || 0) > 0;
      const lvl = levelMap.get(t.id) || 0;

      return {
        id: t.id,
        type: 'department',
        data: {
          team: t,
          level: lvl,
          isRoot: !t.parentId,
          hasChildren,
          isCollapsed: collapsedBranchIds.has(t.id),
          orientation: direction,
          onToggleCollapse: handleToggleCollapse,
          onAddSubTeam: handleAddSubTeam,
          onOpenChat: handleOpenChat,
          onRunTask: (team: TTeam) => setRunTaskTeam(team),
          onSelectNode: handleSelectNode,
        },
        position: { x: 0, y: 0 },
      };
    });

    // Construct raw edges
    const rawEdges: Edge[] = [];
    visibleTeams.forEach((t) => {
      if (t.parentId && !hiddenNodeIds.has(t.parentId) && teamMap.has(t.parentId)) {
        rawEdges.push({
          id: `${t.parentId}->${t.id}`,
          source: t.parentId,
          target: t.id,
          type: 'delegation',
        });
      }
    });

    // Run Dagre Layout
    const layouted = layoutOrgChart(rawNodes, rawEdges, direction);
    setNodes(layouted.nodes);
    setEdges(layouted.edges);

    setTimeout(() => {
      void fitView({ padding: 0.2, duration: 400 });
    }, 50);
  }, [
    normalizedTeams,
    hiddenNodeIds,
    collapsedBranchIds,
    direction,
    handleToggleCollapse,
    handleAddSubTeam,
    handleOpenChat,
    handleSelectNode,
    fitView,
    setNodes,
    setEdges,
  ]);

  // Drag-and-Drop Re-parenting Connection Handler
  const onConnect = useCallback(
    async (params: Connection) => {
      const sourceParentId = params.source;
      const targetChildId = params.target;

      if (!sourceParentId || !targetChildId || sourceParentId === targetChildId) {
        return;
      }

      // Check for cycles
      if (wouldCreateCycle(normalizedTeams, targetChildId, sourceParentId)) {
        Message.error('Cannot re-parent: this connection would create a circular dependency loop.');
        return;
      }

      try {
        await ipcBridge.team.updateTeam.invoke({
          id: targetChildId,
          parent_id: sourceParentId,
        });
        Message.success('Department re-parented successfully!');
        void mutate('teams:list');
      } catch (err) {
        Message.error(`Failed to re-parent department: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [normalizedTeams, mutate]
  );

  return (
    <div className='relative size-full overflow-hidden bg-[var(--color-bg-1)]'>
      {/* Top Floating Controls Toolbar */}
      <OrgCanvasToolbar
        direction={direction}
        onToggleDirection={() => setDirection((d) => (d === 'TB' ? 'LR' : 'TB'))}
        onFitView={() => void fitView({ padding: 0.2, duration: 400 })}
        onToggleExpandAll={handleToggleExpandAll}
        isAllExpanded={collapsedBranchIds.size === 0}
        onNewRootDepartment={() => {
          setParentForNewSubTeam(null);
          setIsCreateSubTeamOpen(true);
        }}
        onOpenSeedModal={() => setIsSeedModalOpen(true)}
      />

      {/* Main Flow Canvas */}
      {normalizedTeams.length === 0 ? (
        <div className='size-full flex flex-col items-center justify-center gap-16px'>
          <Empty description='No departments or teams created yet.' />
          <div className='flex gap-12px'>
            <button
              type='button'
              className='px-16px py-8px rounded-8px bg-primary text-white font-medium hover:bg-primary/90 transition-colors'
              onClick={() => {
                setParentForNewSubTeam(null);
                setIsCreateSubTeamOpen(true);
              }}
            >
              Create Root Department
            </button>
            <button
              type='button'
              className='px-16px py-8px rounded-8px bg-fill-2 border border-[var(--color-border-2)] text-t-primary font-medium hover:bg-fill-3 transition-colors'
              onClick={() => setIsSeedModalOpen(true)}
            >
              Import Enterprise Template
            </button>
          </div>
        </div>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={0.2}
          maxZoom={1.5}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color='var(--color-border-3, #cbd5e1)' gap={20} size={1} />
          <Controls className='!bg-[var(--color-bg-2)] !border-[var(--color-border-2)] !rounded-8px shadow-lg' />
          <MiniMap
            nodeStrokeWidth={3}
            nodeColor={(n) => {
              if (n.data?.isRoot) return '#f59e0b';
              if (n.data?.level === 1) return '#3b82f6';
              return '#64748b';
            }}
            className='!bg-[var(--color-bg-2)] !border-[var(--color-border-2)] !rounded-8px shadow-lg'
          />
        </ReactFlow>
      )}

      {/* Slide-Over Inspector Drawer */}
      <OrgInspectorDrawer
        team={selectedTeam}
        visible={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
        onRunTask={(team) => {
          setIsInspectorOpen(false);
          setRunTaskTeam(team);
        }}
      />

      {/* Quick Run Task Modal */}
      <QuickRunTaskModal team={runTaskTeam} visible={Boolean(runTaskTeam)} onClose={() => setRunTaskTeam(null)} />

      {/* Org Seed JSON Modal */}
      <OrgSeedModal visible={isSeedModalOpen} onClose={() => setIsSeedModalOpen(false)} />

      {/* Create Department / Sub-Team Modal */}
      {isCreateSubTeamOpen && (
        <TeamCreateModal
          visible={isCreateSubTeamOpen}
          defaultParentId={parentForNewSubTeam}
          onClose={() => setIsCreateSubTeamOpen(false)}
          onCreated={() => {
            setIsCreateSubTeamOpen(false);
            void mutate('teams:list');
          }}
        />
      )}
    </div>
  );
};

export const OrganizationCanvasView: React.FC = () => {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
};

export default OrganizationCanvasView;
