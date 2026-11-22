import type { ScanResult } from '../storage/scanner';
import { getDb, SiteRow, SurveyRow, LineRow, MediaRow, OutcomeRow, InterpretationRow } from './db';
import { isoNow } from '../util/time';

export async function rebuildCache(scan: ScanResult): Promise<{
  sites: number; surveys: number; lines: number;
}> {
  const db = getDb();

  // Flatten first, then write with bulkPut inside one transaction: live
  // queries only see the committed result, so the UI swaps atomically
  // from old cache to new without flicker.
  const siteRows: SiteRow[] = [];
  const surveyRows: SurveyRow[] = [];
  const lineRows: LineRow[] = [];
  const mediaRows: MediaRow[] = [];
  const outcomeRows: OutcomeRow[] = [];
  const interpretations = new Map<string, InterpretationRow>();   // by line id

  for (const s of scan.sites) {
    siteRows.push({ id: s.site.id, code: s.site.code, folderName: s.folderName, json: s.site });
    for (const sv of s.surveys) {
      surveyRows.push({ id: sv.survey.id, siteId: sv.survey.siteId, folderName: sv.folderName, json: sv.survey });
      for (const ln of sv.lines) {
        lineRows.push({
          id: ln.line.id, surveyId: sv.survey.id, folderName: ln.folderName,
          hasDeviceFiles: ln.hasDeviceFiles, json: ln.line,
        });
        if (ln.interpretation) {
          interpretations.set(ln.line.id, {
            id: ln.interpretation.id, lineId: ln.line.id, json: ln.interpretation,
          });
        }
        for (const m of ln.deviceMedia) {
          mediaRows.push({
            id: m.id, linkedKind: m.linkedTo.kind, linkedId: m.linkedTo.id,
            storagePath: m.storagePath, sha256: m.sha256, json: m,
          });
        }
      }
      for (const o of sv.outcomes) {
        outcomeRows.push({ id: o.id, interpretationId: o.interpretationId, json: o });
      }
    }
  }

  await db.transaction('rw', ['sites', 'surveys', 'lines', 'outcomes', 'media', 'interpretations', 'meta'], async () => {
    // The UI is usable during a background scan: an anomaly saved after the scan
    // started is newer than what the scan read.
    for (const row of await db.interpretations.toArray()) {
      if (new Date(row.json.updatedAt) > scan.startedAt) interpretations.set(row.lineId, row);
    }
    await Promise.all([
      db.interpretations.clear(),
      db.sites.clear(), db.surveys.clear(), db.lines.clear(),
      db.outcomes.clear(), db.media.clear(),
    ]);
    await Promise.all([
      db.sites.bulkPut(siteRows),
      db.surveys.bulkPut(surveyRows),
      db.lines.bulkPut(lineRows),
      db.media.bulkPut(mediaRows),
      db.outcomes.bulkPut(outcomeRows),
      db.interpretations.bulkPut([...interpretations.values()]),
    ]);
    await db.meta.put({ key: 'schemaVersion', value: scan.schemaVersion });
    await db.meta.put({ key: 'lastScanCompletedAt', value: isoNow() });
  });

  return { sites: siteRows.length, surveys: surveyRows.length, lines: lineRows.length };
}

export async function hasWarmCache(): Promise<boolean> {
  try {
    return !!(await getDb().meta.get('lastScanCompletedAt'));
  } catch {
    return false;
  }
}
