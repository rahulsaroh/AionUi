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
import { Input, Message, Modal } from '@arco-design/web-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import RootCeoNode from './components/RootCeoNode';
import DepartmentNode from './components/DepartmentNode';
import TeamNode from './components/TeamNode';
import DelegationEdge from './components/DelegationEdge';
import SharedMemberTetherEdge from './components/SharedMemberTetherEdge';
import OrgCanvasToolbar from './components/OrgCanvasToolbar';
import OrgInspectorDrawer, { type OrgNodeType } from './components/OrgInspectorDrawer';
import OrgSeedModal from './components/OrgSeedModal';
import OrgProjectModal from './components/OrgProjectModal';
import OrgDepartmentModal from './components/OrgDepartmentModal';
import OrgEntityEditModal from './components/OrgEntityEditModal';
import { OrgMasterFolderModal } from './components/OrgMasterFolderModal';
import ProjectNode from './components/ProjectNode';
import SharedMemberNode from './components/SharedMemberNode';
import SharedMemberHeaderNode from './components/SharedMemberHeaderNode';
import OrgCanvasTitleBlock from './components/OrgCanvasTitleBlock';
import OrgCanvasLegend from './components/OrgCanvasLegend';
import { layoutOrgChart } from './utils/layoutOrgChart';
import { generateSharedMemberTethers } from './utils/orgTethers';
import { createDepartmentShell, createTeamShell } from './utils/orgCoherence';
import './orgGlow.css';
import { computeOrgStatusPropagation } from './utils/orgStatusPropagation';
import { computeLifecycleStatus } from './utils/orgTheme';
import { useOrgStore } from './store/useOrgStore';
import type { OrgProject, RootCEO, OrgAgentMember } from '@/types/organization';

const nodeTypes: NodeTypes = {
  rootCeo: RootCeoNode,
  department: DepartmentNode,
  team: TeamNode,
  project: ProjectNode,
  sharedMember: SharedMemberNode,
  sharedMemberHeader: SharedMemberHeaderNode,
};

const edgeTypes: EdgeTypes = {
  delegation: DelegationEdge,
  tether: SharedMemberTetherEdge,
};

const CanvasInner: React.FC = () => {
  const { t } = useTranslation();
  const {
    hierarchy,
    hoveredCanonicalAgentId,
    setHoveredCanonicalAgentId,
    selectedCanonicalAgentId,
    setSelectedCanonicalAgentId,
    selectedDepartmentId,
    selectedTeamId,
    selectedProjectId,
    focusedNodeId,
    setSelectedDepartment,
    setSelectedTeam,
    setSelectedProject,
    clearOrgSelection,
    addDepartment,
    addSubTeam,
    updateDepartment,
    updateTeamNode,
    projects,
    nodeStatuses,
    activeFilter,
    setOrgViewMode,
    setSelectedConversationId,
  } = useOrgStore();

  const navigate = useNavigate();
  const { fitView, setCenter, getNode } = useReactFlow();
  const canvasContainerRef = React.useRef<HTMLDivElement>(null);

  const [direction, setDirection] = useState<'TB' | 'LR'>('TB');
  const [collapsedBranchIds, setCollapsedBranchIds] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeType, setSelectedNodeType] = useState<OrgNodeType | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isSeedModalOpen, setIsSeedModalOpen] = useState(false);
  const [isMasterModalOpen, setIsMasterModalOpen] = useState(false);
  const [projectModal, setProjectModal] = useState<{
    visible: boolean;
    project: OrgProject | null;
    departmentId?: string;
    teamId?: string;
  }>({ visible: false, project: null });
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);
  const [editEntity, setEditEntity] = useState<{
    type: 'department' | 'team' | 'member' | 'project' | 'ceo';
    data: any;
    context: { departmentId?: string; teamId?: string };
  } | null>(null);

  const [createDeptModalVisible, setCreateDeptModalVisible] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const { sharedCountsMap, agentLocationMap, sharedPoolMembers } = useMemo(() => {
    const counts: Record<string, number> = {};
    const locations: Record<string, string[]> = {};
    const deptsMap: Record<string, Set<string>> = {};
    const memberObjMap: Record<string, OrgAgentMember> = {};

    hierarchy.departments.forEach((dept) => {
      dept.teams.forEach((team) => {
        team.specialistMembers.forEach((spec) => {
          counts[spec.canonicalAgentId] = (counts[spec.canonicalAgentId] || 0) + 1;
          if (!locations[spec.canonicalAgentId]) locations[spec.canonicalAgentId] = [];
          if (!locations[spec.canonicalAgentId].includes(team.id)) locations[spec.canonicalAgentId].push(team.id);
          if (!deptsMap[spec.canonicalAgentId]) deptsMap[spec.canonicalAgentId] = new Set();
          deptsMap[spec.canonicalAgentId].add(dept.name);
          memberObjMap[spec.canonicalAgentId] = spec;
        });
      });
    });

    const pool = Object.entries(counts)
      .filter(([id, cnt]) => cnt > 1 || (deptsMap[id] && deptsMap[id].size > 1))
      .map(([id, cnt]) => ({
        canonicalId: id,
        member: memberObjMap[id],
        count: cnt,
        departments: Array.from(deptsMap[id] || []),
        teamIds: locations[id] || [],
      }));

    return { sharedCountsMap: counts, agentLocationMap: locations, sharedPoolMembers: pool };
  }, [hierarchy]);

  // Compute live upward propagation of working and error states
  const propagation = useMemo(
    () => computeOrgStatusPropagation(hierarchy, projects, nodeStatuses),
    [hierarchy, projects, nodeStatuses]
  );

  const handleToggleCollapse = useCallback((deptId: string) => {
    setCollapsedBranchIds((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  }, []);

  const handleToggleExpandAll = useCallback(() => {
    if (collapsedBranchIds.size > 0) setCollapsedBranchIds(new Set());
    else setCollapsedBranchIds(new Set(hierarchy.departments.map((d) => d.id)));
  }, [collapsedBranchIds.size, hierarchy.departments]);

  const handleSelectNode = useCallback(
    (nodeId: string, nodeType: OrgNodeType) => {
      setSelectedNodeId(nodeId);
      setSelectedNodeType(nodeType);
      if (nodeType === 'department') {
        setSelectedDepartment(nodeId);
        setSelectedTeam(null);
        setSelectedProject(null);
      } else if (nodeType === 'team') {
        const team = hierarchy.departments.flatMap((d) => d.teams).find((t) => t.id === nodeId);
        setSelectedTeam(nodeId);
        if (team) setSelectedDepartment(team.departmentId);
        setSelectedProject(null);
      } else if (nodeType === 'project') {
        const proj = projects.find((p) => p.id === nodeId);
        setSelectedProject(nodeId);
        if (proj) {
          setSelectedDepartment(proj.departmentId);
          if (proj.teamIds?.[0]) setSelectedTeam(proj.teamIds[0]);
        }
      }
      setIsInspectorOpen(true);
    },
    [hierarchy.departments, projects, setSelectedDepartment, setSelectedTeam, setSelectedProject]
  );

  const handleDispatchToCeo = useCallback(
    (_rootCeo: RootCEO) => {
      setSelectedDepartment(null);
      setSelectedTeam(null);
      setSelectedProject(null);
      setSelectedConversationId(null);
      setOrgViewMode('chat');
    },
    [setSelectedDepartment, setSelectedTeam, setSelectedProject, setSelectedConversationId, setOrgViewMode]
  );

  const openProjectModal = useCallback((departmentId?: string, teamId?: string, project: OrgProject | null = null) => {
    setProjectModal({ visible: true, project, departmentId, teamId });
  }, []);

  const handleSetFolder = useCallback(
    (nodeId: string, nodeType: OrgNodeType) => {
      if (nodeType === 'ceo' || nodeId === 'root-ceo') {
        setIsMasterModalOpen(true);
      } else if (nodeType === 'department') {
        const dept = hierarchy.departments.find((d) => d.id === nodeId);
        setEditEntity({ type: 'department', data: dept ?? null, context: { departmentId: nodeId } });
      } else if (nodeType === 'team') {
        const team = hierarchy.departments.flatMap((d) => d.teams).find((t) => t.id === nodeId);
        setEditEntity({
          type: 'team',
          data: team ?? null,
          context: { departmentId: team?.departmentId, teamId: nodeId },
        });
      } else if (nodeType === 'project') {
        const proj = projects.find((p) => p.id === nodeId);
        if (proj) {
          setEditEntity({
            type: 'project',
            data: proj,
            context: { departmentId: proj.departmentId, teamId: proj.teamIds?.[0] },
          });
        }
      }
      setIsInspectorOpen(false);
    },
    [hierarchy.departments, projects]
  );

  const handleEditSave = () => {
    setEditEntity(null);
  };

  useEffect(() => {
    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];

    rawNodes.push({
      id: hierarchy.rootCeo.id,
      type: 'rootCeo',
      data: {
        rootCeo: hierarchy.rootCeo,
        orientation: direction,
        isDescendantWorking: propagation.workingNodeIds.has(hierarchy.rootCeo.id),
        onDispatchToCeo: handleDispatchToCeo,
        onSelectNode: (id: string, type: 'ceo') => handleSelectNode(id, type),
        onSelectMember: (memberId: string) => handleSelectNode(memberId, 'member'),
        onSetFolder: (id: string) => handleSetFolder(id, 'ceo'),
        onEditCeo: () => setEditEntity({ type: 'ceo', data: hierarchy.rootCeo, context: {} }),
      },
      position: { x: 0, y: 0 },
      className:
        focusedNodeId === hierarchy.rootCeo.id
          ? 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--color-bg-1)]'
          : undefined,
    });

    hierarchy.departments.forEach((dept, deptIdx) => {
      const isDeptCollapsed = collapsedBranchIds.has(dept.id);
      rawNodes.push({
        id: dept.id,
        type: 'department',
        data: {
          department: dept,
          deptIndex: deptIdx,
          isCollapsed: isDeptCollapsed,
          orientation: direction,
          isDescendantWorking: propagation.workingNodeIds.has(dept.id),
          onToggleCollapse: handleToggleCollapse,
          onAddSubTeam: (deptId: string) => {
            addSubTeam(
              deptId,
              createTeamShell(deptId, `New Team ${dept.teams.length + 1}`, hierarchy.rootCeo.ceoAgent.model)
            );
            Message.success(t('team.organization.teamSaved', { defaultValue: 'Sub-team saved' }));
          },
          onAddProject: (deptId: string) => openProjectModal(deptId),
          onEditDepartment: (deptId: string) => setEditingDepartmentId(deptId),
          onRunTask: (d: { id: string }) => handleSelectNode(d.id, 'department'),
          onSelectNode: (id: string, type: 'department') => handleSelectNode(id, type),
          onSelectProject: (projId: string) => handleSelectNode(projId, 'project'),
          onSelectMember: (memberId: string) => handleSelectNode(memberId, 'member'),
          onSetFolder: (nodeId: string) => handleSetFolder(nodeId, 'department'),
          onEditMember: (memberId: string) => {
            const member = dept.teams.flatMap((t) => t.specialistMembers).find((m) => m.id === memberId);
            const team = dept.teams.find((t) => t.specialistMembers.some((m) => m.id === memberId));
            setEditEntity({
              type: 'member',
              data: member ?? null,
              context: { departmentId: dept.id, teamId: team?.id },
            });
            setIsInspectorOpen(false);
          },
        },
        position: { x: 0, y: 0 },
        className: focusedNodeId === dept.id ? 'ring-2 ring-sky-400 ring-offset-2 ring-offset-slate-950' : undefined,
      });

      rawEdges.push({
        id: `edge-${hierarchy.rootCeo.id}->${dept.id}`,
        source: hierarchy.rootCeo.id,
        target: dept.id,
        type: 'delegation',
        data: { deptIndex: deptIdx, deptColor: dept.color },
      });

      if (!isDeptCollapsed) {
        const deptProjects = projects.filter((p) => p.departmentId === dept.id);
        const placedTeamIds = new Set<string>();

        // Tier 3: Project node(s) under department
        deptProjects.forEach((proj) => {
          rawNodes.push({
            id: `project-${proj.id}`,
            type: 'project',
            data: {
              project: proj,
              department: dept,
              orientation: direction,
              isDescendantWorking: propagation.workingNodeIds.has(`project-${proj.id}`),
              onSelectNode: (id: string, _type: 'project') => {
                const cleanId = id.replace(/^project-/, '');
                handleSelectNode(cleanId, 'project');
              },
              onEditProject: () => openProjectModal(dept.id, undefined, proj),
              onSetFolder: () => handleSetFolder(proj.id, 'project'),
            },
            position: { x: 0, y: 0 },
            className:
              focusedNodeId === `project-${proj.id}`
                ? 'ring-2 ring-purple-400 ring-offset-2 ring-offset-slate-950'
                : undefined,
          });

          rawEdges.push({
            id: `edge-${dept.id}->project-${proj.id}`,
            source: dept.id,
            target: `project-${proj.id}`,
            type: 'delegation',
            data: { deptIndex: deptIdx, deptColor: dept.color },
          });

          // Tier 4: Team node(s) under this project
          const projectTeams = dept.teams.filter((t) => proj.teamIds?.includes(t.id) || t.linkedProjectId === proj.id);

          projectTeams.forEach((team) => {
            placedTeamIds.add(team.id);
            rawNodes.push({
              id: team.id,
              type: 'team',
              data: {
                team,
                departmentName: dept.name,
                orientation: direction,
                sharedCountsMap,
                isDescendantWorking: propagation.workingNodeIds.has(team.id),
                onSelectNode: (id: string, type: 'team') => handleSelectNode(id, type),
                onSelectMember: (memberId: string) => handleSelectNode(memberId, 'member'),
                onSetFolder: (nodeId: string) => handleSetFolder(nodeId, 'team'),
                onEditMember: (memberId: string) => {
                  const member = team.specialistMembers.find((m) => m.id === memberId);
                  setEditEntity({
                    type: 'member',
                    data: member ?? null,
                    context: { departmentId: dept.id, teamId: team.id },
                  });
                  setIsInspectorOpen(false);
                },
              },
              position: { x: 0, y: 0 },
              className:
                focusedNodeId === team.id ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-950' : undefined,
            });

            rawEdges.push({
              id: `edge-project-${proj.id}->${team.id}`,
              source: `project-${proj.id}`,
              target: team.id,
              type: 'delegation',
              data: { deptIndex: deptIdx, deptColor: dept.color },
            });
          });
        });

        // Any remaining teams in this department not linked to a project
        const remainingTeams = dept.teams.filter((t) => !placedTeamIds.has(t.id));
        remainingTeams.forEach((team) => {
          rawNodes.push({
            id: team.id,
            type: 'team',
            data: {
              team,
              departmentName: dept.name,
              orientation: direction,
              sharedCountsMap,
              isDescendantWorking: propagation.workingNodeIds.has(team.id),
              onSelectNode: (id: string, type: 'team') => handleSelectNode(id, type),
              onSelectMember: (memberId: string) => handleSelectNode(memberId, 'member'),
              onSetFolder: (nodeId: string) => handleSetFolder(nodeId, 'team'),
              onEditMember: (memberId: string) => {
                const member = team.specialistMembers.find((m) => m.id === memberId);
                setEditEntity({
                  type: 'member',
                  data: member ?? null,
                  context: { departmentId: dept.id, teamId: team.id },
                });
                setIsInspectorOpen(false);
              },
            },
            position: { x: 0, y: 0 },
            className:
              focusedNodeId === team.id ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-950' : undefined,
          });

          rawEdges.push({
            id: `edge-${dept.id}->${team.id}`,
            source: dept.id,
            target: team.id,
            type: 'delegation',
            data: { deptIndex: deptIdx, deptColor: dept.color },
          });
        });
      }
    });

    // Tier 5: Shared Members Bottom Strip
    if (sharedPoolMembers.length > 0) {
      rawNodes.push({
        id: 'shared-member-header',
        type: 'sharedMemberHeader',
        data: {},
        position: { x: 0, y: 0 },
      });

      sharedPoolMembers.forEach((sharedItem) => {
        rawNodes.push({
          id: `shared-${sharedItem.canonicalId}`,
          type: 'sharedMember',
          data: {
            member: sharedItem.member,
            departmentsServed: sharedItem.departments,
            sharedCount: sharedItem.count,
            onSelectMember: (memberId: string) => handleSelectNode(memberId, 'member'),
            onHoverMember: (canonicalId: string | null) => setHoveredCanonicalAgentId(canonicalId),
          },
          position: { x: 0, y: 0 },
        });
      });

      // Generate tethers cleanly connecting each shared member to their teams
      const existingNodeIdSet = new Set(rawNodes.map((n) => n.id));
      const tethers = generateSharedMemberTethers(sharedPoolMembers, existingNodeIdSet);
      rawEdges.push(...tethers);
    }

    const layouted = layoutOrgChart(rawNodes, rawEdges, direction);
    setNodes(layouted.nodes);
    setEdges(layouted.edges);
    setTimeout(() => void fitView({ padding: 0.25, duration: 400 }), 50);
  }, [
    hierarchy,
    collapsedBranchIds,
    direction,
    hoveredCanonicalAgentId,
    setHoveredCanonicalAgentId,
    selectedCanonicalAgentId,
    sharedCountsMap,
    agentLocationMap,
    sharedPoolMembers,
    propagation,
    handleToggleCollapse,
    handleSelectNode,
    handleDispatchToCeo,
    handleSetFolder,
    addSubTeam,
    openProjectModal,
    projects,
    fitView,
    setNodes,
    setEdges,
    t,
  ]);

  // Active shared agent (hovered or selected)
  const activeSharedAgentId = hoveredCanonicalAgentId || selectedCanonicalAgentId;

  // Build the set of edge IDs along the path from hoveredNodeId to root-ceo
  const highlightedEdgeIdSet = useMemo(() => {
    if (!hoveredNodeId) return new Set<string>();
    const edgeSet = new Set<string>();
    let currentId: string | null = hoveredNodeId;
    const parentMap = new Map<string, { edgeId: string; parentId: string }>();

    edges.forEach((edge) => {
      if (edge.type === 'delegation') {
        parentMap.set(edge.target, { edgeId: edge.id, parentId: edge.source });
      }
    });

    while (currentId && parentMap.has(currentId)) {
      const parent = parentMap.get(currentId)!;
      edgeSet.add(parent.edgeId);
      currentId = parent.parentId;
    }

    return edgeSet;
  }, [hoveredNodeId, edges]);

  // Derived edges with path highlighting, working glow, and tether focus
  const displayEdges = useMemo(() => {
    return edges.map((edge) => {
      if (edge.type === 'delegation') {
        const isPathHighlighted = highlightedEdgeIdSet.has(edge.id);
        const isWorkingPath = propagation.workingEdgeIds.has(edge.id);
        const isDimmed = Boolean(hoveredNodeId) && !isPathHighlighted && !isWorkingPath;
        return {
          ...edge,
          zIndex: isPathHighlighted ? 10 : isWorkingPath ? 6 : 1,
          data: {
            ...edge.data,
            isPathHighlighted,
            isDimmed,
            isWorkingPath,
            exceedsAnimationLimit: propagation.exceedsAnimationLimit,
          },
        };
      }

      if (edge.type === 'tether') {
        const edgeCanonicalId = (edge.data as any)?.canonicalId;
        const isHighlighted = Boolean(activeSharedAgentId && edgeCanonicalId === activeSharedAgentId);
        const isWorkingTether = propagation.workingEdgeIds.has(edge.id);
        const isDimmed = Boolean(activeSharedAgentId && edgeCanonicalId !== activeSharedAgentId) && !isWorkingTether;
        return {
          ...edge,
          zIndex: isHighlighted ? 8 : isWorkingTether ? 5 : -1,
          data: {
            ...edge.data,
            isHighlighted,
            isDimmed,
            isWorking: isWorkingTether,
          },
        };
      }

      return edge;
    });
  }, [edges, highlightedEdgeIdSet, hoveredNodeId, activeSharedAgentId, propagation]);

  // Compute matching nodes based on activeFilter (All / Active / Dormant / Shared)
  const matchingNodeIdSet = useMemo(() => {
    if (activeFilter === 'all') return null;

    const matched = new Set<string>();

    if (activeFilter === 'active') {
      // Active = any node directly working or with a working descendant
      propagation.workingNodeIds.forEach((id) => matched.add(id));
    } else if (activeFilter === 'dormant') {
      // Dormant = nodes with dormant lifecycle status
      hierarchy.departments.forEach((dept) => {
        if (computeLifecycleStatus(dept.lastActiveAt, nodeStatuses[dept.id] || dept.status) === 'dormant') {
          matched.add(dept.id);
        }
        dept.teams.forEach((team) => {
          if (computeLifecycleStatus(team.lastActiveAt, nodeStatuses[team.id] || team.status) === 'dormant') {
            matched.add(team.id);
          }
        });
      });
    } else if (activeFilter === 'shared') {
      // Shared = shared-pool members, their strip cards, header, and teams containing shared members
      matched.add('shared-member-header');
      sharedPoolMembers.forEach((item) => {
        matched.add(`shared-${item.canonicalId}`);
        const appearances = agentLocationMap[item.canonicalId] || [];
        appearances.forEach((teamId) => matched.add(teamId));
      });
    }

    return matched;
  }, [activeFilter, propagation.workingNodeIds, hierarchy, nodeStatuses, sharedPoolMembers, agentLocationMap]);

  // Display nodes with filter dimming applied: non-matching nodes are dimmed while structure remains visible
  const displayNodes = useMemo(() => {
    return nodes.map((node) => {
      const isDimmed = matchingNodeIdSet ? !matchingNodeIdSet.has(node.id) : false;
      return {
        ...node,
        data: {
          ...(node.data as any),
          isDimmed,
        },
        style: {
          ...node.style,
          opacity: isDimmed ? 0.22 : 1,
          transition: 'opacity 0.3s ease, filter 0.3s ease',
          filter: isDimmed ? 'grayscale(0.7)' : undefined,
          pointerEvents: isDimmed ? 'none' : 'auto',
        } as React.CSSProperties,
      };
    });
  }, [nodes, matchingNodeIdSet]);

  // Escape key clears selection and hover highlights
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedNodeId(null);
        setSelectedNodeType(null);
        setHoveredNodeId(null);
        setHoveredCanonicalAgentId(null);
        setSelectedCanonicalAgentId(null);
        clearOrgSelection();
        setIsInspectorOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearOrgSelection, setHoveredCanonicalAgentId, setSelectedCanonicalAgentId]);

  // Center canvas on the focused node when sidebar-driven selection changes
  useEffect(() => {
    if (!focusedNodeId) return;
    const node = getNode(focusedNodeId);
    if (node) {
      setCenter(node.position.x, node.position.y, { duration: 400 });
    }
  }, [focusedNodeId, getNode, setCenter]);

  const handleConfirmCreateDept = () => {
    if (!newDeptName.trim()) return;
    addDepartment(createDepartmentShell(newDeptName, hierarchy.rootCeo.ceoAgent.model));
    setNewDeptName('');
    setCreateDeptModalVisible(false);
    Message.success(t('team.organization.departmentSaved', { defaultValue: 'Department saved' }));
  };

  const editingDepartment = editingDepartmentId
    ? (hierarchy.departments.find((department) => department.id === editingDepartmentId) ?? null)
    : null;

  return (
    <div
      ref={canvasContainerRef}
      className='relative size-full overflow-hidden'
      style={{
        background: 'radial-gradient(ellipse at 50% 15%, #0d1a38 0%, #070c1a 60%, #030712 100%)',
      }}
    >
      {/* Top Left Title Block */}
      <OrgCanvasTitleBlock />

      {/* Top Right Legend Box */}
      <OrgCanvasLegend />

      {/* Bottom Floating Canvas Toolbar */}
      <OrgCanvasToolbar
        direction={direction}
        onToggleDirection={() => setDirection((d) => (d === 'TB' ? 'LR' : 'TB'))}
        onFitView={() => void fitView({ padding: 0.25, duration: 400 })}
        onToggleExpandAll={handleToggleExpandAll}
        isAllExpanded={collapsedBranchIds.size === 0}
        onNewRootDepartment={() => setCreateDeptModalVisible(true)}
        onNewProject={() => openProjectModal(hierarchy.departments[0]?.id)}
        onOpenSeedModal={() => setIsSeedModalOpen(true)}
      />

      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeMouseEnter={(_event, node) => setHoveredNodeId(node.id)}
        onNodeMouseLeave={() => setHoveredNodeId(null)}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.2}
        maxZoom={1.6}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color='rgba(99, 102, 241, 0.15)' gap={24} size={1} />
        <Controls className='!bg-slate-900/90 !border-slate-700 !rounded-10px shadow-lg text-slate-200' />
        <MiniMap
          nodeStrokeWidth={3}
          nodeColor={(n) => {
            if (n.type === 'rootCeo') return '#06B6D4';
            if (n.type === 'department') return '#38BDF8';
            if (n.type === 'project') return '#A855F7';
            if (n.type === 'team') return '#10B981';
            if (n.type === 'sharedMember') return '#818CF8';
            return '#64748B';
          }}
          className='!bg-slate-900/90 !border-slate-700 !rounded-10px shadow-lg'
        />
      </ReactFlow>

      <OrgInspectorDrawer
        selectedNodeId={selectedNodeId}
        selectedNodeType={selectedNodeType}
        visible={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
        onOpenConversation={(convId) => {
          setIsInspectorOpen(false);
          void navigate(`/conversation/${convId}`);
        }}
        onEditDepartment={(deptId) => setEditingDepartmentId(deptId)}
        onEditProject={(project) => openProjectModal(project.departmentId, project.teamIds?.[0], project)}
        onSetFolder={(nodeId, nodeType) => handleSetFolder(nodeId, nodeType)}
        getPopupContainer={() => canvasContainerRef.current || document.body}
      />

      <OrgSeedModal visible={isSeedModalOpen} onClose={() => setIsSeedModalOpen(false)} />
      <OrgProjectModal
        visible={projectModal.visible}
        project={projectModal.project}
        defaultDepartmentId={projectModal.departmentId}
        defaultTeamId={projectModal.teamId}
        onClose={() => setProjectModal({ visible: false, project: null })}
      />
      <OrgDepartmentModal
        visible={Boolean(editingDepartmentId)}
        department={editingDepartment}
        onClose={() => setEditingDepartmentId(null)}
      />
      <OrgEntityEditModal
        visible={Boolean(editEntity)}
        entity={editEntity?.type ?? 'department'}
        data={editEntity?.data ?? null}
        context={editEntity?.context ?? {}}
        onClose={() => setEditEntity(null)}
        onSave={handleEditSave}
      />
      <OrgMasterFolderModal visible={isMasterModalOpen} onClose={() => setIsMasterModalOpen(false)} />

      <Modal
        title={t('team.organization.addDepartment', { defaultValue: 'Add Department' })}
        visible={createDeptModalVisible}
        onOk={handleConfirmCreateDept}
        onCancel={() => setCreateDeptModalVisible(false)}
        okText={t('team.organization.save', { defaultValue: 'Save' })}
        okButtonProps={{ disabled: !newDeptName.trim() }}
      >
        <div className='flex flex-col gap-8px'>
          <span className='text-12px text-t-secondary'>
            {t('team.organization.departmentName', { defaultValue: 'Department name' })}
          </span>
          <Input value={newDeptName} onChange={setNewDeptName} onPressEnter={handleConfirmCreateDept} autoFocus />
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
