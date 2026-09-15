import { describe, it, expect } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { getOrCreatePath } from './paths';
import { writeJson, readJson, fileExists } from './atomic';
import { stubChannelSet } from '../test/fixtures';
import { writeSurveyUpdate } from './transaction';
import type { Line, Survey } from '../domain/types';

const now = new Date('2026-09-13T10:00:00Z');
const survey: Survey = {
  id: 'SV', siteId: 'ST', createdAt: now, updatedAt: now, revision: 1,
  startedAt: now, timezone: 'Europe/Sofia', operator: 'Anton',
  deviceModel: 'PQWT-TC300', deviceSerial: 'x', precipLast48h: 'none',
  qualityFlag: 'good',
};
const line: Line = {
  id: 'LN', createdAt: now, updatedAt: now, revision: 1,
  label: 'L1', pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
  mode: 'multi-frequency', channelSetSnapshot: stubChannelSet(),
  vertices: [], dipoleOrientation: 'inline', transformLog: [],
  points: [], noiseZones: [], status: 'draft',
};

describe('writeSurveyUpdate', () => {
  it('writes media, line.json, then survey.json in order', async () => {
    const root = createMockRoot();
    const svPath = ['sites', 'ST_x', 'surveys', 's01'];
    await getOrCreatePath(root, svPath);  // ensure path exists

    const order: string[] = [];
    const originalWrite = (root as any).__trace = (event: string) => order.push(event);
    void originalWrite;

    await writeSurveyUpdate(root, {
      sitePath: ['sites', 'ST_x'],
      surveyPath: svPath,
      mediaWrites: [{
        lineFolderName: 'L1',
        fileName: 'p05.jpg',
        blob: new Blob([new Uint8Array([1, 2, 3])]),
        kind: 'media',
      }],
      lineWrites: [{ lineFolderName: 'L1', lineJson: line }],
      surveyJson: survey,
    });

    // Verify all files exist.
    const l1Media = await root
      .getDirectoryHandle('sites').then((d) => d.getDirectoryHandle('ST_x'))
      .then((d) => d.getDirectoryHandle('surveys'))
      .then((d) => d.getDirectoryHandle('s01'))
      .then((d) => d.getDirectoryHandle('lines'))
      .then((d) => d.getDirectoryHandle('L1'))
      .then((d) => d.getDirectoryHandle('media'));
    expect(await fileExists(l1Media, 'p05.jpg')).toBe(true);

    const l1Dir = await root
      .getDirectoryHandle('sites').then((d) => d.getDirectoryHandle('ST_x'))
      .then((d) => d.getDirectoryHandle('surveys'))
      .then((d) => d.getDirectoryHandle('s01'))
      .then((d) => d.getDirectoryHandle('lines'))
      .then((d) => d.getDirectoryHandle('L1'));
    expect(await fileExists(l1Dir, 'line.json')).toBe(true);

    const svDir = await root
      .getDirectoryHandle('sites').then((d) => d.getDirectoryHandle('ST_x'))
      .then((d) => d.getDirectoryHandle('surveys'))
      .then((d) => d.getDirectoryHandle('s01'));
    const wroteSurvey = await readJson<Survey>(svDir, 'survey.json');
    expect(wroteSurvey.id).toBe('SV');
  });

  it('a crash after media write leaves survey.json in its previous state', async () => {
    const root = createMockRoot();
    const svPath = ['sites', 'ST_x', 'surveys', 's01'];
    const svDir = await getOrCreatePath(root, svPath);
    // Seed a previous survey.json (v1).
    await writeJson(svDir, 'survey.json', { ...survey, revision: 1 });

    // Simulate crash after media by throwing during line write.
    const broken: any = { ...line };
    Object.defineProperty(broken, 'toJSON', { value: () => { throw new Error('boom'); } });

    await expect(writeSurveyUpdate(root, {
      sitePath: ['sites', 'ST_x'],
      surveyPath: svPath,
      mediaWrites: [{
        lineFolderName: 'L1',
        fileName: 'p05.jpg',
        blob: new Uint8Array([1]),
        kind: 'media',
      }],
      lineWrites: [{ lineFolderName: 'L1', lineJson: broken as Line }],
      surveyJson: { ...survey, revision: 2 },
    })).rejects.toThrow();

    const back = await readJson<Survey>(svDir, 'survey.json');
    expect(back.revision).toBe(1);  // never advanced
  });
});
