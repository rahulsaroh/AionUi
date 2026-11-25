/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'node:http';
import crypto from 'node:crypto';
import type { DesktopToolExecutionResult, DesktopToolName } from '@/common/desktopControl';
import { getDesktopControlService } from '@process/services/desktopControl';

type DesktopBridgeRequest = {
  tool: DesktopToolName;
  args?: Record<string, unknown>;
};

let bridgeServer: http.Server | null = null;
let bridgePort: number | null = null;
let bridgeToken: string | null = null;

/**
 * Starts the local authenticated HTTP bridge server for Desktop Control MCP.
 * Bound to 127.0.0.1 on an ephemeral port and protected by a per-session bearer token.
 */
export async function startDesktopControlBridgeServer(): Promise<{ port: number; token: string }> {
  if (bridgeServer && bridgePort && bridgeToken) {
    return { port: bridgePort, token: bridgeToken };
  }

  const token = crypto.randomBytes(24).toString('hex');
  bridgeToken = token;

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/desktop-tool') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${token}`) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: invalid authorization token' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body) as DesktopBridgeRequest;
        if (!payload || typeof payload.tool !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing tool name' }));
          return;
        }
        const result: DesktopToolExecutionResult = await getDesktopControlService().executeTool(
          payload.tool,
          payload.args || {}
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve(addr.port);
      } else {
        reject(new Error('Could not bind desktop control bridge server'));
      }
    });
  });

  bridgeServer = server;
  bridgePort = port;
  getDesktopControlService().setBridgePort(port);
  return { port, token };
}

export function getDesktopControlBridgeInfo(): { port: number; token: string } | null {
  if (bridgePort && bridgeToken) {
    return { port: bridgePort, token: bridgeToken };
  }
  return null;
}

export async function stopDesktopControlBridgeServer(): Promise<void> {
  getDesktopControlService().setBridgePort(null);
  if (bridgeServer) {
    await new Promise<void>((resolve) => {
      bridgeServer?.close(() => resolve());
    });
    bridgeServer = null;
    bridgePort = null;
    bridgeToken = null;
  }
}
