import { describe, it, expect, beforeEach } from 'vitest';
import { setWakeLockAdapter } from '../hardware/wake-lock';
import { setGeolocationAdapter } from '../hardware/geolocation';
import { mockWakeLockAdapter, mockGeolocationAdapter } from '../test/mock-navigator';
import { sampleVertex } from './gps-sampling';

let wl: ReturnType<typeof mockWakeLockAdapter>;
let geo: ReturnType<typeof mockGeolocationAdapter>;

beforeEach(() => {
  wl = mockWakeLockAdapter();
  geo = mockGeolocationAdapter();
  setWakeLockAdapter(wl.adapter);
  setGeolocationAdapter(geo.adapter);
});

async function tick() { return new Promise((r) => setTimeout(r, 0)); }

describe('sampleVertex', () => {
  it('discards the first N fixes and averages the rest', async () => {
    const promise = sampleVertex(1, {
      targetSamples: 5,
      discardFirst: 3,
      timeoutMs: 60_000,
    });

    // Wait for sampleVertex to set up watchPosition
    await tick();

    // Feed 3 bad fixes (should be discarded)
    for (let i = 0; i < 3; i++) {
      geo.pushFix({ lat: 40.0, lon: 20.0, accuracyM: 50 });
      await tick();
    }
    // Feed 5 real fixes clustered around 42.32, 23.78
    for (let i = 0; i < 5; i++) {
      geo.pushFix({ lat: 42.32 + i * 1e-6, lon: 23.78 + i * 1e-6, accuracyM: 6 + i });
      await tick();
    }

    const result = await promise;
    expect(result.sampleCount).toBe(5);
    expect(result.vertex.lat).toBeCloseTo(42.32, 5);
    expect(result.vertex.lon).toBeCloseTo(23.78, 5);
    // Median of [6,7,8,9,10] = 8
    expect(result.medianAccuracyM).toBe(8);
    expect(result.vertex.hAccM).toBe(8);
    expect(result.vertex.hAccMethod).toBe('median-reported');
    expect(result.acceptedDespiteWarning).toBe(false);
    expect(result.vertex.atPointIndex).toBe(1);
  });

  it('sets acceptedDespiteWarning when median accuracy > 15 m', async () => {
    const promise = sampleVertex(17, {
      targetSamples: 3,
      discardFirst: 0,
      timeoutMs: 60_000,
    });
    await tick();
    for (let i = 0; i < 3; i++) {
      geo.pushFix({ lat: 42.32, lon: 23.78, accuracyM: 20 + i });
      await tick();
    }
    const result = await promise;
    expect(result.acceptedDespiteWarning).toBe(true);
    expect(result.medianAccuracyM).toBe(21);
  });

  it('acquires and releases the wake lock', async () => {
    const promise = sampleVertex(1, { targetSamples: 1, discardFirst: 0, timeoutMs: 60_000 });
    await tick();
    geo.pushFix({ lat: 42.32, lon: 23.78, accuracyM: 5 });
    await tick();
    await promise;
    expect(wl.sentinels).toHaveLength(1);
    expect(wl.sentinels[0].released).toBe(true);
  });

  it('reports progress via the callback', async () => {
    const progress: [number, number][] = [];
    const promise = sampleVertex(1, {
      targetSamples: 3,
      discardFirst: 1,
      timeoutMs: 60_000,
      onProgress: (n, a) => progress.push([n, a]),
    });
    await tick();
    geo.pushFix({ accuracyM: 50 });
    await tick();
    geo.pushFix({ accuracyM: 5 });
    await tick();
    geo.pushFix({ accuracyM: 6 });
    await tick();
    geo.pushFix({ accuracyM: 7 });
    await tick();
    await promise;
    // Only the 3 kept samples report progress (indexes 1..3 after the discard).
    expect(progress.map(([n]) => n)).toEqual([1, 2, 3]);
  });

  it('resolves with a partial average when the timeout elapses before targetSamples', async () => {
    const promise = sampleVertex(1, {
      targetSamples: 100,
      discardFirst: 0,
      timeoutMs: 10, // tiny
    });
    await tick();
    // Feed 2 fixes then let the timeout fire
    geo.pushFix({ lat: 42.32, lon: 23.78, accuracyM: 5 });
    geo.pushFix({ lat: 42.32, lon: 23.78, accuracyM: 6 });
    await tick();
    // Wait past the timeout
    await new Promise((r) => setTimeout(r, 20));
    const result = await promise;
    expect(result.sampleCount).toBe(2);
    expect(wl.sentinels[0].released).toBe(true);
  });
});
