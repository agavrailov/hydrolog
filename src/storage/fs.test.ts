import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import {
  setFsAdapter, pickRootFolder,
  persistRoot, getPersistedRoot, clearPersistedRoot,
  verifyPermission,
} from './fs';

beforeEach(async () => {
  await clearPersistedRoot();
});

describe('fs wrapper', () => {
  it('pickRootFolder delegates to the adapter', async () => {
    const root = createMockRoot();
    setFsAdapter({ showDirectoryPicker: async () => root });
    const picked = await pickRootFolder();
    expect(picked).toBe(root);
  });

  it('persistRoot + getPersistedRoot round-trip', async () => {
    const root = createMockRoot();
    await persistRoot(root);
    const got = await getPersistedRoot();
    // IndexedDB deserialization may lose prototype; check the object is structurally equal
    expect(got).toEqual(root);
    // Verify it's actually a FileSystemDirectoryHandle (or mock thereof)
    expect(got).not.toBeNull();
  });

  it('getPersistedRoot returns null when never persisted', async () => {
    const got = await getPersistedRoot();
    expect(got).toBeNull();
  });

  it('verifyPermission returns true for a mock handle (always granted)', async () => {
    const root = createMockRoot();
    expect(await verifyPermission(root)).toBe(true);
  });
});
