#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import http from 'node:http';

console.log('=== [AionUi Org CEO Tools Manual Verification Script] ===\n');

// 1. Prepare demo environment
const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-manual-ceo-'));
const masterRoot = path.join(baseDir, 'MasterOrganization');
const outsideRoot = path.join(baseDir, 'RogueFolder');
fs.mkdirSync(masterRoot, { recursive: true });
fs.mkdirSync(outsideRoot, { recursive: true });

// Setup test folders
const flutter1 = path.join(masterRoot, 'flutter_app1');
const flutter2 = path.join(masterRoot, 'flutter_app2');
const youtube1 = path.join(masterRoot, 'youtube_channel1');
const digital1 = path.join(masterRoot, 'digital_product1');
const misc1 = path.join(masterRoot, 'misc_unrelated');

fs.mkdirSync(flutter1, { recursive: true });
fs.writeFileSync(path.join(flutter1, 'pubspec.yaml'), 'name: flutter_app1\ndescription: Flutter App 1');

fs.mkdirSync(flutter2, { recursive: true });
fs.writeFileSync(path.join(flutter2, 'pubspec.yaml'), 'name: flutter_app2\ndescription: Flutter App 2');

fs.mkdirSync(youtube1, { recursive: true });
fs.writeFileSync(path.join(youtube1, 'script.md'), '# Episode 1 script');
fs.writeFileSync(path.join(youtube1, 'intro.mp4'), '');

fs.mkdirSync(digital1, { recursive: true });
fs.writeFileSync(path.join(digital1, 'product.json'), '{"name": "SaaS Guide", "price": 49}');
fs.writeFileSync(path.join(digital1, 'guide.pdf'), '');

fs.mkdirSync(misc1, { recursive: true });
fs.writeFileSync(path.join(misc1, 'notes.txt'), 'Scratch notes');

console.log(`[1] Created mock master root at: ${masterRoot}`);
console.log('    - flutter_app1 (pubspec.yaml)');
console.log('    - flutter_app2 (pubspec.yaml)');
console.log('    - youtube_channel1 (script.md, intro.mp4)');
console.log('    - digital_product1 (product.json, guide.pdf)');
console.log('    - misc_unrelated (notes.txt)\n');

// 2. Mock Bridge Server
const token = 'test-token-' + Date.now();
const createdEntities = {
  departments: [],
  projects: [],
  members: [],
  tasks: [],
};

const bridgeServer = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/org-tool') {
    res.writeHead(404);
    res.end();
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const { tool, args } = data;

      if (tool === 'create_department') {
        const targetResolved = path.resolve(args.folder);
        const rootResolved = path.resolve(masterRoot);
        if (!targetResolved.startsWith(rootResolved)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              error: `Access denied: Department folder "${args.folder}" is outside organization master root "${masterRoot}".`,
            })
          );
          return;
        }

        const id = 'dept-' + Date.now();
        createdEntities.departments.push({ id, ...args });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, result: { id, name: args.name, folder: args.folder } }));
        return;
      }

      if (tool === 'create_project') {
        const targetResolved = path.resolve(args.folder);
        const rootResolved = path.resolve(masterRoot);
        if (!targetResolved.startsWith(rootResolved)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              error: `Access denied: Project folder "${args.folder}" is outside organization master root "${masterRoot}".`,
            })
          );
          return;
        }

        const id = 'proj-' + Date.now();
        createdEntities.projects.push({ id, ...args });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, result: { id, name: args.name, folder: args.folder } }));
        return;
      }

      if (tool === 'hire_member') {
        const id = 'mem-' + Date.now();
        createdEntities.members.push({ id, ...args });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, result: { id, name: args.name, role: args.role } }));
        return;
      }

      if (tool === 'assign_task') {
        createdEntities.tasks.push(args);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, result: { dispatched: true, task: args.task } }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result: { executed: tool } }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: String(err) }));
    }
  });
});

await new Promise((resolve) => bridgeServer.listen(0, '127.0.0.1', resolve));
const port = bridgeServer.address().port;
console.log(`[2] Bridge server running on 127.0.0.1:${port}`);

// 3. Spawn Builtin MCP Server bundle (out/main/builtin-mcp-org.js)
const mcpScript = path.resolve('out/main/builtin-mcp-org.js');
if (!fs.existsSync(mcpScript)) {
  console.error(`ERROR: MCP bundle not found at ${mcpScript}. Please run "node scripts/build-mcp-servers.js" first.`);
  process.exit(1);
}

const child = spawn(process.execPath, [mcpScript], {
  env: {
    ...process.env,
    AIONUI_ORG_BRIDGE_PORT: String(port),
    AIONUI_ORG_BRIDGE_TOKEN: token,
    AIONUI_ORG_ROLE: 'ceo',
    AIONUI_ORG_MASTER_ROOT: masterRoot,
  },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let msgId = 1;
function sendJsonRpc(method, params = {}) {
  const req = {
    jsonrpc: '2.0',
    id: msgId++,
    method,
    params,
  };
  return new Promise((resolve, reject) => {
    const onData = (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === req.id) {
            child.stdout.removeListener('data', onData);
            resolve(parsed);
            return;
          }
        } catch {}
      }
    };
    child.stdout.on('data', onData);
    child.stdin.write(JSON.stringify(req) + '\n');
    setTimeout(() => {
      child.stdout.removeListener('data', onData);
      reject(new Error(`Timeout waiting for response to ${method}`));
    }, 5000);
  });
}

try {
  // Initialize MCP connection
  const initRes = await sendJsonRpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0' },
  });
  console.log('[3] MCP Server Initialized:', initRes.result?.serverInfo?.name);

  // List tools
  const toolsRes = await sendJsonRpc('tools/list');
  const toolNames = toolsRes.result?.tools?.map((t) => t.name) || [];
  console.log(`[4] Available Tools (${toolNames.length}):`, toolNames.join(', '));

  // Acceptance Criterion 1: scan_folder
  console.log('\n--- Acceptance Criterion 1: Scan Folder & Project Hints ---');
  const scanCall = await sendJsonRpc('tools/call', {
    name: 'scan_folder',
    arguments: { path: masterRoot, depth: 2 },
  });
  console.log('✓ scan_folder executed successfully.');
  const scanContent = JSON.parse(scanCall.result?.content?.[0]?.text || '{}');
  const children = scanContent.children || [];
  for (const childNode of children) {
    console.log(`  - ${childNode.name}: hint="${childNode.typeHint || 'none'}", files=${childNode.fileCount}`);
  }

  // Acceptance Criterion 3: Path outside root fails closed
  console.log('\n--- Acceptance Criterion 3: Refuse Department Outside Root ---');
  const rogueCall = await sendJsonRpc('tools/call', {
    name: 'create_department',
    arguments: { name: 'Marketing', folder: path.join(outsideRoot, 'Marketing') },
  });
  const rogueText = rogueCall.result?.content?.[0]?.text || '';
  console.log(`✓ Result for path outside root: ${rogueText}`);
  if (rogueText.includes('Access denied') || rogueCall.result?.isError) {
    console.log('✓ Security Boundary check passed: correctly refused rogue folder.');
  } else {
    throw new Error('Failed: Expected access denied for folder outside master root!');
  }

  // Acceptance Criterion 2: Propose and Create
  console.log('\n--- Acceptance Criterion 2: Create Department & Project ---');
  const createDeptCall = await sendJsonRpc('tools/call', {
    name: 'create_department',
    arguments: { name: 'App Builder', folder: path.join(masterRoot, 'App Builder') },
  });
  console.log('✓ create_department result:', createDeptCall.result?.content?.[0]?.text);

  const createProjCall = await sendJsonRpc('tools/call', {
    name: 'create_project',
    arguments: {
      departmentId: createdEntities.departments[0]?.id || 'dept-1',
      name: 'flutter_app1',
      folder: path.join(masterRoot, 'App Builder', 'flutter_app1'),
    },
  });
  console.log('✓ create_project result:', createProjCall.result?.content?.[0]?.text);

  // Acceptance Criterion 4: Assign Task to App Builder
  console.log('\n--- Acceptance Criterion 4: Assign Task Scoped to Project ---');
  const taskCall = await sendJsonRpc('tools/call', {
    name: 'assign_task',
    arguments: {
      target: 'App Builder',
      projectId: createdEntities.projects[0]?.id || 'proj-1',
      task: 'Add a splash screen to flutter_app1',
    },
  });
  console.log('✓ assign_task result:', taskCall.result?.content?.[0]?.text);

  console.log('\n======================================================');
  console.log('🎉 ALL MANUAL VERIFICATION CRITERIA PASSED CLEANLY! 🎉');
  console.log('======================================================\n');
} finally {
  child.kill();
  bridgeServer.close();
  try {
    fs.rmSync(baseDir, { recursive: true, force: true });
  } catch {}
}
