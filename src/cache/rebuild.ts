import type { ScanResult } from '../storage/scanner';
import { getDb, SiteRow, SurveyRow, LineRow, MediaRow, OutcomeRow } from './db';
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

  for (const s of scan.sites) {
    siteRows.push({ id: s.site.id, code: s.site.code, folderName: s.folderName, json: s.site });
    for (const sv of s.surveys) {
      surveyRows.push({ id: sv.survey.id, siteId: sv.survey.siteId, folderName: sv.folderName, json: sv.survey });
      for (const ln of sv.lines) {
        lineRows.push({
          id: ln.line.id, surveyId: sv.survey.id, folderName: ln.folderName,
          hasDeviceFiles: ln.hasDeviceFiles, json: ln.line,
        });
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

  await db.transaction('rw', ['sites', 'surveys', 'lines', 'outcomes', 'media', 'meta'], async () => {
    await Promise.all([
      db.sites.clear(), db.surveys.clear(), db.lines.clear(),
      db.outcomes.clear(), db.media.clear(),
    ]);
    await Promise.all([
      db.sites.bulkPut(siteRows),
      db.surveys.bulkPut(surveyRows),
      db.lines.bulkPut(lineRows),
      db.media.bulkPut(mediaRows),
      db.outcomes.bulkPut(outcomeRows),
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
