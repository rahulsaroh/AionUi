/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { OrgDepartmentNode, OrgProject, OrgAgentMember } from '@/types/organization';

export interface DepartmentHeadCallbacks {
  onLiveStep?: (step: string) => void;
  onCreateProject?: (project: OrgProject) => void;
  onAssignMember?: (projectId: string, memberId: string) => void;
  onHireMember?: (member: OrgAgentMember) => void;
}

/**
 * Department Head Agent:
 * - Scans department folder using scanFolder (strictly bounded to department.workspacePath)
 * - Identifies subfolders as projects
 * - Assigns members from the shared member pool (or hires if none match)
 */
export class DepartmentHeadAgent {
  constructor(
    private department: OrgDepartmentNode,
    private existingProjects: OrgProject[],
    private memberPool: OrgAgentMember[],
    private callbacks: DepartmentHeadCallbacks
  ) {}

  public getSystemPrompt(): string {
    const deptFolder = this.department.workspacePath || 'Unassigned Folder';
    return `You are ${this.department.departmentCeoAgent.name}, Department Head for "${this.department.name}".
Your department workspace path is strictly: "${deptFolder}".

Mandate:
1. Scan your department directory to discover application and product subfolders.
2. For each discovered app/channel/product folder, map it to a Project under this department.
3. Review the shared global member pool (${this.memberPool.length} available members).
4. Assign suitable members to each project by ID. Only propose hiring a new member if no existing member possesses the required skills.
5. You operate strictly inside "${deptFolder}". You cannot access or scan paths outside your department.`;
  }

  /**
   * Scans department directory and maps subfolders to projects.
   */
  public async analyzeFolderAndMapProjects(): Promise<{
    discovered: Array<{ name: string; folder: string; recommendedMemberIds: string[] }>;
    summary: string;
  }> {
    const deptFolder = this.department.workspacePath;
    if (!deptFolder) {
      throw new Error(`Department "${this.department.name}" does not have an assigned workspace folder.`);
    }

    this.callbacks.onLiveStep?.(`Scanning department folder: ${deptFolder}`);

    const scanResult = await ipcBridge.org.scanFolder(deptFolder, deptFolder, { depth: 2, maxEntries: 300 });
    const subdirs = scanResult.entries.filter((e: any) => e.isDirectory && !e.relativePath.includes('/'));

    const discovered: Array<{ name: string; folder: string; recommendedMemberIds: string[] }> = [];

    for (const dir of subdirs) {
      const fullPath = `${deptFolder.replace(/[\\/]$/, '')}/${dir.name}`;
      const recMembers: string[] = [];

      // Match skills against directory name
      const nameLower = dir.name.toLowerCase();
      for (const m of this.memberPool) {
        if (
          (nameLower.includes('ui') || nameLower.includes('web') || nameLower.includes('frontend')) &&
          (m.skills?.includes('react') || m.skills?.includes('ui') || m.role === 'specialist')
        ) {
          if (!recMembers.includes(m.id)) recMembers.push(m.id);
        } else if (
          (nameLower.includes('api') || nameLower.includes('service') || nameLower.includes('backend')) &&
          (m.skills?.includes('typescript') || m.skills?.includes('python') || m.skills?.includes('api'))
        ) {
          if (!recMembers.includes(m.id)) recMembers.push(m.id);
        }
      }

      // Default fallback: pick first available member if none specifically matched
      if (recMembers.length === 0 && this.memberPool.length > 0) {
        recMembers.push(this.memberPool[0].id);
      }

      discovered.push({
        name: dir.name,
        folder: fullPath,
        recommendedMemberIds: recMembers,
      });
    }

    return {
      discovered,
      summary: `Discovered ${discovered.length} potential project subfolders under ${this.department.name}.`,
    };
  }

  /**
   * Creates a project and assigns members.
   */
  public createProject(name: string, folder: string, memberIds: string[]): OrgProject {
    const proj: OrgProject = {
      id: `proj-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name,
      departmentId: this.department.id,
      teamIds: [],
      memberIds,
      workspacePath: folder,
      status: 'active',
    };
    this.callbacks.onCreateProject?.(proj);
    return proj;
  }
}

/**
 * Project Head Agent:
 * - Direct chat agent for an individual project
 * - Contextual awareness: README/main files + recent chat history injected
 * - Can edit files, create files, and run shell strictly inside project.workspacePath
 */
export class ProjectHeadAgent {
  constructor(
    private project: OrgProject,
    private headMember: OrgAgentMember,
    private recentChatHistory: Array<{ role: string; content: string }> = []
  ) {}

  public async getContextualSystemPrompt(): Promise<string> {
    const projFolder = this.project.workspacePath || 'Unassigned Project Folder';
    let readmeSnippet = '';

    if (this.project.workspacePath) {
      try {
        const readmePath = `${this.project.workspacePath.replace(/[\\/]$/, '')}/README.md`;
        const readRes = await ipcBridge.org.readFile(readmePath, this.project.workspacePath, 2048);
        if (readRes?.content) {
          readmeSnippet = `\n--- Project README Summary ---\n${readRes.content}\n-----------------------------`;
        }
      } catch {}
    }

    return `You are ${this.headMember.name}, Project Head for "${this.project.name}".
Your project workspace folder is strictly: "${projFolder}".
Goal: "${this.project.goal || 'Build and maintain this project to the highest standard.'}"
${readmeSnippet}

Capabilities & Safety Boundaries:
1. You can inspect code, write files, and execute shell commands.
2. All operations are strictly constrained to "${projFolder}".
3. Any attempt to access, write, or run commands outside this boundary is rejected.
4. Answer direct developer questions accurately, assist with code changes, debugging, and project tasks.`;
  }

  public async readFile(relativePath: string): Promise<string> {
    const projFolder = this.project.workspacePath;
    if (!projFolder) throw new Error('Project workspace path not set');
    const fullPath = `${projFolder.replace(/[\\/]$/, '')}/${relativePath.replace(/^[\\/]/, '')}`;
    const res = await ipcBridge.org.readFile(fullPath, projFolder);
    return res.content;
  }

  public async writeFile(relativePath: string, content: string): Promise<boolean> {
    const projFolder = this.project.workspacePath;
    if (!projFolder) throw new Error('Project workspace path not set');
    const fullPath = `${projFolder.replace(/[\\/]$/, '')}/${relativePath.replace(/^[\\/]/, '')}`;
    return ipcBridge.org.writeFile(fullPath, content, projFolder);
  }

  public async runShell(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const projFolder = this.project.workspacePath;
    if (!projFolder) throw new Error('Project workspace path not set');
    return ipcBridge.org.runShell(command, projFolder, projFolder);
  }
}
