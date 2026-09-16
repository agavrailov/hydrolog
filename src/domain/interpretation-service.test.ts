import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { resetDb } from '../cache/db';
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
    pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
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
