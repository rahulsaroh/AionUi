import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertWithinScope } from '../../../packages/desktop/src/process/services/org/pathGuard';

const tempRoots: string[] = [];

function mkTempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-org-scope-'));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures in tests
    }
  }
});

describe('assertWithinScope', () => {
  it('allows child path', async () => {
    const r = await assertWithinScope('C:/proj/app1/sub/file.txt', 'C:/proj/app1');
    expect(r.allowed).toBe(true);
  });

  it('rejects .. traversal', async () => {
    const r = await assertWithinScope('C:/proj/app1/../app10/x.txt', 'C:/proj/app1');
    expect(r.allowed).toBe(false);
  });

  it('rejects absolute outside', async () => {
    const r = await assertWithinScope('D:/other/x.txt', 'C:/proj/app1');
    expect(r.allowed).toBe(false);
  });

  it('rejects sibling prefix app1 vs app10', async () => {
    const r = await assertWithinScope('C:/proj/app10/x.txt', 'C:/proj/app1');
    expect(r.allowed).toBe(false);
  });

  it('Windows case differences allowed', async () => {
    const r = await assertWithinScope('C:/PROJ/App1/X.TXT', 'c:/proj/app1');
    expect(r.allowed).toBe(true);
  });

  it('trailing slashes allowed', async () => {
    const r = await assertWithinScope('C:/proj/app1/x.txt/', 'C:/proj/app1/');
    expect(r.allowed).toBe(true);
  });

  it('empty path rejected', async () => {
    const r = await assertWithinScope('', 'C:/proj/app1');
    expect(r.allowed).toBe(false);
  });

  it('nonexistent target inside root allowed (resolved via existing parent)', async () => {
    const root = mkTempRoot();
    const target = path.join(root, 'nested', 'nope.txt');
    const r = await assertWithinScope(target, root);
    expect(r.allowed).toBe(true);
  });

  it('nonexistent target outside root rejected', async () => {
    const root = mkTempRoot();
    const outside = path.join(path.dirname(root), 'outside', 'nope.txt');
    const r = await assertWithinScope(outside, root);
    expect(r.allowed).toBe(false);
  });

  it('rejects symlink escape when target exists', async () => {
    const root = mkTempRoot();
    const outside = mkTempRoot();
    const insideDir = path.join(root, 'inside');
    fs.mkdirSync(insideDir, { recursive: true });
    const linkPath = path.join(insideDir, 'escape-link');
    try {
      fs.symlinkSync(outside, linkPath, 'junction');
    } catch {
      // Symlink/junction creation may be restricted in some environments.
      return;
    }
    const r = await assertWithinScope(path.join(linkPath, 'secret.txt'), root);
    expect(r.allowed).toBe(false);
  });

  it('rejects symlink escape via nonexistent child under symlinked parent', async () => {
    const root = mkTempRoot();
    const outside = mkTempRoot();
    const insideDir = path.join(root, 'inside');
    fs.mkdirSync(insideDir, { recursive: true });
    const linkPath = path.join(insideDir, 'escape-link');
    try {
      fs.symlinkSync(outside, linkPath, 'junction');
    } catch {
      // Symlink/junction creation may be restricted in some environments.
      return;
    }
    const r = await assertWithinScope(path.join(linkPath, 'nonexistent', 'secret.txt'), root);
    expect(r.allowed).toBe(false);
  });
});
