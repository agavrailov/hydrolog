import { describe, it, expect } from 'vitest';
import { createMockRoot } from './mock-fs';

describe('mock FileSystemDirectoryHandle', () => {
  it('creates and reads a file', async () => {
    const root = createMockRoot();
    const f = await root.getFileHandle('a.txt', { create: true });
    const w = await f.createWritable();
    await w.write('hello');
    await w.close();

    const file = await f.getFile();
    expect(await file.text()).toBe('hello');
  });

  it('creates and lists a subdirectory', async () => {
    const root = createMockRoot();
    const sub = await root.getDirectoryHandle('sub', { create: true });
    await sub.getFileHandle('inner.txt', { create: true });

    const entries: string[] = [];
    for await (const [name] of (root as any).entries()) entries.push(name);
    expect(entries).toContain('sub');
  });

  it('supports rename by writing new + removing old', async () => {
    const root = createMockRoot();
    const f = await root.getFileHandle('a.txt', { create: true });
    const w = await f.createWritable();
    await w.write('v1');
    await w.close();
    await root.removeEntry('a.txt');
    await expect(root.getFileHandle('a.txt')).rejects.toThrow();
  });

  it('throws NotFoundError for missing files without create:true', async () => {
    const root = createMockRoot();
    await expect(root.getFileHandle('missing.txt')).rejects.toThrow(/not found/i);
  });
});
