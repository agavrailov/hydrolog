import type { Line, MediaAsset } from './types';
import { newId } from '../util/id';
import { sha256Hex } from '../util/hash';
import { writeJson, writeBlob, readBlob, fileExists } from '../storage/atomic';
import { getOrCreatePath } from '../storage/paths';
import { getRoot } from '../storage/fs';
import { getDb, type LineRow } from '../cache/db';
import { parsePqwtCsv } from './pqwt-parser';
import { buildPqwtChannelSet } from './pqwt-channel-set';
import { attachDeviceData, createLine } from './line-service';
import { buildLinePoints } from './line-points';
import { ELECTRODE_LAYOUT, deviceSpacingM } from './device-config';
import type { PqwtLineCandidate } from './pqwt-import-scanner';

export interface ImportInto {
  targetLineId: string;
  candidate: PqwtLineCandidate;
}

export interface ImportResult {
  lineId: string;
  verbatimPaths: string[];      // relative to line folder
  readingsCsvPath: string;      // relative to line folder
  deviceMediaIds: string[];     // MediaAsset ids
  imagesAdded?: number;         // set when screens were added to an already imported line
}

function readingsToLongCsv(
  channelLabels: string[],
  readings: (number | null)[][],
  recordedAtIso: string,
): string {
  const out: string[] = ['point,channel,pass,recordedAt,value'];
  for (let p = 0; p < readings.length; p++) {
    for (let c = 0; c < channelLabels.length; c++) {
      const v = readings[p][c];
      if (v === null) continue;
      out.push(`${p + 1},${channelLabels[c]},1,${recordedAtIso},${v}`);
    }
  }
  return out.join('\r\n') + '\r\n';
}

async function writeVerbatim(
  deviceFilesDir: FileSystemDirectoryHandle,
  file: File,
): Promise<{ path: string; sha256: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await writeBlob(deviceFilesDir, file.name, bytes);
  const sha256 = await sha256Hex(bytes);
  return { path: `device-files/${file.name}`, sha256 };
}

// A PQWT snapshot spreads the mode's depth linearly over its channels, so the deepest
// channel is the mode (100 / 150). Holds for lines imported before this check existed.
function importedModeM(line: Line): number {
  return Math.round(line.channelSetSnapshot.channels.at(-1)?.pseudoDepthM ?? 0);
}

async function sameBytes(dir: FileSystemDirectoryHandle, file: File): Promise<boolean> {
  const hash = async (b: Blob) => sha256Hex(new Uint8Array(await b.arrayBuffer()));
  return (await hash(await readBlob(dir, file.name))) === (await hash(file));
}

async function registerScreen(input: {
  lineDir: FileSystemDirectoryHandle;
  linePath: string;
  line: Line;
  file: File;
  index: number;                // N in device-media-N.json
  now: Date;
}): Promise<string> {
  const { lineDir, linePath, line, file, index, now } = input;
  const point1 = line.vertices[0];
  const media: MediaAsset = {
    id: newId(),
    createdAt: now, updatedAt: now, revision: 1,
    kind: 'device-screen',
    capturedAt: now,   // device clock unreliable; use import time
    lat: point1?.lat,
    lon: point1?.lon,
    linkedTo: { kind: 'line', id: line.id },
    storagePath: `${linePath}/device-files/${file.name}`,
    sha256: await sha256Hex(new Uint8Array(await file.arrayBuffer())),
    isOriginal: true,   // §4.13: device screens never downscaled
  };
  await writeJson(lineDir, `device-media-${index}.json`, media);
  await getDb().media.put({
    id: media.id,
    linkedKind: media.linkedTo.kind,
    linkedId: media.linkedTo.id,
    storagePath: media.storagePath,
    sha256: media.sha256,
    json: media,
  });
  return media.id;
}

// Re-importing a line adds screens it does not have yet. The stored CSV must be
// byte-identical: device codes repeat between sites and days, so code + mode alone
// could hang another measurement's screens on this line.
async function addMissingScreens(row: LineRow, candidate: PqwtLineCandidate): Promise<ImportResult> {
  const db = getDb();
  const name = `${candidate.folderName} (${candidate.depthRangeM}M)`;
  const alreadyImported = new Error(`Линия ${name} вече е импортирана`);

  const sv = (await db.surveys.get(row.surveyId))!;
  const site = await db.sites.get(sv.siteId);
  if (!site) throw new Error(`orphan line — site missing: ${sv.siteId}`);
  const segments = ['sites', site.folderName, 'surveys', sv.folderName, 'lines', row.folderName];
  const lineDir = await getOrCreatePath(getRoot(), segments);
  const filesDir = await getOrCreatePath(lineDir, ['device-files']);

  if (!(await fileExists(filesDir, candidate.csvFile.name))) throw alreadyImported;
  if (!(await sameBytes(filesDir, candidate.csvFile))) {
    throw new Error(`Линия ${name} вече е импортирана с различни данни — не трий този файл от уреда`);
  }

  // Compared without extension: the same screen may be stored as BMP and offered as PNG.
  const stem = (path: string) => path.split('/').pop()!.replace(/\.[^.]+$/, '').toLowerCase();
  const stored = (await db.media.where('linkedId').equals(row.id).toArray()).map((m) => stem(m.storagePath));
  const missing = [candidate.rawBmp, candidate.processedBmp]
    .filter((f): f is File => !!f && !stored.includes(stem(f.name)));
  if (missing.length === 0) throw alreadyImported;

  for (const file of missing) {
    if ((await fileExists(filesDir, file.name)) && !(await sameBytes(filesDir, file))) {
      throw new Error(`${file.name} вече е записан с друго съдържание — не го презаписвам`);
    }
  }

  let manifest = (await fileExists(filesDir, 'sha256.txt'))
    ? await (await readBlob(filesDir, 'sha256.txt')).text()
    : '';
  const now = new Date();
  const verbatimPaths: string[] = [];
  const deviceMediaIds: string[] = [];
  let index = 1;
  for (const file of missing) {
    const { path, sha256 } = await writeVerbatim(filesDir, file);
    verbatimPaths.push(path);
    const entry = `${sha256}  ${file.name}\n`;
    if (!manifest.includes(entry)) manifest += entry;
    await writeBlob(filesDir, 'sha256.txt', new TextEncoder().encode(manifest));
    while (await fileExists(lineDir, `device-media-${index}.json`)) index++;
    deviceMediaIds.push(await registerScreen({
      lineDir, linePath: segments.join('/'), line: row.json, file, index, now,
    }));
  }

  return {
    lineId: row.id,
    verbatimPaths,
    readingsCsvPath: 'readings.csv',
    deviceMediaIds,
    imagesAdded: missing.length,
  };
}

export interface ImportAsNew {
  surveyId: string;
  candidate: PqwtLineCandidate;
}

export async function importPqwtAsNewLine(input: ImportAsNew): Promise<ImportResult> {
  const db = getDb();
  const svRow = await db.surveys.get(input.surveyId);
  if (!svRow) throw new Error(`survey not found: ${input.surveyId}`);

  // Validate before creating anything on disk.
  parsePqwtCsv(input.candidate.csvText);

  // A device line is identified by mode + folder: the device keeps the same code in 100M
  // and 150M. The first one imported keeps the folder name, the other gets a mode suffix.
  const { folderName, depthRangeM } = input.candidate;
  const names = [folderName, `${folderName}-${depthRangeM}M`];
  const rows = (await db.lines.where('surveyId').equals(input.surveyId).toArray())
    .filter((r) => names.includes(r.json.label));
  const siblings = rows.map((r) => r.json);
  const hasData = (l: Line) => l.deviceStartPointIndex !== undefined;

  const imported = rows.find((r) => hasData(r.json) && importedModeM(r.json) === depthRangeM);
  if (imported) return addMissingScreens(imported, input.candidate);

  // An empty draft under this name is what an interrupted import leaves behind.
  const unfinished = siblings.find((l) => !hasData(l) && l.vertices.length === 0);
  if (unfinished) return importPqwtIntoLine({ targetLineId: unfinished.id, candidate: input.candidate });

  const label = names.find((n) => !siblings.some((l) => l.label === n));
  if (!label) throw new Error(`Имената ${names.join(' и ')} вече са заети в това проучване`);

  // Placeholders from the device model — pointCount is overwritten below from the
  // actual CSV row count; spacingM is cable geometry and has no better source.
  const layout = ELECTRODE_LAYOUT[svRow.json.deviceModel];
  const line = await createLine(input.surveyId, {
    label,
    pointCount: layout?.active ?? 17,
    spacingM: deviceSpacingM(svRow.json.deviceModel) ?? 2,
    mode: 'multi-frequency',
    dipoleOrientation: 'inline',
    vertices: [],
  });

  return importPqwtIntoLine({ targetLineId: line.id, candidate: input.candidate });
}

export async function importPqwtIntoLine(input: ImportInto): Promise<ImportResult> {
  const root = getRoot();
  const db = getDb();

  // 1. Parse first (fail fast before any file writes)
  const parsed = parsePqwtCsv(input.candidate.csvText);

  // 2. Verify target line + parent survey + parent site
  const lineRow = await db.lines.get(input.targetLineId);
  if (!lineRow) throw new Error(`line not found: ${input.targetLineId}`);
  const svRow = await db.surveys.get(lineRow.surveyId);
  if (!svRow) throw new Error(`orphan line — survey missing: ${lineRow.surveyId}`);
  const siteRow = await db.sites.get(svRow.siteId);
  if (!siteRow) throw new Error(`orphan line — site missing: ${svRow.siteId}`);

  // 3. Build ChannelSet from parsed header + depth-range from candidate + survey device model
  const channelSetSnapshot = buildPqwtChannelSet({
    channelLabels: parsed.channelLabels,
    depthRangeM: input.candidate.depthRangeM,
    deviceModel: svRow.json.deviceModel,
  });

  const importedAt = new Date();

  // 3b. Build Line.points[] — GPS-interpolated positions zipped with readings
  const points = buildLinePoints({
    vertices: lineRow.json.vertices,
    pointCount: parsed.pointCount,
    channelSet: channelSetSnapshot,
    parsedReadings: parsed.readings,
    recordedAt: importedAt,
    electrodeLayout: ELECTRODE_LAYOUT[svRow.json.deviceModel],
  });

  // 4. Write verbatim raw files to device-files/ (§7.3)
  const lineDirSegments = [
    'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', lineRow.folderName,
  ];
  const lineDir = await getOrCreatePath(root, lineDirSegments);
  const deviceFilesDir = await getOrCreatePath(lineDir, ['device-files']);

  const verbatimResults: { path: string; sha256: string }[] = [];
  verbatimResults.push(await writeVerbatim(deviceFilesDir, input.candidate.csvFile));
  if (input.candidate.rawBmp) {
    verbatimResults.push(await writeVerbatim(deviceFilesDir, input.candidate.rawBmp));
  }
  if (input.candidate.processedBmp) {
    verbatimResults.push(await writeVerbatim(deviceFilesDir, input.candidate.processedBmp));
  }

  // 5. Write SHA-256 manifest
  const sha256Manifest = verbatimResults
    .map((r) => `${r.sha256}  ${r.path.replace('device-files/', '')}`)
    .join('\n') + '\n';
  await writeBlob(deviceFilesDir, 'sha256.txt', new TextEncoder().encode(sha256Manifest));

  // 6. Write parsed readings.csv (long format; skip null values per brief)
  const recordedAtIso = importedAt.toISOString();
  const readingsCsv = readingsToLongCsv(parsed.channelLabels, parsed.readings, recordedAtIso);
  await writeBlob(lineDir, 'readings.csv', new TextEncoder().encode(readingsCsv));

  // 7. Register screens as MediaAssets (§5.5, §4.13 isOriginal=true — device screens never downscaled)
  const deviceMediaIds: string[] = [];
  const bmpFiles: File[] = [];
  if (input.candidate.rawBmp) bmpFiles.push(input.candidate.rawBmp);
  if (input.candidate.processedBmp) bmpFiles.push(input.candidate.processedBmp);

  for (let i = 0; i < bmpFiles.length; i++) {
    deviceMediaIds.push(await registerScreen({
      lineDir, linePath: lineDirSegments.join('/'), line: lineRow.json,
      file: bmpFiles[i], index: i + 1, now: importedAt,
    }));
  }

  // 8. Attach device data to the Line (guarded — first import only; sets status='complete')
  await attachDeviceData(input.targetLineId, {
    channelSetSnapshot,
    pointCount: parsed.pointCount,
    deviceStartPointIndex: parsed.startN,
    deviceLineNumber: parsed.deviceLineLabel,
    mode: 'multi-frequency',
    status: 'complete',
    points,
  });

  return {
    lineId: input.targetLineId,
    verbatimPaths: verbatimResults.map((r) => r.path),
    readingsCsvPath: 'readings.csv',
    deviceMediaIds,
  };
}
