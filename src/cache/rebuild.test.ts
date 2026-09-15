import { describe, it, expect, beforeEach } from 'vitest';
import { buildFixtureRoot, stubChannelSet } from '../test/fixtures';
import { scanRoot } from '../storage/scanner';
import { getDb, resetDb } from './db';
import { rebuildCache } from './rebuild';
import type { Site, Survey, Line } from '../domain/types';

beforeEach(async () => { await resetDb(); });

const now = new Date('2026-09-13T10:00:00Z');
const mkSite = (id: string, code: string): Site => ({
  id, code, createdAt: now, updatedAt: now, revision: 1,
  name: 'x', settlement: 'x', municipality: 'x', region: 'x',
  centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
  status: 'surveyed', tags: [],
});
const mkSurvey = (id: string, siteId: string): Survey => ({
  id, siteId, createdAt: now, updatedAt: now, revision: 1,
  startedAt: now, timezone: 'Europe/Sofia', operator: 'Anton',
  deviceModel: 'PQWT-TC300', deviceSerial: 'x', precipLast48h: 'none',
  qualityFlag: 'good',
});
const mkLine = (id: string): Line => ({
  id, createdAt: now, updatedAt: now, revision: 1,
  label: 'L1', pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
  mode: 'multi-frequency', channelSetSnapshot: stubChannelSet(),
  vertices: [], dipoleOrientation: 'inline', transformLog: [],
  points: [], noiseZones: [], status: 'draft',
});

describe('rebuildCache', () => {
  it('populates all tables from a scan and reports counts', async () => {
    const root = await buildFixtureRoot({
      sites: [
        {
          folderName: 'A_x', site: mkSite('SA', 'A'),
          surveys: [{
            folderName: 's01', survey: mkSurvey('SVA', 'SA'),
            lines: [{ folderName: 'L1', line: mkLine('LA1') }],
          }],
        },
        {
          folderName: 'B_x', site: mkSite('SB', 'B'),
          surveys: [{
            folderName: 's01', survey: mkSurvey('SVB', 'SB'),
            lines: [
              { folderName: 'L1', line: mkLine('LB1') },
              { folderName: 'L2', line: mkLine('LB2') },
            ],
          }],
        },
      ],
    });
    const scan = await scanRoot(root);
    const counts = await rebuildCache(scan);
    expect(counts).toEqual({ sites: 2, surveys: 2, lines: 3 });

    const db = getDb();
    expect(await db.sites.count()).toBe(2);
    expect(await db.surveys.count()).toBe(2);
    expect(await db.lines.count()).toBe(3);
    const meta = await db.meta.get('lastScanCompletedAt');
    expect(meta?.value).toBeTruthy();
  });

  it('is idempotent — running twice yields the same state', async () => {
    const root = await buildFixtureRoot({
      sites: [{
        folderName: 'A_x', site: mkSite('SA', 'A'),
        surveys: [{
          folderName: 's01', survey: mkSurvey('SVA', 'SA'),
          lines: [{ folderName: 'L1', line: mkLine('LA1') }],
        }],
      }],
    });
    const scan = await scanRoot(root);
    await rebuildCache(scan);
    await rebuildCache(scan);
    const db = getDb();
    expect(await db.sites.count()).toBe(1);
    expect(await db.lines.count()).toBe(1);
  });
});
