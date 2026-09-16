import type { ScanResult } from '../storage/scanner';
import { getDb } from './db';
import { isoNow } from '../util/time';

export async function rebuildCache(scan: ScanResult): Promise<{
  sites: number; surveys: number; lines: number;
}> {
  const db = getDb();
  let sites = 0, surveys = 0, lines = 0;

  await db.transaction('rw', ['sites', 'surveys', 'lines', 'outcomes', 'media', 'meta'], async () => {
    await db.sites.clear();
    await db.surveys.clear();
    await db.lines.clear();
    await db.outcomes.clear();
    await db.media.clear();

    for (const s of scan.sites) {
      await db.sites.put({
        id: s.site.id,
        code: s.site.code,
        folderName: s.folderName,
        json: s.site,
      });
      sites++;

      for (const sv of s.surveys) {
        await db.surveys.put({
          id: sv.survey.id,
          siteId: sv.survey.siteId,
          folderName: sv.folderName,
          json: sv.survey,
        });
        surveys++;

        for (const ln of sv.lines) {
          await db.lines.put({
            id: ln.line.id,
            surveyId: sv.survey.id,
            folderName: ln.folderName,
            hasDeviceFiles: ln.hasDeviceFiles,
            json: ln.line,
          });
          lines++;

          for (const m of ln.deviceMedia) {
            await db.media.put({
              id: m.id,
              linkedKind: m.linkedTo.kind,
              linkedId: m.linkedTo.id,
              storagePath: m.storagePath,
              sha256: m.sha256,
              json: m,
            });
          }
        }

        for (const o of sv.outcomes) {
          await db.outcomes.put({
            id: o.id,
            interpretationId: o.interpretationId,
            json: o,
          });
        }
      }
    }

    await db.meta.put({ key: 'schemaVersion', value: scan.schemaVersion });
    await db.meta.put({ key: 'lastScanCompletedAt', value: isoNow() });
  });

  return { sites, surveys, lines };
}
