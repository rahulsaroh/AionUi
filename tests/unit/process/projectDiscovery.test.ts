import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { discoverProjectsInFolder } from '../../../packages/desktop/src/process/services/org/projectDiscovery';

describe('discoverProjectsInFolder', () => {
  it('discovers projects with package.json or subfolders in target directory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-disc-test-'));

    try {
      const proj1 = path.join(tmpDir, 'webapp');
      fs.mkdirSync(proj1);
      fs.writeFileSync(path.join(proj1, 'package.json'), JSON.stringify({ name: 'my-cool-webapp' }));

      const proj2 = path.join(tmpDir, 'cli-tool');
      fs.mkdirSync(proj2);
      fs.writeFileSync(path.join(proj2, 'Cargo.toml'), '[package]\nname = "cli-tool"');

      const hiddenDir = path.join(tmpDir, '.git');
      fs.mkdirSync(hiddenDir);

      const ignoredDir = path.join(tmpDir, 'node_modules');
      fs.mkdirSync(ignoredDir);

      const results = await discoverProjectsInFolder(tmpDir, tmpDir);

      expect(results).toHaveLength(2);
      const names = results.map((r) => r.name);
      expect(names).toContain('my-cool-webapp');
      expect(names).toContain('cli-tool');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty array when target path is outside allowed root', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-disc-root-'));
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-disc-other-'));

    try {
      const results = await discoverProjectsInFolder(otherDir, tmpDir);
      expect(results).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});
