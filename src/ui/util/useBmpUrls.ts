import { useState, useEffect, useSyncExternalStore } from 'react';
import { readBlob } from '../../storage/atomic';
import { peekRoot, subscribeRoot } from '../../storage/fs';

// On Android every File System Access call is a round trip through a content
// provider, so device screens are cached for the opened folder: each directory is
// resolved once, and a screen read once stays available while the app is open.
// Screens are stored verbatim and never rewritten, so a path's bytes do not change.
let cacheRoot: FileSystemDirectoryHandle | null = null;
const dirs = new Map<string, Promise<FileSystemDirectoryHandle>>();
const urls = new Map<string, Promise<string | null>>();

function resetForRoot(root: FileSystemDirectoryHandle): void {
  if (root === cacheRoot) return;
  for (const u of urls.values()) void u.then((url) => url && URL.revokeObjectURL(url));
  dirs.clear();
  urls.clear();
  cacheRoot = root;
}

function dirOf(root: FileSystemDirectoryHandle, segments: string[]): Promise<FileSystemDirectoryHandle> {
  if (segments.length === 0) return Promise.resolve(root);
  const key = segments.join('/');
  const cached = dirs.get(key);
  if (cached) return cached;
  const p = dirOf(root, segments.slice(0, -1))
    .then((parent) => parent.getDirectoryHandle(segments[segments.length - 1]));
  dirs.set(key, p);
  p.catch(() => { if (dirs.get(key) === p) dirs.delete(key); });
  return p;
}

async function read(root: FileSystemDirectoryHandle, path: string): Promise<string | null> {
  const parts = path.split('/');
  const name = parts.pop()!;
  const attempt = async () => URL.createObjectURL(await readBlob(await dirOf(root, parts), name));
  try {
    return await attempt();
  } catch {
    // A cached folder may have been moved or replaced (sync, tombstoning): walk again.
    for (let i = 1; i <= parts.length; i++) dirs.delete(parts.slice(0, i).join('/'));
    try {
      return await attempt();
    } catch {
      return null;
    }
  }
}

function urlFor(root: FileSystemDirectoryHandle, path: string): Promise<string | null> {
  resetForRoot(root);
  const cached = urls.get(path);
  if (cached) return cached;
  const p = read(root, path);
  urls.set(path, p);
  // A missing screen may still be on its way through sync: do not remember the miss.
  void p.then((url) => { if (!url && urls.get(path) === p) urls.delete(path); });
  return p;
}

export function useBmpUrls(storagePaths: string[]): string[] {
  const root = useSyncExternalStore(subscribeRoot, peekRoot);
  const [loaded, setLoaded] = useState<string[]>([]);
  const key = storagePaths.join('|');

  useEffect(() => {
    if (!root || storagePaths.length === 0) {
      setLoaded([]);
      return;
    }
    let live = true;
    void Promise.all(storagePaths.map((p) => urlFor(root, p))).then((found) => {
      if (live) setLoaded(found.filter((u): u is string => !!u));
    });
    return () => { live = false; };
  }, [key, root]); // eslint-disable-line react-hooks/exhaustive-deps

  return loaded;
}
