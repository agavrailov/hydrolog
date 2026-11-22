import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { readJson } from '../storage/atomic';
import { getPath } from '../storage/paths';
import { createSite } from './site-service';
import { createSurvey } from './survey-service';
import { createLine, updateLine, softDeleteLine, defaultChannelSetSnapshot, attachDeviceData } from './line-service';
import type { Point, Vertex } from './types';
import { buildLinePoints } from './line-points';
import { polylineLengthM } from './enu';

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

function vertex(electrodeIndex: number, lat: number, lon: number): Vertex {
  return {
    lat, lon, elevSource: 'none',
    hAccM: 6, hAccMethod: 'median-reported',
    sampleCount: 20, fixedAt: new Date(), electrodeIndex,
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
  it('generates sequential labels L1, L2, ...', async () => {
    const { survey } = await seedSiteAndSurvey();
    const l1 = await createLine(survey.id, {
      pointCount: 17, spacingM: 2,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7804)],
    });
    const l2 = await createLine(survey.id, {
      pointCount: 17, spacingM: 2,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.33, 23.78), vertex(17, 42.33, 23.7804)],
    });
    expect(l1.label).toBe('L1');
    expect(l2.label).toBe('L2');
  });

  it('writes line.json + vertices.geojson under sites/.../surveys/.../lines/L1/', async () => {
    const { site, survey } = await seedSiteAndSurvey();
    const line = await createLine(survey.id, {
      pointCount: 17, spacingM: 2,
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
    expect(persisted.spacingM).toBe(2);
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
      pointCount: 17, spacingM: 2,
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
      pointCount: 17, spacingM: 2,
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
      pointCount: 17, spacingM: 2,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7804)],
    });
    await softDeleteLine(line.id);
    expect(await getDb().lines.get(line.id)).toBeUndefined();
    const tombs = await getPath(root, ['_tombstones', 'lines']);
    expect(tombs).not.toBeNull();
  });
});

describe('attachDeviceData', () => {
  it('sets channelSetSnapshot, deviceStartPointIndex, and other device fields on first call', async () => {
    const { survey } = await seedSiteAndSurvey();
    const line = await createLine(survey.id, {
      pointCount: 17, spacingM: 2,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7804)],
    });

    const customChannelSet = defaultChannelSetSnapshot();
    const attached = await attachDeviceData(line.id, {
      channelSetSnapshot: { ...customChannelSet, name: 'PQWT 150M 36ch' },
      pointCount: 18,
      deviceStartPointIndex: 80,
      deviceLineNumber: '1',
      mode: 'multi-frequency',
      status: 'complete',
    });

    expect(attached.deviceStartPointIndex).toBe(80);
    expect(attached.deviceLineNumber).toBe('1');
    expect(attached.pointCount).toBe(18);
    expect(attached.status).toBe('complete');
    expect(attached.channelSetSnapshot.name).toBe('PQWT 150M 36ch');
    expect(attached.revision).toBe(2);
  });

  it('refuses a second attach on the same line (§4.9 frozen after first import)', async () => {
    const { survey } = await seedSiteAndSurvey();
    const line = await createLine(survey.id, {
      pointCount: 17, spacingM: 2,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7804)],
    });
    const cs = defaultChannelSetSnapshot();
    await attachDeviceData(line.id, {
      channelSetSnapshot: cs, pointCount: 18, deviceStartPointIndex: 80,
      deviceLineNumber: '1', mode: 'multi-frequency', status: 'complete',
    });
    await expect(attachDeviceData(line.id, {
      channelSetSnapshot: cs, pointCount: 18, deviceStartPointIndex: 90,
      deviceLineNumber: '1', mode: 'multi-frequency',
    })).rejects.toThrow(/already been attached/i);
  });
});

describe('updateLine — geometry that arrives after import', () => {
  const START = { lat: 42, lon: 23 };
  const north = (m: number) => START.lat + (m / 6378137) * (180 / Math.PI);
  const cable = (lastElectrode: number) => [
    vertex(1, START.lat, START.lon),
    vertex(lastElectrode, north((lastElectrode - 1) * 2.5), START.lon),
  ];

  async function imported(count: number, adjust: (p: Point[]) => Point[] = (p) => p) {
    const { survey } = await seedSiteAndSurvey();
    const line = await createLine(survey.id, {
      pointCount: count, spacingM: 2.5,
      mode: 'multi-frequency', dipoleOrientation: 'inline', vertices: [],
    });
    const channelSet = { ...defaultChannelSetSnapshot(), deviceModel: 'GT-150' };
    return attachDeviceData(line.id, {
      channelSetSnapshot: channelSet, pointCount: count,
      deviceStartPointIndex: 80, deviceLineNumber: '110', mode: 'multi-frequency',
      points: adjust(buildLinePoints({
        vertices: [], pointCount: count, channelSet,
        parsedReadings: Array.from({ length: count }, (_, i) => [i]),
        recordedAt: new Date('2026-11-22T10:00:00Z'),
      })),
    });
  }

  // §7.5: the cable has points + 4 electrodes; a full-length fix still ends at 22.
  it.each([[18, 22], [12, 16], [12, 22], [2, 6], [1, 5]])(
    'places %s points on electrodes 3 onwards when the last vertex is electrode %s',
    async (count, lastElectrode) => {
      const line = await imported(count);
      const next = await updateLine(line.id, { vertices: cable(lastElectrode) });

      next.points.forEach((p, i) => {
        expect(polylineLengthM([START, p])).toBeCloseTo((2 + i) * 2.5, 3);
        expect(p.offsetM).toBeCloseTo(i * 2.5, 3);
      });
    },
  );

  it('keeps readings, flags and notes', async () => {
    const line = await imported(3, (ps) => ps.map((p) => ({ ...p, flags: ['suspect'], note: `n${p.index}` })));
    const next = await updateLine(line.id, { vertices: cable(7) });

    expect(next.points[0].lat).not.toBe(0);
    next.points.forEach((p, i) => {
      expect(p.readings).toEqual(line.points[i].readings);
      expect(p.flags).toEqual(['suspect']);
      expect(p.note).toBe(`n${i + 1}`);
    });
  });

  it('does not move measured or manual points', async () => {
    const line = await imported(3, (ps) => [
      { ...ps[0], coordSource: 'measured', lat: 42.5, lon: 23.5 },
      { ...ps[1], coordSource: 'manual', lat: 42.6, lon: 23.6 },
      ps[2],
    ]);
    const next = await updateLine(line.id, { vertices: cable(7) });

    expect(next.points[0]).toEqual(line.points[0]);
    expect(next.points[1]).toEqual(line.points[1]);
    expect(next.points[2].lat).not.toBe(0);
  });

  it('writes the new positions to line.json', async () => {
    const line = await imported(3);
    const next = await updateLine(line.id, { vertices: cable(7) });

    const row = (await getDb().lines.get(line.id))!;
    const sv = (await getDb().surveys.get(row.surveyId))!;
    const site = (await getDb().sites.get(sv.siteId))!;
    const dir = await getPath(root, ['sites', site.folderName, 'surveys', sv.folderName, 'lines', row.folderName]);
    const saved = await readJson<{ points: Point[] }>(dir!, 'line.json');
    expect(saved.points[0].lat).not.toBe(0);
    expect(saved.points[0].lat).toBe(next.points[0].lat);
  });

  it('returns points to placeholders when geometry is cleared', async () => {
    const line = await imported(3);
    await updateLine(line.id, { vertices: cable(7) });
    const next = await updateLine(line.id, { vertices: [] });

    expect(next.points.map((p) => [p.lat, p.lon, p.offsetM])).toEqual([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  });
});
