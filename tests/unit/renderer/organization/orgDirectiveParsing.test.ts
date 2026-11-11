import { describe, it, expect } from 'vitest';
import {
  extractDepartmentCreationIntent,
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
});
