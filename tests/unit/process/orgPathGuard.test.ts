import { describe, it, expect } from 'vitest';
import { assertWithinScope } from '../../../packages/desktop/src/process/services/org/pathGuard';

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
  it('nonexistent path uses resolved (allowed if inside)', async () => {
    const r = await assertWithinScope('C:/proj/app1/nope.txt', 'C:/proj/app1');
    expect(r.allowed).toBe(true);
  });
});
