import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { readBlob, readJson, fileExists } from '../storage/atomic';
import { getPath } from '../storage/paths';
import { createSite } from './site-service';
import { createSurvey } from './survey-service';
import { createLine } from './line-service';
import { captureAnchorPhoto, setDownscaleAdapter } from './anchor-photo';
import type { Vertex, MediaAsset } from './types';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
  // Identity downscale for tests
  setDownscaleAdapter(async (b) => b);
});

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
  const v: Vertex = {
    lat: 42.32, lon: 23.78, elevSource: 'none',
    hAccM: 6, hAccMethod: 'median-reported',
    sampleCount: 20, fixedAt: new Date(), electrodeIndex: 1,
  };
  const line = await createLine(sv.id, {
    pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
    mode: 'multi-frequency', dipoleOrientation: 'inline',
    vertices: [v, { ...v, electrodeIndex: 17, lon: 23.7804 }],
  });
  return { site, sv, line };
}

describe('captureAnchorPhoto', () => {
  it('writes anchor.jpg + anchor-media.json under the line folder', async () => {
    const { site, sv, line } = await seedLine();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const file = new File([bytes], 'photo.jpg', { type: 'image/jpeg' });
    const media = await captureAnchorPhoto({
      file, lineId: line.id,
      capturedAt: new Date('2026-09-15T10:05:00Z'),
      lat: 42.32001, lon: 23.78002,
      bearingDeg: 175,
    });

    const siteRow = (await getDb().sites.get(site.id))!;
    const svRow = (await getDb().surveys.get(sv.id))!;
    const lineDir = await getPath(root, [
      'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', 'L1',
    ]);
    expect(await fileExists(lineDir!, 'anchor.jpg')).toBe(true);
    const persisted = await readJson<MediaAsset>(lineDir!, 'anchor-media.json');
    expect(persisted.kind).toBe('point1-anchor');
    expect(persisted.lat).toBe(42.32001);
    expect(persisted.lon).toBe(23.78002);
    expect(persisted.bearingDeg).toBe(175);
    expect(persisted.linkedTo.id).toBe(line.id);
    expect(persisted.sha256).toHaveLength(64);
    // Round-trip the blob
    const stored = await readBlob(lineDir!, 'anchor.jpg');
    const storedBytes = new Uint8Array(await stored.arrayBuffer());
    expect(Array.from(storedBytes)).toEqual([1, 2, 3, 4, 5]);
    // Returned media object matches the persisted one
    expect(media.storagePath).toContain('anchor.jpg');
    // Cache row was populated per §10.3 folder-first-then-cache invariant
    const cacheRow = await getDb().media.get(media.id);
    expect(cacheRow).toBeDefined();
    expect(cacheRow!.linkedId).toBe(line.id);
    expect(cacheRow!.storagePath).toContain('anchor.jpg');
  });

  it('stamps lat/lon from the caller, never from EXIF', async () => {
    const { line } = await seedLine();
    const file = new File([new Uint8Array([9])], 'photo.jpg', { type: 'image/jpeg' });
    const media = await captureAnchorPhoto({
      file, lineId: line.id,
      capturedAt: new Date(),
      lat: 1.111, lon: 2.222,
    });
    expect(media.lat).toBe(1.111);
    expect(media.lon).toBe(2.222);
  });
});
