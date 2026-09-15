import type { Survey } from './types';
import { newId } from '../util/id';
import { writeJson } from '../storage/atomic';
import { getOrCreatePath, getPath, surveyFolderName } from '../storage/paths';
import { getRoot } from '../storage/fs';
import { getDb } from '../cache/db';
import { readLatestSyncedProbe } from '../storage/sync';

export type SurveyCreateInput = Omit<
  Survey,
  'id' | 'siteId' | 'createdAt' | 'updatedAt' | 'revision' | 'deletedAt' | 'finalizedAt'
>;

export type SurveyUpdateInput = Partial<
  Omit<Survey, 'id' | 'siteId' | 'createdAt' | 'revision' | 'deletedAt'>
>;

interface EditHistoryEntry {
  at: string;      // ISO
  reason: string;
  revision: number;
}

interface SurveyWithHistory extends Survey {
  editHistory?: EditHistoryEntry[];
}

async function nextSequenceForDate(
  siteId: string,
  startedAt: Date,
): Promise<number> {
  const db = getDb();
  const rows = await db.surveys.where('siteId').equals(siteId).toArray();
  // Match "YYYY-MM-DDTHH-mm_sNN" for the same minute stamp.
  const stamp = surveyFolderName(startedAt, 1).slice(0, -4); // strip "_s01"
  let max = 0;
  for (const r of rows) {
    if (r.folderName.startsWith(stamp)) {
      const m = /_s(\d{2})$/.exec(r.folderName);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
  }
  return max + 1;
}

export async function createSurvey(
  siteId: string,
  input: SurveyCreateInput,
): Promise<Survey> {
  const root = getRoot();
  const db = getDb();

  const siteRow = await db.sites.get(siteId);
  if (!siteRow) throw new Error(`site not found: ${siteId}`);

  const seq = await nextSequenceForDate(siteId, input.startedAt);
  const folderName = surveyFolderName(input.startedAt, seq);

  const now = new Date();
  const survey: Survey = {
    ...input,
    id: newId(),
    siteId,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };

  const svDir = await getOrCreatePath(root, [
    'sites', siteRow.folderName, 'surveys', folderName,
  ]);
  await writeJson(svDir, 'survey.json', survey);

  await db.surveys.put({
    id: survey.id,
    siteId,
    folderName,
    json: survey,
  });

  return survey;
}

export async function updateSurvey(
  id: string,
  patch: SurveyUpdateInput,
  opts?: { editReason?: string },
): Promise<Survey> {
  const root = getRoot();
  const db = getDb();

  const row = await db.surveys.get(id);
  if (!row) throw new Error(`survey not found: ${id}`);
  const existing = row.json as SurveyWithHistory;

  if (existing.finalizedAt && !opts?.editReason) {
    throw new Error(
      'survey is finalized; edits require an editReason to be recorded',
    );
  }

  const now = new Date();
  const next: SurveyWithHistory = {
    ...existing,
    ...patch,
    id: existing.id,
    siteId: existing.siteId,
    createdAt: existing.createdAt,
    updatedAt: now,
    revision: existing.revision + 1,
  };

  if (opts?.editReason) {
    const entry: EditHistoryEntry = {
      at: now.toISOString(),
      reason: opts.editReason,
      revision: next.revision,
    };
    next.editHistory = [...(existing.editHistory ?? []), entry];
  }

  const siteRow = await db.sites.get(existing.siteId);
  if (!siteRow) throw new Error(`orphan survey — site missing: ${existing.siteId}`);
  const svDir = await getPath(root, ['sites', siteRow.folderName, 'surveys', row.folderName]);
  if (!svDir) throw new Error(`survey folder missing: ${row.folderName}`);
  await writeJson(svDir, 'survey.json', next);

  await db.surveys.put({ ...row, json: next });
  return next;
}

export async function finalizeSurvey(id: string): Promise<Survey> {
  const root = getRoot();
  const db = getDb();

  const row = await db.surveys.get(id);
  if (!row) throw new Error(`survey not found: ${id}`);

  const lastProbe = await readLatestSyncedProbe(root);
  if (!lastProbe) {
    throw new Error('backup out of date — no sync probe found; sync before finalizing');
  }
  const startedAt = new Date(row.json.startedAt);
  if (lastProbe.getTime() < startedAt.getTime()) {
    throw new Error(
      `backup out of date — last sync probe (${lastProbe.toISOString()}) is older than survey.startedAt (${startedAt.toISOString()}). Sync before finalizing.`,
    );
  }

  const now = new Date();
  const finalized: Survey = {
    ...row.json,
    finalizedAt: now,
    updatedAt: now,
    revision: row.json.revision + 1,
  };

  const siteRow = await db.sites.get(row.siteId);
  if (!siteRow) throw new Error(`orphan survey — site missing: ${row.siteId}`);
  const svDir = await getPath(root, ['sites', siteRow.folderName, 'surveys', row.folderName]);
  if (!svDir) throw new Error(`survey folder missing: ${row.folderName}`);
  await writeJson(svDir, 'survey.json', finalized);

  await db.surveys.put({ ...row, json: finalized });
  return finalized;
}
