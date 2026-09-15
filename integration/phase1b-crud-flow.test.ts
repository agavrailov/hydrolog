import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../src/test/mock-fs';
import { setRoot, clearRoot } from '../src/storage/fs';
import { getDb, resetDb } from '../src/cache/db';
import { readJson } from '../src/storage/atomic';
import { getPath } from '../src/storage/paths';
import { writeSyncProbe } from '../src/storage/sync';
import { createSite, updateSite, softDeleteSite, restoreSite } from '../src/domain/site-service';
import { createSurvey, updateSurvey, finalizeSurvey } from '../src/domain/survey-service';
import type { Survey } from '../src/domain/types';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

describe('Phase 1b full CRUD flow', () => {
  it('restore after ordinary edits keeps the folder graph intact', async () => {
    // Create site + one survey
    const site = await createSite({
      name: 'Ivanov', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    const svBefore = await createSurvey(site.id, {
      startedAt: new Date(Date.now() - 3600_000),
      timezone: 'Europe/Sofia', operator: 'Anton',
      deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });

    // Edit the site (e.g. accessNotes) — must not affect folder or survey linkage
    await updateSite(site.id, { accessNotes: 'north gate' });

    // Soft-delete
    await softDeleteSite(site.id);
    const tombs = await getPath(root, ['_tombstones']);
    let tombName: string | null = null;
    for await (const [n, h] of (tombs as any).entries()) {
      if (h.kind === 'file' && n.startsWith('BG-SOF-0001_Ivanov_')) tombName = n;
    }
    expect(tombName).not.toBeNull();

    // Restore
    await restoreSite(tombName!);

    // The original site folder is still there and its surveys/ subtree is reachable
    const siteDir = await getPath(root, ['sites', 'BG-SOF-0001_Ivanov']);
    expect(siteDir).not.toBeNull();
    const surveysDir = await getPath(siteDir!, ['surveys']);
    expect(surveysDir).not.toBeNull();

    // The survey row is still in the cache and points at the same folder
    const svRow = await getDb().surveys.get(svBefore.id);
    expect(svRow).toBeDefined();
  });

  it('create site → create survey → edit both → finalize → soft-delete → restore', async () => {
    // 1. Create a site
    const site = await createSite({
      name: 'Ivanov',
      settlement: 'Долна Баня',
      municipality: 'Долна Баня',
      region: 'Софийска',
      centroid: { lat: 42.32, lon: 23.78 },
      accessNotes: '',
      landUse: '',
      status: 'surveyed',
      tags: ['pilot'],
    });
    expect(site.code).toBe('BG-SOF-0001');
    expect(site.revision).toBe(1);

    // 2. Create a survey under it
    const startedAt = new Date(Date.now() - 3600_000);
    const sv = await createSurvey(site.id, {
      startedAt,
      timezone: 'Europe/Sofia',
      operator: 'Anton',
      deviceModel: 'PQWT-TC300',
      deviceSerial: 'SN1',
      precipLast48h: 'none',
      qualityFlag: 'good',
    });
    expect(sv.siteId).toBe(site.id);
    expect(sv.revision).toBe(1);

    // 3. Edit the site — bumps revision
    const site2 = await updateSite(site.id, { accessNotes: 'north gate' });
    expect(site2.revision).toBe(2);
    expect(site2.accessNotes).toBe('north gate');

    // 4. Edit the survey (still a draft — no reason needed)
    const sv2 = await updateSurvey(sv.id, { summary: 'clean survey' });
    expect(sv2.revision).toBe(2);
    expect(sv2.summary).toBe('clean survey');

    // 5. Finalize the survey (needs a fresh probe)
    await writeSyncProbe(root, new Date());
    const svFinal = await finalizeSurvey(sv.id);
    expect(svFinal.finalizedAt).toBeDefined();
    expect(svFinal.revision).toBe(3);

    // 6. Edit after finalize — requires a reason
    await expect(updateSurvey(sv.id, { operator: 'x' })).rejects.toThrow(/reason/i);
    const svEdited = await updateSurvey(sv.id, { operator: 'Ivan' }, { editReason: 'typo' });
    expect((svEdited as any).editHistory).toBeDefined();
    expect((svEdited as any).editHistory[0].reason).toBe('typo');
    expect(svEdited.revision).toBe(4);

    // 7. Verify JSON on disk matches the cache
    const svDir = await getPath(root, ['sites', 'BG-SOF-0001_Ivanov', 'surveys', (await getDb().surveys.get(sv.id))!.folderName]);
    const persisted = await readJson<Survey>(svDir!, 'survey.json');
    expect(persisted.operator).toBe('Ivan');
    expect(persisted.finalizedAt).toBeDefined();
    expect(persisted.revision).toBe(4);

    // 8. Soft-delete the site (survey rows remain but the site is gone from the cache)
    await softDeleteSite(site.id);
    expect(await getDb().sites.get(site.id)).toBeUndefined();

    const tombs = await getPath(root, ['_tombstones']);
    let tombName: string | null = null;
    for await (const [n, h] of (tombs as any).entries()) {
      if (h.kind === 'file' && n.startsWith('BG-SOF-0001_Ivanov_')) tombName = n;
    }
    expect(tombName).not.toBeNull();

    // 9. Restore (bumps revision by 2: softDelete +1, restore +1)
    const restored = await restoreSite(tombName!);
    expect(restored.id).toBe(site.id);
    expect(restored.deletedAt).toBeUndefined();
    expect(await getDb().sites.get(site.id)).toBeDefined();
    // revision should be +2 from the pre-delete state (which was 2)
    expect(restored.revision).toBe(4);
  });
});
