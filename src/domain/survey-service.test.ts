import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { readJson } from '../storage/atomic';
import { getPath } from '../storage/paths';
import { writeSyncProbe } from '../storage/sync';
import { createSite } from './site-service';
import { createSurvey, updateSurvey, finalizeSurvey } from './survey-service';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

async function makeSite() {
  return createSite({
    name: 'S', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
}

describe('createSurvey', () => {
  it('creates survey.json under the site and populates the cache', async () => {
    const site = await makeSite();
    const survey = await createSurvey(site.id, {
      startedAt: new Date('2026-09-15T10:00:00Z'),
      timezone: 'Europe/Sofia',
      operator: 'Anton',
      deviceModel: 'PQWT-TC300',
      deviceSerial: 'SN123',
      precipLast48h: 'none',
      qualityFlag: 'good',
    });
    expect(survey.siteId).toBe(site.id);
    expect(survey.revision).toBe(1);
    expect(survey.finalizedAt).toBeUndefined();

    const svDir = await getPath(root, ['sites', 'BG-SOF-0001_S', 'surveys', '2026-09-15T10-00_s01']);
    expect(svDir).not.toBeNull();
    const persisted = await readJson<typeof survey>(svDir!, 'survey.json');
    expect(persisted.operator).toBe('Anton');

    const row = await getDb().surveys.get(survey.id);
    expect(row?.siteId).toBe(site.id);
    expect(row?.folderName).toBe('2026-09-15T10-00_s01');
  });

  it('assigns sequential seq numbers for surveys on the same date', async () => {
    const site = await makeSite();
    const t = new Date('2026-09-15T10:00:00Z');
    const a = await createSurvey(site.id, {
      startedAt: t, timezone: 'Europe/Sofia', operator: 'Anton',
      deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    const b = await createSurvey(site.id, {
      startedAt: t, timezone: 'Europe/Sofia', operator: 'Anton',
      deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    const rowA = await getDb().surveys.get(a.id);
    const rowB = await getDb().surveys.get(b.id);
    expect(rowA?.folderName).toBe('2026-09-15T10-00_s01');
    expect(rowB?.folderName).toBe('2026-09-15T10-00_s02');
  });
});

describe('updateSurvey', () => {
  it('bumps revision and updatedAt without a reason on a draft', async () => {
    const site = await makeSite();
    const survey = await createSurvey(site.id, {
      startedAt: new Date('2026-09-15T10:00:00Z'), timezone: 'Europe/Sofia',
      operator: 'Anton', deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateSurvey(survey.id, { operator: 'Иван' });
    expect(updated.revision).toBe(2);
    expect(updated.operator).toBe('Иван');
  });

  it('rejects edits on a finalized survey without a reason', async () => {
    const site = await makeSite();
    const survey = await createSurvey(site.id, {
      startedAt: new Date(Date.now() - 3600_000), timezone: 'Europe/Sofia',
      operator: 'Anton', deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    await writeSyncProbe(root, new Date()); // pass the finalize gate
    await finalizeSurvey(survey.id);
    await expect(updateSurvey(survey.id, { operator: 'x' })).rejects.toThrow(/reason/i);
  });

  it('accepts edits on a finalized survey when a reason is provided; appends editHistory', async () => {
    const site = await makeSite();
    const survey = await createSurvey(site.id, {
      startedAt: new Date(Date.now() - 3600_000), timezone: 'Europe/Sofia',
      operator: 'Anton', deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    await writeSyncProbe(root, new Date());
    await finalizeSurvey(survey.id);
    const edited = await updateSurvey(survey.id, { operator: 'Ivan' }, { editReason: 'typo fix' });
    expect((edited as any).editHistory).toBeDefined();
    expect((edited as any).editHistory[0].reason).toBe('typo fix');
  });
});

describe('finalizeSurvey (§10.9 gate)', () => {
  it('throws when no sync probe exists', async () => {
    const site = await makeSite();
    const survey = await createSurvey(site.id, {
      startedAt: new Date('2026-09-15T10:00:00Z'), timezone: 'Europe/Sofia',
      operator: 'Anton', deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    await expect(finalizeSurvey(survey.id)).rejects.toThrow(/backup/i);
  });

  it('throws when the probe is older than the survey.startedAt', async () => {
    const site = await makeSite();
    // Probe written yesterday
    await writeSyncProbe(root, new Date(Date.now() - 24 * 3600_000));
    // Survey started this morning
    const survey = await createSurvey(site.id, {
      startedAt: new Date(), timezone: 'Europe/Sofia',
      operator: 'Anton', deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    await expect(finalizeSurvey(survey.id)).rejects.toThrow(/backup/i);
  });

  it('succeeds when the probe is newer than the survey.startedAt', async () => {
    const site = await makeSite();
    const survey = await createSurvey(site.id, {
      startedAt: new Date(Date.now() - 3600_000), timezone: 'Europe/Sofia',
      operator: 'Anton', deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    await writeSyncProbe(root, new Date());
    const finalized = await finalizeSurvey(survey.id);
    expect(finalized.finalizedAt).toBeDefined();
    expect(finalized.revision).toBe(2);
  });
});
