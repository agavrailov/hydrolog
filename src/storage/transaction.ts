import type { Line, Survey, TransformLogEntry, NoiseZone } from '../domain/types';
import { writeJson, writeBlob } from './atomic';
import { getOrCreatePath } from './paths';

export interface MediaWrite {
  lineFolderName: string;
  fileName: string;
  blob: Blob | BufferSource;
  kind: 'device-files' | 'media';
}

export interface LineWrite {
  lineFolderName: string;
  lineJson: Line;
  verticesGeoJson?: unknown;
  transformLog?: TransformLogEntry[];
  noiseZones?: NoiseZone[];
}

export interface SurveyUpdate {
  sitePath: string[];              // e.g. ['sites', 'BG-SOF-0043_x']
  surveyPath: string[];            // e.g. ['sites', 'BG-SOF-0043_x', 'surveys', 's01']
  mediaWrites: MediaWrite[];
  lineWrites: LineWrite[];
  surveyJson: Survey;              // written last as the commit marker
}

// Order per §10.5:
// 1. Media blobs first (content-addressed, idempotent on retry).
// 2. Referring line.json / interpretation.json.
// 3. survey.json last as the commit marker.
export async function writeSurveyUpdate(
  root: FileSystemDirectoryHandle,
  upd: SurveyUpdate,
): Promise<void> {
  // Step 1: media.
  for (const m of upd.mediaWrites) {
    const dir = await getOrCreatePath(root, [
      ...upd.surveyPath, 'lines', m.lineFolderName, m.kind,
    ]);
    await writeBlob(dir, m.fileName, m.blob);
  }

  // Step 2: line.json (and companion files) per line.
  for (const l of upd.lineWrites) {
    const lineDir = await getOrCreatePath(root, [
      ...upd.surveyPath, 'lines', l.lineFolderName,
    ]);
    await writeJson(lineDir, 'line.json', l.lineJson);
    if (l.verticesGeoJson !== undefined) {
      await writeJson(lineDir, 'vertices.geojson', l.verticesGeoJson);
    }
    if (l.transformLog !== undefined) {
      await writeJson(lineDir, 'transform-log.json', l.transformLog);
    }
    if (l.noiseZones !== undefined) {
      await writeJson(lineDir, 'noise-zones.json', l.noiseZones);
    }
  }

  // Step 3: survey.json — commit marker.
  const svDir = await getOrCreatePath(root, upd.surveyPath);
  await writeJson(svDir, 'survey.json', upd.surveyJson);
}
