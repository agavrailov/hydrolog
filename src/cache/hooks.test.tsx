import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { getDb, resetDb } from './db';
import { useSites, useSite, useSurveys, useSurvey, useLines, useLine } from './hooks';

beforeEach(async () => { await resetDb(); });

const siteRow = (id: string, code: string) => ({
  id, code, folderName: `${code}_x`,
  json: {
    id, code, name: 'x', settlement: 'x', municipality: 'x', region: 'x',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed' as const, tags: [] as string[],
    createdAt: new Date(), updatedAt: new Date(), revision: 1,
  },
});

describe('useSites', () => {
  it('returns all non-deleted sites ordered by code', async () => {
    const db = getDb();
    await db.sites.bulkPut([
      siteRow('A', 'BG-PLO-0001'),
      siteRow('B', 'BG-SOF-0001'),
    ]);
    const { result } = renderHook(() => useSites());
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current!.map((r) => r.code)).toEqual(['BG-PLO-0001', 'BG-SOF-0001']);
  });

  it('filters by query (case-insensitive substring against name/settlement/tags)', async () => {
    const db = getDb();
    const a = siteRow('A', 'BG-SOF-0001'); a.json.name = 'Ivanov'; a.json.settlement = 'Долна Баня';
    const b = siteRow('B', 'BG-SOF-0002'); b.json.name = 'Petrov'; b.json.settlement = 'Костенец';
    await db.sites.bulkPut([a, b]);

    const { result } = renderHook(() => useSites({ query: 'ivan' }));
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current!.map((r) => r.code)).toEqual(['BG-SOF-0001']);

    const { result: r2 } = renderHook(() => useSites({ query: 'долна' }));
    await waitFor(() => expect(r2.current).toBeDefined());
    expect(r2.current!.map((r) => r.code)).toEqual(['BG-SOF-0001']);
  });
});

describe('useSite', () => {
  it('returns the row for a given id, or undefined', async () => {
    const db = getDb();
    await db.sites.put(siteRow('A', 'BG-SOF-0001'));
    const { result } = renderHook(() => useSite('A'));
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current?.code).toBe('BG-SOF-0001');
  });
});

describe('useSurveys / useSurvey', () => {
  it('useSurveys returns surveys under a site, newest first', async () => {
    const db = getDb();
    await db.sites.put(siteRow('A', 'BG-SOF-0001'));
    const now = new Date();
    const mkSv = (id: string, folder: string) => ({
      id, siteId: 'A', folderName: folder,
      json: {
        id, siteId: 'A', startedAt: now, timezone: 'Europe/Sofia',
        operator: 'x', deviceModel: 'x', deviceSerial: 'x',
        precipLast48h: 'none' as const, qualityFlag: 'good' as const,
        createdAt: now, updatedAt: now, revision: 1,
      },
    });
    await db.surveys.bulkPut([
      mkSv('S1', '2026-09-01T10-00_s01'),
      mkSv('S2', '2026-09-15T10-00_s01'),
    ]);
    const { result } = renderHook(() => useSurveys('A'));
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current!.map((r) => r.id)).toEqual(['S2', 'S1']);
  });

  it('useSurveys returns empty array when the parent site row is missing', async () => {
    const db = getDb();
    // Survey row exists but no matching site row (simulates soft-deleted parent)
    await db.surveys.put({
      id: 'S1', siteId: 'MISSING', folderName: 's01',
      json: {
        id: 'S1', siteId: 'MISSING', startedAt: new Date(), timezone: 'Europe/Sofia',
        operator: 'x', deviceModel: 'x', deviceSerial: 'x',
        precipLast48h: 'none' as const, qualityFlag: 'good' as const,
        createdAt: new Date(), updatedAt: new Date(), revision: 1,
      },
    });
    const { result } = renderHook(() => useSurveys('MISSING'));
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current).toEqual([]);
  });

  it('useSurvey returns a survey by id', async () => {
    const db = getDb();
    const now = new Date();
    const sv = {
      id: 'S1', siteId: 'A', folderName: '2026-09-01T10-00_s01',
      json: {
        id: 'S1', siteId: 'A', startedAt: now, timezone: 'Europe/Sofia',
        operator: 'x', deviceModel: 'x', deviceSerial: 'x',
        precipLast48h: 'none' as const, qualityFlag: 'good' as const,
        createdAt: now, updatedAt: now, revision: 1,
      },
    };
    await db.surveys.put(sv);
    const { result } = renderHook(() => useSurvey('S1'));
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current?.id).toBe('S1');
  });
});

describe('useLines / useLine', () => {
  const surveyRow = (id: string, siteId: string) => ({
    id, siteId, folderName: `s01`,
    json: {
      id, siteId, startedAt: new Date(), timezone: 'Europe/Sofia',
      operator: 'x', deviceModel: 'x', deviceSerial: 'x',
      precipLast48h: 'none' as const, qualityFlag: 'good' as const,
      createdAt: new Date(), updatedAt: new Date(), revision: 1,
    },
  });

  const lineRow = (id: string, surveyId: string, label: string) => ({
    id, surveyId, folderName: label, hasDeviceFiles: false,
    json: {
      id, label,
      createdAt: new Date(), updatedAt: new Date(), revision: 1,
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency' as const,
      channelSetSnapshot: {
        name: 'x', deviceModel: 'x', kind: 'frequency' as const,
        units: 'mV' as const, depthModel: 'linear-nominal' as const,
        provenanceNote: '', channels: [], frozenAt: new Date(),
      },
      vertices: [], dipoleOrientation: 'inline' as const,
      transformLog: [], points: [], noiseZones: [],
      status: 'draft' as const,
    },
  });

  it('useLines returns lines under a survey, ordered by label', async () => {
    const db = getDb();
    await db.sites.put(siteRow('S', 'BG-SOF-0001'));
    await db.surveys.put(surveyRow('SV', 'S'));
    await db.lines.bulkPut([lineRow('L2id', 'SV', 'L2'), lineRow('L1id', 'SV', 'L1')]);
    const { result } = renderHook(() => useLines('SV'));
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current!.map((r) => r.json.label)).toEqual(['L1', 'L2']);
  });

  it('useLines returns [] when the parent survey row is missing', async () => {
    const db = getDb();
    await db.lines.put(lineRow('L1id', 'MISSING', 'L1'));
    const { result } = renderHook(() => useLines('MISSING'));
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current).toEqual([]);
  });

  it('useLine returns the row by id or undefined', async () => {
    const db = getDb();
    await db.surveys.put(surveyRow('SV', 'S'));
    await db.lines.put(lineRow('L1id', 'SV', 'L1'));
    const { result } = renderHook(() => useLine('L1id'));
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current?.json.label).toBe('L1');
  });
});
