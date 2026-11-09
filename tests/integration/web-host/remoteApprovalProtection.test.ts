/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { startStaticServer, type StaticServerHandle } from '../../../packages/web-host/src/static-server';

async function mkRendererFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-remote-approval-'));
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><title>root</title>');
  return dir;
}

async function startMockBackend(): Promise<{
  port: number;
  received: Array<{ url: string; body: string }>;
  close: () => Promise<void>;
}> {
  const received: Array<{ url: string; body: string }> = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({
        url: req.url ?? '',
        body: Buffer.concat(chunks).toString('utf-8'),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    received,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe('Remote Web-Host Approval Protection', () => {
  let handle: StaticServerHandle | null = null;
  let backend: { port: number; received: Array<{ url: string; body: string }>; close: () => Promise<void> } | null =
    null;
  let staticDir = '';

  beforeEach(async () => {
    staticDir = await mkRendererFixture();
    backend = await startMockBackend();
    handle = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      allowRemote: true,
    });
  });

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = null;
    }
    if (backend) {
      await backend.close();
      backend = null;
    }
    await fs.rm(staticDir, { recursive: true, force: true });
  });

  it('rejects remote session attempting to approve action forbidden by autonomy profile (403 Forbidden)', async () => {
    const url = `http://127.0.0.1:${handle!.port}/api/conversations/conv-1/confirmations/call-1/confirm`;

    // Attempt to approve a spend action as remote session
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-remote-session': 'true',
        'x-action-category': 'spend',
      },
      body: JSON.stringify({
        msg_id: 'msg-1',
        data: { value: 'proceed_once' },
      }),
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe('REMOTE_APPROVAL_FORBIDDEN');
    // Backend should never receive the forbidden approval!
    expect(backend!.received).toHaveLength(0);
  });

  it('rejects remote session attempting to approve deleting outside project folder', async () => {
    const url = `http://127.0.0.1:${handle!.port}/api/conversations/conv-1/confirmations/call-2/confirm`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-remote-session': 'true',
        'x-action-category': 'file_delete',
        'x-action-outside': 'true',
      },
      body: JSON.stringify({
        msg_id: 'msg-2',
        data: { value: 'proceed_once' },
      }),
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe('REMOTE_APPROVAL_FORBIDDEN');
    expect(backend!.received).toHaveLength(0);
  });

  it('allows remote session to approve an action permitted by the profile', async () => {
    const url = `http://127.0.0.1:${handle!.port}/api/conversations/conv-1/confirmations/call-3/confirm`;

    // Safe inside-workspace action under autopilot profile
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-remote-session': 'true',
        'x-action-category': 'file_write',
        'x-action-outside': 'false',
        'x-autonomy-profile': 'autopilot',
      },
      body: JSON.stringify({
        msg_id: 'msg-3',
        data: { value: 'proceed_once' },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(backend!.received).toHaveLength(1);
    expect(backend!.received[0].url).toContain('/confirm');
  });
});
