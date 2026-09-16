import { describe, it, expect } from 'vitest';
import { buildFixtureRoot, stubChannelSet } from '../test/fixtures';
import { scanRoot } from './scanner';
import type { Site, Survey, Line } from '../domain/types';

const now = new Date('2026-09-13T10:00:00Z');

const site: Site = {
  id: '01J000SITE',
  createdAt: now, updatedAt: now, revision: 1,
  name: 'Dolna Banya Ivanov',
  code: 'BG-SOF-0043',
  settlement: 'Долна Баня',
  municipality: 'Долна Баня',
  region: 'Софийска',
  centroid: { lat: 42.32, lon: 23.78 },
  accessNotes: '', landUse: '',
  status: 'surveyed', tags: [],
};

const survey: Survey = {
  id: '01J000SURV',
  createdAt: now, updatedAt: now, revision: 1,
  siteId: site.id,
  startedAt: now,
  timezone: 'Europe/Sofia',
  operator: 'Anton',
  deviceModel: 'PQWT-TC300',
  deviceSerial: 'SN123',
  precipLast48h: 'none',
  qualityFlag: 'good',
};

const line: Line = {
  id: '01J000LINE',
  createdAt: now, updatedAt: now, revision: 1,
  label: 'L1',
  pointCount: 17,
  pointSpacingM: 2,
  electrodeSpacingM: 5,
  mode: 'multi-frequency',
  channelSetSnapshot: stubChannelSet(),
  vertices: [],
  dipoleOrientation: 'inline',
  transformLog: [],
  points: [],
  noiseZones: [],
  status: 'draft',
};

describe('scanRoot', () => {
  it('reads a one-site one-survey one-line tree', async () => {
    const root = await buildFixtureRoot({
      sites: [{
        folderName: 'BG-SOF-0043_Dolna-Banya_Ivanov',
        site,
        surveys: [{
          folderName: '2026-09-13T10-00_s01',
          survey,
          lines: [{ folderName: 'L1', line }],
        }],
      }],
    });

    const scan = await scanRoot(root);
    expect(scan.schemaVersion).toBe('hydrolog-v1');
    expect(scan.sites).toHaveLength(1);
    expect(scan.sites[0].site.code).toBe('BG-SOF-0043');
    expect(scan.sites[0].surveys[0].survey.operator).toBe('Anton');
    expect(scan.sites[0].surveys[0].lines[0].line.label).toBe('L1');
    expect(scan.sites[0].surveys[0].lines[0].hasDeviceFiles).toBe(false);
  });

  it('detects device files and media files on a line', async () => {
    const root = await buildFixtureRoot({
      sites: [{
        folderName: 'BG-SOF-0043_x',
        site,
        surveys: [{
          folderName: '2026-09-13T10-00_s01',
          survey,
          lines: [{
            folderName: 'L1', line,
            deviceFiles: ['ThreeFreq.dat', 'ProfileSurvey.dat'],
            mediaFiles: ['p05.jpg', 'voice-01.m4a'],
          }],
        }],
      }],
    });
    const scan = await scanRoot(root);
    const l = scan.sites[0].surveys[0].lines[0];
    expect(l.hasDeviceFiles).toBe(true);
    expect(l.mediaFiles.sort()).toEqual(['p05.jpg', 'voice-01.m4a']);
  });

  it('tolerates missing regulatory.json (optional)', async () => {
    const root = await buildFixtureRoot({
      sites: [{
        folderName: 'BG-SOF-0043_x', site,
        surveys: [{ folderName: 's01', survey, lines: [{ folderName: 'L1', line }] }],
      }],
    });
    const scan = await scanRoot(root);
    expect(scan.sites[0].regulatory).toBeUndefined();
  });

  it('throws when site.json is missing', async () => {
    const root = await buildFixtureRoot({
      sites: [{
        folderName: 'BG-SOF-0043_x', site,
        surveys: [{ folderName: 's01', survey, lines: [{ folderName: 'L1', line }] }],
      }],
    });
    // Remove the site.json to simulate corruption.
    const siteDir = await root.getDirectoryHandle('sites').then((d) =>
      d.getDirectoryHandle('BG-SOF-0043_x'),
    );
    await siteDir.removeEntry('site.json');
    const result = await scanRoot(root);
    expect(result.sites).toHaveLength(0);
  });

  it('skips _tombstones/, _backup_pre_migration_*, _sync_probe/', async () => {
    const root = await buildFixtureRoot({
      sites: [{
        folderName: 'BG-SOF-0043_x', site,
        surveys: [{ folderName: 's01', survey, lines: [{ folderName: 'L1', line }] }],
      }],
    });
    // Add ignored siblings under root.
    await root.getDirectoryHandle('_tombstones', { create: true });
    await root.getDirectoryHandle('_backup_pre_migration_2026-09-14-1200', { create: true });
    await root.getDirectoryHandle('_sync_probe', { create: true });

    const scan = await scanRoot(root);
    expect(scan.sites).toHaveLength(1);
  });
});
