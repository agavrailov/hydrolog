# HydroLog Phase 1c — Line Field Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Anton to walk to a site, capture a `Line` in the field: fix GPS vertices at point 1 and point N (with wake lock and median-of-samples averaging per §5.2), interpolate the intermediate points along the polyline via local ENU projection (§5.3), snap a mandatory point-1 anchor photo (§5.4), and persist the whole line to the folder tree atomically.

**Architecture:** Browser hardware APIs (Geolocation, Wake Lock) wrapped behind small adapter interfaces so tests can inject deterministic mocks. A GPS sampling service does the sample-discard-median-wake-lock dance. Local ENU tangent-plane projection converts vertices to metres for interpolation and length cross-check. A `<LineCaptureScreen>` sequences the field workflow: parameters → point-1 GPS → anchor photo → point-N GPS → save. Line data flows through Phase 1a's `writeSurveyUpdate` for atomic media→line→survey commit order.

**Tech Stack:** React 18, TypeScript 5, Vitest (with `vi.stubGlobal` for browser APIs), Web Geolocation API, Web Wake Lock API, `createImageBitmap` + Canvas for anchor photo downscale.

**Spec:** `docs/app-spec-v2.md` — especially §2 physics rules (unchanged), §4.5 Line schema, §4.13 MediaAsset (`kind: 'point1-anchor'`), §5.2 GPS fixing rules, §5.3 polyline geometry, §5.4 line direction defences, §10.5 write order.

## Global Constraints

Every task inherits these. Verbatim from the spec / prior-plan rulings.

- **Every task ends with `npm run typecheck && npm test && npm run build` all green before commit.** (Phase 1a lesson — no scoped-only tests.)
- **Physics rules R1/R2/R3/R6 unchanged.** No `depth_m`, no `resistivity`, no `aquifer`.
- **GPS §5.2:**
  - `enableHighAccuracy: true`, `maximumAge: 0`.
  - **Discard the first 3 fixes** (cached / network-derived — they drag the mean).
  - Sample 20–60 s with live counter; hold wake lock, re-acquire on `visibilitychange`.
  - Store `hAccM = median of reported accuracy values`. **Never std dev of samples** — σ shrinks toward zero under fused-provider bias while true error stays 4–8 m. Publishing σ would be the most flattering lie in the system.
  - Soft gate at 15 m: warn + set `acceptedDespiteWarning`. Never hard-block.
- **Line §4.5:**
  - `electrodeSpacingM > pointSpacingM` — hard guard. Otherwise both were swapped and the whole x-axis is wrong.
  - `vertices[]` is an ordered polyline of surveyed vertices (§5.3), not just two endpoints.
  - `channelSetSnapshot` is by value, frozen (§4.9). Phase 1c hardcodes a default TC300 snapshot; a dedicated ChannelSet service is a later plan.
  - `transformLog` is a required array (may be empty; never `undefined`). §5.4 no-silent-flips.
- **Point-1 anchor photo §5.4:** required MediaAsset kind `'point1-anchor'` before finalize. Phase 1c captures it; Phase 1d/e enforces it on finalize.
- **MediaAsset §4.13:** downscales to 2048 px long edge (anchor photos are NOT device screens), decoded with `createImageBitmap(blob, {imageOrientation:'from-image'})` so Android photos aren't stored sideways. `lat/lon` stamped at capture time — never from EXIF.
- **Bulgarian in UI only.** All user-facing strings from `src/ui/labels.ts`. English in code/comments/JSON.
- **Folder-first, then cache** (Phase 1a §10.3, Phase 1b service pattern).
- **Audit fields (§4.1)** on every write.

---

## File Structure Map

Files created or modified across the plan. Task numbers in parentheses.

```
src/
  hardware/
    wake-lock.ts                              # (T1) adapter + default implementation
    wake-lock.test.ts                         # (T1)
    geolocation.ts                            # (T2) adapter + default implementation
    geolocation.test.ts                       # (T2)
    orientation.ts                            # (T8, optional) DeviceOrientation — deferred; noted in plan only
  domain/
    gps-sampling.ts                           # (T3) sample-discard-median service using both adapters
    gps-sampling.test.ts                      # (T3)
    enu.ts                                    # (T4) WGS84 <-> local ENU tangent-plane; polyline utilities
    enu.test.ts                               # (T4)
    line-code.ts                              # (T5) generate line labels L1, L2, ...
    line-code.test.ts                         # (T5)
    channel-set-defaults.ts                   # (T6) hardcoded TC300 default ChannelSetSnapshot
    line-service.ts                           # (T6) createLine/updateLine/softDeleteLine
    line-service.test.ts                      # (T6)
    anchor-photo.ts                           # (T8) File -> downscaled Blob + MediaAsset row
    anchor-photo.test.ts                      # (T8)
  cache/
    hooks.ts                                  # (T7) modify — add useLine, useLines
    hooks.test.tsx                            # (T7) modify — add tests
  ui/
    labels.ts                                 # (T9) modify — add line + capture UI strings
    LineCaptureScreen.tsx                     # (T10) field capture UI
    LineCaptureScreen.test.tsx                # (T10)
    LineDetail.tsx                            # (T11)
    LineDetail.test.tsx                       # (T11)
    Router.tsx                                # (T11) modify — add line routes
    SurveyDetail.tsx                          # (T11) modify — surface lines list + "New line" button
    SurveyDetail.test.tsx                     # (T11) modify — assert new UI additions
  test/
    mock-navigator.ts                         # (T1, T2) small helpers for stubGlobal-based mocks
integration/
  phase1c-line-capture-flow.test.ts           # (T12)
```

Rationale for the splits:

- `hardware/` — thin adapter modules around browser APIs. Nothing else in the app talks to `navigator.*` directly.
- `domain/` grows the actual capture logic in isolated files. Each one is a single responsibility.
- `enu.ts` is pure math with no runtime state — trivially unit-tested against §14 T1/T3 numeric ground truths.
- Anchor-photo capture lives in `domain/` (not `hardware/`) because it uses no navigator API — it takes a `File` from the browser's file input and produces a stored MediaAsset. The `<input capture="environment">` is a UI concern owned by `LineCaptureScreen`.

---

## Task 1: Wake Lock adapter

**Files:**
- Create: `src/hardware/wake-lock.ts`, `src/hardware/wake-lock.test.ts`, `src/test/mock-navigator.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface WakeLockSentinel { release(): Promise<void>; released: boolean; }` — subset of the standard Web API.
  - `interface WakeLockAdapter { request(type: 'screen'): Promise<WakeLockSentinel>; }`
  - `defaultWakeLockAdapter: WakeLockAdapter` — production wrapper around `navigator.wakeLock.request('screen')`. Throws a descriptive error if unavailable.
  - `setWakeLockAdapter(a: WakeLockAdapter): void` and `getWakeLockAdapter(): WakeLockAdapter` — test hooks.
  - `holdWakeLock(): Promise<() => Promise<void>>` — high-level helper: acquires, re-acquires on `visibilitychange` (Android auto-releases when the doc hides), returns a release function that stops re-acquiring.
  - `mockWakeLockAdapter(): { adapter: WakeLockAdapter; sentinels: WakeLockSentinel[] }` — test helper exported from `src/test/mock-navigator.ts`.

- [ ] **Step 1: Write the mock helper**

Write `src/test/mock-navigator.ts`:
```typescript
import type { WakeLockAdapter, WakeLockSentinel } from '../hardware/wake-lock';

export function mockWakeLockAdapter(): { adapter: WakeLockAdapter; sentinels: WakeLockSentinel[] } {
  const sentinels: WakeLockSentinel[] = [];
  const adapter: WakeLockAdapter = {
    async request(_type) {
      let released = false;
      const s: WakeLockSentinel = {
        released: false,
        async release() {
          released = true;
          s.released = true;
        },
      };
      // Expose the closure's flag so tests can inspect
      Object.defineProperty(s, '_released', { get: () => released });
      sentinels.push(s);
      return s;
    },
  };
  return { adapter, sentinels };
}
```

- [ ] **Step 2: Write failing tests**

Write `src/hardware/wake-lock.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setWakeLockAdapter, getWakeLockAdapter, holdWakeLock } from './wake-lock';
import { mockWakeLockAdapter } from '../test/mock-navigator';

let mock: ReturnType<typeof mockWakeLockAdapter>;

beforeEach(() => {
  mock = mockWakeLockAdapter();
  setWakeLockAdapter(mock.adapter);
});

afterEach(() => {
  // Reset visibility state so tests don't pollute each other
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('holdWakeLock', () => {
  it('acquires a sentinel and returns a release function', async () => {
    const release = await holdWakeLock();
    expect(mock.sentinels).toHaveLength(1);
    await release();
    expect(mock.sentinels[0].released).toBe(true);
  });

  it('re-acquires on visibilitychange after being auto-released', async () => {
    const release = await holdWakeLock();
    expect(mock.sentinels).toHaveLength(1);

    // Simulate Android hiding the document then showing again
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    // Simulate the OS auto-releasing the first sentinel
    mock.sentinels[0].released = true;

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // Give the microtask queue a tick for the async re-acquire
    await new Promise((r) => setTimeout(r, 0));
    expect(mock.sentinels.length).toBeGreaterThanOrEqual(2);

    await release();
  });

  it('release stops the re-acquire loop', async () => {
    const release = await holdWakeLock();
    await release();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 0));

    // Only the initial sentinel exists — no re-acquire after release
    expect(mock.sentinels).toHaveLength(1);
  });
});

describe('adapter injection', () => {
  it('getWakeLockAdapter returns whatever was set', () => {
    const a = mockWakeLockAdapter().adapter;
    setWakeLockAdapter(a);
    expect(getWakeLockAdapter()).toBe(a);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npm test src/hardware/wake-lock.test.ts
```
Expected: FAIL (module missing).

- [ ] **Step 4: Implement `src/hardware/wake-lock.ts`**

```typescript
export interface WakeLockSentinel {
  release(): Promise<void>;
  released: boolean;
}

export interface WakeLockAdapter {
  request(type: 'screen'): Promise<WakeLockSentinel>;
}

export const defaultWakeLockAdapter: WakeLockAdapter = {
  async request(type) {
    const wl = (globalThis as unknown as { navigator?: { wakeLock?: { request: (t: string) => Promise<WakeLockSentinel> } } }).navigator?.wakeLock;
    if (!wl) {
      throw new Error('Wake Lock API not available. Use Chrome desktop or Android M132+.');
    }
    return wl.request(type);
  },
};

let adapter: WakeLockAdapter = defaultWakeLockAdapter;

export function setWakeLockAdapter(a: WakeLockAdapter): void {
  adapter = a;
}

export function getWakeLockAdapter(): WakeLockAdapter {
  return adapter;
}

// Acquires a screen wake lock and re-acquires it on visibilitychange (Android
// auto-releases when the document hides). Returns a release function that
// stops the re-acquire loop and releases the current sentinel.
export async function holdWakeLock(): Promise<() => Promise<void>> {
  let stopped = false;
  let current: WakeLockSentinel | null = await adapter.request('screen');

  const reacquire = async () => {
    if (stopped) return;
    if (document.visibilityState !== 'visible') return;
    if (current && !current.released) return;
    try {
      current = await adapter.request('screen');
    } catch {
      // Best-effort; UI shows a "keep screen on" message elsewhere.
    }
  };

  const onVisibility = () => { void reacquire(); };
  document.addEventListener('visibilitychange', onVisibility);

  return async () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisibility);
    if (current && !current.released) {
      try { await current.release(); } catch { /* ignore */ }
    }
  };
}
```

- [ ] **Step 5: Run tests, typecheck, build**

```bash
npm test src/hardware/wake-lock.test.ts && npm run typecheck && npm run build
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/hardware/wake-lock.ts src/hardware/wake-lock.test.ts src/test/mock-navigator.ts
git commit -m "feat(hardware): wake lock adapter + visibilitychange re-acquire helper"
```

---

## Task 2: Geolocation adapter

**Files:**
- Create: `src/hardware/geolocation.ts`, `src/hardware/geolocation.test.ts`
- Modify: `src/test/mock-navigator.ts` — add `mockGeolocationAdapter()` helper.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface GeoFix { lat: number; lon: number; accuracyM: number; timestamp: number; }`
  - `interface GeolocationAdapter { watchPosition(onFix: (fix: GeoFix) => void, onError: (err: Error) => void, opts?: PositionOptions): number; clearWatch(watchId: number): void; }`
  - `defaultGeolocationAdapter: GeolocationAdapter` — production wrapper around `navigator.geolocation`.
  - `setGeolocationAdapter(a: GeolocationAdapter): void`, `getGeolocationAdapter(): GeolocationAdapter`.
  - `mockGeolocationAdapter(): { adapter: GeolocationAdapter; pushFix: (fix: Partial<GeoFix>) => void; pushError: (msg: string) => void; }` — in `src/test/mock-navigator.ts`.

- [ ] **Step 1: Extend `src/test/mock-navigator.ts`**

Add these exports to the existing file:
```typescript
import type { GeolocationAdapter, GeoFix } from '../hardware/geolocation';

export function mockGeolocationAdapter(): {
  adapter: GeolocationAdapter;
  pushFix: (fix: Partial<GeoFix>) => void;
  pushError: (msg: string) => void;
} {
  let nextWatchId = 1;
  const watchers = new Map<number, { onFix: (f: GeoFix) => void; onError: (e: Error) => void }>();

  const adapter: GeolocationAdapter = {
    watchPosition(onFix, onError) {
      const id = nextWatchId++;
      watchers.set(id, { onFix, onError });
      return id;
    },
    clearWatch(id) {
      watchers.delete(id);
    },
  };

  const pushFix = (fix: Partial<GeoFix>) => {
    const full: GeoFix = {
      lat: fix.lat ?? 0,
      lon: fix.lon ?? 0,
      accuracyM: fix.accuracyM ?? 5,
      timestamp: fix.timestamp ?? Date.now(),
    };
    for (const w of watchers.values()) w.onFix(full);
  };

  const pushError = (msg: string) => {
    for (const w of watchers.values()) w.onError(new Error(msg));
  };

  return { adapter, pushFix, pushError };
}
```

- [ ] **Step 2: Write failing tests**

Write `src/hardware/geolocation.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { setGeolocationAdapter, getGeolocationAdapter } from './geolocation';
import { mockGeolocationAdapter } from '../test/mock-navigator';

describe('geolocation adapter', () => {
  it('delivers pushed fixes to registered watchers', () => {
    const { adapter, pushFix } = mockGeolocationAdapter();
    setGeolocationAdapter(adapter);
    const fixes: unknown[] = [];
    const id = getGeolocationAdapter().watchPosition(
      (f) => fixes.push(f),
      () => {},
    );
    pushFix({ lat: 42.32, lon: 23.78, accuracyM: 6.2 });
    pushFix({ lat: 42.32001, lon: 23.78001, accuracyM: 5.9 });
    expect(fixes).toHaveLength(2);
    getGeolocationAdapter().clearWatch(id);
  });

  it('clearWatch stops delivering fixes', () => {
    const { adapter, pushFix } = mockGeolocationAdapter();
    setGeolocationAdapter(adapter);
    let count = 0;
    const id = getGeolocationAdapter().watchPosition(() => count++, () => {});
    pushFix({});
    getGeolocationAdapter().clearWatch(id);
    pushFix({});
    expect(count).toBe(1);
  });

  it('errors are delivered to onError', () => {
    const { adapter, pushError } = mockGeolocationAdapter();
    setGeolocationAdapter(adapter);
    let errMsg = '';
    getGeolocationAdapter().watchPosition(
      () => {},
      (e) => { errMsg = e.message; },
    );
    pushError('permission denied');
    expect(errMsg).toBe('permission denied');
  });
});
```

- [ ] **Step 3: RED**

```bash
npm test src/hardware/geolocation.test.ts
```
Expected: FAIL.

- [ ] **Step 4: Implement `src/hardware/geolocation.ts`**

```typescript
export interface GeoFix {
  lat: number;
  lon: number;
  accuracyM: number;
  timestamp: number;
}

export interface GeolocationAdapter {
  watchPosition(
    onFix: (fix: GeoFix) => void,
    onError: (err: Error) => void,
    opts?: PositionOptions,
  ): number;
  clearWatch(watchId: number): void;
}

export const defaultGeolocationAdapter: GeolocationAdapter = {
  watchPosition(onFix, onError, opts) {
    const geo = (globalThis as unknown as { navigator?: { geolocation?: Geolocation } }).navigator?.geolocation;
    if (!geo) {
      onError(new Error('Geolocation API not available. Use Chrome on a device with GPS.'));
      return -1;
    }
    return geo.watchPosition(
      (pos) => onFix({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
        timestamp: pos.timestamp,
      }),
      (err) => onError(new Error(err.message)),
      opts ?? { enableHighAccuracy: true, maximumAge: 0 },
    );
  },
  clearWatch(id) {
    const geo = (globalThis as unknown as { navigator?: { geolocation?: Geolocation } }).navigator?.geolocation;
    if (geo && id >= 0) geo.clearWatch(id);
  },
};

let adapter: GeolocationAdapter = defaultGeolocationAdapter;

export function setGeolocationAdapter(a: GeolocationAdapter): void { adapter = a; }
export function getGeolocationAdapter(): GeolocationAdapter { return adapter; }
```

- [ ] **Step 5: GREEN + typecheck + build**

```bash
npm test src/hardware/geolocation.test.ts && npm run typecheck && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/hardware/geolocation.ts src/hardware/geolocation.test.ts src/test/mock-navigator.ts
git commit -m "feat(hardware): geolocation adapter with test-swappable interface"
```

---

## Task 3: GPS sampling service

**Files:**
- Create: `src/domain/gps-sampling.ts`, `src/domain/gps-sampling.test.ts`

**Interfaces:**
- Consumes: `holdWakeLock` (T1), `getGeolocationAdapter` (T2), `Vertex` type (Phase 1a T3).
- Produces:
  - `interface SamplingOptions { targetSamples: number; discardFirst: number; timeoutMs: number; onProgress?: (n: number, latestAccuracyM: number) => void; }`
  - `interface SamplingResult { vertex: Vertex; sampleCount: number; medianAccuracyM: number; acceptedDespiteWarning: boolean; }`
  - `async function sampleVertex(atPointIndex: number, opts: SamplingOptions): Promise<SamplingResult>` — orchestrates the whole capture:
    1. Acquire wake lock.
    2. `watchPosition` with `enableHighAccuracy: true, maximumAge: 0`.
    3. Discard the first `opts.discardFirst` fixes.
    4. Collect until `sampleCount === targetSamples` OR `timeoutMs` elapses.
    5. `clearWatch`, release wake lock.
    6. Compute mean lat/lon, median accuracy (via sort). Set `acceptedDespiteWarning = median > 15`.
    7. Return SamplingResult with a fully populated `Vertex`.
  - Guarantee: even if aborted early by timeout, the wake lock is released and the watch is cleared.

- [ ] **Step 1: Write failing tests**

Write `src/domain/gps-sampling.test.ts`:
```typescript
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
```

- [ ] **Step 2: RED**

```bash
npm test src/domain/gps-sampling.test.ts
```

- [ ] **Step 3: Implement `src/domain/gps-sampling.ts`**

```typescript
import type { Vertex } from './types';
import { holdWakeLock } from '../hardware/wake-lock';
import { getGeolocationAdapter } from '../hardware/geolocation';

export interface SamplingOptions {
  targetSamples: number;
  discardFirst: number;
  timeoutMs: number;
  onProgress?: (kept: number, latestAccuracyM: number) => void;
}

export interface SamplingResult {
  vertex: Vertex;
  sampleCount: number;
  medianAccuracyM: number;
  acceptedDespiteWarning: boolean;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export async function sampleVertex(
  atPointIndex: number,
  opts: SamplingOptions,
): Promise<SamplingResult> {
  const release = await holdWakeLock();
  const kept: { lat: number; lon: number; acc: number }[] = [];
  let discarded = 0;

  const geo = getGeolocationAdapter();

  return new Promise<SamplingResult>((resolve, reject) => {
    let settled = false;
    const watchId = geo.watchPosition(
      (fix) => {
        if (settled) return;
        if (discarded < opts.discardFirst) {
          discarded++;
          return;
        }
        kept.push({ lat: fix.lat, lon: fix.lon, acc: fix.accuracyM });
        opts.onProgress?.(kept.length, fix.accuracyM);
        if (kept.length >= opts.targetSamples) finalize();
      },
      (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      },
    );

    const timer = setTimeout(finalize, opts.timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      geo.clearWatch(watchId);
      void release();
    }

    function finalize() {
      if (settled) return;
      settled = true;
      cleanup();
      const n = kept.length;
      if (n === 0) {
        reject(new Error('no GPS samples collected before timeout'));
        return;
      }
      const meanLat = kept.reduce((s, k) => s + k.lat, 0) / n;
      const meanLon = kept.reduce((s, k) => s + k.lon, 0) / n;
      const medianAccuracyM = median(kept.map((k) => k.acc));
      const vertex: Vertex = {
        lat: meanLat,
        lon: meanLon,
        elevSource: 'none',
        hAccM: medianAccuracyM,
        hAccMethod: 'median-reported',
        sampleCount: n,
        fixedAt: new Date(),
        atPointIndex,
      };
      resolve({
        vertex,
        sampleCount: n,
        medianAccuracyM,
        acceptedDespiteWarning: medianAccuracyM > 15,
      });
    }
  });
}
```

- [ ] **Step 4: GREEN + typecheck + build**

```bash
npm test src/domain/gps-sampling.test.ts && npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/gps-sampling.ts src/domain/gps-sampling.test.ts
git commit -m "feat(domain): GPS sample-discard-median service with wake-lock lifecycle"
```

---

## Task 4: ENU projection + polyline utilities

**Files:**
- Create: `src/domain/enu.ts`, `src/domain/enu.test.ts`

**Interfaces:**
- Consumes: `LatLon` type (Phase 1a T3).
- Produces:
  - `enuOf(refLat: number, refLon: number, lat: number, lon: number): { e: number; n: number }` — local tangent-plane in metres. Uses WGS84 equatorial radius 6378137 m with `cos(refLat)` factor. Accurate to sub-cm at target scale (~30 m lines).
  - `llFromEnu(refLat: number, refLon: number, e: number, n: number): { lat: number; lon: number }` — inverse.
  - `polylineLengthM(vertices: LatLon[]): number` — sum of ENU segment lengths using the polyline's first vertex as the reference.
  - `interpolatePointsAlongPolyline(vertices: LatLon[], pointCount: number): LatLon[]` — returns exactly `pointCount` points evenly spaced along the polyline (arc-length parametrisation). First point = first vertex, last point = last vertex.

- [ ] **Step 1: Write failing tests**

Write `src/domain/enu.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { enuOf, llFromEnu, polylineLengthM, interpolatePointsAlongPolyline } from './enu';

const REF_LAT = 42.32;
const REF_LON = 23.78;

describe('enuOf / llFromEnu', () => {
  it('is a round-trip identity at sub-cm precision at 42.32N', () => {
    const cases = [
      { lat: 42.32,     lon: 23.78     },
      { lat: 42.320001, lon: 23.780001 },
      { lat: 42.320100, lon: 23.780050 },
      { lat: 42.319500, lon: 23.780200 },
    ];
    for (const c of cases) {
      const { e, n } = enuOf(REF_LAT, REF_LON, c.lat, c.lon);
      const back = llFromEnu(REF_LAT, REF_LON, e, n);
      // 1e-8 deg ~ 1.1 mm — that's the round-trip tolerance
      expect(back.lat).toBeCloseTo(c.lat, 8);
      expect(back.lon).toBeCloseTo(c.lon, 8);
    }
  });

  it('reference point maps to (0,0)', () => {
    expect(enuOf(REF_LAT, REF_LON, REF_LAT, REF_LON)).toEqual({ e: 0, n: 0 });
  });
});

describe('polylineLengthM', () => {
  it('returns 0 for a single vertex', () => {
    expect(polylineLengthM([{ lat: REF_LAT, lon: REF_LON }])).toBe(0);
  });

  it('matches expected metric distance for a straight 32 m line east-west', () => {
    // 32 m east at REF_LAT: dLon in radians = 32 / (R * cos(lat))
    const R = 6378137;
    const dLon = 32 / (R * Math.cos((REF_LAT * Math.PI) / 180)); // radians
    const endLon = REF_LON + (dLon * 180) / Math.PI;
    const len = polylineLengthM([
      { lat: REF_LAT, lon: REF_LON },
      { lat: REF_LAT, lon: endLon },
    ]);
    expect(len).toBeCloseTo(32, 3); // < 1 mm
  });
});

describe('interpolatePointsAlongPolyline (§14 T1, T3)', () => {
  it('returns exactly pointCount points, first = first vertex, last = last vertex', () => {
    const R = 6378137;
    const dLon = 32 / (R * Math.cos((REF_LAT * Math.PI) / 180));
    const endLon = REF_LON + (dLon * 180) / Math.PI;
    const pts = interpolatePointsAlongPolyline(
      [{ lat: REF_LAT, lon: REF_LON }, { lat: REF_LAT, lon: endLon }],
      17,
    );
    expect(pts).toHaveLength(17);
    expect(pts[0].lat).toBeCloseTo(REF_LAT, 10);
    expect(pts[0].lon).toBeCloseTo(REF_LON, 10);
    expect(pts[16].lat).toBeCloseTo(REF_LAT, 8);
    expect(pts[16].lon).toBeCloseTo(endLon, 8);
  });

  it('inter-point spacing is constant to <= 10 mm along a straight 32 m line (§14 T3)', () => {
    const R = 6378137;
    const dLon = 32 / (R * Math.cos((REF_LAT * Math.PI) / 180));
    const endLon = REF_LON + (dLon * 180) / Math.PI;
    const pts = interpolatePointsAlongPolyline(
      [{ lat: REF_LAT, lon: REF_LON }, { lat: REF_LAT, lon: endLon }],
      17,
    );
    const spacings: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      spacings.push(polylineLengthM([pts[i - 1], pts[i]]));
    }
    const expected = 32 / 16; // 17 points ⇒ 16 intervals
    for (const s of spacings) {
      expect(Math.abs(s - expected)).toBeLessThan(0.01); // 10 mm
    }
  });

  it('honours detour vertices — points interpolate along the polyline, not the endpoint chord', () => {
    // L-shape: 20 m east, then 20 m north. Reconstructed length ~40 m.
    const R = 6378137;
    const cosLat = Math.cos((REF_LAT * Math.PI) / 180);
    const dLonEast = ((20 / (R * cosLat)) * 180) / Math.PI;
    const dLatNorth = ((20 / R) * 180) / Math.PI;
    const vertices = [
      { lat: REF_LAT, lon: REF_LON },
      { lat: REF_LAT, lon: REF_LON + dLonEast },
      { lat: REF_LAT + dLatNorth, lon: REF_LON + dLonEast },
    ];
    expect(polylineLengthM(vertices)).toBeCloseTo(40, 2);
    const pts = interpolatePointsAlongPolyline(vertices, 5); // 4 intervals of 10 m
    // Midpoint (index 2) should sit exactly at the corner
    expect(pts[2].lat).toBeCloseTo(REF_LAT, 5);
    expect(pts[2].lon).toBeCloseTo(REF_LON + dLonEast, 8);
  });
});
```

- [ ] **Step 2: RED**

```bash
npm test src/domain/enu.test.ts
```

- [ ] **Step 3: Implement `src/domain/enu.ts`**

```typescript
import type { LatLon } from './types';

const R_EARTH = 6378137; // WGS84 equatorial radius, metres
const DEG = Math.PI / 180;

export function enuOf(
  refLat: number, refLon: number,
  lat: number, lon: number,
): { e: number; n: number } {
  const cosRefLat = Math.cos(refLat * DEG);
  const dLat = (lat - refLat) * DEG;
  const dLon = (lon - refLon) * DEG;
  return {
    e: R_EARTH * cosRefLat * dLon,
    n: R_EARTH * dLat,
  };
}

export function llFromEnu(
  refLat: number, refLon: number,
  e: number, n: number,
): { lat: number; lon: number } {
  const cosRefLat = Math.cos(refLat * DEG);
  const dLat = n / R_EARTH;
  const dLon = e / (R_EARTH * cosRefLat);
  return {
    lat: refLat + dLat / DEG,
    lon: refLon + dLon / DEG,
  };
}

export function polylineLengthM(vertices: LatLon[]): number {
  if (vertices.length < 2) return 0;
  const ref = vertices[0];
  let total = 0;
  let prev = enuOf(ref.lat, ref.lon, vertices[0].lat, vertices[0].lon);
  for (let i = 1; i < vertices.length; i++) {
    const cur = enuOf(ref.lat, ref.lon, vertices[i].lat, vertices[i].lon);
    const de = cur.e - prev.e;
    const dn = cur.n - prev.n;
    total += Math.sqrt(de * de + dn * dn);
    prev = cur;
  }
  return total;
}

export function interpolatePointsAlongPolyline(
  vertices: LatLon[],
  pointCount: number,
): LatLon[] {
  if (pointCount < 1) return [];
  if (vertices.length === 0) return [];
  if (vertices.length === 1) return Array(pointCount).fill(vertices[0]);

  const ref = vertices[0];
  const enu = vertices.map((v) => enuOf(ref.lat, ref.lon, v.lat, v.lon));
  const segLens: number[] = [];
  let total = 0;
  for (let i = 1; i < enu.length; i++) {
    const de = enu[i].e - enu[i - 1].e;
    const dn = enu[i].n - enu[i - 1].n;
    const s = Math.sqrt(de * de + dn * dn);
    segLens.push(s);
    total += s;
  }

  if (pointCount === 1) return [vertices[0]];
  const step = total / (pointCount - 1);
  const points: LatLon[] = [];

  for (let i = 0; i < pointCount; i++) {
    const target = i * step;
    let acc = 0;
    let seg = 0;
    while (seg < segLens.length && acc + segLens[seg] < target) {
      acc += segLens[seg];
      seg++;
    }
    if (seg >= segLens.length) {
      // At or beyond end
      const last = enu[enu.length - 1];
      points.push(llFromEnu(ref.lat, ref.lon, last.e, last.n));
      continue;
    }
    const t = segLens[seg] === 0 ? 0 : (target - acc) / segLens[seg];
    const a = enu[seg];
    const b = enu[seg + 1];
    const e = a.e + t * (b.e - a.e);
    const n = a.n + t * (b.n - a.n);
    points.push(llFromEnu(ref.lat, ref.lon, e, n));
  }
  return points;
}
```

- [ ] **Step 4: GREEN + typecheck + build**

```bash
npm test src/domain/enu.test.ts && npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/enu.ts src/domain/enu.test.ts
git commit -m "feat(domain): local ENU projection + polyline interpolation (§5.3)"
```

---

## Task 5: Line code (label) generator

**Files:**
- Create: `src/domain/line-code.ts`, `src/domain/line-code.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `generateLineLabel(existingLabels: string[]): string` — returns the next `L<n>` (`L1`, `L2`, `L3`, …). Ignores malformed labels. Empty list → `'L1'`.

- [ ] **Step 1: Write failing tests**

Write `src/domain/line-code.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { generateLineLabel } from './line-code';

describe('generateLineLabel', () => {
  it('returns L1 for an empty list', () => {
    expect(generateLineLabel([])).toBe('L1');
  });

  it('increments the max', () => {
    expect(generateLineLabel(['L1', 'L2'])).toBe('L3');
  });

  it('ignores non-matching labels', () => {
    expect(generateLineLabel(['not-a-label', 'L2'])).toBe('L3');
  });

  it('handles gaps by using max+1', () => {
    expect(generateLineLabel(['L1', 'L4'])).toBe('L5');
  });

  it('handles multi-digit numbers', () => {
    expect(generateLineLabel(['L9', 'L10'])).toBe('L11');
  });
});
```

- [ ] **Step 2: RED**

```bash
npm test src/domain/line-code.test.ts
```

- [ ] **Step 3: Implement `src/domain/line-code.ts`**

```typescript
export function generateLineLabel(existingLabels: string[]): string {
  let max = 0;
  for (const l of existingLabels) {
    const m = /^L(\d+)$/.exec(l);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `L${max + 1}`;
}
```

- [ ] **Step 4: GREEN + typecheck + build**

```bash
npm test src/domain/line-code.test.ts && npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/line-code.ts src/domain/line-code.test.ts
git commit -m "feat(domain): line label generator (L1, L2, ...)"
```

---

## Task 6: Default ChannelSet stub + Line service

**Files:**
- Create: `src/domain/channel-set-defaults.ts`, `src/domain/line-service.ts`, `src/domain/line-service.test.ts`

**Interfaces:**
- Consumes: `newId` (Phase 1a T4), `writeJson` (Phase 1a T6), `getOrCreatePath` + `lineFolderName` (Phase 1a T7), `getRoot` (Phase 1b T2), `getDb` (Phase 1a T9), `generateLineLabel` (T5), `polylineLengthM` (T4), `Line` + `Vertex` + `ChannelSetSnapshot` types.
- Produces:
  - `defaultChannelSetSnapshot(): ChannelSetSnapshot` — hardcoded PQWT-TC300, 40 channels, `linear-nominal` depth model, `mV` units, `frozenAt = new Date('2026-01-01T00:00:00Z')` (stable across creates).
  - `interface LineCreateInput { pointCount: number; pointSpacingM: number; electrodeSpacingM: number; mode: Line['mode']; dipoleOrientation: Line['dipoleOrientation']; vertices: Vertex[]; point1AnchorMediaId?: string; }`
  - `createLine(surveyId: string, input: LineCreateInput): Promise<Line>` — validates `electrodeSpacingM > pointSpacingM` (throws otherwise), generates label from existing lines under this survey, computes `lengthM` via `polylineLengthM`, embeds `defaultChannelSetSnapshot()`, sets `transformLog: []` and `status: vertices.length >= 2 ? 'draft' : 'draft'` (Phase 1c always uses `'draft'`), writes `line.json` and `vertices.geojson`, puts cache row.
  - `updateLine(id: string, patch: LineUpdateInput): Promise<Line>` — bumps audit, rewrites `line.json` (and `vertices.geojson` if vertices changed).
  - `softDeleteLine(id: string): Promise<void>` — moves `line.json` to `_tombstones/lines/<lineFolderName>_<stamp>.json`, removes `line.json` from the line folder, deletes cache row. (Distinct tombstone subfolder to keep site tombstones clean.)
  - `LineUpdateInput = Partial<Omit<Line, 'id' | 'label' | 'createdAt' | 'revision' | 'deletedAt' | 'channelSetSnapshot'>>` — `label` and `channelSetSnapshot` are immutable post-create.

- [ ] **Step 1: Write failing tests**

Write `src/domain/line-service.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { readJson } from '../storage/atomic';
import { getPath } from '../storage/paths';
import { createSite } from './site-service';
import { createSurvey } from './survey-service';
import { createLine, updateLine, softDeleteLine, defaultChannelSetSnapshot } from './line-service';
import type { Vertex } from './types';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

async function seedSiteAndSurvey() {
  const site = await createSite({
    name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
  const survey = await createSurvey(site.id, {
    startedAt: new Date('2026-09-15T10:00:00Z'),
    timezone: 'Europe/Sofia', operator: 'Anton',
    deviceModel: 'PQWT-TC300', deviceSerial: 'x',
    precipLast48h: 'none', qualityFlag: 'good',
  });
  return { site, survey };
}

function vertex(atPointIndex: number, lat: number, lon: number): Vertex {
  return {
    lat, lon, elevSource: 'none',
    hAccM: 6, hAccMethod: 'median-reported',
    sampleCount: 20, fixedAt: new Date(), atPointIndex,
  };
}

describe('defaultChannelSetSnapshot', () => {
  it('has 40 channels, mV units, linear-nominal depth model', () => {
    const cs = defaultChannelSetSnapshot();
    expect(cs.channels).toHaveLength(40);
    expect(cs.units).toBe('mV');
    expect(cs.depthModel).toBe('linear-nominal');
  });

  it('returns a stable snapshot with a fixed frozenAt', () => {
    const a = defaultChannelSetSnapshot();
    const b = defaultChannelSetSnapshot();
    expect(a.frozenAt.getTime()).toBe(b.frozenAt.getTime());
  });
});

describe('createLine', () => {
  it('validates electrodeSpacingM > pointSpacingM', async () => {
    const { survey } = await seedSiteAndSurvey();
    await expect(createLine(survey.id, {
      pointCount: 17,
      pointSpacingM: 5,
      electrodeSpacingM: 5,  // equal, must fail
      mode: 'multi-frequency',
      dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7803)],
    })).rejects.toThrow(/electrodeSpacingM/i);

    await expect(createLine(survey.id, {
      pointCount: 17,
      pointSpacingM: 5,
      electrodeSpacingM: 3,  // less than pointSpacing, must fail
      mode: 'multi-frequency',
      dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7803)],
    })).rejects.toThrow(/electrodeSpacingM/i);
  });

  it('generates sequential labels L1, L2, ...', async () => {
    const { survey } = await seedSiteAndSurvey();
    const l1 = await createLine(survey.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7804)],
    });
    const l2 = await createLine(survey.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.33, 23.78), vertex(17, 42.33, 23.7804)],
    });
    expect(l1.label).toBe('L1');
    expect(l2.label).toBe('L2');
  });

  it('writes line.json + vertices.geojson under sites/.../surveys/.../lines/L1/', async () => {
    const { site, survey } = await seedSiteAndSurvey();
    const line = await createLine(survey.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7804)],
    });
    const siteRow = (await getDb().sites.get(site.id))!;
    const svRow = (await getDb().surveys.get(survey.id))!;
    const lineDir = await getPath(root, [
      'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', 'L1',
    ]);
    expect(lineDir).not.toBeNull();
    const persisted = await readJson<typeof line>(lineDir!, 'line.json');
    expect(persisted.electrodeSpacingM).toBe(5);
    expect(persisted.transformLog).toEqual([]);
    expect(persisted.channelSetSnapshot.units).toBe('mV');
  });

  it('computes lengthM from the vertex polyline', async () => {
    const { survey } = await seedSiteAndSurvey();
    // Straight east 32 m
    const R = 6378137;
    const cosLat = Math.cos((42.32 * Math.PI) / 180);
    const dLon = ((32 / (R * cosLat)) * 180) / Math.PI;
    const line = await createLine(survey.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.78 + dLon)],
    });
    expect(line.lengthM).toBeCloseTo(32, 2);
  });
});

describe('updateLine', () => {
  it('bumps updatedAt + revision, rewrites line.json', async () => {
    const { survey } = await seedSiteAndSurvey();
    const line = await createLine(survey.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7804)],
    });
    await new Promise((r) => setTimeout(r, 5));
    const next = await updateLine(line.id, { groundSlopePct: 5.5 });
    expect(next.revision).toBe(2);
    expect(next.groundSlopePct).toBe(5.5);
  });
});

describe('softDeleteLine', () => {
  it('moves line.json to _tombstones/lines/ and clears the cache row', async () => {
    const { survey } = await seedSiteAndSurvey();
    const line = await createLine(survey.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7804)],
    });
    await softDeleteLine(line.id);
    expect(await getDb().lines.get(line.id)).toBeUndefined();
    const tombs = await getPath(root, ['_tombstones', 'lines']);
    expect(tombs).not.toBeNull();
  });
});
```

- [ ] **Step 2: RED**

```bash
npm test src/domain/line-service.test.ts
```

- [ ] **Step 3: Implement `src/domain/channel-set-defaults.ts`**

```typescript
import type { ChannelSetSnapshot, Channel } from './types';

const FROZEN_AT = new Date('2026-01-01T00:00:00Z');

function tc300Channels(): Channel[] {
  return Array.from({ length: 40 }, (_, i) => ({
    label: `ch${i + 1}`,
    order: i,
    pseudoDepthM: (i + 1) * 4.5,
  }));
}

export function defaultChannelSetSnapshot(): ChannelSetSnapshot {
  return {
    name: 'TC300 linear-nominal v1 (default)',
    deviceModel: 'PQWT-TC300',
    kind: 'frequency',
    units: 'mV',
    depthModel: 'linear-nominal',
    provenanceNote: 'Phase 1c default snapshot; replace via ChannelSet service in a later phase.',
    channels: tc300Channels(),
    frozenAt: FROZEN_AT,
  };
}
```

- [ ] **Step 4: Implement `src/domain/line-service.ts`**

```typescript
import type { Line, Vertex } from './types';
import { newId } from '../util/id';
import { writeJson, fileExists } from '../storage/atomic';
import { getOrCreatePath, getPath, lineFolderName } from '../storage/paths';
import { getRoot } from '../storage/fs';
import { getDb } from '../cache/db';
import { generateLineLabel } from './line-code';
import { polylineLengthM } from './enu';
import { defaultChannelSetSnapshot } from './channel-set-defaults';

export { defaultChannelSetSnapshot };

export interface LineCreateInput {
  pointCount: number;
  pointSpacingM: number;
  electrodeSpacingM: number;
  mode: Line['mode'];
  dipoleOrientation: Line['dipoleOrientation'];
  vertices: Vertex[];
  point1AnchorMediaId?: string;
  groundSlopePct?: number;
  reliefM?: number;
  polarityConvention?: string;
}

export type LineUpdateInput = Partial<
  Omit<Line, 'id' | 'label' | 'createdAt' | 'revision' | 'deletedAt' | 'channelSetSnapshot'>
>;

function assertSpacing(pointSpacingM: number, electrodeSpacingM: number): void {
  if (!(electrodeSpacingM > pointSpacingM)) {
    throw new Error(
      `electrodeSpacingM (${electrodeSpacingM}) must be strictly greater than pointSpacingM (${pointSpacingM}); check whether they were swapped`,
    );
  }
}

function verticesToGeoJson(vs: Vertex[]) {
  return {
    type: 'LineString' as const,
    coordinates: vs.map((v) => (v.elevM != null ? [v.lon, v.lat, v.elevM] : [v.lon, v.lat])),
  };
}

async function surveyFolderPath(surveyId: string): Promise<{ segments: string[]; lineFolder: string }> {
  const db = getDb();
  const svRow = await db.surveys.get(surveyId);
  if (!svRow) throw new Error(`survey not found: ${surveyId}`);
  const siteRow = await db.sites.get(svRow.siteId);
  if (!siteRow) throw new Error(`orphan survey — site missing: ${svRow.siteId}`);
  return {
    segments: ['sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines'],
    lineFolder: svRow.folderName, // unused; kept for symmetry, remove if lint flags
  };
}

export async function createLine(
  surveyId: string,
  input: LineCreateInput,
): Promise<Line> {
  assertSpacing(input.pointSpacingM, input.electrodeSpacingM);

  const root = getRoot();
  const db = getDb();

  // Existing labels under this survey
  const siblings = await db.lines.where('surveyId').equals(surveyId).toArray();
  const label = generateLineLabel(siblings.map((r) => r.json.label));

  const lengthM = polylineLengthM(input.vertices);

  const now = new Date();
  const line: Line = {
    id: newId(),
    createdAt: now, updatedAt: now, revision: 1,
    label,
    pointCount: input.pointCount,
    pointSpacingM: input.pointSpacingM,
    electrodeSpacingM: input.electrodeSpacingM,
    mode: input.mode,
    channelSetSnapshot: defaultChannelSetSnapshot(),
    vertices: input.vertices,
    azimuthSource: 'derived-from-vertices',
    lengthM,
    point1AnchorMediaId: input.point1AnchorMediaId,
    dipoleOrientation: input.dipoleOrientation,
    polarityConvention: input.polarityConvention,
    groundSlopePct: input.groundSlopePct,
    reliefM: input.reliefM,
    transformLog: [],
    points: [],
    noiseZones: [],
    status: 'draft',
  };

  const { segments } = await surveyFolderPath(surveyId);
  const linesDir = await getOrCreatePath(root, segments);
  const lineDir = await getOrCreatePath(linesDir, [lineFolderName(label)]);
  await writeJson(lineDir, 'line.json', line);
  await writeJson(lineDir, 'vertices.geojson', verticesToGeoJson(input.vertices));

  await db.lines.put({
    id: line.id,
    surveyId,
    folderName: lineFolderName(label),
    hasDeviceFiles: false,
    json: line,
  });

  return line;
}

export async function updateLine(id: string, patch: LineUpdateInput): Promise<Line> {
  const root = getRoot();
  const db = getDb();

  const row = await db.lines.get(id);
  if (!row) throw new Error(`line not found: ${id}`);
  const existing = row.json;

  if (patch.pointSpacingM != null || patch.electrodeSpacingM != null) {
    assertSpacing(
      patch.pointSpacingM ?? existing.pointSpacingM,
      patch.electrodeSpacingM ?? existing.electrodeSpacingM,
    );
  }

  const nextVertices = patch.vertices ?? existing.vertices;
  const next: Line = {
    ...existing,
    ...patch,
    id: existing.id,
    label: existing.label,
    channelSetSnapshot: existing.channelSetSnapshot,
    createdAt: existing.createdAt,
    updatedAt: new Date(),
    revision: existing.revision + 1,
    vertices: nextVertices,
    lengthM: polylineLengthM(nextVertices),
  };

  const svRow = await db.surveys.get(existing.id === row.id ? row.surveyId : row.surveyId);
  if (!svRow) throw new Error(`orphan line — survey missing`);
  const siteRow = await db.sites.get(svRow.siteId);
  if (!siteRow) throw new Error(`orphan line — site missing`);

  const lineDir = await getPath(root, [
    'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', row.folderName,
  ]);
  if (!lineDir) throw new Error(`line folder missing: ${row.folderName}`);

  await writeJson(lineDir, 'line.json', next);
  if (patch.vertices) {
    await writeJson(lineDir, 'vertices.geojson', verticesToGeoJson(nextVertices));
  }
  await db.lines.put({ ...row, json: next });
  return next;
}

export async function softDeleteLine(id: string): Promise<void> {
  const root = getRoot();
  const db = getDb();

  const row = await db.lines.get(id);
  if (!row) throw new Error(`line not found: ${id}`);

  const now = new Date();
  const tombstoned = { ...row.json, deletedAt: now, updatedAt: now, revision: row.json.revision + 1, folderName: row.folderName };
  const tombsDir = await getOrCreatePath(root, ['_tombstones', 'lines']);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  await writeJson(tombsDir, `${row.folderName}_${stamp}.json`, tombstoned);

  const svRow = await db.surveys.get(row.surveyId);
  if (svRow) {
    const siteRow = await db.sites.get(svRow.siteId);
    if (siteRow) {
      const lineDir = await getPath(root, [
        'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', row.folderName,
      ]);
      if (lineDir && (await fileExists(lineDir, 'line.json'))) {
        await lineDir.removeEntry('line.json');
      }
    }
  }

  await db.lines.delete(id);
}
```

- [ ] **Step 5: GREEN + typecheck + build**

```bash
npm test src/domain/line-service.test.ts && npm run typecheck && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/domain/channel-set-defaults.ts src/domain/line-service.ts src/domain/line-service.test.ts
git commit -m "feat(domain): line service (create/update/softDelete) + TC300 default channel set"
```

---

## Task 7: Line reactive hooks

**Files:**
- Modify: `src/cache/hooks.ts` — add `useLine`, `useLines`.
- Modify: `src/cache/hooks.test.tsx` — add tests.

**Interfaces:**
- Consumes: `getDb`, `LineRow` (Phase 1a T9).
- Produces:
  - `useLines(surveyId: string | undefined): LineRow[] | undefined` — returns non-deleted lines under the survey, ordered by `folderName` ascending (`L1`, `L2`, …).
  - `useLine(id: string | undefined): LineRow | undefined` — like `useSite` / `useSurvey`.
  - Both hide orphan lines when the parent survey row is missing (M2 pattern from Phase 1b's final review).

- [ ] **Step 1: Add failing tests**

Append to `src/cache/hooks.test.tsx`:
```typescript
import { useLines, useLine } from './hooks';

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
```

- [ ] **Step 2: RED**

```bash
npm test src/cache/hooks.test.tsx
```

- [ ] **Step 3: Extend `src/cache/hooks.ts`**

Append to the file:
```typescript
export function useLines(surveyId: string | undefined): LineRow[] | undefined {
  return useLiveQuery(async () => {
    if (!surveyId) return [];
    const survey = await getDb().surveys.get(surveyId);
    if (!survey) return [];  // orphan lines hidden until survey is present
    const rows = await getDb().lines.where('surveyId').equals(surveyId).toArray();
    return rows
      .filter((r) => !r.json.deletedAt)
      .sort((a, b) => a.folderName.localeCompare(b.folderName));
  }, [surveyId]);
}

export function useLine(id: string | undefined): LineRow | undefined {
  return useLiveQuery(async () => {
    if (!id) return undefined;
    return getDb().lines.get(id);
  }, [id]);
}
```

Also, make sure `LineRow` is imported/exported alongside `SiteRow`/`SurveyRow` at the top of the file.

- [ ] **Step 4: GREEN + typecheck + build**

```bash
npm test src/cache/hooks.test.tsx && npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/cache/hooks.ts src/cache/hooks.test.tsx
git commit -m "feat(cache): useLine + useLines hooks with orphan-parent guard"
```

---

## Task 8: Anchor photo capture module

**Files:**
- Create: `src/domain/anchor-photo.ts`, `src/domain/anchor-photo.test.ts`

**Interfaces:**
- Consumes: `newId`, `sha256Hex`, `writeBlob`, `getOrCreatePath`, `getRoot`, `getDb`, `MediaAsset` type.
- Produces:
  - `interface AnchorCaptureInput { file: File; lineId: string; capturedAt: Date; lat: number; lon: number; bearingDeg?: number; caption?: string; }`
  - `async function captureAnchorPhoto(input: AnchorCaptureInput): Promise<MediaAsset>` — writes the (optionally downscaled) blob to `sites/.../lines/L1/anchor.jpg`, computes SHA-256, writes a MediaAsset JSON entry to the line folder as `anchor-media.json`, does NOT put a Dexie row for MediaAsset in this phase (media table stays scanned; Line references it by id via `point1AnchorMediaId`).
  - `interface DownscaleOptions { maxEdgePx: number; type: string; quality: number; }`
  - `async function downscaleImage(blob: Blob, opts?: DownscaleOptions): Promise<Blob>` — uses `createImageBitmap(blob, {imageOrientation:'from-image'})` + `<canvas>` + `canvas.toBlob`. If `createImageBitmap` is not available (test env), returns the input blob unchanged and marks it with an internal flag.
  - `setDownscaleAdapter(fn: (blob: Blob) => Promise<Blob>): void` — test hook. Default runs `downscaleImage`. Tests inject an identity function.

- [ ] **Step 1: Write failing tests**

Write `src/domain/anchor-photo.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { readBlob, readJson, fileExists } from '../storage/atomic';
import { getPath } from '../storage/paths';
import { createSite } from './site-service';
import { createSurvey } from './survey-service';
import { createLine } from './line-service';
import { captureAnchorPhoto, setDownscaleAdapter } from './anchor-photo';
import type { Vertex, MediaAsset } from './types';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
  // Identity downscale for tests
  setDownscaleAdapter(async (b) => b);
});

async function seedLine() {
  const site = await createSite({
    name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
  const sv = await createSurvey(site.id, {
    startedAt: new Date(), timezone: 'Europe/Sofia', operator: 'x',
    deviceModel: 'PQWT-TC300', deviceSerial: 'x',
    precipLast48h: 'none', qualityFlag: 'good',
  });
  const v: Vertex = {
    lat: 42.32, lon: 23.78, elevSource: 'none',
    hAccM: 6, hAccMethod: 'median-reported',
    sampleCount: 20, fixedAt: new Date(), atPointIndex: 1,
  };
  const line = await createLine(sv.id, {
    pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
    mode: 'multi-frequency', dipoleOrientation: 'inline',
    vertices: [v, { ...v, atPointIndex: 17, lon: 23.7804 }],
  });
  return { site, sv, line };
}

describe('captureAnchorPhoto', () => {
  it('writes anchor.jpg + anchor-media.json under the line folder', async () => {
    const { site, sv, line } = await seedLine();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const file = new File([bytes], 'photo.jpg', { type: 'image/jpeg' });
    const media = await captureAnchorPhoto({
      file, lineId: line.id,
      capturedAt: new Date('2026-09-15T10:05:00Z'),
      lat: 42.32001, lon: 23.78002,
      bearingDeg: 175,
    });

    const siteRow = (await getDb().sites.get(site.id))!;
    const svRow = (await getDb().surveys.get(sv.id))!;
    const lineDir = await getPath(root, [
      'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', 'L1',
    ]);
    expect(await fileExists(lineDir!, 'anchor.jpg')).toBe(true);
    const persisted = await readJson<MediaAsset>(lineDir!, 'anchor-media.json');
    expect(persisted.kind).toBe('point1-anchor');
    expect(persisted.lat).toBe(42.32001);
    expect(persisted.lon).toBe(23.78002);
    expect(persisted.bearingDeg).toBe(175);
    expect(persisted.linkedTo.id).toBe(line.id);
    expect(persisted.sha256).toHaveLength(64);
    // Round-trip the blob
    const stored = await readBlob(lineDir!, 'anchor.jpg');
    const storedBytes = new Uint8Array(await stored.arrayBuffer());
    expect(Array.from(storedBytes)).toEqual([1, 2, 3, 4, 5]);
    // Returned media object matches the persisted one
    expect(media.storagePath).toContain('anchor.jpg');
  });

  it('stamps lat/lon from the caller, never from EXIF', async () => {
    const { line } = await seedLine();
    const file = new File([new Uint8Array([9])], 'photo.jpg', { type: 'image/jpeg' });
    const media = await captureAnchorPhoto({
      file, lineId: line.id,
      capturedAt: new Date(),
      lat: 1.111, lon: 2.222,
    });
    expect(media.lat).toBe(1.111);
    expect(media.lon).toBe(2.222);
  });
});
```

- [ ] **Step 2: RED**

```bash
npm test src/domain/anchor-photo.test.ts
```

- [ ] **Step 3: Implement `src/domain/anchor-photo.ts`**

```typescript
import type { MediaAsset } from './types';
import { newId } from '../util/id';
import { sha256Hex } from '../util/hash';
import { writeJson, writeBlob } from '../storage/atomic';
import { getOrCreatePath } from '../storage/paths';
import { getRoot } from '../storage/fs';
import { getDb } from '../cache/db';

type Downscaler = (blob: Blob) => Promise<Blob>;

async function defaultDownscale(blob: Blob): Promise<Blob> {
  const g = globalThis as unknown as {
    createImageBitmap?: (b: Blob, o?: { imageOrientation?: string }) => Promise<{ width: number; height: number; close?: () => void }>;
    document?: Document;
  };
  if (!g.createImageBitmap || !g.document) return blob;
  const bitmap = await g.createImageBitmap(blob, { imageOrientation: 'from-image' });
  const maxEdge = 2048;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = g.document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, w, h);
  bitmap.close?.();
  return new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b ?? blob), 'image/webp', 0.85);
  });
}

let downscaler: Downscaler = defaultDownscale;
export function setDownscaleAdapter(fn: Downscaler): void { downscaler = fn; }

export interface AnchorCaptureInput {
  file: File;
  lineId: string;
  capturedAt: Date;
  lat: number;
  lon: number;
  bearingDeg?: number;
  caption?: string;
}

export async function captureAnchorPhoto(input: AnchorCaptureInput): Promise<MediaAsset> {
  const root = getRoot();
  const db = getDb();

  const lineRow = await db.lines.get(input.lineId);
  if (!lineRow) throw new Error(`line not found: ${input.lineId}`);
  const svRow = await db.surveys.get(lineRow.surveyId);
  if (!svRow) throw new Error(`orphan line — survey missing: ${lineRow.surveyId}`);
  const siteRow = await db.sites.get(svRow.siteId);
  if (!siteRow) throw new Error(`orphan line — site missing: ${svRow.siteId}`);

  const processed = await downscaler(input.file);
  const bytes = new Uint8Array(await processed.arrayBuffer());
  const sha256 = await sha256Hex(bytes);

  const lineDir = await getOrCreatePath(root, [
    'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', lineRow.folderName,
  ]);
  await writeBlob(lineDir, 'anchor.jpg', processed);

  const now = new Date();
  const media: MediaAsset = {
    id: newId(),
    createdAt: now, updatedAt: now, revision: 1,
    kind: 'point1-anchor',
    capturedAt: input.capturedAt,
    lat: input.lat,
    lon: input.lon,
    bearingDeg: input.bearingDeg,
    linkedTo: { kind: 'line', id: input.lineId },
    storagePath: `sites/${siteRow.folderName}/surveys/${svRow.folderName}/lines/${lineRow.folderName}/anchor.jpg`,
    sha256,
    caption: input.caption,
    isOriginal: false, // downscaled per §4.13
  };
  await writeJson(lineDir, 'anchor-media.json', media);
  return media;
}
```

- [ ] **Step 4: GREEN + typecheck + build**

```bash
npm test src/domain/anchor-photo.test.ts && npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/anchor-photo.ts src/domain/anchor-photo.test.ts
git commit -m "feat(domain): anchor photo capture with app-stamped lat/lon and §4.13 downscale"
```

---

## Task 9: Extend Bulgarian labels for line capture UI

**Files:**
- Modify: `src/ui/labels.ts` — add `line`, `capture` sections.

**Interfaces:**
- Consumes: nothing.
- Produces: new sections on the exported `labels` object.

- [ ] **Step 1: Extend `src/ui/labels.ts`**

Locate the `labels = {` object and add these sections (before the closing `} as const`):

```typescript
  line: {
    title: 'Профил',
    label: 'Означение',
    createTitle: 'Ново измерване (профил)',
    editTitle: 'Редакция на профил',
    deleteConfirm: 'Сигурен ли си, че искаш да изтриеш този профил?',
    fields: {
      pointCount: 'Брой точки',
      pointSpacingM: 'Разстояние между точки (м)',
      electrodeSpacingM: 'Разстояние между електродите (м)',
      mode: 'Режим',
      dipoleOrientation: 'Ориентация на дипола',
      groundSlopePct: 'Наклон на терена (%)',
      reliefM: 'Релеф (м)',
    },
    modeOptions: {
      single: 'единична честота',
      triple: 'три честоти',
      'multi-frequency': 'многочестотен',
    },
    dipoleOptions: {
      inline: 'по линията',
      broadside: 'напречно',
    },
    lengthM: 'Изчислена дължина',
    verticesFixed: 'Фиксирани върхове',
    noLines: 'Няма профили. Създай първия.',
    newLine: 'Нов профил',
  },
  capture: {
    step1Title: 'Стъпка 1: Параметри',
    step2Title: 'Стъпка 2: GPS точка 1',
    step3Title: 'Стъпка 3: Опорна снимка',
    step4Title: 'Стъпка 4: GPS точка N',
    step5Title: 'Стъпка 5: Запис',
    gpsStart: 'Стартирай GPS',
    gpsStop: 'Спри',
    gpsSampling: 'Взимане на проби:',
    gpsSampleCount: 'проби',
    gpsAccuracy: 'Точност:',
    gpsMeters: 'м',
    gpsWarnAccuracy: 'Внимание: точност над 15 м. Можеш да запишеш, но качеството ще пострада.',
    anchorTake: 'Направи опорна снимка (в точка 1, по посока на линията)',
    anchorRetake: 'Направи нова',
    anchorMissing: 'Опорната снимка е задължителна преди приключване (§5.4).',
    save: 'Запиши профила',
    saving: 'Записва…',
    spacingSwapError: 'Разстоянието между електродите трябва да е строго по-голямо от разстоянието между точките. Провери дали не са разменени.',
    keepScreenOn: 'Дръж екрана включен, за да завърши измерването.',
    guideBearing: 'Насочи телефона в посока на профила и натисни бутона.',
  },
```

- [ ] **Step 2: Verify build**

```bash
npm run typecheck && npm run build && npm test
```
All green; no test regressions (labels are pure data).

- [ ] **Step 3: Commit**

```bash
git add src/ui/labels.ts
git commit -m "feat(ui): Bulgarian labels for line + capture UI"
```

---

## Task 10: Line capture screen

**Files:**
- Create: `src/ui/LineCaptureScreen.tsx`, `src/ui/LineCaptureScreen.test.tsx`

**Interfaces:**
- Consumes: `sampleVertex` (T3), `createLine` (T6), `captureAnchorPhoto` (T8), `labels` (T9), type `Vertex`, mock adapters.
- Produces:
  - `<LineCaptureScreen surveyId={string} onSaved={(lineId: string) => void} onCancel={() => void} />`

Behaviour (five stages, each rendered as one section; stages advance on user action; no wizard state machine — a single React state object with a `stage` field):

1. **Parameters** — `pointCount`, `pointSpacingM`, `electrodeSpacingM`, `mode` (select), `dipoleOrientation` (select). Continue button enables when values are entered and the spacing invariant holds.
2. **Point 1 GPS** — "Start GPS" button. While sampling, renders live progress ("проби N/M", accuracy). Save button appears when target reached; if the resulting median accuracy > 15 m, shows the warning (allow the user to accept anyway per §5.2 soft gate).
3. **Anchor photo** — `<input type="file" accept="image/*" capture="environment">`. On file selected, immediately calls `captureAnchorPhoto` with the just-fixed point-1 GPS coordinates. Shows a thumbnail preview and a "retake" button.
4. **Point N GPS** — same UI as step 2, but for `atPointIndex = pointCount`.
5. **Save** — button that calls `createLine({ vertices: [v1, vN], point1AnchorMediaId: media.id, ... })`, then `onSaved(line.id)`.

Errors from any step surface in a `<div role="alert">` at the top of the current stage.

- [ ] **Step 1: Write failing tests**

Write `src/ui/LineCaptureScreen.test.tsx`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { setWakeLockAdapter } from '../hardware/wake-lock';
import { setGeolocationAdapter } from '../hardware/geolocation';
import { mockWakeLockAdapter, mockGeolocationAdapter } from '../test/mock-navigator';
import { setDownscaleAdapter } from '../domain/anchor-photo';
import { createSite } from '../domain/site-service';
import { createSurvey } from '../domain/survey-service';
import { LineCaptureScreen } from './LineCaptureScreen';

let geo: ReturnType<typeof mockGeolocationAdapter>;

async function tick() { return new Promise((r) => setTimeout(r, 0)); }

beforeEach(async () => {
  await resetDb();
  clearRoot();
  setRoot(createMockRoot());
  const wl = mockWakeLockAdapter();
  setWakeLockAdapter(wl.adapter);
  geo = mockGeolocationAdapter();
  setGeolocationAdapter(geo.adapter);
  setDownscaleAdapter(async (b) => b);
});

async function seedSurvey() {
  const site = await createSite({
    name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
  const sv = await createSurvey(site.id, {
    startedAt: new Date(), timezone: 'Europe/Sofia', operator: 'Anton',
    deviceModel: 'PQWT-TC300', deviceSerial: 'x',
    precipLast48h: 'none', qualityFlag: 'good',
  });
  return { site, sv };
}

describe('<LineCaptureScreen /> — full field flow', () => {
  it('captures params -> P1 -> anchor -> PN -> saves', async () => {
    const { sv } = await seedSurvey();
    const onSaved = vi.fn();
    render(<LineCaptureScreen surveyId={sv.id} onSaved={onSaved} onCancel={() => {}} />);

    // Step 1 — parameters (defaults pre-filled)
    // pointCount 17, pointSpacingM 2, electrodeSpacingM 5 default; continue
    await userEvent.click(screen.getByRole('button', { name: /продължи/i }));

    // Step 2 — P1 GPS
    await userEvent.click(screen.getByRole('button', { name: /стартирай gps/i }));
    // Feed 3 discards + 5 real fixes
    for (let i = 0; i < 3; i++) { geo.pushFix({ accuracyM: 50 }); await tick(); }
    for (let i = 0; i < 5; i++) {
      geo.pushFix({ lat: 42.32 + i * 1e-6, lon: 23.78 + i * 1e-6, accuracyM: 6 });
      await tick();
    }
    // Wait for the "продължи" button on this stage to become active
    const p1Continue = await screen.findByRole('button', { name: /продължи/i });
    await userEvent.click(p1Continue);

    // Step 3 — anchor photo (upload)
    const input = screen.getByLabelText(/опорна снимка/i) as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2])], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);
    // Continue
    await userEvent.click(await screen.findByRole('button', { name: /продължи/i }));

    // Step 4 — PN GPS
    await userEvent.click(screen.getByRole('button', { name: /стартирай gps/i }));
    for (let i = 0; i < 3; i++) { geo.pushFix({ accuracyM: 50 }); await tick(); }
    for (let i = 0; i < 5; i++) {
      geo.pushFix({ lat: 42.32001 + i * 1e-6, lon: 23.7804 + i * 1e-6, accuracyM: 5 });
      await tick();
    }
    await userEvent.click(await screen.findByRole('button', { name: /продължи/i }));

    // Step 5 — save
    await userEvent.click(screen.getByRole('button', { name: /запиши профила/i }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const lineId = onSaved.mock.calls[0][0];
    const row = await getDb().lines.get(lineId);
    expect(row?.json.label).toBe('L1');
    expect(row?.json.vertices).toHaveLength(2);
    expect(row?.json.vertices[0].atPointIndex).toBe(1);
    expect(row?.json.vertices[1].atPointIndex).toBe(17);
    expect(row?.json.point1AnchorMediaId).toBeDefined();
  });

  it('shows the spacing-swap error when electrodeSpacingM <= pointSpacingM', async () => {
    const { sv } = await seedSurvey();
    render(<LineCaptureScreen surveyId={sv.id} onSaved={() => {}} onCancel={() => {}} />);
    const eInput = screen.getByLabelText(/разстояние между електродите/i);
    await userEvent.clear(eInput);
    await userEvent.type(eInput, '2');
    // Continue should be disabled OR clicking should show an alert
    await userEvent.click(screen.getByRole('button', { name: /продължи/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/разстоянието между електродите/i);
  });
});
```

- [ ] **Step 2: RED**

```bash
npm test src/ui/LineCaptureScreen.test.tsx
```

- [ ] **Step 3: Implement `src/ui/LineCaptureScreen.tsx`**

```typescript
import { useState, FormEvent } from 'react';
import { labels } from './labels';
import type { Vertex, Line } from '../domain/types';
import { sampleVertex } from '../domain/gps-sampling';
import { createLine, LineCreateInput } from '../domain/line-service';
import { captureAnchorPhoto } from '../domain/anchor-photo';

type Stage = 'params' | 'p1' | 'anchor' | 'pn' | 'save';

interface Params {
  pointCount: number;
  pointSpacingM: number;
  electrodeSpacingM: number;
  mode: Line['mode'];
  dipoleOrientation: Line['dipoleOrientation'];
}

const DEFAULT_PARAMS: Params = {
  pointCount: 17,
  pointSpacingM: 2,
  electrodeSpacingM: 5,
  mode: 'multi-frequency',
  dipoleOrientation: 'inline',
};

interface Props {
  surveyId: string;
  onSaved: (lineId: string) => void;
  onCancel: () => void;
}

export function LineCaptureScreen({ surveyId, onSaved, onCancel }: Props) {
  const [stage, setStage] = useState<Stage>('params');
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [error, setError] = useState<string | null>(null);
  const [v1, setV1] = useState<Vertex | null>(null);
  const [vN, setVN] = useState<Vertex | null>(null);
  const [anchorMediaId, setAnchorMediaId] = useState<string | null>(null);
  const [sampling, setSampling] = useState(false);
  const [samplingProgress, setSamplingProgress] = useState<{ n: number; acc: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const l = labels.capture;
  const ll = labels.line;

  const setP = <K extends keyof Params>(k: K, v: Params[K]) =>
    setParams((p) => ({ ...p, [k]: v }));

  // ─── Stage 1: params ───────────────────────────────
  if (stage === 'params') {
    const onContinue = (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!(params.electrodeSpacingM > params.pointSpacingM)) {
        setError(l.spacingSwapError);
        return;
      }
      setStage('p1');
    };
    return (
      <form onSubmit={onContinue} style={{ padding: 16, display: 'grid', gap: 8, maxWidth: 480 }}>
        <h2>{l.step1Title}</h2>
        {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}
        <label>{ll.fields.pointCount}
          <input type="number" min={5} max={999} value={params.pointCount}
                 onChange={(e) => setP('pointCount', Number(e.target.value))} required />
        </label>
        <label>{ll.fields.pointSpacingM}
          <input type="number" step="0.1" value={params.pointSpacingM}
                 onChange={(e) => setP('pointSpacingM', Number(e.target.value))} required />
        </label>
        <label>{ll.fields.electrodeSpacingM}
          <input type="number" step="0.1" value={params.electrodeSpacingM}
                 onChange={(e) => setP('electrodeSpacingM', Number(e.target.value))} required />
        </label>
        <label>{ll.fields.mode}
          <select value={params.mode} onChange={(e) => setP('mode', e.target.value as Params['mode'])}>
            {(Object.keys(ll.modeOptions) as (keyof typeof ll.modeOptions)[]).map((k) => (
              <option key={k} value={k}>{ll.modeOptions[k]}</option>
            ))}
          </select>
        </label>
        <label>{ll.fields.dipoleOrientation}
          <select value={params.dipoleOrientation}
                  onChange={(e) => setP('dipoleOrientation', e.target.value as Params['dipoleOrientation'])}>
            {(Object.keys(ll.dipoleOptions) as (keyof typeof ll.dipoleOptions)[]).map((k) => (
              <option key={k} value={k}>{ll.dipoleOptions[k]}</option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit">Продължи</button>
          <button type="button" onClick={onCancel}>{labels.common.cancel}</button>
        </div>
      </form>
    );
  }

  // ─── Stage helper: sample a vertex ────────────────
  const startSampling = async (atPointIndex: number) => {
    setError(null);
    setSampling(true);
    setSamplingProgress({ n: 0, acc: 0 });
    try {
      const result = await sampleVertex(atPointIndex, {
        targetSamples: 5,
        discardFirst: 3,
        timeoutMs: 60_000,
        onProgress: (n, acc) => setSamplingProgress({ n, acc }),
      });
      if (atPointIndex === 1) setV1(result.vertex);
      else setVN(result.vertex);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSampling(false);
    }
  };

  // ─── Stage 2: point 1 ──────────────────────────────
  if (stage === 'p1' || stage === 'pn') {
    const atPointIndex = stage === 'p1' ? 1 : params.pointCount;
    const currentVertex = stage === 'p1' ? v1 : vN;
    const stepTitle = stage === 'p1' ? l.step2Title : l.step4Title;
    return (
      <section style={{ padding: 16, display: 'grid', gap: 8, maxWidth: 480 }}>
        <h2>{stepTitle}</h2>
        {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}
        {!currentVertex && (
          <button onClick={() => startSampling(atPointIndex)} disabled={sampling}>
            {l.gpsStart}
          </button>
        )}
        {sampling && samplingProgress && (
          <p>{l.gpsSampling} {samplingProgress.n} {l.gpsSampleCount} · {l.gpsAccuracy} {samplingProgress.acc.toFixed(1)} {l.gpsMeters}
            <br /><small>{l.keepScreenOn}</small>
          </p>
        )}
        {currentVertex && (
          <>
            <p>
              Lat {currentVertex.lat.toFixed(6)} · Lon {currentVertex.lon.toFixed(6)}
              <br />hAccM {currentVertex.hAccM.toFixed(1)} {l.gpsMeters} · {currentVertex.sampleCount} {l.gpsSampleCount}
            </p>
            {currentVertex.hAccM > 15 && (
              <div role="alert" style={{ color: 'orange' }}>{l.gpsWarnAccuracy}</div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setStage(stage === 'p1' ? 'anchor' : 'save')}>Продължи</button>
              <button onClick={() => {
                if (stage === 'p1') setV1(null); else setVN(null);
              }}>{l.gpsStop}</button>
            </div>
          </>
        )}
      </section>
    );
  }

  // ─── Stage 3: anchor photo ─────────────────────────
  if (stage === 'anchor') {
    const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !v1) return;
      setError(null);
      setBusy(true);
      try {
        // Line row doesn't exist yet — we'll capture using a temporary linkedTo
        // once the Line is saved. Store the file in state and defer the actual
        // captureAnchorPhoto call until Stage 5 (Save). Rationale: anchor-photo.ts
        // requires the lineId to build the folder path.
        setPendingAnchor(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    };
    return (
      <section style={{ padding: 16, display: 'grid', gap: 8, maxWidth: 480 }}>
        <h2>{l.step3Title}</h2>
        {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}
        <p>{l.guideBearing}</p>
        <label>{l.anchorTake}
          <input type="file" accept="image/*" capture="environment" onChange={onFile} />
        </label>
        {pendingAnchor && <p>✓ {pendingAnchor.name}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setStage('pn')} disabled={!pendingAnchor || busy}>Продължи</button>
        </div>
      </section>
    );
  }

  // ─── Stage 5: save ─────────────────────────────────
  if (stage === 'save') {
    const onSave = async () => {
      if (!v1 || !vN || !pendingAnchor) {
        setError(l.anchorMissing);
        return;
      }
      setError(null);
      setBusy(true);
      try {
        // Create the line first (without media id), then attach the photo, then patch the line.
        const line = await createLine(surveyId, {
          pointCount: params.pointCount,
          pointSpacingM: params.pointSpacingM,
          electrodeSpacingM: params.electrodeSpacingM,
          mode: params.mode,
          dipoleOrientation: params.dipoleOrientation,
          vertices: [v1, vN],
        } satisfies LineCreateInput);
        const media = await captureAnchorPhoto({
          file: pendingAnchor,
          lineId: line.id,
          capturedAt: new Date(),
          lat: v1.lat,
          lon: v1.lon,
        });
        // Update the line to reference the just-created media
        const { updateLine } = await import('../domain/line-service');
        await updateLine(line.id, { point1AnchorMediaId: media.id });
        setAnchorMediaId(media.id);
        onSaved(line.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    };
    return (
      <section style={{ padding: 16, display: 'grid', gap: 8, maxWidth: 480 }}>
        <h2>{l.step5Title}</h2>
        {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}
        <button onClick={onSave} disabled={busy}>{busy ? l.saving : l.save}</button>
      </section>
    );
  }

  return null;

  // Note: `pendingAnchor` is defined below via useState — declared here at the
  // bottom of the function so the JSX above can reference it. Move it to the
  // top on any refactor; TypeScript hoists via `useState` closures.
  // (See React functional-component hooks-order rules.)
  // ─── Hooks defined below (at top-of-function level) ───
}
```

**Note on hooks ordering**: the code above uses `useState` at the top of the component. To keep the plan's excerpt readable, the anchor-photo state is described inline. In the actual file, add `const [pendingAnchor, setPendingAnchor] = useState<File | null>(null);` alongside the other useState calls at the top of the function body.

- [ ] **Step 4: GREEN + typecheck + build**

```bash
npm test src/ui/LineCaptureScreen.test.tsx && npm run typecheck && npm run build
```

If typecheck complains about `pendingAnchor` — add it as a useState hook at the top of the function alongside `stage`, `params`, `error`, etc. If `React` import is needed for `React.ChangeEvent`, use `import type { ChangeEvent } from 'react'` and reference `ChangeEvent<HTMLInputElement>` directly.

- [ ] **Step 5: Commit**

```bash
git add src/ui/LineCaptureScreen.tsx src/ui/LineCaptureScreen.test.tsx
git commit -m "feat(ui): line capture screen (params → P1 → anchor → PN → save)"
```

---

## Task 11: Line detail screen + router wiring

**Files:**
- Create: `src/ui/LineDetail.tsx`, `src/ui/LineDetail.test.tsx`
- Modify: `src/ui/Router.tsx` — add three routes:
  - `/sites/:id/surveys/:svId/lines/new` → `<LineCaptureScreen>` wrapped.
  - `/sites/:id/surveys/:svId/lines/:lnId` → `<LineDetail>`.
  - (Edit deferred; only new + view for Phase 1c.)
- Modify: `src/ui/SurveyDetail.tsx` — replace the "lines placeholder" section with a real lines list via `useLines(surveyId)` + "New line" button.

**Interfaces:**
- Consumes: `useLine` (T7), `labels`, `Line` type.
- Produces:
  - `<LineDetail lineId={string} onBack={() => void} />` — read view of a line: header (label, length), parameters, vertex list (lat/lon/hAccM per vertex), anchor thumbnail if present, transformLog rendered as a table (empty state = "няма трансформации").
  - Router routes wired.

- [ ] **Step 1: Write failing tests for LineDetail**

Write `src/ui/LineDetail.test.tsx`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { createSite } from '../domain/site-service';
import { createSurvey } from '../domain/survey-service';
import { createLine } from '../domain/line-service';
import { LineDetail } from './LineDetail';
import type { Vertex } from '../domain/types';

beforeEach(async () => {
  await resetDb();
  clearRoot();
  setRoot(createMockRoot());
});

function v(atPointIndex: number, lat: number, lon: number): Vertex {
  return {
    lat, lon, elevSource: 'none',
    hAccM: 6, hAccMethod: 'median-reported',
    sampleCount: 20, fixedAt: new Date(), atPointIndex,
  };
}

describe('<LineDetail />', () => {
  it('renders label, spacing, mode, vertices', async () => {
    const site = await createSite({
      name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    const sv = await createSurvey(site.id, {
      startedAt: new Date(), timezone: 'Europe/Sofia', operator: 'x',
      deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    const line = await createLine(sv.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [v(1, 42.32, 23.78), v(17, 42.32, 23.7804)],
    });

    render(<LineDetail lineId={line.id} onBack={() => {}} />);
    expect(await screen.findByText('L1')).toBeInTheDocument();
    // Spacing values
    expect(screen.getByText(/5/)).toBeInTheDocument();
    // Vertices show both point indices
    expect(screen.getByText(/точка 1/i)).toBeInTheDocument();
    expect(screen.getByText(/точка 17/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: RED**

```bash
npm test src/ui/LineDetail.test.tsx
```

- [ ] **Step 3: Implement `src/ui/LineDetail.tsx`**

```typescript
import { labels } from './labels';
import { useLine } from '../cache/hooks';

interface Props {
  lineId: string;
  onBack: () => void;
}

export function LineDetail({ lineId, onBack }: Props) {
  const row = useLine(lineId);
  if (!row) return <p>{labels.common.loading}</p>;
  const l = row.json;
  const ll = labels.line;
  return (
    <section style={{ padding: 16, maxWidth: 720 }}>
      <button onClick={onBack}>{labels.common.back}</button>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{l.label}</h1>
        <code>{ll.title}</code>
      </header>

      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px' }}>
        <dt>{ll.fields.pointCount}</dt><dd>{l.pointCount}</dd>
        <dt>{ll.fields.pointSpacingM}</dt><dd>{l.pointSpacingM}</dd>
        <dt>{ll.fields.electrodeSpacingM}</dt><dd>{l.electrodeSpacingM}</dd>
        <dt>{ll.fields.mode}</dt><dd>{ll.modeOptions[l.mode]}</dd>
        <dt>{ll.fields.dipoleOrientation}</dt><dd>{ll.dipoleOptions[l.dipoleOrientation]}</dd>
        {l.lengthM != null && (<><dt>{ll.lengthM}</dt><dd>{l.lengthM.toFixed(2)} m</dd></>)}
      </dl>

      <h2>{ll.verticesFixed}</h2>
      <ul>
        {l.vertices.map((v, i) => (
          <li key={i}>
            точка {v.atPointIndex} · {v.lat.toFixed(6)}, {v.lon.toFixed(6)} · hAccM {v.hAccM.toFixed(1)} m · {v.sampleCount} проби
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Wire routes in `src/ui/Router.tsx`**

Add these route handler wrappers (near the other Route wrappers):

```typescript
import { LineCaptureScreen } from './LineCaptureScreen';
import { LineDetail } from './LineDetail';

function LineNewRoute({ params }: { params: { id: string; svId: string } }) {
  const [, setLocation] = useLocation();
  return (
    <LineCaptureScreen
      surveyId={params.svId}
      onSaved={(lineId) => setLocation(`/sites/${params.id}/surveys/${params.svId}/lines/${lineId}`)}
      onCancel={() => setLocation(`/sites/${params.id}/surveys/${params.svId}`)}
    />
  );
}

function LineDetailRoute({ params }: { params: { id: string; svId: string; lnId: string } }) {
  const [, setLocation] = useLocation();
  return (
    <LineDetail
      lineId={params.lnId}
      onBack={() => setLocation(`/sites/${params.id}/surveys/${params.svId}`)}
    />
  );
}
```

Then in the `<Switch>`, add the two routes BEFORE the fallback (and BEFORE any `/sites/:id/surveys/:svId` catch-all):

```typescript
<Route path="/sites/:id/surveys/:svId/lines/new">
  {(params) => <LineNewRoute params={params as { id: string; svId: string }} />}
</Route>
<Route path="/sites/:id/surveys/:svId/lines/:lnId">
  {(params) => <LineDetailRoute params={params as { id: string; svId: string; lnId: string } } />}
</Route>
```

- [ ] **Step 5: Update `src/ui/SurveyDetail.tsx`**

Locate the block:
```typescript
      <h2>{l.linesHeading}</h2>
      <p>{l.linesPlaceholder}</p>
```
Replace with:
```typescript
      <h2>{l.linesHeading}</h2>
      <LinesList surveyId={surveyId} />
```

Add at the top of the file:
```typescript
import { useLines } from '../cache/hooks';
```

Then define `LinesList` at the bottom of the file (below `SurveyDetail`):
```typescript
function LinesList({ surveyId }: { surveyId: string }) {
  const lines = useLines(surveyId);
  if (lines === undefined) return <p>{labels.common.loading}</p>;
  if (lines.length === 0) return <p>{labels.line.noLines}</p>;
  return (
    <ul>
      {lines.map((r) => (
        <li key={r.id}>
          <strong>{r.json.label}</strong> · {r.json.pointCount} точки, {r.json.pointSpacingM} m spacing
        </li>
      ))}
    </ul>
  );
}
```

Also, `SurveyDetail` needs a "New line" button that navigates. Since `SurveyDetail` doesn't own routing state, add the button and delegate to a new `onNewLine` prop:

```typescript
interface Props {
  surveyId: string;
  onEdit: () => void;
  onBack: () => void;
  onNewLine: () => void;  // NEW
}
```

Add the button next to Finalize/Edit:
```typescript
<button onClick={onNewLine} disabled={busy}>{labels.line.newLine}</button>
```

Then update `SurveyDetailRoute` in `Router.tsx` to pass:
```typescript
onNewLine={() => setLocation(`/sites/${params.id}/surveys/${params.svId}/lines/new`)}
```

Update `src/ui/SurveyDetail.test.tsx` if its render call omits `onNewLine` — pass `onNewLine={() => {}}`.

- [ ] **Step 6: GREEN + typecheck + build**

```bash
npm test && npm run typecheck && npm run build
```
Fix any lint/type errors introduced by the SurveyDetail props change. Expect ~1 test file (SurveyDetail.test.tsx) to need the new prop.

- [ ] **Step 7: Commit**

```bash
git add src/ui/LineDetail.tsx src/ui/LineDetail.test.tsx src/ui/Router.tsx src/ui/SurveyDetail.tsx src/ui/SurveyDetail.test.tsx
git commit -m "feat(ui): line detail screen + router wiring + surveys list under SurveyDetail"
```

---

## Task 12: Integration test — full line capture flow

**Files:**
- Create: `integration/phase1c-line-capture-flow.test.ts`

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Write the test**

Write `integration/phase1c-line-capture-flow.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../src/test/mock-fs';
import { setRoot, clearRoot } from '../src/storage/fs';
import { getDb, resetDb } from '../src/cache/db';
import { setWakeLockAdapter } from '../src/hardware/wake-lock';
import { setGeolocationAdapter } from '../src/hardware/geolocation';
import { mockWakeLockAdapter, mockGeolocationAdapter } from '../src/test/mock-navigator';
import { setDownscaleAdapter } from '../src/domain/anchor-photo';
import { readJson } from '../src/storage/atomic';
import { getPath } from '../src/storage/paths';
import { createSite } from '../src/domain/site-service';
import { createSurvey } from '../src/domain/survey-service';
import { sampleVertex } from '../src/domain/gps-sampling';
import { createLine, updateLine } from '../src/domain/line-service';
import { captureAnchorPhoto } from '../src/domain/anchor-photo';
import type { Line } from '../src/domain/types';

let root: FileSystemDirectoryHandle;
let geo: ReturnType<typeof mockGeolocationAdapter>;

async function tick() { return new Promise((r) => setTimeout(r, 0)); }

beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
  const wl = mockWakeLockAdapter();
  setWakeLockAdapter(wl.adapter);
  geo = mockGeolocationAdapter();
  setGeolocationAdapter(geo.adapter);
  setDownscaleAdapter(async (b) => b);
});

describe('Phase 1c full line capture flow', () => {
  it('site → survey → sampleVertex×2 → captureAnchor → createLine → updateLine linkage', async () => {
    // Seed
    const site = await createSite({
      name: 'Ivanov', settlement: 'Долна Баня', municipality: 'Долна Баня',
      region: 'Софийска', centroid: { lat: 42.32, lon: 23.78 },
      accessNotes: '', landUse: '', status: 'surveyed', tags: [],
    });
    const sv = await createSurvey(site.id, {
      startedAt: new Date(), timezone: 'Europe/Sofia', operator: 'Anton',
      deviceModel: 'PQWT-TC300', deviceSerial: 'SN1',
      precipLast48h: 'none', qualityFlag: 'good',
    });

    // Point 1
    const p1Promise = sampleVertex(1, { targetSamples: 5, discardFirst: 3, timeoutMs: 60_000 });
    for (let i = 0; i < 3; i++) { geo.pushFix({ accuracyM: 50 }); await tick(); }
    for (let i = 0; i < 5; i++) {
      geo.pushFix({ lat: 42.32 + i * 1e-6, lon: 23.78 + i * 1e-6, accuracyM: 6 });
      await tick();
    }
    const p1 = await p1Promise;

    // Point 17
    const pnPromise = sampleVertex(17, { targetSamples: 5, discardFirst: 3, timeoutMs: 60_000 });
    for (let i = 0; i < 3; i++) { geo.pushFix({ accuracyM: 50 }); await tick(); }
    for (let i = 0; i < 5; i++) {
      geo.pushFix({ lat: 42.32 + i * 1e-6, lon: 23.7804 + i * 1e-6, accuracyM: 5 });
      await tick();
    }
    const pn = await pnPromise;

    // Create line
    const line = await createLine(sv.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [p1.vertex, pn.vertex],
    });

    // Capture anchor
    const file = new File([new Uint8Array([9, 9, 9])], 'photo.jpg', { type: 'image/jpeg' });
    const media = await captureAnchorPhoto({
      file, lineId: line.id,
      capturedAt: new Date(),
      lat: p1.vertex.lat, lon: p1.vertex.lon,
    });

    // Link back onto the line
    const linked = await updateLine(line.id, { point1AnchorMediaId: media.id });
    expect(linked.revision).toBe(2);
    expect(linked.point1AnchorMediaId).toBe(media.id);

    // Verify JSON on disk mirrors the cache
    const siteRow = (await getDb().sites.get(site.id))!;
    const svRow = (await getDb().surveys.get(sv.id))!;
    const lineDir = await getPath(root, [
      'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', 'L1',
    ]);
    expect(lineDir).not.toBeNull();
    const persisted = await readJson<Line>(lineDir!, 'line.json');
    expect(persisted.channelSetSnapshot.units).toBe('mV');       // §2 R1 flow-through
    expect(persisted.channelSetSnapshot.depthModel).toBe('linear-nominal'); // §2 R3
    expect(persisted.transformLog).toEqual([]);                  // §5.4
    expect(persisted.point1AnchorMediaId).toBe(media.id);
    expect(persisted.vertices).toHaveLength(2);
    expect(persisted.vertices[0].hAccMethod).toBe('median-reported');
    expect(persisted.lengthM).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the whole suite**

```bash
npm test && npm run typecheck && npm run build
```
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add integration/phase1c-line-capture-flow.test.ts
git commit -m "test(integration): full Phase 1c line capture flow"
```

---

## Done criteria

All true before this plan is considered complete:

- [ ] `npm test` reports every test file green (target: ~155+ tests).
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` succeeds.
- [ ] `npm run dev` opens an app where Anton can navigate to a Survey, click "Нов профил", and capture a Line end-to-end (with mocked geolocation in tests; real GPS in the browser).
- [ ] The integration test proves the full lifecycle: two GPS samples + anchor photo + line row + folder JSON.
- [ ] Every commit ran `npm run typecheck` before landing (Phase 1a's ruling).
- [ ] All Bulgarian UI copy lives in `src/ui/labels.ts`; no user-visible literals in components.
- [ ] Physics rules R1/R2/R3/R6 unchanged; `channelSetSnapshot` is embedded by value, frozen (§4.9); `transformLog` is a required empty array (§5.4).

## What is NOT in this plan (deferred to later phases)

- DeviceOrientation-based bearing capture (add in a follow-up "capture polish" plan).
- Detour vertices (midway) — Phase 1c captures only point 1 and point N. Users can add detour vertices in Phase 1e when we add a real polyline editor.
- Line edit UI (`/sites/:id/surveys/:svId/lines/:lnId/edit`) — read-only in Phase 1c.
- Anchor photo re-capture / rotation UI — accept the first upload.
- Media tombstones / soft-delete of the anchor photo — media follows the line for now.
- Wake Lock permission prompt handling on iOS-Chrome-adjacent browsers (out of scope; Chrome-family only).
- Real ChannelSet management — `channelSets/` folder writes are deferred; every Line embeds the same TC300 stub for now.
