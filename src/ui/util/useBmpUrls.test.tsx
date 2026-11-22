import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createMockRoot } from '../../test/mock-fs';
import { setRoot, clearRoot } from '../../storage/fs';
import { getOrCreatePath } from '../../storage/paths';
import { writeBlob } from '../../storage/atomic';
import { useBmpUrls } from './useBmpUrls';

const DIR = ['sites', 'S', 'surveys', 'V', 'lines', 'L1', 'device-files'];
const RAW = [...DIR, 'raw.png'].join('/');
const PROCESSED = [...DIR, 'processed.png'].join('/');

async function seed(root: FileSystemDirectoryHandle, files: Record<string, number> = { 'raw.png': 1, 'processed.png': 2 }) {
  const dir = await getOrCreatePath(root, DIR);
  for (const [name, byte] of Object.entries(files)) await writeBlob(dir, name, new Uint8Array([byte]));
  return dir;
}

// Counts File System Access calls made through any mock handle.
function counter(root: FileSystemDirectoryHandle) {
  const proto = Object.getPrototypeOf(root);
  const n = { dirs: 0, files: 0 };
  const dirs = proto.getDirectoryHandle, files = proto.getFileHandle;
  proto.getDirectoryHandle = function (...a: any[]) { n.dirs++; return dirs.apply(this, a); };
  proto.getFileHandle = function (...a: any[]) { n.files++; return files.apply(this, a); };
  return {
    n,
    reset: () => Object.assign(n, { dirs: 0, files: 0 }),
    restore: () => { proto.getDirectoryHandle = dirs; proto.getFileHandle = files; },
  };
}

const bytesOf = async (url: string) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())];

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  clearRoot();
  root = createMockRoot();
  await seed(root);
  setRoot(root);
});

describe('useBmpUrls', () => {
  it('loads every path in order', async () => {
    const { result } = renderHook(() => useBmpUrls([RAW, PROCESSED]));
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(await bytesOf(result.current[0])).toEqual([1]);
    expect(await bytesOf(result.current[1])).toEqual([2]);
  });

  it('walks the folder tree once for screens in the same folder', async () => {
    const c = counter(root);
    try {
      const { result } = renderHook(() => useBmpUrls([RAW, PROCESSED]));
      await waitFor(() => expect(result.current).toHaveLength(2));
      expect(c.n.dirs).toBe(DIR.length);
    } finally { c.restore(); }
  });

  it('serves a screen it has already loaded without touching the folder', async () => {
    const first = renderHook(() => useBmpUrls([RAW]));
    await waitFor(() => expect(first.result.current).toHaveLength(1));
    first.unmount();

    const c = counter(root);
    try {
      const again = renderHook(() => useBmpUrls([RAW]));
      await waitFor(() => expect(again.result.current).toHaveLength(1));
      expect(c.n).toEqual({ dirs: 0, files: 0 });
      expect(await bytesOf(again.result.current[0])).toEqual([1]);
    } finally { c.restore(); }
  });

  it('loads once folder access arrives after the screen was shown', async () => {
    clearRoot();
    const { result } = renderHook(() => useBmpUrls([RAW]));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toEqual([]);

    act(() => setRoot(root));
    await waitFor(() => expect(result.current).toHaveLength(1));
  });

  it('shows the screens that exist when one is missing', async () => {
    const missing = [...DIR, 'gone.png'].join('/');
    const { result } = renderHook(() => useBmpUrls([RAW, missing, PROCESSED]));
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(await bytesOf(result.current[1])).toEqual([2]);
  });

  it('finds a screen whose folder was replaced after it was cached', async () => {
    const first = renderHook(() => useBmpUrls([RAW]));
    await waitFor(() => expect(first.result.current).toHaveLength(1));
    first.unmount();

    const lines = (await getOrCreatePath(root, DIR.slice(0, -2)));
    await lines.removeEntry('L1', { recursive: true });
    await seed(root, { 'new.png': 7 });

    const { result } = renderHook(() => useBmpUrls([[...DIR, 'new.png'].join('/')]));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(await bytesOf(result.current[0])).toEqual([7]);
  });

  it('forgets everything when another folder is opened', async () => {
    const first = renderHook(() => useBmpUrls([RAW]));
    await waitFor(() => expect(first.result.current).toHaveLength(1));
    first.unmount();

    const other = createMockRoot('Other');
    await seed(other, { 'raw.png': 9 });
    act(() => setRoot(other));

    const { result } = renderHook(() => useBmpUrls([RAW]));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(await bytesOf(result.current[0])).toEqual([9]);
  });
});
