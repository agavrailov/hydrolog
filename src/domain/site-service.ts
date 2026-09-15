import type { Site } from './types';
import { newId } from '../util/id';
import { writeJson, readJson, fileExists } from '../storage/atomic';
import { getOrCreatePath, getPath, siteFolderName } from '../storage/paths';
import { getRoot } from '../storage/fs';
import { getDb } from '../cache/db';
import { generateSiteCode } from './site-code';

export type SiteCreateInput = Omit<
  Site, 'id' | 'code' | 'createdAt' | 'updatedAt' | 'revision' | 'deletedAt'
>;

export type SiteUpdateInput = Partial<
  Omit<Site, 'id' | 'code' | 'name' | 'createdAt' | 'revision' | 'deletedAt'>
>;

interface TombstonedSite extends Site {
  folderName?: string;
}

export async function createSite(input: SiteCreateInput): Promise<Site> {
  const root = getRoot();
  const db = getDb();

  const existing = await db.sites.toArray();
  const code = generateSiteCode(input.region, existing.map((r) => r.code));

  const now = new Date();
  const site: Site = {
    ...input,
    id: newId(),
    code,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };

  const folderName = siteFolderName(code, input.name);
  const siteDir = await getOrCreatePath(root, ['sites', folderName]);
  await writeJson(siteDir, 'site.json', site);

  await db.sites.put({
    id: site.id,
    code: site.code,
    folderName,
    json: site,
  });

  return site;
}

export async function updateSite(id: string, patch: SiteUpdateInput): Promise<Site> {
  const root = getRoot();
  const db = getDb();

  const row = await db.sites.get(id);
  if (!row) throw new Error(`site not found: ${id}`);

  const existing = row.json;
  const next: Site = {
    ...existing,
    ...patch,
    id: existing.id,
    code: existing.code,
    createdAt: existing.createdAt,
    updatedAt: new Date(),
    revision: existing.revision + 1,
  };

  const siteDir = await getPath(root, ['sites', row.folderName]);
  if (!siteDir) throw new Error(`site folder missing: ${row.folderName}`);
  await writeJson(siteDir, 'site.json', next);

  await db.sites.put({ ...row, json: next });
  return next;
}

export async function softDeleteSite(id: string): Promise<void> {
  const root = getRoot();
  const db = getDb();

  const row = await db.sites.get(id);
  if (!row) throw new Error(`site not found: ${id}`);

  const now = new Date();
  const tombstoned: TombstonedSite = {
    ...row.json,
    deletedAt: now,
    updatedAt: now,
    revision: row.json.revision + 1,
    folderName: row.folderName,
  };

  const tombstonesDir = await getOrCreatePath(root, ['_tombstones']);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const tombstoneName = `${row.folderName}_${stamp}.json`;
  await writeJson(tombstonesDir, tombstoneName, tombstoned);

  const siteDir = await getPath(root, ['sites', row.folderName]);
  if (siteDir && (await fileExists(siteDir, 'site.json'))) {
    await siteDir.removeEntry('site.json');
  }

  await db.sites.delete(id);
}

export async function restoreSite(tombstoneName: string): Promise<Site> {
  const root = getRoot();
  const db = getDb();

  const tombstonesDir = await getPath(root, ['_tombstones']);
  if (!tombstonesDir) throw new Error('_tombstones/ not found');
  const stored = await readJson<TombstonedSite>(tombstonesDir, tombstoneName);

  const restored: Site = {
    ...stored,
    deletedAt: undefined,
    updatedAt: new Date(),
    revision: stored.revision + 1,
  };

  const folderName = stored.folderName ?? siteFolderName(restored.code, restored.name);
  const siteDir = await getOrCreatePath(root, ['sites', folderName]);
  await writeJson(siteDir, 'site.json', restored);
  await tombstonesDir.removeEntry(tombstoneName);

  await db.sites.put({
    id: restored.id,
    code: restored.code,
    folderName,
    json: restored,
  });

  return restored;
}
