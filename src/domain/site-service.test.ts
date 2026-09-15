import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { readJson, fileExists } from '../storage/atomic';
import { getPath } from '../storage/paths';
import { createSite, updateSite, softDeleteSite, restoreSite } from './site-service';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

describe('createSite', () => {
  it('creates site.json, generates a code, populates the cache', async () => {
    const site = await createSite({
      name: 'Ivanov',
      settlement: 'Долна Баня',
      municipality: 'Долна Баня',
      region: 'Софийска',
      centroid: { lat: 42.32, lon: 23.78 },
      accessNotes: '',
      landUse: '',
      status: 'surveyed',
      tags: [],
    });
    expect(site.code).toBe('BG-SOF-0001');
    expect(site.revision).toBe(1);
    expect(site.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    // Folder written
    const siteDir = await getPath(root, ['sites', 'BG-SOF-0001_Ivanov']);
    expect(siteDir).not.toBeNull();
    expect(await fileExists(siteDir!, 'site.json')).toBe(true);

    // Cache populated
    const row = await getDb().sites.get(site.id);
    expect(row?.code).toBe('BG-SOF-0001');
    expect(row?.folderName).toBe('BG-SOF-0001_Ivanov');
  });

  it('assigns sequential codes within the same region', async () => {
    const a = await createSite({
      name: 'A', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    const b = await createSite({
      name: 'B', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    expect(a.code).toBe('BG-SOF-0001');
    expect(b.code).toBe('BG-SOF-0002');
  });
});

describe('updateSite', () => {
  it('bumps updatedAt and revision, rewrites site.json', async () => {
    const site = await createSite({
      name: 'x', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    const originalUpdated = site.updatedAt;
    // Ensure a measurable clock tick
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateSite(site.id, { accessNotes: 'gate on the north side' });
    expect(updated.revision).toBe(2);
    expect(updated.accessNotes).toBe('gate on the north side');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(new Date(originalUpdated).getTime());

    const siteDir = await getPath(root, ['sites', site.code + '_x']);
    const persisted = await readJson<typeof site>(siteDir!, 'site.json');
    expect(persisted.accessNotes).toBe('gate on the north side');
  });

  it('throws when the site does not exist', async () => {
    await expect(updateSite('01J000MISSING', { accessNotes: 'x' })).rejects.toThrow(/not found/i);
  });
});

describe('softDeleteSite + restoreSite', () => {
  it('moves site.json to _tombstones and removes the cache row', async () => {
    const site = await createSite({
      name: 'DeleteMe', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    await softDeleteSite(site.id);

    const siteDir = await getPath(root, ['sites', site.code + '_DeleteMe']);
    expect(await fileExists(siteDir!, 'site.json')).toBe(false);

    const tombstones = await getPath(root, ['_tombstones']);
    expect(tombstones).not.toBeNull();
    let tombstoneFile: string | null = null;
    for await (const [name, h] of (tombstones as any).entries()) {
      if (h.kind === 'file' && name.startsWith(`${site.code}_DeleteMe_`)) {
        tombstoneFile = name;
      }
    }
    expect(tombstoneFile).not.toBeNull();

    expect(await getDb().sites.get(site.id)).toBeUndefined();

    // Restore round-trips
    const restored = await restoreSite(tombstoneFile!);
    expect(restored.id).toBe(site.id);
    expect(restored.deletedAt).toBeUndefined();
    expect(restored.revision).toBe(site.revision + 2); // softDelete bumps to +1, restore bumps to +2
    expect(await getDb().sites.get(site.id)).toBeDefined();
    expect(await fileExists(siteDir!, 'site.json')).toBe(true);
  });
});
