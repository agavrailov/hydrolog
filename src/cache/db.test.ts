import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, resetDb } from './db';

beforeEach(async () => { await resetDb(); });

describe('HydroLogDb', () => {
  it('has sites, surveys, lines, media, outcomes, meta tables', () => {
    const db = getDb();
    expect(db.sites).toBeDefined();
    expect(db.surveys).toBeDefined();
    expect(db.lines).toBeDefined();
    expect(db.media).toBeDefined();
    expect(db.outcomes).toBeDefined();
    expect(db.meta).toBeDefined();
  });

  it('round-trips a site by id', async () => {
    const db = getDb();
    await db.sites.put({
      id: '01J000',
      code: 'BG-SOF-0043',
      folderName: 'BG-SOF-0043_x',
      json: { name: 'x' } as any,
    });
    const got = await db.sites.get('01J000');
    expect(got?.code).toBe('BG-SOF-0043');
  });

  it('queries surveys by siteId', async () => {
    const db = getDb();
    await db.surveys.bulkPut([
      { id: 'S1', siteId: 'X', folderName: 's01', json: {} as any },
      { id: 'S2', siteId: 'X', folderName: 's02', json: {} as any },
      { id: 'S3', siteId: 'Y', folderName: 's01', json: {} as any },
    ]);
    const forX = await db.surveys.where('siteId').equals('X').toArray();
    expect(forX).toHaveLength(2);
  });

  it('resetDb clears everything', async () => {
    const db = getDb();
    await db.sites.put({ id: '1', code: 'C', folderName: 'F', json: {} as any });
    await resetDb();
    const db2 = getDb();
    expect(await db2.sites.count()).toBe(0);
  });
});
