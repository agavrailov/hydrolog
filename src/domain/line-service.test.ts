import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { readJson } from '../storage/atomic';
import { getPath } from '../storage/paths';
import { createSite } from './site-service';
import { createSurvey } from './survey-service';
import { createLine, updateLine, softDeleteLine, defaultChannelSetSnapshot } from './line-service';
import type { Vertex } from './types';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

async function seedSiteAndSurvey() {
  const site = await createSite({
    name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
  const survey = await createSurvey(site.id, {
    startedAt: new Date('2026-09-15T10:00:00Z'),
    timezone: 'Europe/Sofia', operator: 'Anton',
    deviceModel: 'PQWT-TC300', deviceSerial: 'x',
    precipLast48h: 'none', qualityFlag: 'good',
  });
  return { site, survey };
}

function vertex(atPointIndex: number, lat: number, lon: number): Vertex {
  return {
    lat, lon, elevSource: 'none',
    hAccM: 6, hAccMethod: 'median-reported',
    sampleCount: 20, fixedAt: new Date(), atPointIndex,
  };
}

describe('defaultChannelSetSnapshot', () => {
  it('has 40 channels, mV units, linear-nominal depth model', () => {
    const cs = defaultChannelSetSnapshot();
    expect(cs.channels).toHaveLength(40);
    expect(cs.units).toBe('mV');
    expect(cs.depthModel).toBe('linear-nominal');
  });

  it('returns a stable snapshot with a fixed frozenAt', () => {
    const a = defaultChannelSetSnapshot();
    const b = defaultChannelSetSnapshot();
    expect(a.frozenAt.getTime()).toBe(b.frozenAt.getTime());
  });
});

describe('createLine', () => {
  it('validates electrodeSpacingM > pointSpacingM', async () => {
    const { survey } = await seedSiteAndSurvey();
    await expect(createLine(survey.id, {
      pointCount: 17,
      pointSpacingM: 5,
      electrodeSpacingM: 5,  // equal, must fail
      mode: 'multi-frequency',
      dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7803)],
    })).rejects.toThrow(/electrodeSpacingM/i);

    await expect(createLine(survey.id, {
      pointCount: 17,
      pointSpacingM: 5,
      electrodeSpacingM: 3,  // less than pointSpacing, must fail
      mode: 'multi-frequency',
      dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7803)],
    })).rejects.toThrow(/electrodeSpacingM/i);
  });

  it('generates sequential labels L1, L2, ...', async () => {
    const { survey } = await seedSiteAndSurvey();
    const l1 = await createLine(survey.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7804)],
    });
    const l2 = await createLine(survey.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.33, 23.78), vertex(17, 42.33, 23.7804)],
    });
    expect(l1.label).toBe('L1');
    expect(l2.label).toBe('L2');
  });

  it('writes line.json + vertices.geojson under sites/.../surveys/.../lines/L1/', async () => {
    const { site, survey } = await seedSiteAndSurvey();
    const line = await createLine(survey.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7804)],
    });
    const siteRow = (await getDb().sites.get(site.id))!;
    const svRow = (await getDb().surveys.get(survey.id))!;
    const lineDir = await getPath(root, [
      'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', 'L1',
    ]);
    expect(lineDir).not.toBeNull();
    const persisted = await readJson<typeof line>(lineDir!, 'line.json');
    expect(persisted.electrodeSpacingM).toBe(5);
    expect(persisted.transformLog).toEqual([]);
    expect(persisted.channelSetSnapshot.units).toBe('mV');
  });

  it('computes lengthM from the vertex polyline', async () => {
    const { survey } = await seedSiteAndSurvey();
    // Straight east 32 m
    const R = 6378137;
    const cosLat = Math.cos((42.32 * Math.PI) / 180);
    const dLon = ((32 / (R * cosLat)) * 180) / Math.PI;
    const line = await createLine(survey.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.78 + dLon)],
    });
    expect(line.lengthM).toBeCloseTo(32, 2);
  });
});

describe('updateLine', () => {
  it('bumps updatedAt + revision, rewrites line.json', async () => {
    const { survey } = await seedSiteAndSurvey();
    const line = await createLine(survey.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7804)],
    });
    await new Promise((r) => setTimeout(r, 5));
    const next = await updateLine(line.id, { groundSlopePct: 5.5 });
    expect(next.revision).toBe(2);
    expect(next.groundSlopePct).toBe(5.5);
  });
});

describe('softDeleteLine', () => {
  it('moves line.json to _tombstones/lines/ and clears the cache row', async () => {
    const { survey } = await seedSiteAndSurvey();
    const line = await createLine(survey.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7804)],
    });
    await softDeleteLine(line.id);
    expect(await getDb().lines.get(line.id)).toBeUndefined();
    const tombs = await getPath(root, ['_tombstones', 'lines']);
    expect(tombs).not.toBeNull();
  });
});
