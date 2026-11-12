import { describe, it, expect } from 'vitest';
import {
  extractDepartmentCreationIntent,
  extractDepartmentDeletionIntent,
  extractProjectDiscoveryOrBatchIntent,
  extractTeamCreationIntent,
  extractProjectCreationIntent,
  parseOrgActions,
  OrgDelegationEngine,
} from '@/renderer/pages/organization/utils/orgDelegationEngine';
import { createDefaultOrgHierarchy } from '@/renderer/pages/organization/utils/defaultOrgSeed';
import { createDepartmentShell } from '@/renderer/pages/organization/utils/orgCoherence';

describe('Organization Directive & Intent Parsing', () => {
  it('extracts department creation with typo and trailing clause', () => {
    const prompt = 'lets first create a deparment name App Developing department and then we will assign a team to it';
    const result = extractDepartmentCreationIntent(prompt);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('App Developing');
  });

  it('extracts department creation with folder path', () => {
    const prompt =
      'lets first create an app department, files of which are stored into folder G:\\My Drive\\Life\\Money\\Apps';
    const result = extractDepartmentCreationIntent(prompt);
    expect(result).not.toBeNull();
    expect(result?.name.toLowerCase()).toBe('app');
    expect(result?.workspacePath).toBe('G:\\My Drive\\Life\\Money\\Apps');
  });

  it('extracts department creation with dept abbreviation', () => {
    const prompt = 'create dept Machine Learning Research';
    const result = extractDepartmentCreationIntent(prompt);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Machine Learning Research');
  });

  it('extracts team creation with target department', () => {
    const hierarchy = createDefaultOrgHierarchy();
    const appDept = createDepartmentShell('App Builder');
    appDept.id = 'dept-app-builder';
    hierarchy.departments.push(appDept);

    const prompt = 'create team Core Mobile under App Builder';
    const result = extractTeamCreationIntent(prompt, hierarchy.departments);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Core Mobile');
    expect(result?.department.id).toBe('dept-app-builder');
  });

  it('extracts project creation with department', () => {
    const hierarchy = createDefaultOrgHierarchy();
    const appDept = createDepartmentShell('App Builder');
    appDept.id = 'dept-app-builder';
    hierarchy.departments.push(appDept);

    const prompt = 'create project AI Assistant in department App Builder';
    const result = extractProjectCreationIntent(prompt, hierarchy.departments);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('AI Assistant');
    expect(result?.department.id).toBe('dept-app-builder');
  });

  it('parses structured org-action code blocks from LLM responses', () => {
    const llmOutput = `Certainly. I have structured the new department and initial team:
\`\`\`org-action
[
  { "action": "create_department", "name": "App Developing", "description": "Mobile and desktop applications" },
  { "action": "create_team", "department": "App Developing", "name": "Flutter Core" }
]
\`\`\`
All assets have been configured and leadership assigned.`;

    const { actions, cleanText } = parseOrgActions(llmOutput);
    expect(actions).toHaveLength(2);
    expect(actions[0].action).toBe('create_department');
    expect(actions[0].name).toBe('App Developing');
    expect(actions[1].action).toBe('create_team');
    expect(actions[1].name).toBe('Flutter Core');
    expect(cleanText).not.toContain('```org-action');
  });

  it('executes directive end-to-end to create department and returns createdDepartments', async () => {
    const hierarchy = createDefaultOrgHierarchy();
    const engine = new OrgDelegationEngine(hierarchy, undefined, undefined, undefined, { simulationMode: true });

    const prompt = 'lets first create a deparment name App Developing department and then we will assign a team to it';
    const result = await engine.executeDirective(prompt);

    expect(result.success).toBe(true);
    expect(result.createdDepartments).toBeDefined();
    expect(result.createdDepartments).toHaveLength(1);
    expect(result.createdDepartments![0].name).toBe('App Developing');
    expect(result.finalSynthesis).toContain('App Developing');
  });

  it('rejects creating department when prompt is asking to add/create projects in a department', () => {
    const prompt1 = 'search for my different projects in this folder and create multiple projects in this department';
    expect(extractDepartmentCreationIntent(prompt1)).toBeNull();

    const prompt2 = 'create multiple projects in this department';
    expect(extractDepartmentCreationIntent(prompt2)).toBeNull();

    const prompt3 = 'create a project in this department';
    expect(extractDepartmentCreationIntent(prompt3)).toBeNull();

    const prompt4 = 'create 3 teams in this department';
    expect(extractDepartmentCreationIntent(prompt4)).toBeNull();
  });

  it('correctly extracts project discovery intent for searching projects in folder', () => {
    const hierarchy = createDefaultOrgHierarchy();
    const appDept = createDepartmentShell('app development');
    appDept.workspacePath = 'G:\\My Drive\\Life\\Money\\Apps';
    hierarchy.departments.push(appDept);

    const prompt = 'search for my different projects in this folder and create multiple projects in this department';
    const result = extractProjectDiscoveryOrBatchIntent(prompt, hierarchy.departments);

    expect(result).not.toBeNull();
    expect(result?.type).toBe('discover');
    expect(result?.targetDepartment.id).toBe(appDept.id);
    expect(result?.folderPath).toBe('G:\\My Drive\\Life\\Money\\Apps');
  });

  it('executes directive to discover and create projects instead of creating a bogus department', async () => {
    const hierarchy = createDefaultOrgHierarchy();
    const appDept = createDepartmentShell('app development');
    appDept.workspacePath = 'G:\\My Drive\\Life\\Money\\Apps';
    hierarchy.departments.push(appDept);

    const engine = new OrgDelegationEngine(hierarchy, undefined, undefined, undefined, { simulationMode: true });
    const prompt = 'search for my different projects in this folder and create multiple projects in this department';
    const result = await engine.executeDirective(prompt);

    expect(result.success).toBe(true);
    expect(result.createdDepartments).toBeUndefined();
    expect(result.createdProjects).toBeDefined();
    expect(result.createdProjects!.length).toBeGreaterThan(0);
    expect(result.createdProjects![0].departmentId).toBe(appDept.id);
    expect(appDept.linkedProjects.length).toBeGreaterThan(0);
    expect(result.finalSynthesis).not.toContain('multiple projects in this');
    expect(result.finalSynthesis).toContain('app development');
  });

  it('extracts department deletion intent and removes department', async () => {
    const hierarchy = createDefaultOrgHierarchy();
    const bogusDept = createDepartmentShell('multiple projects in this');
    hierarchy.departments.push(bogusDept);

    const prompt = 'delete department multiple projects in this';
    const intent = extractDepartmentDeletionIntent(prompt, hierarchy.departments);
    expect(intent).not.toBeNull();
    expect(intent?.department.id).toBe(bogusDept.id);

    const engine = new OrgDelegationEngine(hierarchy, undefined, undefined, undefined, { simulationMode: true });
    const result = await engine.executeDirective(prompt);
    expect(result.success).toBe(true);
    expect(result.deletedDepartmentIds).toContain(bogusDept.id);
    expect(hierarchy.departments.some((d) => d.id === bogusDept.id)).toBe(false);
  });

  it('extracts department creation when user says "start a app development department and choose folder to work with:"', () => {
    const prompt =
      'hi, start a app development department and choose folder to work with: G:\\My Drive\\Life\\Money\\Apps';
    const result = extractDepartmentCreationIntent(prompt);
    expect(result).not.toBeNull();
    expect(result?.name.toLowerCase()).toBe('app development');
    expect(result?.workspacePath).toBe('G:\\My Drive\\Life\\Money\\Apps');
  });

  it('extracts project discovery when user says "in app development department folder, i have multiple apps. make each app an project and add here"', () => {
    const hierarchy = createDefaultOrgHierarchy();
    const appDept = createDepartmentShell('app development');
    appDept.workspacePath = 'G:\\My Drive\\Life\\Money\\Apps';
    hierarchy.departments.push(appDept);

    const prompt = 'in app development department folder, i have multiple apps. make each app an project and add here';
    const result = extractProjectDiscoveryOrBatchIntent(prompt, hierarchy.departments);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('discover');
    expect(result?.targetDepartment.id).toBe(appDept.id);
    expect(result?.folderPath).toBe('G:\\My Drive\\Life\\Money\\Apps');
  });

  it('extracts project discovery using fallback path from conversation history if department has no path yet', () => {
    const hierarchy = createDefaultOrgHierarchy();
    const appDept = createDepartmentShell('app development');
    // Department has no workspacePath set yet
    hierarchy.departments.push(appDept);

    const prompt = 'in app development department folder, i have multiple apps. make each app an project and add here';
    const fallback = 'G:\\My Drive\\Life\\Money\\Apps';
    const result = extractProjectDiscoveryOrBatchIntent(prompt, hierarchy.departments, undefined, undefined, fallback);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('discover');
    expect(result?.targetDepartment.id).toBe(appDept.id);
    expect(result?.folderPath).toBe('G:\\My Drive\\Life\\Money\\Apps');
  });

  it('prefers fallbackPath over auto-generated departments path', () => {
    const hierarchy = createDefaultOrgHierarchy();
    const appDept = createDepartmentShell('app development');
    appDept.workspacePath = 'G:\\My Drive\\Life\\departments\\app-development';
    hierarchy.departments.push(appDept);

    const prompt = 'in app development department folder, i have multiple apps. make each app an project and add here';
    const fallback = 'G:\\My Drive\\Life\\Money\\Apps';
    const result = extractProjectDiscoveryOrBatchIntent(prompt, hierarchy.departments, undefined, undefined, fallback);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('discover');
    expect(result?.targetDepartment.id).toBe(appDept.id);
    expect(result?.folderPath).toBe('G:\\My Drive\\Life\\Money\\Apps');
  });

  it('extracts project discovery for "search for all apps and make a project of each app"', () => {
    const hierarchy = createDefaultOrgHierarchy();
    const appDept = createDepartmentShell('app development');
    appDept.workspacePath = 'G:\\My Drive\\Life\\Money\\Apps';
    hierarchy.departments.push(appDept);

    const prompt = 'search for all apps and make a project of each app';
    const result = extractProjectDiscoveryOrBatchIntent(prompt, hierarchy.departments);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('discover');
    expect(result?.targetDepartment.id).toBe(appDept.id);
  });

  it('executes directive from prompt with multiple apps and creates projects plus default core team without blocking', async () => {
    const hierarchy = createDefaultOrgHierarchy();
    const appDept = createDepartmentShell('app development');
    appDept.workspacePath = 'G:\\My Drive\\Life\\Money\\Apps';
    hierarchy.departments.push(appDept);

    const engine = new OrgDelegationEngine(hierarchy, undefined, undefined, undefined, { simulationMode: true });
    const prompt = 'in app development department folder, i have multiple apps. make each app an project and add here';
    const result = await engine.executeDirective(prompt);

    expect(result.success).toBe(true);
    expect(result.createdProjects).toBeDefined();
    expect(result.createdProjects!.length).toBeGreaterThan(0);
    expect(result.createdTeams).toBeDefined();
    expect(result.createdTeams![0].team.name).toBe('Core');
    expect(result.finalSynthesis).toContain('app development');
    expect(result.finalSynthesis).not.toContain('add a team');
  });
});
