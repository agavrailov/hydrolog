import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';

const ROOT_HANDLE_KEY = 'hydrolog.rootHandle.v1';

export interface FsAdapter {
  showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
}

let adapter: FsAdapter = {
  showDirectoryPicker: async () => {
    if (typeof (globalThis as any).showDirectoryPicker !== 'function') {
      throw new Error('File System Access API not available. Use Chrome desktop or Android M132+.');
    }
    return (globalThis as any).showDirectoryPicker({ mode: 'readwrite' });
  },
};

export function setFsAdapter(a: FsAdapter): void {
  adapter = a;
}

export async function pickRootFolder(): Promise<FileSystemDirectoryHandle> {
  return adapter.showDirectoryPicker();
}

export async function persistRoot(handle: FileSystemDirectoryHandle): Promise<void> {
  await idbSet(ROOT_HANDLE_KEY, handle);
}

export async function getPersistedRoot(): Promise<FileSystemDirectoryHandle | null> {
  const h = (await idbGet(ROOT_HANDLE_KEY)) as FileSystemDirectoryHandle | undefined;
  if (!h) return null;
  return h;
}

export async function clearPersistedRoot(): Promise<void> {
  await idbDel(ROOT_HANDLE_KEY);
}

export async function verifyPermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<boolean> {
  const opts = { mode } as { mode: 'read' | 'readwrite' };
  // @ts-expect-error queryPermission is on real handles; mock provides it.
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  // @ts-expect-error requestPermission is on real handles; mock provides it.
  return (await handle.requestPermission?.(opts)) === 'granted';
}

let currentRoot: FileSystemDirectoryHandle | null = null;

export function setRoot(handle: FileSystemDirectoryHandle): void {
  currentRoot = handle;
}

export function getRoot(): FileSystemDirectoryHandle {
  if (!currentRoot) {
    throw new Error('root folder not set — call setRoot() after picking a folder');
  }
  return currentRoot;
}

export function clearRoot(): void {
  currentRoot = null;
}
