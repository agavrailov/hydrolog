import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createMockRoot } from '../src/test/mock-fs';
import { setRoot, clearRoot } from '../src/storage/fs';
import { getDb, resetDb } from '../src/cache/db';
import { readBlob } from '../src/storage/atomic';
import { getPath } from '../src/storage/paths';
import { createSite } from '../src/domain/site-service';
import { createSurvey } from '../src/domain/survey-service';
import { createLine } from '../src/domain/line-service';
import { importPqwtIntoLine } from '../src/domain/pqwt-import-service';
import type { Vertex, Line } from '../src/domain/types';

const SAMPLES_ROOT = join(
  process.cwd(),
  'Profile Survey', '150M',
);

const HAS_REAL_SAMPLES = existsSync(join(SAMPLES_ROOT, 'L1', '150M_L1.csv'));

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

function readSample(label: string, ext: 'csv' | 'bmp', processed = false): { name: string; bytes: Buffer } {
  const dir = join(SAMPLES_ROOT, label);
  if (ext === 'csv') {
    const name = `150M_${label}.csv`;
    return { name, bytes: readFileSync(join(dir, name)) };
  }
  const suffix = processed ? '_Processed' : '';
  const name = `150M_Profile_${label}${suffix}.bmp`;
  return { name, bytes: readFileSync(join(dir, name)) };
}

describe.skipIf(!HAS_REAL_SAMPLES)('Phase 2a — real-sample end-to-end', () => {
  it('imports the real L1 sample: parses 18×36, stores verbatim, updates Line', async () => {
    // Seed site + survey + line
    const site = await createSite({
      name: 'Sample', settlement: 'Долна Баня', municipality: 'Долна Баня',
      region: 'Софийска', centroid: { lat: 42.32, lon: 23.78 },
      accessNotes: '', landUse: '', status: 'surveyed', tags: [],
    });
    const sv = await createSurvey(site.id, {
      startedAt: new Date(), timezone: 'Europe/Sofia', operator: 'Anton',
      deviceModel: 'PQWT-150M', deviceSerial: 'SN1',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    const v: Vertex = {
      lat: 42.32, lon: 23.78, elevSource: 'none',
      hAccM: 6, hAccMethod: 'median-reported',
      sampleCount: 20, fixedAt: new Date(), electrodeIndex: 1,
    };
    const line = await createLine(sv.id, {
      pointCount: 17, spacingM: 2,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [v, { ...v, electrodeIndex: 3, lon: 23.7801 }],
    });

    // Load the real sample bytes
    const csvBytes = readSample('L1', 'csv');
    const rawBmpBytes = readSample('L1', 'bmp', false);
    const procBmpBytes = readSample('L1', 'bmp', true);

    const candidate = {
      folderName: 'L1',
      depthRangeM: 150,
      deviceLineLabel: '1',
      csvFile: new File([csvBytes.bytes as BlobPart], csvBytes.name, { type: 'text/csv' }),
      csvText: new TextDecoder().decode(csvBytes.bytes),
      rawBmp: new File([rawBmpBytes.bytes as BlobPart], rawBmpBytes.name, { type: 'image/bmp' }),
      processedBmp: new File([procBmpBytes.bytes as BlobPart], procBmpBytes.name, { type: 'image/bmp' }),
    };

    const result = await importPqwtIntoLine({ targetLineId: line.id, candidate });
    expect(result.deviceMediaIds).toHaveLength(2);

    // Line state after import
    const updated = (await getDb().lines.get(line.id))!.json as Line;
    expect(updated.deviceStartPointIndex).toBe(80);
    expect(updated.deviceLineNumber).toBe('1');
    expect(updated.pointCount).toBe(18);
    expect(updated.channelSetSnapshot.channels).toHaveLength(36);
    expect(updated.channelSetSnapshot.units).toBe('mV');         // §2 R1
    expect(updated.channelSetSnapshot.depthModel).toBe('linear-nominal');  // §2 R3
    expect(updated.status).toBe('complete');

    // Verbatim CSV round-trip (§7.3)
    const siteRow = (await getDb().sites.get(site.id))!;
    const svRow = (await getDb().surveys.get(sv.id))!;
    const deviceFilesDir = await getPath(root, [
      'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', 'L1', 'device-files',
    ]);
    expect(deviceFilesDir).not.toBeNull();
    const backBlob = await readBlob(deviceFilesDir!, '150M_L1.csv');
    const backBytes = new Uint8Array(await backBlob.arrayBuffer());
    expect(backBytes.length).toBe(csvBytes.bytes.length);
    for (let i = 0; i < backBytes.length; i++) {
      if (backBytes[i] !== csvBytes.bytes[i]) throw new Error(`byte drift at index ${i}`);
    }

    // readings.csv: 18 × 36 = 648 data lines (assuming zero nulls in the real sample)
    const readingsBlob = await readBlob(await getPath(root, [
      'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', 'L1',
    ]) as FileSystemDirectoryHandle, 'readings.csv');
    const readingsText = await readingsBlob.text();
    const dataLines = readingsText.split(/\r?\n/).filter((l) => l && !l.startsWith('point,'));
    expect(dataLines.length).toBe(18 * 36);

    // MediaAsset rows populated (Phase 1c M1 pattern)
    const mediaRows = await getDb().media.where('linkedId').equals(line.id).toArray();
    expect(mediaRows).toHaveLength(2);
    expect(mediaRows.every((r) => r.json.kind === 'device-screen')).toBe(true);
    expect(mediaRows.every((r) => r.json.isOriginal === true)).toBe(true);   // §4.13 device screens never downscaled
  });
});

describe.skipIf(HAS_REAL_SAMPLES)('Phase 2a — real-sample end-to-end (SKIPPED — sample files not present)', () => {
  it('skipped', () => { expect(true).toBe(true); });
});
