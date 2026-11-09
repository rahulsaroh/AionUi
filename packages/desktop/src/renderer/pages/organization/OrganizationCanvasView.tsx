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
import OrgInspectorDrawer from './components/OrgInspectorDrawer';
import OrgSeedModal from './components/OrgSeedModal';
import OrgProjectModal from './components/OrgProjectModal';
import OrgDepartmentModal from './components/OrgDepartmentModal';
import OrgEntityEditModal from './components/OrgEntityEditModal';
import { OrgMasterFolderModal } from './components/OrgMasterFolderModal';
import ProjectNode from './components/ProjectNode';
import { layoutOrgChart } from './utils/layoutOrgChart';
import { createDepartmentShell, createTeamShell } from './utils/orgCoherence';
import { useOrgStore } from './store/useOrgStore';
import type { OrgProject, RootCEO } from '@/types/organization';

const nodeTypes: NodeTypes = {
  rootCeo: RootCeoNode,
  department: DepartmentNode,
  team: TeamNode,
  project: ProjectNode,
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
    selectedCanonicalAgentId,
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
    setOrgViewMode,
    setSelectedConversationId,
  } = useOrgStore();

  const navigate = useNavigate();
  const { fitView, setCenter, getNode } = useReactFlow();

  const [direction, setDirection] = useState<'TB' | 'LR'>('TB');
  const [collapsedBranchIds, setCollapsedBranchIds] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeType, setSelectedNodeType] = useState<'ceo' | 'department' | 'team' | null>(null);
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
    type: 'department' | 'team' | 'member' | 'project';
    data: any;
    context: { departmentId?: string; teamId?: string };
  } | null>(null);

  const [createDeptModalVisible, setCreateDeptModalVisible] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const { sharedCountsMap, agentLocationMap } = useMemo(() => {
    const counts: Record<string, number> = {};
    const locations: Record<string, string[]> = {};
    hierarchy.departments.forEach((dept) => {
      dept.teams.forEach((team) => {
        team.specialistMembers.forEach((spec) => {
          counts[spec.canonicalAgentId] = (counts[spec.canonicalAgentId] || 0) + 1;
          if (!locations[spec.canonicalAgentId]) locations[spec.canonicalAgentId] = [];
          if (!locations[spec.canonicalAgentId].includes(team.id)) locations[spec.canonicalAgentId].push(team.id);
        });
      });
    });
    return { sharedCountsMap: counts, agentLocationMap: locations };
  }, [hierarchy]);

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
    (nodeId: string, nodeType: 'ceo' | 'department' | 'team') => {
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
      }
      setIsInspectorOpen(true);
    },
    [hierarchy.departments, setSelectedDepartment, setSelectedTeam, setSelectedProject]
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
    (nodeId: string, nodeType: 'ceo' | 'department' | 'team') => {
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
      }
      setIsInspectorOpen(false);
    },
    [hierarchy.departments]
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
        onDispatchToCeo: handleDispatchToCeo,
        onSelectNode: (id: string, type: 'ceo') => handleSelectNode(id, type),
        onSetFolder: (id: string) => handleSetFolder(id, 'ceo'),
      },
      position: { x: 0, y: 0 },
      className:
        focusedNodeId === hierarchy.rootCeo.id
          ? 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--color-bg-1)]'
          : undefined,
    });

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
            addSubTeam(deptId, createTeamShell(deptId, `New Team ${dept.teams.length + 1}`));
            Message.success(t('team.organization.teamSaved', { defaultValue: 'Sub-team saved' }));
          },
          onAddProject: (deptId: string) => openProjectModal(deptId),
          onEditDepartment: (deptId: string) => setEditingDepartmentId(deptId),
          onRunTask: (d: { id: string }) => handleSelectNode(d.id, 'department'),
          onSelectNode: (id: string, type: 'department') => handleSelectNode(id, type),
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
        className:
          focusedNodeId === dept.id ? 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--color-bg-1)]' : undefined,
      });

      rawEdges.push({
        id: `edge-${hierarchy.rootCeo.id}->${dept.id}`,
        source: hierarchy.rootCeo.id,
        target: dept.id,
        type: 'delegation',
      });

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
              focusedNodeId === team.id
                ? 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--color-bg-1)]'
                : undefined,
          });
          rawEdges.push({ id: `edge-${dept.id}->${team.id}`, source: dept.id, target: team.id, type: 'delegation' });

          // Level 4: Project node(s) docked below the team
          const teamProjects = projects.filter((p) => p.teamIds.includes(team.id));
          teamProjects.forEach((proj) => {
            rawNodes.push({
              id: `project-${proj.id}`,
              type: 'project',
              data: {
                project: proj,
                team,
                department: dept,
                orientation: direction,
                onSelectNode: (id: string, type: 'project') => {
                  setSelectedProject(id.replace(/^project-/, ''));
                  setIsInspectorOpen(true);
                },
                onEditProject: () => openProjectModal(dept.id, team.id, proj),
                onSetFolder: () =>
                  setEditEntity({ type: 'project', data: proj, context: { departmentId: dept.id, teamId: team.id } }),
              },
              position: { x: 0, y: 0 },
              className:
                focusedNodeId === `project-${proj.id}`
                  ? 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--color-bg-1)]'
                  : undefined,
            });
            rawEdges.push({
              id: `edge-${team.id}->project-${proj.id}`,
              source: team.id,
              target: `project-${proj.id}`,
              type: 'delegation',
            });
          });
        });
      }
    });

    const activeSharedAgentId = hoveredCanonicalAgentId || selectedCanonicalAgentId;
    if (activeSharedAgentId && agentLocationMap[activeSharedAgentId]) {
      const targetNodeIds = agentLocationMap[activeSharedAgentId].filter((id) => rawNodes.some((n) => n.id === id));
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

    const layouted = layoutOrgChart(rawNodes, rawEdges, direction);
    setNodes(layouted.nodes);
    setEdges(layouted.edges);
    setTimeout(() => void fitView({ padding: 0.25, duration: 400 }), 50);
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
    handleSetFolder,
    addSubTeam,
    openProjectModal,
    projects,
    fitView,
    setNodes,
    setEdges,
    t,
  ]);

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
    addDepartment(createDepartmentShell(newDeptName));
    setNewDeptName('');
    setCreateDeptModalVisible(false);
    Message.success(t('team.organization.departmentSaved', { defaultValue: 'Department saved' }));
  };

  const editingDepartment = editingDepartmentId
    ? (hierarchy.departments.find((department) => department.id === editingDepartmentId) ?? null)
    : null;

  return (
    <div className='relative size-full overflow-hidden bg-[var(--color-bg-1)]'>
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
            if (n.type === 'team') return '#10B981';
            return '#FBBF24';
          }}
          className='!bg-[var(--color-bg-2)] !border-[var(--color-border-2)] !rounded-10px shadow-lg'
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
