import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../src/test/mock-fs';
import { setRoot, clearRoot } from '../src/storage/fs';
import { getDb, resetDb } from '../src/cache/db';
import { setWakeLockAdapter } from '../src/hardware/wake-lock';
import { setGeolocationAdapter } from '../src/hardware/geolocation';
import { mockWakeLockAdapter, mockGeolocationAdapter } from '../src/test/mock-navigator';
import { setDownscaleAdapter } from '../src/domain/anchor-photo';
import { readJson } from '../src/storage/atomic';
import { getPath } from '../src/storage/paths';
import { createSite } from '../src/domain/site-service';
import { createSurvey } from '../src/domain/survey-service';
import { sampleVertex } from '../src/domain/gps-sampling';
import { createLine, updateLine } from '../src/domain/line-service';
import { captureAnchorPhoto } from '../src/domain/anchor-photo';
import type { Line } from '../src/domain/types';

let root: FileSystemDirectoryHandle;
let geo: ReturnType<typeof mockGeolocationAdapter>;

async function tick() { return new Promise((r) => setTimeout(r, 0)); }

beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
  const wl = mockWakeLockAdapter();
  setWakeLockAdapter(wl.adapter);
  geo = mockGeolocationAdapter();
  setGeolocationAdapter(geo.adapter);
  setDownscaleAdapter(async (b) => b);
});

describe('Phase 1c full line capture flow', () => {
  it('site → survey → sampleVertex×2 → captureAnchor → createLine → updateLine linkage', async () => {
    // Seed
    const site = await createSite({
      name: 'Ivanov', settlement: 'Долна Баня', municipality: 'Долна Баня',
      region: 'Софийска', centroid: { lat: 42.32, lon: 23.78 },
      accessNotes: '', landUse: '', status: 'surveyed', tags: [],
    });
    const sv = await createSurvey(site.id, {
      startedAt: new Date(), timezone: 'Europe/Sofia', operator: 'Anton',
      deviceModel: 'PQWT-TC300', deviceSerial: 'SN1',
      precipLast48h: 'none', qualityFlag: 'good',
    });

    // Point 1
    const p1Promise = sampleVertex(1, { targetSamples: 5, discardFirst: 3, timeoutMs: 60_000 });
    await tick();
    for (let i = 0; i < 3; i++) { geo.pushFix({ accuracyM: 50 }); await tick(); }
    for (let i = 0; i < 5; i++) {
      geo.pushFix({ lat: 42.32 + i * 1e-6, lon: 23.78 + i * 1e-6, accuracyM: 6 });
      await tick();
    }
    const p1 = await p1Promise;

    // Point 17
    const pnPromise = sampleVertex(17, { targetSamples: 5, discardFirst: 3, timeoutMs: 60_000 });
    await tick();
    for (let i = 0; i < 3; i++) { geo.pushFix({ accuracyM: 50 }); await tick(); }
    for (let i = 0; i < 5; i++) {
      geo.pushFix({ lat: 42.32 + i * 1e-6, lon: 23.7804 + i * 1e-6, accuracyM: 5 });
      await tick();
    }
    const pn = await pnPromise;

    // Create line
    const line = await createLine(sv.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [p1.vertex, pn.vertex],
    });

    // Capture anchor
    const file = new File([new Uint8Array([9, 9, 9])], 'photo.jpg', { type: 'image/jpeg' });
    const media = await captureAnchorPhoto({
      file, lineId: line.id,
      capturedAt: new Date(),
      lat: p1.vertex.lat, lon: p1.vertex.lon,
    });

    // Link back onto the line
    const linked = await updateLine(line.id, { point1AnchorMediaId: media.id });
    expect(linked.revision).toBe(2);
    expect(linked.point1AnchorMediaId).toBe(media.id);

    // Verify JSON on disk mirrors the cache
    const siteRow = (await getDb().sites.get(site.id))!;
    const svRow = (await getDb().surveys.get(sv.id))!;
    const lineDir = await getPath(root, [
      'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', 'L1',
    ]);
    expect(lineDir).not.toBeNull();
    const persisted = await readJson<Line>(lineDir!, 'line.json');
    expect(persisted.channelSetSnapshot.units).toBe('mV');       // §2 R1 flow-through
    expect(persisted.channelSetSnapshot.depthModel).toBe('linear-nominal'); // §2 R3
    expect(persisted.transformLog).toEqual([]);                  // §5.4
    expect(persisted.point1AnchorMediaId).toBe(media.id);
    expect(persisted.vertices).toHaveLength(2);
    expect(persisted.vertices[0].hAccMethod).toBe('median-reported');
    expect(persisted.lengthM).toBeGreaterThan(0);
    const mediaRow = await getDb().media.get(media.id);
    expect(mediaRow).toBeDefined();
    expect(mediaRow!.linkedId).toBe(line.id);
  });
});
