#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in MCP server for OS-level Desktop GUI Control ("aionui-desktop-control").
 * Runs as a standalone stdio process spawned by the MCP client (aioncore or external ACP agents).
 * Forwards tool execution to the Electron main process bridge via authenticated localhost HTTP.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BUILTIN_DESKTOP_CONTROL_NAME } from './constants';

const logDiagnostic = (message: string): void => {
  process.stderr.write(`[builtin-mcp-desktop-control] ${message}\n`);
};

type BridgeResponse = {
  success: boolean;
  tool?: string;
  data?: unknown;
  error?: string;
  durationMs?: number;
};

async function callDesktopBridge(tool: string, args: Record<string, unknown> = {}): Promise<BridgeResponse> {
  const port = process.env.AIONUI_DESKTOP_CONTROL_PORT;
  const token = process.env.AIONUI_DESKTOP_CONTROL_TOKEN;

  if (!port || !token) {
    return {
      success: false,
      error:
        'Desktop Control bridge is unavailable (missing AIONUI_DESKTOP_CONTROL_PORT or TOKEN). Restart AionUi if this persists.',
    };
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/desktop-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tool, args }),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        success: false,
        error: `Desktop Control bridge HTTP ${res.status}: ${text}`,
      };
    }

    return (await res.json()) as BridgeResponse;
  } catch (err) {
    return {
      success: false,
      error: `Desktop Control bridge communication failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function formatTextResponse(response: BridgeResponse) {
  if (!response.success) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ${response.error || 'Unknown error occurred during desktop control execution.'}`,
        },
      ],
      isError: true,
    };
  }

  const outputText =
    typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? { success: true }, null, 2);

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
  logDiagnostic('Starting aionui-desktop-control MCP server...');

  const server = new McpServer({
    name: BUILTIN_DESKTOP_CONTROL_NAME,
    version: '1.0.0',
  });

  server.tool(
    'desktop_screenshot',
    'Capture a screenshot of the user PC screen (physical pixel coordinates) along with display bounds and scale factors.',
    {
      displayIndex: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('0-based display index to capture (default 0, primary/first display).'),
    },
    async (args) => {
      const res = await callDesktopBridge('desktop_screenshot', args);
      if (!res.success || !res.data || typeof res.data !== 'object') {
        return formatTextResponse(res);
      }

      const shot = res.data as {
        base64: string;
        mimeType: string;
        width: number;
        height: number;
        scaleFactor: number;
        displayId: number;
        displayIndex: number;
        displays: unknown[];
      };

      const metadata = {
        width: shot.width,
        height: shot.height,
        scaleFactor: shot.scaleFactor,
        displayId: shot.displayId,
        displayIndex: shot.displayIndex,
        displays: shot.displays,
      };

      return {
        content: [
          {
            type: 'image' as const,
            data: shot.base64,
            mimeType: shot.mimeType || 'image/png',
          },
          {
            type: 'text' as const,
            text: JSON.stringify(metadata, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    'desktop_list_windows',
    'List visible top-level desktop windows on the PC with hwnd, title, processName, pid, bounds, and foreground state.',
    {},
    async () => {
      const res = await callDesktopBridge('desktop_list_windows', {});
      return formatTextResponse(res);
    }
  );

  server.tool(
    'desktop_focus_window',
    'Restore (if minimized) and bring a desktop window to the foreground by hwnd, partial title, or pid.',
    {
      hwnd: z.string().optional().describe('Hex window handle (e.g. "0x1A0B2C").'),
      title: z.string().optional().describe('Case-insensitive substring of the window title.'),
      pid: z.number().int().positive().optional().describe('Process ID of the target window.'),
    },
    async (args) => {
      const res = await callDesktopBridge('desktop_focus_window', args);
      return formatTextResponse(res);
    }
  );

  server.tool(
    'desktop_ui_tree',
    'Inspect native Windows UI Automation elements for the foreground or specified window, returning element names, types, and clickable center coordinates.',
    {
      hwnd: z.string().optional().describe('Optional hex window handle (defaults to foreground window).'),
      title: z.string().optional().describe('Optional case-insensitive window title substring.'),
      maxDepth: z.number().int().min(1).max(8).optional().describe('Maximum tree depth (1-8, default 4).'),
      maxNodes: z
        .number()
        .int()
        .min(10)
        .max(400)
        .optional()
        .describe('Maximum nodes to collect (10-400, default 120).'),
    },
    async (args) => {
      const res = await callDesktopBridge('desktop_ui_tree', args);
      return formatTextResponse(res);
    }
  );

  server.tool(
    'desktop_click',
    'Click the mouse at physical screen coordinates (x, y). Use desktop_screenshot or desktop_ui_tree first to locate targets accurately.',
    {
      x: z.number().describe('Physical screen X coordinate in pixels.'),
      y: z.number().describe('Physical screen Y coordinate in pixels.'),
      button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button (default "left").'),
      clickCount: z.number().int().min(1).max(3).optional().describe('Click count (1 for single, 2 for double).'),
    },
    async (args) => {
      const res = await callDesktopBridge('desktop_click', args);
      return formatTextResponse(res);
    }
  );

  server.tool(
    'desktop_move',
    'Move the mouse cursor to (x, y), or drag from (x, y) to (toX, toY).',
    {
      x: z.number().describe('Start or target X coordinate.'),
      y: z.number().describe('Start or target Y coordinate.'),
      drag: z.boolean().optional().describe('Set true to hold left button and drag to (toX, toY).'),
      toX: z.number().optional().describe('Destination X coordinate when drag=true.'),
      toY: z.number().optional().describe('Destination Y coordinate when drag=true.'),
    },
    async (args) => {
      const res = await callDesktopBridge('desktop_move', args);
      return formatTextResponse(res);
    }
  );

  server.tool(
    'desktop_type',
    'Type Unicode text into the currently focused desktop window or input field.',
    {
      text: z.string().min(1).describe('Text string to type.'),
    },
    async (args) => {
      const res = await callDesktopBridge('desktop_type', args);
      return formatTextResponse(res);
    }
  );

  server.tool(
    'desktop_hotkey',
    'Press a key or keyboard shortcut combination (e.g. ["Ctrl", "c"], ["Alt", "Tab"], ["Enter"]).',
    {
      keys: z
        .array(z.string())
        .min(1)
        .describe('Ordered list of key names to press together (e.g. ["Ctrl", "Shift", "s"] or ["Enter"]).'),
    },
    async (args) => {
      const res = await callDesktopBridge('desktop_hotkey', args);
      return formatTextResponse(res);
    }
  );

  server.tool(
    'desktop_scroll',
    'Scroll the mouse wheel vertically and/or horizontally (optionally moving to x, y first).',
    {
      x: z.number().optional().describe('Optional X coordinate to move cursor to before scrolling.'),
      y: z.number().optional().describe('Optional Y coordinate to move cursor to before scrolling.'),
      deltaY: z
        .number()
        .int()
        .optional()
        .describe('Vertical wheel delta in Win32 units (120 per notch up, -120 per notch down; default -360).'),
      deltaX: z.number().int().optional().describe('Horizontal wheel delta (default 0).'),
    },
    async (args) => {
      const res = await callDesktopBridge('desktop_scroll', args);
      return formatTextResponse(res);
    }
  );

  server.tool(
    'desktop_get_cursor',
    'Get the current physical screen coordinates (x, y) of the mouse cursor.',
    {},
    async () => {
      const res = await callDesktopBridge('desktop_get_cursor', {});
      return formatTextResponse(res);
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logDiagnostic('aionui-desktop-control MCP server connected.');
}

main().catch((err) => {
  logDiagnostic(`Fatal error: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  process.exit(1);
});
