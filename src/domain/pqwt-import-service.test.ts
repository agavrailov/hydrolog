import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { readBlob, fileExists } from '../storage/atomic';
import { getPath } from '../storage/paths';
import { PQWT_L1_MINIMAL_CSV } from '../test/fixtures-pqwt';
import { createSite } from './site-service';
import { createSurvey } from './survey-service';
import { createLine } from './line-service';
import { importPqwtIntoLine, type ImportInto } from './pqwt-import-service';
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
    pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
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
