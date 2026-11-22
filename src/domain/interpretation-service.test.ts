import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { getRoot } from '../storage/fs';
import { getPath } from '../storage/paths';
import { readJson, writeJson, writeBlob, readBlob, fileExists } from '../storage/atomic';
import { scanRoot } from '../storage/scanner';
import { rebuildCache } from '../cache/rebuild';
import { softDeleteLine } from './line-service';
import type { Interpretation } from './types';
import { createSite } from './site-service';
import { createSurvey } from './survey-service';
import { createLine } from './line-service';
import { getOrCreateInterpretation, addAnomaly, removeAnomaly } from './interpretation-service';
import type { Vertex } from './types';

function v(electrodeIndex: number): Vertex {
  return {
    lat: 42.32, lon: 23.78, elevSource: 'none',
    hAccM: 6, hAccMethod: 'median-reported',
    sampleCount: 10, fixedAt: new Date(), electrodeIndex,
  };
}

async function seedLine() {
  const site = await createSite({
    name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
  const sv = await createSurvey(site.id, {
    startedAt: new Date(), timezone: 'Europe/Sofia', operator: 'x',
    deviceModel: 'PQWT-TC300', deviceSerial: 'x',
    precipLast48h: 'none', qualityFlag: 'good',
  });
  return createLine(sv.id, {
    pointCount: 17, spacingM: 2,
    mode: 'multi-frequency', dipoleOrientation: 'inline',
    vertices: [v(1), v(17)],
  });
}

beforeEach(async () => {
  await resetDb();
  clearRoot();
  setRoot(createMockRoot());
});

describe('getOrCreateInterpretation', () => {
  it('creates a fresh interpretation with no anomalies', async () => {
    const line = await seedLine();
    const interp = await getOrCreateInterpretation(line.id);
    expect(interp.id).toBeTruthy();
    expect(interp.anomalies).toHaveLength(0);
    expect(interp.verdict).toBe('inconclusive');
  });

  it('returns the same id on second call', async () => {
    const line = await seedLine();
    const a = await getOrCreateInterpretation(line.id);
    const b = await getOrCreateInterpretation(line.id);
    expect(b.id).toBe(a.id);
  });
});

describe('addAnomaly', () => {
  it('appends anomaly with generated id and computed pseudoDepth', async () => {
    const line = await seedLine();
    const interp = await addAnomaly(line.id, {
      fromPoint: 3, toPoint: 7,
      fromChannel: 1, toChannel: 2,
      type: 'fracture-signature', confidence: 3,
    });
    expect(interp.anomalies).toHaveLength(1);
    const a = interp.anomalies[0];
    expect(a.id).toBeTruthy();
    expect(a.lineId).toBe(line.id);
    expect(a.fromPoint).toBe(3);
    expect(a.toPoint).toBe(7);
    expect(a.type).toBe('fracture-signature');
    expect(a.confidence).toBe(3);
    expect(typeof a.pseudoDepthFromM).toBe('number');
    expect(typeof a.pseudoDepthToM).toBe('number');
  });

  it('persists: second getOrCreate returns updated anomalies', async () => {
    const line = await seedLine();
    await addAnomaly(line.id, {
      fromPoint: 1, toPoint: 5, fromChannel: 1, toChannel: 1,
      type: 'conductive-zone', confidence: 2,
    });
    const interp = await getOrCreateInterpretation(line.id);
    expect(interp.anomalies).toHaveLength(1);
  });

  it('increments revision on each add', async () => {
    const line = await seedLine();
    const a = await addAnomaly(line.id, {
      fromPoint: 1, toPoint: 3, fromChannel: 1, toChannel: 1,
      type: 'contact', confidence: 4,
    });
    const b = await addAnomaly(line.id, {
      fromPoint: 5, toPoint: 7, fromChannel: 2, toChannel: 3,
      type: 'clay-lens-signature', confidence: 2,
    });
    expect(b.revision).toBeGreaterThan(a.revision);
    expect(b.anomalies).toHaveLength(2);
  });
});

describe('removeAnomaly', () => {
  it('removes by id', async () => {
    const line = await seedLine();
    const interp = await addAnomaly(line.id, {
      fromPoint: 1, toPoint: 5, fromChannel: 1, toChannel: 1,
      type: 'noise-artefact', confidence: 1,
    });
    const removed = await removeAnomaly(line.id, interp.anomalies[0].id);
    expect(removed.anomalies).toHaveLength(0);
  });

  it('is a no-op for unknown id', async () => {
    const line = await seedLine();
    await addAnomaly(line.id, {
      fromPoint: 1, toPoint: 5, fromChannel: 1, toChannel: 1,
      type: 'noise-artefact', confidence: 1,
    });
    const result = await removeAnomaly(line.id, 'nonexistent-id');
    expect(result.anomalies).toHaveLength(1);
  });
});

describe('interpretations — the folder is the truth', () => {
  const ANOMALY = {
    fromPoint: 2, toPoint: 5, fromChannel: 1, toChannel: 4, type: 'contact', confidence: 3,
  } as const;

  async function lineDir(lineId: string) {
    const ln = (await getDb().lines.get(lineId))!;
    const sv = (await getDb().surveys.get(ln.surveyId))!;
    const site = (await getDb().sites.get(sv.siteId))!;
    return (await getPath(getRoot(), ['sites', site.folderName, 'surveys', sv.folderName, 'lines', ln.folderName]))!;
  }
  const rescan = async () => rebuildCache(await scanRoot(getRoot()));
  const cached = async (lineId: string) =>
    (await getDb().interpretations.where('lineId').equals(lineId).first())?.json;

  it('shows anomalies after the cache is rebuilt from nothing', async () => {
    const line = await seedLine();
    await addAnomaly(line.id, ANOMALY);
    await resetDb();
    await rescan();

    expect((await cached(line.id))?.anomalies).toMatchObject([ANOMALY]);
  });

  it('picks up a change made in the folder by another device', async () => {
    const line = await seedLine();
    const mine = await addAnomaly(line.id, ANOMALY);
    await writeJson(await lineDir(line.id), 'interpretation.json', { ...mine, anomalies: [], revision: 9 });
    await rescan();

    expect((await cached(line.id))?.anomalies).toEqual([]);
  });

  it('drops a cached interpretation whose file is gone', async () => {
    const line = await seedLine();
    await addAnomaly(line.id, ANOMALY);
    await (await lineDir(line.id)).removeEntry('interpretation.json');
    await new Promise((r) => setTimeout(r, 5));
    await rescan();

    expect(await cached(line.id)).toBeUndefined();
  });

  it('keeps an anomaly added while a scan was running', async () => {
    const line = await seedLine();
    await addAnomaly(line.id, ANOMALY);
    await new Promise((r) => setTimeout(r, 5));
    const scan = await scanRoot(getRoot());
    await new Promise((r) => setTimeout(r, 5));
    await addAnomaly(line.id, ANOMALY);
    await rebuildCache(scan);

    expect((await cached(line.id))?.anomalies).toHaveLength(2);
  });

  it('adds to what is in the folder, not to a stale cache', async () => {
    const line = await seedLine();
    const mine = await addAnomaly(line.id, ANOMALY);
    const dir = await lineDir(line.id);
    await writeJson(dir, 'interpretation.json', {
      ...mine, anomalies: [...mine.anomalies, { ...mine.anomalies[0], id: 'remote' }],
    });
    await addAnomaly(line.id, ANOMALY);

    const saved = await readJson<Interpretation>(dir, 'interpretation.json');
    expect(saved.anomalies).toHaveLength(3);
    expect(saved.anomalies.map((a) => a.id)).toContain('remote');
  });

  it('does not overwrite an unreadable interpretation.json', async () => {
    const line = await seedLine();
    const dir = await lineDir(line.id);
    await writeBlob(dir, 'interpretation.json', new TextEncoder().encode('{ half'));

    await expect(addAnomaly(line.id, ANOMALY)).rejects.toThrow();
    expect(await (await readBlob(dir, 'interpretation.json')).text()).toBe('{ half');
  });

  it('gives a line re-created in a deleted line folder a clean start, archiving the old file', async () => {
    const old = await seedLine();
    await addAnomaly(old.id, ANOMALY);
    const { surveyId } = (await getDb().lines.get(old.id))!;
    await softDeleteLine(old.id);
    const fresh = await createLine(surveyId, {
      label: old.label, pointCount: 17, spacingM: 2,
      mode: 'multi-frequency', dipoleOrientation: 'inline', vertices: [],
    });

    expect(await fileExists(await lineDir(fresh.id), 'interpretation.json')).toBe(false);
    const tombs: any = await getPath(getRoot(), ['_tombstones', 'lines']);
    const archived: string[] = [];
    for await (const name of tombs.keys()) if (name.endsWith('.interpretation.json')) archived.push(name);
    expect(archived).toHaveLength(1);
    expect((await readJson<Interpretation>(tombs, archived[0])).anomalies).toMatchObject([ANOMALY]);
  });
});
