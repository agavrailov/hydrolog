import type { Line, Vertex } from './types';
import { newId } from '../util/id';
import { writeJson, fileExists } from '../storage/atomic';
import { getOrCreatePath, getPath, lineFolderName } from '../storage/paths';
import { getRoot } from '../storage/fs';
import { getDb } from '../cache/db';
import { generateLineLabel } from './line-code';
import { polylineLengthM } from './enu';
import { defaultChannelSetSnapshot } from './channel-set-defaults';

export { defaultChannelSetSnapshot };

export interface LineCreateInput {
  pointCount: number;
  pointSpacingM: number;
  electrodeSpacingM: number;
  mode: Line['mode'];
  dipoleOrientation: Line['dipoleOrientation'];
  vertices: Vertex[];
  point1AnchorMediaId?: string;
  groundSlopePct?: number;
  reliefM?: number;
  polarityConvention?: string;
}

export type LineUpdateInput = Partial<
  Omit<Line, 'id' | 'label' | 'createdAt' | 'revision' | 'deletedAt' | 'channelSetSnapshot'>
>;

function assertSpacing(pointSpacingM: number, electrodeSpacingM: number): void {
  if (!(electrodeSpacingM > pointSpacingM)) {
    throw new Error(
      `electrodeSpacingM (${electrodeSpacingM}) must be strictly greater than pointSpacingM (${pointSpacingM}); check whether they were swapped`,
    );
  }
}

function verticesToGeoJson(vs: Vertex[]) {
  return {
    type: 'LineString' as const,
    coordinates: vs.map((v) => (v.elevM != null ? [v.lon, v.lat, v.elevM] : [v.lon, v.lat])),
  };
}

async function surveyFolderPath(surveyId: string): Promise<{ segments: string[] }> {
  const db = getDb();
  const svRow = await db.surveys.get(surveyId);
  if (!svRow) throw new Error(`survey not found: ${surveyId}`);
  const siteRow = await db.sites.get(svRow.siteId);
  if (!siteRow) throw new Error(`orphan survey — site missing: ${svRow.siteId}`);
  return {
    segments: ['sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines'],
  };
}

export async function createLine(
  surveyId: string,
  input: LineCreateInput,
): Promise<Line> {
  assertSpacing(input.pointSpacingM, input.electrodeSpacingM);

  const root = getRoot();
  const db = getDb();

  // Existing labels under this survey
  const siblings = await db.lines.where('surveyId').equals(surveyId).toArray();
  const label = generateLineLabel(siblings.map((r) => r.json.label));

  const lengthM = polylineLengthM(input.vertices);

  const now = new Date();
  const line: Line = {
    id: newId(),
    createdAt: now, updatedAt: now, revision: 1,
    label,
    pointCount: input.pointCount,
    pointSpacingM: input.pointSpacingM,
    electrodeSpacingM: input.electrodeSpacingM,
    mode: input.mode,
    channelSetSnapshot: defaultChannelSetSnapshot(),
    vertices: input.vertices,
    azimuthSource: 'derived-from-vertices',
    lengthM,
    point1AnchorMediaId: input.point1AnchorMediaId,
    dipoleOrientation: input.dipoleOrientation,
    polarityConvention: input.polarityConvention,
    groundSlopePct: input.groundSlopePct,
    reliefM: input.reliefM,
    transformLog: [],
    points: [],
    noiseZones: [],
    status: 'draft',
  };

  const { segments } = await surveyFolderPath(surveyId);
  const linesDir = await getOrCreatePath(root, segments);
  const lineDir = await getOrCreatePath(linesDir, [lineFolderName(label)]);
  await writeJson(lineDir, 'line.json', line);
  await writeJson(lineDir, 'vertices.geojson', verticesToGeoJson(input.vertices));

  await db.lines.put({
    id: line.id,
    surveyId,
    folderName: lineFolderName(label),
    hasDeviceFiles: false,
    json: line,
  });

  return line;
}

export async function updateLine(id: string, patch: LineUpdateInput): Promise<Line> {
  const root = getRoot();
  const db = getDb();

  const row = await db.lines.get(id);
  if (!row) throw new Error(`line not found: ${id}`);
  const existing = row.json;

  if (patch.pointSpacingM != null || patch.electrodeSpacingM != null) {
    assertSpacing(
      patch.pointSpacingM ?? existing.pointSpacingM,
      patch.electrodeSpacingM ?? existing.electrodeSpacingM,
    );
  }

  const nextVertices = patch.vertices ?? existing.vertices;
  const next: Line = {
    ...existing,
    ...patch,
    id: existing.id,
    label: existing.label,
    channelSetSnapshot: existing.channelSetSnapshot,
    createdAt: existing.createdAt,
    updatedAt: new Date(),
    revision: existing.revision + 1,
    vertices: nextVertices,
    lengthM: polylineLengthM(nextVertices),
  };

  const svRow = await db.surveys.get(row.surveyId);
  if (!svRow) throw new Error(`orphan line — survey missing`);
  const siteRow = await db.sites.get(svRow.siteId);
  if (!siteRow) throw new Error(`orphan line — site missing`);

  const lineDir = await getPath(root, [
    'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', row.folderName,
  ]);
  if (!lineDir) throw new Error(`line folder missing: ${row.folderName}`);

  await writeJson(lineDir, 'line.json', next);
  if (patch.vertices) {
    await writeJson(lineDir, 'vertices.geojson', verticesToGeoJson(nextVertices));
  }
  await db.lines.put({ ...row, json: next });
  return next;
}

export async function softDeleteLine(id: string): Promise<void> {
  const root = getRoot();
  const db = getDb();

  const row = await db.lines.get(id);
  if (!row) throw new Error(`line not found: ${id}`);

  const now = new Date();
  const tombstoned = { ...row.json, deletedAt: now, updatedAt: now, revision: row.json.revision + 1 };
  const tombsDir = await getOrCreatePath(root, ['_tombstones', 'lines']);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  await writeJson(tombsDir, `${row.folderName}_${stamp}.json`, tombstoned);

  const svRow = await db.surveys.get(row.surveyId);
  if (svRow) {
    const siteRow = await db.sites.get(svRow.siteId);
    if (siteRow) {
      const lineDir = await getPath(root, [
        'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', row.folderName,
      ]);
      if (lineDir && (await fileExists(lineDir, 'line.json'))) {
        await lineDir.removeEntry('line.json');
      }
    }
  }

  await db.lines.delete(id);
}
