import { describe, it, expect } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import {
  writeSyncProbe, readLatestSyncedProbe, hoursSinceLastSync, nagLevel,
} from './sync';

describe('sync canary', () => {
  it('writeSyncProbe + readLatestSyncedProbe round-trip', async () => {
    const root = createMockRoot();
    const t = new Date('2026-09-14T09:00:00Z');
    await writeSyncProbe(root, t);
    const back = await readLatestSyncedProbe(root);
    expect(back?.toISOString()).toBe(t.toISOString());
  });

  it('readLatestSyncedProbe returns null when no probes exist', async () => {
    const root = createMockRoot();
    expect(await readLatestSyncedProbe(root)).toBeNull();
  });

  it('reads the newest of many probes', async () => {
    const root = createMockRoot();
    await writeSyncProbe(root, new Date('2026-09-14T09:00:00Z'));
    await writeSyncProbe(root, new Date('2026-09-14T10:00:00Z'));
    await writeSyncProbe(root, new Date('2026-09-14T09:30:00Z'));
    const back = await readLatestSyncedProbe(root);
    expect(back?.toISOString()).toBe('2026-09-14T10:00:00.000Z');
  });

  it('hoursSinceLastSync returns hours difference', async () => {
    const root = createMockRoot();
    await writeSyncProbe(root, new Date('2026-09-14T00:00:00Z'));
    const h = await hoursSinceLastSync(root, new Date('2026-09-14T13:30:00Z'));
    expect(h).toBeCloseTo(13.5, 1);
  });

  it('hoursSinceLastSync returns null when no probe', async () => {
    const root = createMockRoot();
    const h = await hoursSinceLastSync(root, new Date());
    expect(h).toBeNull();
  });
});

describe('nagLevel', () => {
  it('null → red (unknown treated as worst case)', () => {
    expect(nagLevel(null)).toBe('red');
  });
  it('< 12 h → ok', () => {
    expect(nagLevel(11.9)).toBe('ok');
  });
  it('12–24 h → amber', () => {
    expect(nagLevel(12)).toBe('amber');
    expect(nagLevel(23.9)).toBe('amber');
  });
  it('≥ 24 h → red', () => {
    expect(nagLevel(24)).toBe('red');
    expect(nagLevel(100)).toBe('red');
  });
});
