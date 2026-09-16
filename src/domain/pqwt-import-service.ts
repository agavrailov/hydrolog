import type { MediaAsset } from './types';
import { newId } from '../util/id';
import { sha256Hex } from '../util/hash';
import { writeJson, writeBlob } from '../storage/atomic';
import { getOrCreatePath } from '../storage/paths';
import { getRoot } from '../storage/fs';
import { getDb } from '../cache/db';
import { parsePqwtCsv } from './pqwt-parser';
import { buildPqwtChannelSet } from './pqwt-channel-set';
import { attachDeviceData } from './line-service';
import { buildLinePoints } from './line-points';
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

  // 7. Register BMPs as MediaAssets (§5.5, §4.13 isOriginal=true — device screens never downscaled)
  const deviceMediaIds: string[] = [];
  const bmpFiles: File[] = [];
  if (input.candidate.rawBmp) bmpFiles.push(input.candidate.rawBmp);
  if (input.candidate.processedBmp) bmpFiles.push(input.candidate.processedBmp);

  const point1 = lineRow.json.vertices[0];
  const now = importedAt;
  for (let i = 0; i < bmpFiles.length; i++) {
    const bmp = bmpFiles[i];
    const bytes = new Uint8Array(await bmp.arrayBuffer());
    const sha = await sha256Hex(bytes);
    const media: MediaAsset = {
      id: newId(),
      createdAt: now, updatedAt: now, revision: 1,
      kind: 'device-screen',
      capturedAt: now,   // device clock unreliable; use import time
      lat: point1?.lat,
      lon: point1?.lon,
      linkedTo: { kind: 'line', id: input.targetLineId },
      storagePath: `sites/${siteRow.folderName}/surveys/${svRow.folderName}/lines/${lineRow.folderName}/device-files/${bmp.name}`,
      sha256: sha,
      isOriginal: true,   // §4.13: device screens never downscaled
    };
    await writeJson(lineDir, `device-media-${i + 1}.json`, media);
    await db.media.put({
      id: media.id,
      linkedKind: media.linkedTo.kind,
      linkedId: media.linkedTo.id,
      storagePath: media.storagePath,
      sha256: media.sha256,
      json: media,
    });
    deviceMediaIds.push(media.id);
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
