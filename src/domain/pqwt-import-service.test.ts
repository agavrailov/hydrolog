import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { readBlob, writeBlob, fileExists } from '../storage/atomic';
import { scanRoot } from '../storage/scanner';
import { rebuildCache } from '../cache/rebuild';
import { getPath } from '../storage/paths';
import { PQWT_L1_MINIMAL_CSV } from '../test/fixtures-pqwt';
import { createSite } from './site-service';
import { createSurvey } from './survey-service';
import { createLine } from './line-service';
import { importPqwtIntoLine, importPqwtAsNewLine, type ImportInto } from './pqwt-import-service';
import type { Vertex, Line } from './types';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

async function seedLine() {
  const site = await createSite({
    name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
  const sv = await createSurvey(site.id, {
    startedAt: new Date(), timezone: 'Europe/Sofia', operator: 'Anton',
    deviceModel: 'PQWT-150M', deviceSerial: 'x',
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
  return { site, sv, line };
}

function mkCandidate(csvText: string, folderName = 'L1', depthRangeM = 150) {
  return {
    folderName,
    depthRangeM,
    deviceLineLabel: '1',
    csvFile: new File([csvText], `150M_${folderName}.csv`, { type: 'text/csv' }),
    csvText,
    rawBmp: new File([new Uint8Array([0x42, 0x4d, 0x01])], `150M_Profile_${folderName}.bmp`, { type: 'image/bmp' }),
    processedBmp: new File([new Uint8Array([0x42, 0x4d, 0x02])], `150M_Profile_${folderName}_Processed.bmp`, { type: 'image/bmp' }),
  };
}

describe('importPqwtIntoLine — happy path', () => {
  it('writes verbatim files + readings.csv + media rows + updates Line', async () => {
    const { site, sv, line } = await seedLine();
    const input: ImportInto = { targetLineId: line.id, candidate: mkCandidate(PQWT_L1_MINIMAL_CSV) };
    const result = await importPqwtIntoLine(input);

    expect(result.lineId).toBe(line.id);
    expect(result.verbatimPaths.length).toBeGreaterThanOrEqual(1);
    expect(result.deviceMediaIds).toHaveLength(2);

    // Verify verbatim CSV on disk
    const siteRow = (await getDb().sites.get(site.id))!;
    const svRow = (await getDb().surveys.get(sv.id))!;
    const lineDir = await getPath(root, [
      'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', 'L1',
    ]);
    expect(lineDir).not.toBeNull();
    const deviceFilesDir = await getPath(lineDir!, ['device-files']);
    expect(deviceFilesDir).not.toBeNull();
    expect(await fileExists(deviceFilesDir!, '150M_L1.csv')).toBe(true);
    expect(await fileExists(deviceFilesDir!, '150M_Profile_L1.bmp')).toBe(true);
    expect(await fileExists(deviceFilesDir!, '150M_Profile_L1_Processed.bmp')).toBe(true);
    expect(await fileExists(deviceFilesDir!, 'sha256.txt')).toBe(true);

    // Verify parsed readings.csv
    expect(await fileExists(lineDir!, 'readings.csv')).toBe(true);
    const readingsBlob = await readBlob(lineDir!, 'readings.csv');
    const readingsText = await readingsBlob.text();
    expect(readingsText).toContain('point,channel,pass,recordedAt,value');
    // 3 rows × 36 channels = 108 data lines
    const dataLines = readingsText.split(/\r?\n/).filter((l) => l && !l.startsWith('point,'));
    expect(dataLines.length).toBe(108);

    // Verify MediaAsset rows in the cache
    const mediaRows = await getDb().media.where('linkedId').equals(line.id).toArray();
    expect(mediaRows).toHaveLength(2);
    expect(mediaRows.every((r) => r.json.kind === 'device-screen')).toBe(true);
    expect(mediaRows.every((r) => r.json.isOriginal === true)).toBe(true);

    // Verify Line was updated
    const updatedLine = (await getDb().lines.get(line.id))!.json as Line;
    expect(updatedLine.deviceStartPointIndex).toBe(80);
    expect(updatedLine.deviceLineNumber).toBe('1');
    expect(updatedLine.pointCount).toBe(3);
    expect(updatedLine.channelSetSnapshot.channels).toHaveLength(36);
    expect(updatedLine.channelSetSnapshot.channels[0].pseudoDepthM).toBeCloseTo(4.167, 2);
    expect(updatedLine.status).toBe('complete');

    // Points should be constructed from the 3-point fixture + line vertices
    expect(updatedLine.points).toHaveLength(3);
    expect(updatedLine.points[0].index).toBe(1);
    expect(updatedLine.points[0].offsetM).toBe(0);
    expect(updatedLine.points[0].coordSource).toBe('interpolated');
    expect(updatedLine.points[0].readings[0].values).toHaveLength(36);
  });

  it('reads back verbatim CSV bytes matching the input exactly (§7.3)', async () => {
    const { line } = await seedLine();
    await importPqwtIntoLine({ targetLineId: line.id, candidate: mkCandidate(PQWT_L1_MINIMAL_CSV) });

    const lineRow = (await getDb().lines.get(line.id))!;
    const svRow = (await getDb().surveys.get(lineRow.surveyId))!;
    const siteRow = (await getDb().sites.get(svRow.siteId))!;
    const deviceFilesDir = await getPath(root, [
      'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', 'L1', 'device-files',
    ]);
    const back = await readBlob(deviceFilesDir!, '150M_L1.csv');
    const backText = await back.text();
    expect(backText).toBe(PQWT_L1_MINIMAL_CSV);
  });
});

describe('importPqwtIntoLine — error paths (§7.5)', () => {
  it('throws when target line does not exist', async () => {
    await expect(importPqwtIntoLine({
      targetLineId: '01J000MISSING',
      candidate: mkCandidate(PQWT_L1_MINIMAL_CSV),
    })).rejects.toThrow(/not found/i);
  });

  it('throws when CSV is malformed', async () => {
    const { line } = await seedLine();
    await expect(importPqwtIntoLine({
      targetLineId: line.id,
      candidate: mkCandidate('nonsense,not,a,csv\r\n'),
    })).rejects.toThrow();
  });

  it('refuses to re-import (line already has deviceStartPointIndex)', async () => {
    const { line } = await seedLine();
    await importPqwtIntoLine({ targetLineId: line.id, candidate: mkCandidate(PQWT_L1_MINIMAL_CSV) });
    await expect(importPqwtIntoLine({
      targetLineId: line.id,
      candidate: mkCandidate(PQWT_L1_MINIMAL_CSV),
    })).rejects.toThrow(/already been attached/i);
  });
});

describe('importPqwtAsNewLine', () => {
  async function seedSurvey() {
    const site = await createSite({
      name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    return createSurvey(site.id, {
      startedAt: new Date(), timezone: 'Europe/Sofia', operator: 'Anton',
      deviceModel: 'GT-150', precipLast48h: 'none', qualityFlag: 'good',
    });
  }
  const run = (surveyId: string, folder: string, depth: number, csv = PQWT_L1_MINIMAL_CSV) =>
    importPqwtAsNewLine({ surveyId, candidate: mkCandidate(csv, folder, depth) });
  const linesOf = async (surveyId: string) =>
    (await getDb().lines.where('surveyId').equals(surveyId).toArray())
      .map((r) => r.json)
      .sort((a, b) => a.label.localeCompare(b.label));

  it.each([
    [100, 150, '110-150M'],
    [150, 100, '110-100M'],
  ])('imports the same folder in both modes (%sM, then %sM)', async (first, second, suffixed) => {
    const sv = await seedSurvey();
    await run(sv.id, '110', first);
    await run(sv.id, '110', second);

    const lines = await linesOf(sv.id);
    expect(lines.map((l) => l.label)).toEqual(['110', suffixed]);
    expect(lines.map((l) => Math.round(l.channelSetSnapshot.channels.at(-1)!.pseudoDepthM!)))
      .toEqual([first, second]);
  });

  it('rejects a repeat of either mode once both are imported', async () => {
    const sv = await seedSurvey();
    await run(sv.id, '110', 100);
    await run(sv.id, '110', 150);

    await expect(run(sv.id, '110', 100)).rejects.toThrow('Линия 110 (100M) вече е импортирана');
    await expect(run(sv.id, '110', 150)).rejects.toThrow('Линия 110 (150M) вече е импортирана');
    expect(await linesOf(sv.id)).toHaveLength(2);
  });

  it.each([
    ['a bad header', 'broken'],
    ['a header with no data rows', PQWT_L1_MINIMAL_CSV.split('\r\n')[0] + '\r\n'],
  ])('creates nothing for a CSV with %s', async (_name, csv) => {
    const sv = await seedSurvey();
    await expect(run(sv.id, '110', 150, csv)).rejects.toThrow();

    expect(await linesOf(sv.id)).toHaveLength(0);
    const site = (await getDb().sites.toArray())[0];
    const svRow = (await getDb().surveys.get(sv.id))!;
    expect(await getPath(root, ['sites', site.folderName, 'surveys', svRow.folderName, 'lines'])).toBeNull();
  });

  it('completes an empty draft left by a failed import instead of inventing a name', async () => {
    const sv = await seedSurvey();
    const draft = await createLine(sv.id, {
      label: '110', pointCount: 18, spacingM: 2.5,
      mode: 'multi-frequency', dipoleOrientation: 'inline', vertices: [],
    });
    await run(sv.id, '110', 150);

    const lines = await linesOf(sv.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ id: draft.id, label: '110', status: 'complete' });
  });

  it('refuses rather than inventing a name when both names are taken', async () => {
    const sv = await seedSurvey();
    const at = { lat: 42, lon: 23, electrodeIndex: 1 } as Vertex;
    for (const label of ['110', '110-150M']) {
      await createLine(sv.id, {
        label, pointCount: 18, spacingM: 2.5,
        mode: 'multi-frequency', dipoleOrientation: 'inline', vertices: [at],
      });
    }
    await expect(run(sv.id, '110', 150)).rejects.toThrow(/заети/);
    expect(await linesOf(sv.id)).toHaveLength(2);
  });
});

describe('importPqwtAsNewLine — screens for a line imported without them', () => {
  const png = (name: string, byte = 1) => new File([new Uint8Array([0x89, 0x50, byte])], name);
  const RAW = '150M_Profile_L1.png';
  const PROCESSED = '150M_Profile_L1_Processed.png';

  async function importedWithoutScreens() {
    const { sv } = await seedLine();          // occupies L1
    const bare = { ...mkCandidate(PQWT_L1_MINIMAL_CSV, 'L7'), rawBmp: undefined, processedBmp: undefined };
    const { lineId } = await importPqwtAsNewLine({ surveyId: sv.id, candidate: bare });
    const svRow = (await getDb().surveys.get(sv.id))!;
    const site = (await getDb().sites.get(svRow.siteId))!;
    const dir = (await getPath(root, ['sites', site.folderName, 'surveys', svRow.folderName, 'lines', 'L7']))!;
    const files = (await getPath(dir, ['device-files']))!;
    const again = (extra: object) => importPqwtAsNewLine({ surveyId: sv.id, candidate: { ...bare, ...extra } });
    const screens = async () => (await getDb().media.where('linkedId').equals(lineId).toArray())
      .map((m) => m.storagePath.split('/').pop());
    return { lineId, dir, files, again, screens };
  }

  it('adds both screens, processed last, without touching the line', async () => {
    const t = await importedWithoutScreens();
    const before = await (await readBlob(t.dir, 'line.json')).text();

    const res = await t.again({ rawBmp: png(RAW), processedBmp: png(PROCESSED) });

    expect(res).toMatchObject({ lineId: t.lineId, imagesAdded: 2 });
    expect(await t.screens()).toEqual([RAW, PROCESSED]);
    expect(await (await readBlob(t.dir, 'line.json')).text()).toBe(before);
  });

  it('keeps the CSV in the manifest and adds the screens to it', async () => {
    const t = await importedWithoutScreens();
    const before = await (await readBlob(t.files, 'sha256.txt')).text();
    await t.again({ rawBmp: png(RAW), processedBmp: png(PROCESSED) });

    const after = await (await readBlob(t.files, 'sha256.txt')).text();
    expect(after.startsWith(before)).toBe(true);
    expect(after.trim().split('\n').map((l) => l.split('  ')[1]))
      .toEqual(['150M_L7.csv', RAW, PROCESSED]);
  });

  it('survives a rebuild of the cache from the folder', async () => {
    const t = await importedWithoutScreens();
    await t.again({ rawBmp: png(RAW), processedBmp: png(PROCESSED) });
    await resetDb();
    await rebuildCache(await scanRoot(root));

    expect(await t.screens()).toEqual([RAW, PROCESSED]);
  });

  it('adds only the screen that is missing', async () => {
    const t = await importedWithoutScreens();
    await t.again({ rawBmp: png(RAW) });
    const res = await t.again({ rawBmp: png(RAW), processedBmp: png(PROCESSED) });

    expect(res.imagesAdded).toBe(1);
    expect(await t.screens()).toEqual([RAW, PROCESSED]);
  });

  it('reports a duplicate when nothing is missing', async () => {
    const t = await importedWithoutScreens();
    await t.again({ rawBmp: png(RAW) });
    await expect(t.again({ rawBmp: png(RAW) })).rejects.toThrow(/вече е импортирана/);
    expect(await t.screens()).toEqual([RAW]);
  });

  it('does not add a PNG twin of a screen already stored as BMP', async () => {
    const t = await importedWithoutScreens();
    await t.again({ rawBmp: png('150M_Profile_L1.bmp') });
    await expect(t.again({ rawBmp: png(RAW) })).rejects.toThrow(/вече е импортирана/);
    expect(await t.screens()).toEqual(['150M_Profile_L1.bmp']);
  });

  it('never attaches screens from a different measurement with the same code', async () => {
    const t = await importedWithoutScreens();
    const csvText = PQWT_L1_MINIMAL_CSV + ' ';
    await expect(t.again({
      csvText, csvFile: new File([csvText], '150M_L7.csv'), rawBmp: png(RAW),
    })).rejects.toThrow(/различни данни/);
    expect(await t.screens()).toEqual([]);
  });

  it('never overwrites a stored file that has different bytes', async () => {
    const t = await importedWithoutScreens();
    await writeBlob(t.files, RAW, new Uint8Array([9, 9]));
    await expect(t.again({ rawBmp: png(RAW) })).rejects.toThrow(/друго съдържание/);
    expect([...new Uint8Array(await (await readBlob(t.files, RAW)).arrayBuffer())]).toEqual([9, 9]);
  });
});
