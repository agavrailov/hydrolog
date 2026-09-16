import type { Interpretation, Anomaly, AnomalyType } from './types';
import { newId } from '../util/id';
import { writeJson, readJson } from '../storage/atomic';
import { getPath } from '../storage/paths';
import { getRoot } from '../storage/fs';
import { getDb } from '../cache/db';

export interface AnomalyInput {
  fromPoint: number;
  toPoint: number;
  fromChannel: number;
  toChannel: number;
  type: AnomalyType;
  confidence: 1 | 2 | 3 | 4 | 5;
  note?: string;
}

async function resolveLineDir(lineId: string): Promise<FileSystemDirectoryHandle> {
  const db = getDb();
  const root = getRoot();
  const row = await db.lines.get(lineId);
  if (!row) throw new Error(`line not found: ${lineId}`);
  const svRow = await db.surveys.get(row.surveyId);
  if (!svRow) throw new Error(`orphan line — survey missing: ${row.surveyId}`);
  const siteRow = await db.sites.get(svRow.siteId);
  if (!siteRow) throw new Error(`orphan line — site missing: ${svRow.siteId}`);
  const dir = await getPath(root, [
    'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', row.folderName,
  ]);
  if (!dir) throw new Error(`line folder missing: ${row.folderName}`);
  return dir;
}

async function loadFromFsa(lineDir: FileSystemDirectoryHandle): Promise<Interpretation | null> {
  try {
    return await readJson<Interpretation>(lineDir, 'interpretation.json');
  } catch {
    return null;
  }
}

async function persist(lineId: string, interp: Interpretation): Promise<void> {
  const db = getDb();
  const dir = await resolveLineDir(lineId);
  await writeJson(dir, 'interpretation.json', interp);
  await db.interpretations.put({ id: interp.id, lineId, json: interp });
}

export async function getOrCreateInterpretation(lineId: string): Promise<Interpretation> {
  const db = getDb();
  const existing = await db.interpretations.where('lineId').equals(lineId).first();
  if (existing) return existing.json;

  const dir = await resolveLineDir(lineId);
  const fromDisk = await loadFromFsa(dir);
  if (fromDisk) {
    await db.interpretations.put({ id: fromDisk.id, lineId, json: fromDisk });
    return fromDisk;
  }

  const now = new Date();
  const fresh: Interpretation = {
    id: newId(),
    createdAt: now, updatedAt: now, revision: 1,
    anomalies: [], correlations: [],
    verdict: 'inconclusive',
    reportText: '', disclaimerVersion: '1.0', author: '',
  };
  await persist(lineId, fresh);
  return fresh;
}

export async function addAnomaly(lineId: string, input: AnomalyInput): Promise<Interpretation> {
  const interp = await getOrCreateInterpretation(lineId);
  const db = getDb();
  const lineRow = await db.lines.get(lineId);
  if (!lineRow) throw new Error(`line not found: ${lineId}`);
  const channels = lineRow.json.channelSetSnapshot.channels;

  const pseudoDepthFromM = channels[input.fromChannel - 1]?.pseudoDepthM ?? 0;
  const pseudoDepthToM = channels[input.toChannel - 1]?.pseudoDepthM ?? 0;

  const anomaly: Anomaly = {
    id: newId(),
    lineId,
    fromPoint: input.fromPoint,
    toPoint: input.toPoint,
    fromChannel: input.fromChannel,
    toChannel: input.toChannel,
    pseudoDepthFromM,
    pseudoDepthToM,
    type: input.type,
    confidence: input.confidence,
    note: input.note,
  };

  const now = new Date();
  const next: Interpretation = {
    ...interp,
    anomalies: [...interp.anomalies, anomaly],
    updatedAt: now,
    revision: interp.revision + 1,
  };
  await persist(lineId, next);
  return next;
}

export async function removeAnomaly(lineId: string, anomalyId: string): Promise<Interpretation> {
  const interp = await getOrCreateInterpretation(lineId);
  const now = new Date();
  const next: Interpretation = {
    ...interp,
    anomalies: interp.anomalies.filter((a) => a.id !== anomalyId),
    updatedAt: now,
    revision: interp.revision + 1,
  };
  await persist(lineId, next);
  return next;
}
