#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in MCP server for Organization Management ("aionui-org").
 * Runs as a standalone stdio process spawned by the MCP client (e.g. ACP agent session).
 * Forwards tool execution to the main process bridge via authenticated HTTP.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BUILTIN_ORG_MCP_NAME } from './constants';

const logDiagnostic = (message: string): void => {
  process.stderr.write(`[builtin-mcp-org] ${message}\n`);
};

async function callBridgeTool(
  tool: string,
  args: Record<string, any>
): Promise<{ success: boolean; result?: any; error?: string }> {
  const port = process.env.AIONUI_ORG_BRIDGE_PORT;
  const token = process.env.AIONUI_ORG_BRIDGE_TOKEN;
  const role = process.env.AIONUI_ORG_ROLE || 'ceo';
  const deptId = process.env.AIONUI_ORG_DEPT_ID;
  const projectId = process.env.AIONUI_ORG_PROJECT_ID;
  const deptWorkspacePath = process.env.AIONUI_ORG_DEPT_WORKSPACE;
  const projectFolder = process.env.AIONUI_ORG_PROJECT_FOLDER || deptWorkspacePath;
  const approvalPolicy = process.env.AIONUI_ORG_APPROVAL_POLICY;

  if (!port || !token) {
    return {
      success: false,
      error: 'Organization bridge is unavailable (missing AIONUI_ORG_BRIDGE_PORT or TOKEN).',
    };
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/org-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tool,
        args,
        role,
        deptId,
        projectId,
        deptWorkspacePath,
        projectFolder,
        approvalPolicy,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        success: false,
        error: `Bridge HTTP ${res.status}: ${text}`,
      };
    }

    return (await res.json()) as { success: boolean; result?: any; error?: string };
  } catch (err) {
    return {
      success: false,
      error: `Bridge communication failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function formatToolResponse(response: { success: boolean; result?: any; error?: string }) {
  if (!response.success) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ${response.error || 'Unknown error occurred during tool execution.'}`,
        },
      ],
      isError: true,
    };
  }

  const outputText =
    typeof response.result === 'string'
      ? response.result
      : JSON.stringify(response.result ?? { success: true }, null, 2);

  return {
    content: [
      {
        type: 'text' as const,
        text: outputText,
      },
    ],
  };
}

async function main() {
  const role = process.env.AIONUI_ORG_ROLE || 'ceo';
  logDiagnostic(`Starting aionui-org MCP server for role="${role}"...`);

  const server = new McpServer({
    name: BUILTIN_ORG_MCP_NAME,
    version: '1.0.0',
  });

  // Tools available to CEO and Department Head
  if (role === 'ceo' || role === 'department_head') {
    server.tool(
      'scan_folder',
      'Scans a folder and returns a compact directory tree with domain/project-type hints (Flutter, YouTube, Digital Products, Web, Python). Refuses paths outside master root.',
      {
        path: z
          .string()
          .optional()
          .describe('Absolute path to folder to scan. If omitted, scans the root organization workspace.'),
        depth: z.number().int().min(1).max(3).optional().describe('Maximum traversal depth (1-3, default: 2).'),
        maxEntries: z
          .number()
          .int()
          .min(10)
          .max(500)
          .optional()
          .describe('Maximum directory entries to inspect (default: 100, max: 500).'),
      },
      async (args) => {
        const res = await callBridgeTool('scan_folder', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'create_project',
      'Creates a new project under a department, bound to an app or product folder.',
      {
        departmentId: z.string().describe('ID of the parent department'),
        name: z.string().describe('Name of the project (e.g. Flutter Mobile App, Video Production)'),
        folder: z.string().describe('Absolute directory path on disk for this project'),
        goal: z.string().optional().describe('Primary objective or charter for the project'),
        memberIds: z.array(z.string()).optional().describe('IDs of shared members to assign to this project'),
      },
      async (args) => {
        const res = await callBridgeTool('create_project', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'assign_member',
      'Assigns an existing member from the shared pool to a project.',
      {
        projectId: z.string().describe('Target project ID'),
        memberId: z.string().describe('ID of member from shared pool'),
      },
      async (args) => {
        const res = await callBridgeTool('assign_member', args);
        return formatToolResponse(res);
      }
    );
  }

  // Tools exclusive to Root CEO
  if (role === 'ceo') {
    server.tool(
      'create_department',
      'Creates a new department bound to a specific local directory under master root.',
      {
        name: z.string().describe('Name of the department (e.g. App Builder, YouTube Automation, Digital Products)'),
        folder: z.string().describe('Absolute directory path on disk bound to this department'),
        description: z.string().optional().describe('Charter and responsibilities of the department'),
      },
      async (args) => {
        const res = await callBridgeTool('create_department', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'hire_member',
      'Adds a new autonomous agent specialist to the shared organizational member pool.',
      {
        name: z.string().describe('Member name (e.g. Alex Rivera)'),
        role: z.string().describe('Specialty or role (e.g. flutter-specialist, video-editor, copywriter, qa-engineer)'),
        skills: z.array(z.string()).optional().describe('Technical or creative skills'),
        systemPrompt: z.string().optional().describe('Custom system instructions for this member'),
      },
      async (args) => {
        const res = await callBridgeTool('hire_member', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'propose_structure',
      'Proposes organizational structure (departments, projects, suggested members) to the user for review. Renders an interactive proposal card with Approve/Edit/Reject. Creates NOTHING until the user approves.',
      {
        departments: z
          .array(
            z.object({
              name: z.string().describe('Department name'),
              folder: z.string().describe('Department folder path'),
              description: z.string().optional().describe('Department description'),
              projects: z
                .array(
                  z.object({
                    name: z.string().describe('Project name'),
                    folder: z.string().describe('Project folder path'),
                    description: z.string().optional().describe('Project description'),
                  })
                )
                .optional(),
            })
          )
          .describe('Proposed departments and their sub-projects'),
        suggestedMembers: z
          .array(
            z.object({
              name: z.string().describe('Specialist name'),
              role: z.string().describe('Role / specialty'),
            })
          )
          .optional()
          .describe('Suggested members to hire for this structure'),
      },
      async (args) => {
        const res = await callBridgeTool('propose_structure', args);
        return formatToolResponse(res);
      }
    );
  }

  // Execution tools (shell + file ops) available to Project Heads and specialist members.
  // These run strictly inside the agent's assigned project folder in the main process,
  // gated by the per-project approval policy (read_only | auto_edit | full_auto) and the
  // folder jail. The Root CEO (role === 'ceo') intentionally does NOT get these tools.
  if (role === 'project_head') {
    server.tool(
      'list_dir',
      'Lists the immediate files and subdirectories of a folder inside the project workspace. Free (read-only).',
      {
        path: z
          .string()
          .optional()
          .describe('Absolute path to a folder inside the project workspace. Defaults to the project root.'),
      },
      async (args) => {
        const res = await callBridgeTool('list_dir', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'read_file',
      'Reads a UTF-8 text file inside the project workspace. Free (read-only). Sensitive files (e.g. .env, keys) require user approval.',
      {
        path: z.string().describe('Absolute path to the file inside the project workspace.'),
      },
      async (args) => {
        const res = await callBridgeTool('read_file', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'write_file',
      'Creates or overwrites a UTF-8 text file inside the project workspace. Whether this needs approval depends on the project approval policy.',
      {
        path: z.string().describe('Absolute path to the file inside the project workspace.'),
        content: z.string().describe('Full new UTF-8 content of the file.'),
      },
      async (args) => {
        const res = await callBridgeTool('write_file', args);
        return formatToolResponse(res);
      }
    );

    server.tool(
      'run_shell',
      'Runs a shell command with the project workspace as the working directory. Approval depends on the project policy (auto_edit asks, full_auto allows in-folder safe commands). Commands touching paths outside the folder or performing destructive/system actions always require approval. Returns exitCode, stdout, stderr.',
      {
        command: z.string().describe('Shell command to execute.'),
        cwd: z
          .string()
          .optional()
          .describe('Working directory inside the project workspace. Defaults to the project root.'),
        timeoutMs: z.number().int().min(1000).max(300000).optional().describe('Timeout in ms (1s-5min, default 60s).'),
      },
      async (args) => {
        const res = await callBridgeTool('run_shell', args);
        return formatToolResponse(res);
      }
    );
  }

  // Tools available to all roles (CEO, Dept Head, Project Head)
  server.tool(
    'list_org',
    'Lists the full current organization state including departments, projects, and active shared members.',
    {},
    async () => {
      const res = await callBridgeTool('list_org', {});
      return formatToolResponse(res);
    }
  );

  server.tool(
    'assign_task',
    'Delegates an execution task to a specific project lead or department. If new team members should be recruited, pass approved_lineup_id after getting explicit user approval first.',
    {
      project_id: z.string().optional().describe('ID or name of target project'),
      target: z.string().optional().describe('Target project ID or department (alias for project_id)'),
      text: z.string().optional().describe('Clear, actionable technical directive for execution'),
      task: z.string().optional().describe('Clear, actionable directive for execution (alias for text)'),
      approved_lineup_id: z
        .string()
        .optional()
        .describe(
          'ID of the user-approved lineup (from proposal approval or ask_user reply). Pass this id exactly as received.'
        ),
      approved_lineup: z
        .union([
          z.string(),
          z.array(
            z.union([
              z.string(),
              z.object({
                name: z.string(),
                assistant: z.string(),
              }),
            ])
          ),
        ])
        .optional()
        .describe(
          'Deprecated fallback: User-approved lineup for member recruitment. Prefer passing approved_lineup_id.'
        ),
    },
    async (args) => {
      const res = await callBridgeTool('assign_task', args);
      return formatToolResponse(res);
    }
  );

  server.tool(
    'get_project_status',
    'Retrieves the current execution run state, active agent turns, and mailbox messages for a project team.',
    {
      project_id: z.string().describe('Target project ID'),
    },
    async (args) => {
      const res = await callBridgeTool('get_project_status', args);
      return formatToolResponse(res);
    }
  );

  server.tool(
    'list_project_tasks',
    'Lists the current tasks and their execution status (completed, in_progress, blocked) for a project team.',
    {
      project_id: z.string().describe('Target project ID'),
    },
    async (args) => {
      const res = await callBridgeTool('list_project_tasks', args);
      return formatToolResponse(res);
    }
  );

  server.tool(
    'get_status',
    'Retrieves current organization status, active projects, and telemetry from across the company.',
    {},
    async () => {
      const res = await callBridgeTool('get_status', {});
      return formatToolResponse(res);
    }
  );

  server.tool(
    'ask_user',
    'Asks the user a clarifying question when an executive directive or folder structure is ambiguous.',
    {
      question: z.string().describe('Question to present to the user'),
    },
    async (args) => {
      const res = await callBridgeTool('ask_user', args);
      return formatToolResponse(res);
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logDiagnostic('Connected to stdio transport successfully.');
}

main().catch((err) => {
  logDiagnostic(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
