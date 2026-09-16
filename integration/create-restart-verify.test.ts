import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../src/test/mock-fs';
import { stubChannelSet } from '../src/test/fixtures';
import { writeJson } from '../src/storage/atomic';
import { getOrCreatePath, siteFolderName, surveyFolderName } from '../src/storage/paths';
import { writeSurveyUpdate } from '../src/storage/transaction';
import { scanRoot } from '../src/storage/scanner';
import { rebuildCache } from '../src/cache/rebuild';
import { getDb, resetDb } from '../src/cache/db';
import { newId } from '../src/util/id';
import { isoNow } from '../src/util/time';
import type { Site, Survey, Line, RegulatoryContext } from '../src/domain/types';

beforeEach(async () => { await resetDb(); });

describe('folder-primary invariant (§10 T21)', () => {
  it('create site+survey+line, wipe cache, rescan → identical rows', async () => {
    // ─── Setup: fresh folder, seed a site.json ─────────────────────
    const root = createMockRoot();
    await writeJson(root, '_schema.json', { version: 'hydrolog-v1' });

    const now = new Date('2026-09-13T10:00:00Z');
    const site: Site = {
      id: newId(), createdAt: now, updatedAt: now, revision: 1,
      name: 'Ivanov', code: 'BG-SOF-0043',
      settlement: 'Долна Баня', municipality: 'Долна Баня', region: 'Софийска',
      centroid: { lat: 42.32, lon: 23.78 },
      accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    };
    const siteFolder = siteFolderName(site.code, site.name);
    const siteDir = await getOrCreatePath(root, ['sites', siteFolder]);
    await writeJson(siteDir, 'site.json', site);

    const reg: RegulatoryContext = {
      insideSOZ: { inside: false },
      waterBodyCode: 'BG3G000',
      nearestRegisteredWellM: 340,
    };
    await writeJson(siteDir, 'regulatory.json', reg);

    // ─── Act: write a survey with one line via the transaction sequencer ──
    const survey: Survey = {
      id: newId(), createdAt: now, updatedAt: now, revision: 1,
      siteId: site.id, startedAt: now, timezone: 'Europe/Sofia',
      operator: 'Anton', deviceModel: 'PQWT-TC300', deviceSerial: 'SN123',
      precipLast48h: 'none', qualityFlag: 'good',
    };
    const line: Line = {
      id: newId(), createdAt: now, updatedAt: now, revision: 1,
      label: 'L1', pointCount: 17, spacingM: 2,
      mode: 'multi-frequency', channelSetSnapshot: stubChannelSet(),
      vertices: [], dipoleOrientation: 'inline', transformLog: [],
      points: [], noiseZones: [], status: 'draft',
    };

    const svFolder = surveyFolderName(now, 1);
    const surveyPath = ['sites', siteFolder, 'surveys', svFolder];

    await writeSurveyUpdate(root, {
      sitePath: ['sites', siteFolder],
      surveyPath,
      mediaWrites: [{
        lineFolderName: 'L1',
        fileName: 'anchor.jpg',
        blob: new Blob([new Uint8Array([1, 2, 3])]),
        kind: 'media',
      }],
      lineWrites: [{
        lineFolderName: 'L1',
        lineJson: line,
        verticesGeoJson: { type: 'LineString', coordinates: [] },
      }],
      surveyJson: survey,
    });

    // Populate cache once.
    let scan = await scanRoot(root);
    let counts = await rebuildCache(scan);
    expect(counts).toEqual({ sites: 1, surveys: 1, lines: 1 });

    // ─── Restart: wipe cache, rescan from folder ─────────────────────
    await resetDb();
    scan = await scanRoot(root);
    counts = await rebuildCache(scan);
    expect(counts).toEqual({ sites: 1, surveys: 1, lines: 1 });

    const db = getDb();
    const gotSite = await db.sites.get(site.id);
    expect(gotSite?.code).toBe('BG-SOF-0043');
    expect(gotSite?.folderName).toBe(siteFolder);

    const gotSurvey = await db.surveys.where('siteId').equals(site.id).first();
    expect(gotSurvey?.folderName).toBe(svFolder);

    const gotLine = await db.lines.where('surveyId').equals(survey.id).first();
    expect(gotLine?.hasDeviceFiles).toBe(false);
    expect(gotLine?.json.label).toBe('L1');
    expect(gotLine?.json.channelSetSnapshot.units).toBe('mV');  // §2 R1
    expect(gotLine?.json.channelSetSnapshot.depthModel).toBe('linear-nominal');  // §2 R3
    expect(gotLine?.json.transformLog).toEqual([]);  // §5.4 (empty array, never undefined)

    // Meta was refreshed.
    const meta = await db.meta.get('lastScanCompletedAt');
    expect(meta?.value).toBeTruthy();
    void isoNow;
  });

  it('a scan with no sites returns an empty result cleanly', async () => {
    const root = createMockRoot();
    await writeJson(root, '_schema.json', { version: 'hydrolog-v1' });
    const scan = await scanRoot(root);
    expect(scan.sites).toEqual([]);
    const counts = await rebuildCache(scan);
    expect(counts).toEqual({ sites: 0, surveys: 0, lines: 0 });
  });
});
