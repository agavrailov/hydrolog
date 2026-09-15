import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { writeJson, readJson, writeBlob, readBlob, fileExists } from './atomic';

let root: FileSystemDirectoryHandle;
beforeEach(() => { root = createMockRoot(); });

describe('writeJson / readJson', () => {
  it('writes and reads back an object', async () => {
    await writeJson(root, 'x.json', { a: 1, b: 'hi' });
    const back = await readJson<{ a: number; b: string }>(root, 'x.json');
    expect(back).toEqual({ a: 1, b: 'hi' });
  });

  it('overwrites an existing file atomically', async () => {
    await writeJson(root, 'x.json', { v: 1 });
    await writeJson(root, 'x.json', { v: 2 });
    expect(await readJson<{ v: number }>(root, 'x.json')).toEqual({ v: 2 });
  });

  it('no .tmp file remains after a successful write', async () => {
    await writeJson(root, 'x.json', { a: 1 });
    expect(await fileExists(root, 'x.json.tmp')).toBe(false);
  });

  it('readJson throws on missing file', async () => {
    await expect(readJson(root, 'missing.json')).rejects.toThrow();
  });

  it('readJson throws on invalid JSON', async () => {
    const f = await root.getFileHandle('bad.json', { create: true });
    const w = await f.createWritable();
    await w.write('{not json');
    await w.close();
    await expect(readJson(root, 'bad.json')).rejects.toThrow();
  });
});

describe('writeBlob / readBlob', () => {
  it('round-trips a Uint8Array', async () => {
    await writeBlob(root, 'x.bin', new Uint8Array([1, 2, 3, 4]));
    const b = await readBlob(root, 'x.bin');
    const arr = new Uint8Array(await b.arrayBuffer());
    expect(Array.from(arr)).toEqual([1, 2, 3, 4]);
  });

  it('round-trips a Blob', async () => {
    await writeBlob(root, 'x.bin', new Blob(['hello']));
    const b = await readBlob(root, 'x.bin');
    expect(await b.text()).toBe('hello');
  });
});

describe('fileExists', () => {
  it('true for a written file, false otherwise', async () => {
    expect(await fileExists(root, 'x.json')).toBe(false);
    await writeJson(root, 'x.json', {});
    expect(await fileExists(root, 'x.json')).toBe(true);
  });
});
