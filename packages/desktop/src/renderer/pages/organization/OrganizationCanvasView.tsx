/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Empty, Modal, Input, Message } from '@arco-design/web-react';
import { useNavigate } from 'react-router-dom';
import RootCeoNode from './components/RootCeoNode';
import DepartmentNode from './components/DepartmentNode';
import TeamNode from './components/TeamNode';
import DelegationEdge from './components/DelegationEdge';
import SharedMemberTetherEdge from './components/SharedMemberTetherEdge';
import OrgCanvasToolbar from './components/OrgCanvasToolbar';
import OrgInspectorDrawer from './components/OrgInspectorDrawer';
import OrgSeedModal from './components/OrgSeedModal';
import { layoutOrgChart } from './utils/layoutOrgChart';
import { useOrgStore } from './store/useOrgStore';
import type { RootCEO, OrgDepartmentNode, OrgTeamNode } from '@/types/organization';

const nodeTypes: NodeTypes = {
  rootCeo: RootCeoNode,
  department: DepartmentNode,
  team: TeamNode,
};

const edgeTypes: EdgeTypes = {
  delegation: DelegationEdge,
  tether: SharedMemberTetherEdge,
};

const CanvasInner: React.FC = () => {
  const {
    hierarchy,
    hoveredCanonicalAgentId,
    selectedCanonicalAgentId,
    addDepartment,
    addSubTeam,
  } = useOrgStore();

  const navigate = useNavigate();
  const { fitView } = useReactFlow();

  const [direction, setDirection] = useState<'TB' | 'LR'>('TB');
  const [collapsedBranchIds, setCollapsedBranchIds] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeType, setSelectedNodeType] = useState<'ceo' | 'department' | 'team' | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isSeedModalOpen, setIsSeedModalOpen] = useState(false);

  // Quick Dispatch Modal for CEO
  const [dispatchCeoModalVisible, setDispatchCeoModalVisible] = useState(false);
  const [dispatchCeoPrompt, setDispatchCeoPrompt] = useState('');

  // Create Department Modal
  const [createDeptModalVisible, setCreateDeptModalVisible] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Calculate shared member counts across the entire organization
  const { sharedCountsMap, agentLocationMap } = useMemo(() => {
    const counts: Record<string, number> = {};
    const locations: Record<string, string[]> = {}; // canonicalId -> nodeIds

    hierarchy.departments.forEach((dept) => {
      dept.teams.forEach((team) => {
        team.specialistMembers.forEach((spec) => {
          counts[spec.canonicalAgentId] = (counts[spec.canonicalAgentId] || 0) + 1;
          if (!locations[spec.canonicalAgentId]) {
            locations[spec.canonicalAgentId] = [];
          }
          if (!locations[spec.canonicalAgentId].includes(team.id)) {
            locations[spec.canonicalAgentId].push(team.id);
          }
        });
      });
    });

    return { sharedCountsMap: counts, agentLocationMap: locations };
  }, [hierarchy]);

  // Branch collapse toggle
  const handleToggleCollapse = useCallback((deptId: string) => {
    setCollapsedBranchIds((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  }, []);

  const handleToggleExpandAll = useCallback(() => {
    if (collapsedBranchIds.size > 0) {
      setCollapsedBranchIds(new Set());
    } else {
      const allDeptIds = hierarchy.departments.map((d) => d.id);
      setCollapsedBranchIds(new Set(allDeptIds));
    }
  }, [collapsedBranchIds.size, hierarchy.departments]);

  const handleSelectNode = useCallback((nodeId: string, nodeType: 'ceo' | 'department' | 'team') => {
    setSelectedNodeId(nodeId);
    setSelectedNodeType(nodeType);
    setIsInspectorOpen(true);
  }, []);

  const handleDispatchToCeo = useCallback((_rootCeo: RootCEO) => {
    setSelectedNodeId('root-ceo');
    setSelectedNodeType('ceo');
    setDispatchCeoModalVisible(true);
  }, []);

  // Build Graph Nodes and Edges
  useEffect(() => {
    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];

    // 1. Root CEO Node
    rawNodes.push({
      id: hierarchy.rootCeo.id,
      type: 'rootCeo',
      data: {
        rootCeo: hierarchy.rootCeo,
        orientation: direction,
        onDispatchToCeo: handleDispatchToCeo,
        onSelectNode: (id: string, type: 'ceo') => handleSelectNode(id, type),
      },
      position: { x: 0, y: 0 },
    });

    // 2. Department Nodes & Team Nodes
    hierarchy.departments.forEach((dept) => {
      const isDeptCollapsed = collapsedBranchIds.has(dept.id);

      rawNodes.push({
        id: dept.id,
        type: 'department',
        data: {
          department: dept,
          isCollapsed: isDeptCollapsed,
          orientation: direction,
          onToggleCollapse: handleToggleCollapse,
          onAddSubTeam: (deptId: string) => {
            const teamId = `team-${Date.now()}`;
            addSubTeam(deptId, {
              id: teamId,
              departmentId: deptId,
              name: `New Team ${dept.teams.length + 1}`,
              lastActiveAt: Date.now(),
              status: 'idle',
              teamLeadAgent: {
                id: `lead-${teamId}`,
                canonicalAgentId: `canonical-lead-${teamId}`,
                name: 'Team Lead',
                role: 'team_lead',
                assignedTeamIds: [teamId],
                lastActiveAt: Date.now(),
                status: 'idle',
              },
              hrCoordinatorAgent: {
                id: `hr-${teamId}`,
                canonicalAgentId: `canonical-hr-${teamId}`,
                name: 'HR Coordinator',
                role: 'hr_coordinator',
                assignedTeamIds: [teamId],
                lastActiveAt: Date.now(),
                status: 'idle',
              },
              specialistMembers: [],
            });
            Message.success('Sub-team added to department!');
          },
          onRunTask: (d: OrgDepartmentNode) => {
            handleSelectNode(d.id, 'department');
          },
          onSelectNode: (id: string, type: 'department') => handleSelectNode(id, type),
        },
        position: { x: 0, y: 0 },
      });

      // Edge from Root CEO to Department
      rawEdges.push({
        id: `edge-${hierarchy.rootCeo.id}->${dept.id}`,
        source: hierarchy.rootCeo.id,
        target: dept.id,
        type: 'delegation',
      });

      // Child Teams (if not collapsed)
      if (!isDeptCollapsed) {
        dept.teams.forEach((team) => {
          rawNodes.push({
            id: team.id,
            type: 'team',
            data: {
              team,
              departmentName: dept.name,
              orientation: direction,
              sharedCountsMap,
              onSelectNode: (id: string, type: 'team') => handleSelectNode(id, type),
            },
            position: { x: 0, y: 0 },
          });

          // Edge from Department to Team
          rawEdges.push({
            id: `edge-${dept.id}->${team.id}`,
            source: dept.id,
            target: team.id,
            type: 'delegation',
          });
        });
      }
    });

    // 3. Tether Lines for Shared Members across Departments/Teams
    const activeSharedAgentId = hoveredCanonicalAgentId || selectedCanonicalAgentId;
    if (activeSharedAgentId && agentLocationMap[activeSharedAgentId]) {
      const targetNodeIds = agentLocationMap[activeSharedAgentId].filter((id) =>
        rawNodes.some((n) => n.id === id)
      );

      // Connect each pair of nodes sharing this agent with smooth curved dotted tether line
      for (let i = 0; i < targetNodeIds.length - 1; i++) {
        for (let j = i + 1; j < targetNodeIds.length; j++) {
          rawEdges.push({
            id: `tether-${activeSharedAgentId}-${targetNodeIds[i]}<->${targetNodeIds[j]}`,
            source: targetNodeIds[i],
            target: targetNodeIds[j],
            type: 'tether',
            animated: true,
          });
        }
      }
    }

    // Run Dagre Layout
    const layouted = layoutOrgChart(rawNodes, rawEdges, direction);
    setNodes(layouted.nodes);
    setEdges(layouted.edges);

    setTimeout(() => {
      void fitView({ padding: 0.25, duration: 400 });
    }, 50);
  }, [
    hierarchy,
    collapsedBranchIds,
    direction,
    hoveredCanonicalAgentId,
    selectedCanonicalAgentId,
    sharedCountsMap,
    agentLocationMap,
    handleToggleCollapse,
    handleSelectNode,
    handleDispatchToCeo,
    addSubTeam,
    fitView,
    setNodes,
    setEdges,
  ]);

  const handleConfirmCreateDept = () => {
    if (!newDeptName.trim()) return;
    const deptId = `dept-${Date.now()}`;
    addDepartment({
      id: deptId,
      name: newDeptName.trim(),
      parentDepartmentId: 'root-ceo',
      lastActiveAt: Date.now(),
      status: 'idle',
      departmentCeoAgent: {
        id: `agent-head-${deptId}`,
        canonicalAgentId: `canonical-head-${deptId}`,
        name: `${newDeptName.trim()} Head`,
        title: 'Department CEO',
        role: 'department_head',
        assignedTeamIds: [],
        lastActiveAt: Date.now(),
        status: 'idle',
      },
      teams: [],
      linkedProjects: [],
    });
    setNewDeptName('');
    setCreateDeptModalVisible(false);
    Message.success('Department created successfully!');
  };

  return (
    <div className='relative size-full overflow-hidden bg-[var(--color-bg-1)]'>
      {/* Top Floating Controls Toolbar */}
      <OrgCanvasToolbar
        direction={direction}
        onToggleDirection={() => setDirection((d) => (d === 'TB' ? 'LR' : 'TB'))}
        onFitView={() => void fitView({ padding: 0.25, duration: 400 })}
        onToggleExpandAll={handleToggleExpandAll}
        isAllExpanded={collapsedBranchIds.size === 0}
        onNewRootDepartment={() => setCreateDeptModalVisible(true)}
        onOpenSeedModal={() => setIsSeedModalOpen(true)}
      />

      {/* Main React Flow Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.2}
        maxZoom={1.6}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color='var(--color-border-3, #475569)' gap={24} size={1} />
        <Controls className='!bg-[var(--color-bg-2)] !border-[var(--color-border-2)] !rounded-10px shadow-lg' />
        <MiniMap
          nodeStrokeWidth={3}
          nodeColor={(n) => {
            if (n.type === 'rootCeo') return '#F59E0B';
            if (n.type === 'department') return '#3B82F6';
            return '#10B981';
          }}
          className='!bg-[var(--color-bg-2)] !border-[var(--color-border-2)] !rounded-10px shadow-lg'
        />
      </ReactFlow>

      {/* Slide-Over Inspector Drawer */}
      <OrgInspectorDrawer
        selectedNodeId={selectedNodeId}
        selectedNodeType={selectedNodeType}
        visible={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
        onOpenConversation={(convId) => {
          setIsInspectorOpen(false);
          void navigate(`/conversation/${convId}`);
        }}
      />

      {/* Org Seed JSON Modal */}
      <OrgSeedModal visible={isSeedModalOpen} onClose={() => setIsSeedModalOpen(false)} />

      {/* Create Department Modal */}
      <Modal
        title='Create New Corporate Department'
        visible={createDeptModalVisible}
        onOk={handleConfirmCreateDept}
        onCancel={() => setCreateDeptModalVisible(false)}
        okText='Create Department'
        okButtonProps={{ disabled: !newDeptName.trim() }}
      >
        <div className='flex flex-col gap-8px'>
          <span className='text-12px text-t-secondary'>Enter the Department name:</span>
          <Input
            value={newDeptName}
            onChange={setNewDeptName}
            onPressEnter={handleConfirmCreateDept}
            placeholder='e.g., Enterprise Solutions Department'
            autoFocus
          />
        </div>
      </Modal>

      {/* Quick Dispatch to CEO Modal */}
      <Modal
        title='👑 Executive Directive to Root CEO'
        visible={dispatchCeoModalVisible}
        onOk={() => {
          if (!dispatchCeoPrompt.trim()) return;
          setIsInspectorOpen(true);
          setDispatchCeoModalVisible(false);
        }}
        onCancel={() => setDispatchCeoModalVisible(false)}
        okText='Open Inspector & Dispatch'
        okButtonProps={{ disabled: !dispatchCeoPrompt.trim() }}
      >
        <div className='flex flex-col gap-8px'>
          <span className='text-12px text-t-secondary'>
            Assign a high-level strategic goal to the Root Organization CEO:
          </span>
          <Input.TextArea
            rows={3}
            value={dispatchCeoPrompt}
            onChange={setDispatchCeoPrompt}
            placeholder='e.g., Launch mobile biometric verification across all apps and schedule cross-platform social distribution...'
            autoFocus
          />
        </div>
      </Modal>
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
