/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanFolderCompact, detectFolderTypeHint } from '@/process/services/org/scanFolder';
import { setMasterRootForTesting, resetMasterRoot } from '@/process/services/org/orgScope';

describe('scanFolderCompact & Project Type Hints (Step 3)', () => {
  let tempBase: string;
  let masterRoot: string;
  let outsideDir: string;

  beforeEach(() => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-folder-test-'));
    masterRoot = path.join(tempBase, 'company-hq');
    outsideDir = path.join(tempBase, 'outside-rogue');
    fs.mkdirSync(masterRoot, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    setMasterRootForTesting(masterRoot);
  });

  afterEach(() => {
    resetMasterRoot();
    try {
      fs.rmSync(tempBase, { recursive: true, force: true });
    } catch {}
  });

  it('fails closed when no master root is configured', async () => {
    resetMasterRoot();
    const result = await scanFolderCompact(masterRoot);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No organization master root is configured/);
  });

  it('refuses paths outside master root boundary', async () => {
    const result = await scanFolderCompact(outsideDir);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Access denied/);
  });

  it('handles missing or non-existent target folder gracefully', async () => {
    const nonExistent = path.join(masterRoot, 'ghost_folder');
    const result = await scanFolderCompact(nonExistent);
    expect(result.success).toBe(false);
    expect(result.exists).toBe(false);
    expect(result.error).toMatch(/does not exist/);
  });

  it('detects project type hints correctly from file lists', () => {
    expect(detectFolderTypeHint(['pubspec.yaml', 'lib/main.dart'])).toBe('Flutter app');
    expect(detectFolderTypeHint(['script.md', 'intro.txt'])).toBe('YouTube channel');
    expect(detectFolderTypeHint(['video_01.mp4', 'outro.mov'])).toBe('YouTube channel');
    expect(detectFolderTypeHint(['product.json', 'guide.txt'])).toBe('Digital product');
    expect(detectFolderTypeHint(['handbook.pdf'])).toBe('Digital product');
    expect(detectFolderTypeHint(['package.json', 'src/index.ts'])).toBe('Web app');
    expect(detectFolderTypeHint(['requirements.txt', 'main.py'])).toBe('Python project');
    expect(detectFolderTypeHint(['Cargo.toml', 'src/main.rs'])).toBe('Rust project');
    expect(detectFolderTypeHint(['go.mod', 'main.go'])).toBe('Go project');
    expect(detectFolderTypeHint(['random.txt', 'notes.csv'])).toBeUndefined();
  });

  it('scans multi-project master root and builds compact tree with type hints', async () => {
    // 1. Flutter app
    const flutterDir = path.join(masterRoot, 'flutter_app1');
    fs.mkdirSync(flutterDir, { recursive: true });
    fs.writeFileSync(path.join(flutterDir, 'pubspec.yaml'), 'name: flutter_app1\n');
    fs.writeFileSync(path.join(flutterDir, 'README.md'), '# Flutter App 1\nA mobile client for the company.');

    // 2. YouTube channel
    const ytDir = path.join(masterRoot, 'youtube_channel1');
    fs.mkdirSync(ytDir, { recursive: true });
    fs.writeFileSync(path.join(ytDir, 'script.md'), '# Episode 1 Script\n');
    fs.writeFileSync(path.join(ytDir, 'episode1.mp4'), 'fake-video');

    // 3. Digital product
    const productDir = path.join(masterRoot, 'digital_product1');
    fs.mkdirSync(productDir, { recursive: true });
    fs.writeFileSync(path.join(productDir, 'product.json'), '{"title": "AI Playbook"}');
    fs.writeFileSync(path.join(productDir, 'playbook.pdf'), 'fake-pdf');

    // 4. Ignored directories (node_modules, .git, build)
    const nodeModulesDir = path.join(masterRoot, 'node_modules');
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.writeFileSync(path.join(nodeModulesDir, 'package.json'), '{}');

    const gitDir = path.join(masterRoot, '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'config'), '');

    const result = await scanFolderCompact(masterRoot, { depth: 2 });
    expect(result.success).toBe(true);
    expect(result.tree).toBeDefined();

    const children = result.tree?.children ?? [];
    const childNames = children.map((c) => c.name);

    // Ignored directories should be skipped
    expect(childNames).not.toContain('node_modules');
    expect(childNames).not.toContain('.git');

    // Target projects should be discovered
    expect(childNames).toContain('flutter_app1');
    expect(childNames).toContain('youtube_channel1');
    expect(childNames).toContain('digital_product1');

    const flutterNode = children.find((c) => c.name === 'flutter_app1');
    expect(flutterNode?.typeHint).toBe('Flutter app');
    expect(flutterNode?.hasReadme).toBe(true);
    expect(flutterNode?.readmeSnippet).toContain('Flutter App 1');

    const ytNode = children.find((c) => c.name === 'youtube_channel1');
    expect(ytNode?.typeHint).toBe('YouTube channel');

    const prodNode = children.find((c) => c.name === 'digital_product1');
    expect(prodNode?.typeHint).toBe('Digital product');
  });

  it('caps depth at 3 even if higher depth is requested', async () => {
    // Create nested directory: level1/level2/level3/level4
    const deepPath = path.join(masterRoot, 'level1', 'level2', 'level3', 'level4');
    fs.mkdirSync(deepPath, { recursive: true });
    fs.writeFileSync(path.join(deepPath, 'leaf.txt'), 'deep');

    const result = await scanFolderCompact(masterRoot, { depth: 5 });
    expect(result.success).toBe(true);

    const level1 = result.tree?.children?.find((c) => c.name === 'level1');
    expect(level1).toBeDefined();
    const level2 = level1?.children?.find((c) => c.name === 'level2');
    expect(level2).toBeDefined();
    // Depth is capped at 3 (level1 is depth 2, level2 is depth 3; level2 should not have further children traversed)
    expect(level2?.children).toBeUndefined();
  });
});
