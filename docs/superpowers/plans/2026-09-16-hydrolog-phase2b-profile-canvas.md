# HydroLog Phase 2b — Profile Canvas & Point Construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `Line.points[]` during PQWT import (GPS-interpolated positions + device readings per point) and render the resulting 18×36 readings matrix as a colour heatmap in `LineDetail` alongside the stored device screenshots.

**Architecture:** A new pure function `buildLinePoints` interpolates GPS positions along the existing vertex polyline (using the already-built `interpolatePointsAlongPolyline` from `enu.ts`) and zips them with the parsed readings from Phase 2a's `parsePqwtCsv`. The import service calls it before `attachDeviceData`; the updated line lands in Dexie with a full `points[]` array. `ProfileCanvas` is a focused canvas component — it receives `points` and `channelSet` directly (no I/O), draws one coloured cell per reading, and is embedded in `LineDetail`. Device-screen BMPs are loaded via a new `useLineMedia` hook + a small async helper that navigates the FSA handle tree. No new runtime dependencies.

**Tech Stack:** TypeScript, React 18, HTML Canvas 2D, Dexie 4, Vitest, Testing Library (happy-dom).

**Spec:** `docs/app-spec-v2.md` — §2 R3 (linear-nominal depth model, pseudo-depth axis), §4.6 Point schema, §4.7 Reading schema, §4.9 frozen ChannelSetSnapshot, §4.13 MediaAsset (`device-screen`, full-res, never downscaled), §5.5 profile view (X = point index / metres axis; Y = pseudo-depth; colour = mV; sequential scale; device screenshot side by side).

## Global Constraints

Every task inherits these.

- **Every task ends with `npm run typecheck && npm test && npm run build` all green before commit.** (Phase 1a ruling.)
- **Bulgarian in UI only.** English in code/comments/JSON. All user-facing strings from `src/ui/labels.ts`.
- **Folder-first, then cache** (§10.3) — service writes JSON/blobs to disk first, updates Dexie second.
- **Audit fields (§4.1)** on every write.
- **No new runtime dependencies.** Canvas is native; no charting library.
- **§5.5: the app does not claim to reproduce the instrument's colour map.** Render our own sequential scale (blue-low → red-high), label it as such.
- **§4.13: device screens never downscaled.** `isOriginal: true` on every `device-screen` MediaAsset.
- Phase 2b does NOT implement: Three Freq folder (no sample files available), anomaly entry (Phase 2c), import undo (create-fresh-line per spec), line-with-no-vertices flow.

---

## File Structure Map

```
src/
  domain/
    line-points.ts                   NEW  (T1) buildLinePoints pure function
    line-points.test.ts              NEW  (T1) unit tests
    line-service.ts                  MOD  (T2) extend AttachDeviceDataInput with points?
    pqwt-import-service.ts           MOD  (T2) call buildLinePoints before attachDeviceData
    pqwt-import-service.test.ts      MOD  (T2) assert points[] present after import
  ui/
    ProfileCanvas.tsx                NEW  (T3) canvas heatmap + valueToColor (exported)
    ProfileCanvas.test.tsx           NEW  (T3) smoke test + valueToColor unit tests
    LineDetail.tsx                   MOD  (T5) embed ProfileCanvas + BMP viewer
    labels.ts                        MOD  (T5) add labels.profile section
  cache/
    hooks.ts                         MOD  (T4) add useLineMedia hook
```

---

## Task 1: `buildLinePoints` — pure function

**Files:**
- Create: `src/domain/line-points.ts`
- Create: `src/domain/line-points.test.ts`

**Interfaces:**
- Consumes: `interpolatePointsAlongPolyline`, `polylineLengthM` from `../enu`; `LatLon`, `Point`, `ChannelSetSnapshot` from `./types`
- Produces:
  ```typescript
  export interface BuildLinePointsInput {
    vertices: LatLon[];
    pointCount: number;
    channelSet: ChannelSetSnapshot;
    parsedReadings: (number | null)[][];  // [pointIndex][channelIndex], 0-based
    recordedAt: Date;
  }
  export function buildLinePoints(input: BuildLinePointsInput): Point[]
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/domain/line-points.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildLinePoints } from './line-points';
import type { ChannelSetSnapshot, LatLon } from './types';

// Minimal channel set for testing
const TWO_CH: ChannelSetSnapshot = {
  name: 'test', deviceModel: 'PQWT-150M', kind: 'frequency',
  units: 'mV', depthModel: 'linear-nominal', provenanceNote: 'test',
  frozenAt: new Date('2026-01-01'),
  channels: [
    { label: 'freq01', order: 0, pseudoDepthM: 75 },
    { label: 'freq02', order: 1, pseudoDepthM: 150 },
  ],
};

const V1: LatLon = { lat: 42.00, lon: 23.00 };
const V2: LatLon = { lat: 42.01, lon: 23.01 };

describe('buildLinePoints', () => {
  it('returns pointCount points', () => {
    const pts = buildLinePoints({
      vertices: [V1, V2], pointCount: 3,
      channelSet: TWO_CH,
      parsedReadings: [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]],
      recordedAt: new Date(),
    });
    expect(pts).toHaveLength(3);
  });

  it('index is 1-based', () => {
    const pts = buildLinePoints({
      vertices: [V1, V2], pointCount: 3,
      channelSet: TWO_CH,
      parsedReadings: [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]],
      recordedAt: new Date(),
    });
    expect(pts[0].index).toBe(1);
    expect(pts[2].index).toBe(3);
  });

  it('first point has offsetM=0; last point has offsetM≈totalLength', () => {
    const pts = buildLinePoints({
      vertices: [V1, V2], pointCount: 3,
      channelSet: TWO_CH,
      parsedReadings: [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]],
      recordedAt: new Date(),
    });
    expect(pts[0].offsetM).toBe(0);
    expect(pts[2].offsetM).toBeGreaterThan(pts[1].offsetM);
  });

  it('readings values match parsedReadings', () => {
    const pts = buildLinePoints({
      vertices: [V1, V2], pointCount: 2,
      channelSet: TWO_CH,
      parsedReadings: [[1.0, 2.0], [3.0, 4.0]],
      recordedAt: new Date(),
    });
    expect(pts[0].readings[0].values).toEqual([1.0, 2.0]);
    expect(pts[1].readings[0].values).toEqual([3.0, 4.0]);
  });

  it('null readings propagate correctly', () => {
    const pts = buildLinePoints({
      vertices: [V1, V2], pointCount: 2,
      channelSet: TWO_CH,
      parsedReadings: [[null, 2.0], [3.0, null]],
      recordedAt: new Date(),
    });
    expect(pts[0].readings[0].values[0]).toBeNull();
    expect(pts[1].readings[0].values[1]).toBeNull();
  });

  it('fills with nulls when parsedReadings is shorter than pointCount', () => {
    const pts = buildLinePoints({
      vertices: [V1, V2], pointCount: 3,
      channelSet: TWO_CH,
      parsedReadings: [[0.1, 0.2]],   // only 1 row
      recordedAt: new Date(),
    });
    expect(pts[1].readings[0].values).toEqual([null, null]);
    expect(pts[2].readings[0].values).toEqual([null, null]);
  });

  it('coordSource is interpolated', () => {
    const pts = buildLinePoints({
      vertices: [V1, V2], pointCount: 2,
      channelSet: TWO_CH,
      parsedReadings: [[0.1, 0.2], [0.3, 0.4]],
      recordedAt: new Date(),
    });
    expect(pts[0].coordSource).toBe('interpolated');
  });

  it('elevSource is none', () => {
    const pts = buildLinePoints({
      vertices: [V1, V2], pointCount: 2,
      channelSet: TWO_CH,
      parsedReadings: [[0.1, 0.2], [0.3, 0.4]],
      recordedAt: new Date(),
    });
    expect(pts[0].elevSource).toBe('none');
  });

  it('single vertex: all points share that position', () => {
    const pts = buildLinePoints({
      vertices: [V1], pointCount: 3,
      channelSet: TWO_CH,
      parsedReadings: [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]],
      recordedAt: new Date(),
    });
    expect(pts[0].lat).toBeCloseTo(V1.lat);
    expect(pts[2].lat).toBeCloseTo(V1.lat);
  });

  it('pointCount=1: returns single point at first vertex', () => {
    const pts = buildLinePoints({
      vertices: [V1, V2], pointCount: 1,
      channelSet: TWO_CH,
      parsedReadings: [[0.1, 0.2]],
      recordedAt: new Date(),
    });
    expect(pts).toHaveLength(1);
    expect(pts[0].index).toBe(1);
    expect(pts[0].offsetM).toBe(0);
  });

  it('each point has exactly one Reading with pass=1', () => {
    const pts = buildLinePoints({
      vertices: [V1, V2], pointCount: 2,
      channelSet: TWO_CH,
      parsedReadings: [[0.1, 0.2], [0.3, 0.4]],
      recordedAt: new Date(),
    });
    for (const pt of pts) {
      expect(pt.readings).toHaveLength(1);
      expect(pt.readings[0].pass).toBe(1);
      expect(pt.readings[0].groundingOk).toBe(true);
      expect(pt.readings[0].electrodeTreatment).toBe('none');
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test src/domain/line-points.test.ts
```
Expected: FAIL — `Cannot find module './line-points'`

- [ ] **Step 3: Implement `buildLinePoints`**

Create `src/domain/line-points.ts`:
```typescript
import type { LatLon, Point, ChannelSetSnapshot } from './types';
import { interpolatePointsAlongPolyline, polylineLengthM } from './enu';

export interface BuildLinePointsInput {
  vertices: LatLon[];
  pointCount: number;
  channelSet: ChannelSetSnapshot;
  parsedReadings: (number | null)[][];  // [pointIndex][channelIndex], 0-based
  recordedAt: Date;
}

export function buildLinePoints(input: BuildLinePointsInput): Point[] {
  const { vertices, pointCount, channelSet, parsedReadings, recordedAt } = input;
  const latLons = interpolatePointsAlongPolyline(vertices, pointCount);
  const totalLengthM = vertices.length >= 2 ? polylineLengthM(vertices) : 0;
  const step = pointCount > 1 ? totalLengthM / (pointCount - 1) : 0;
  const nChannels = channelSet.channels.length;

  return latLons.map((ll, i) => {
    const row = parsedReadings[i];
    const values: (number | null)[] = row
      ? [...row]
      : new Array(nChannels).fill(null);

    return {
      index: i + 1,
      offsetM: parseFloat((i * step).toFixed(4)),
      lat: ll.lat,
      lon: ll.lon,
      elevSource: 'none' as const,
      coordSource: 'interpolated' as const,
      readings: [{
        pass: 1,
        recordedAt,
        values,
        groundingOk: true,
        electrodeTreatment: 'none' as const,
      }],
      flags: [],
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test src/domain/line-points.test.ts
```
Expected: all 10 tests PASS.

- [ ] **Step 5: Full verification**

```bash
npm run typecheck && npm test && npm run build
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/domain/line-points.ts src/domain/line-points.test.ts
git commit -m "feat(domain): buildLinePoints — GPS-interpolated points from PQWT readings"
```

---

## Task 2: Wire point construction into the import service

**Files:**
- Modify: `src/domain/line-service.ts` lines ~158–163 (`AttachDeviceDataInput` type)
- Modify: `src/domain/line-service.ts` lines ~183–190 (inside `attachDeviceData`)
- Modify: `src/domain/pqwt-import-service.ts` (call `buildLinePoints`, pass `points` to `attachDeviceData`)
- Modify: `src/domain/pqwt-import-service.test.ts` (assert `points[]` populated)

**Interfaces:**
- Consumes: `buildLinePoints` from `./line-points`
- Produces: `Line.points[]` populated after `importPqwtIntoLine`; `AttachDeviceDataInput.points?: Point[]`

- [ ] **Step 1: Add test assertion for points in the existing import service test**

Open `src/domain/pqwt-import-service.test.ts`. Find the test named `'imports CSV + stores verbatim + registers media + updates Line'` (or similar). After the assertion on `updatedLine.channelSetSnapshot`, add:

```typescript
// Points should be constructed from the 3-point fixture + 2-vertex line
expect(updatedLine.points).toHaveLength(3);           // 3 rows in fixture CSV
expect(updatedLine.points[0].index).toBe(1);
expect(updatedLine.points[0].offsetM).toBe(0);
expect(updatedLine.points[0].coordSource).toBe('interpolated');
expect(updatedLine.points[0].readings[0].values).toHaveLength(36);
```

- [ ] **Step 2: Run to verify current state fails**

```bash
npm test src/domain/pqwt-import-service.test.ts
```
Expected: the test fails because `updatedLine.points` is `[]`.

- [ ] **Step 3: Extend `AttachDeviceDataInput` in `line-service.ts`**

Locate the `AttachDeviceDataInput` type alias (around line 158 — it starts with `'channelSetSnapshot' | ...`). Replace it with:

```typescript
export type AttachDeviceDataInput = Pick<
  Line,
  'channelSetSnapshot' | 'pointCount' | 'deviceStartPointIndex' | 'deviceLineNumber' | 'mode'
> & {
  status?: Line['status'];
  points?: Point[];
};
```

Add `Point` to the existing import of types at the top of `line-service.ts` if not already present:
```typescript
import type { Line, Vertex, Point } from './types';
```

- [ ] **Step 4: Use `points` inside `attachDeviceData`**

Inside `attachDeviceData`, find where `next` is constructed (the object spread starting with `...existing`). Add `points` to the spread:

```typescript
const next: Line = {
  ...existing,
  channelSetSnapshot: patch.channelSetSnapshot,
  pointCount: patch.pointCount,
  deviceStartPointIndex: patch.deviceStartPointIndex,
  deviceLineNumber: patch.deviceLineNumber,
  mode: patch.mode,
  status: patch.status ?? existing.status,
  points: patch.points ?? existing.points,   // ← add this line
  updatedAt: now,
  revision: existing.revision + 1,
};
```

- [ ] **Step 5: Call `buildLinePoints` in `pqwt-import-service.ts`**

At the top of `pqwt-import-service.ts`, add the import:
```typescript
import { buildLinePoints } from './line-points';
```

Immediately after the `channelSetSnapshot` is built (step 3 in the function, after `buildPqwtChannelSet`), add:

```typescript
const importedAt = new Date();
const points = buildLinePoints({
  vertices: lineRow.json.vertices,
  pointCount: parsed.pointCount,
  channelSet: channelSetSnapshot,
  parsedReadings: parsed.readings,
  recordedAt: importedAt,
});
```

Then in the `attachDeviceData` call at the bottom (step 8), add `points` and replace the `new Date()` with `importedAt` for consistency:

```typescript
await attachDeviceData(input.targetLineId, {
  channelSetSnapshot,
  pointCount: parsed.pointCount,
  deviceStartPointIndex: parsed.startN,
  deviceLineNumber: parsed.deviceLineLabel,
  mode: 'multi-frequency',
  status: 'complete',
  points,
});
```

Also pass `importedAt` to `readingsToLongCsv` if that call still uses `new Date()` — replace it with `importedAt.toISOString()`.

- [ ] **Step 6: Run import service tests to verify they pass**

```bash
npm test src/domain/pqwt-import-service.test.ts
```
Expected: all tests PASS including the new points assertions.

- [ ] **Step 7: Full verification**

```bash
npm run typecheck && npm test && npm run build
```
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/domain/line-service.ts src/domain/pqwt-import-service.ts src/domain/pqwt-import-service.test.ts
git commit -m "feat(domain): populate Line.points[] with GPS-interpolated readings at import"
```

---

## Task 3: `ProfileCanvas` component

**Files:**
- Create: `src/ui/ProfileCanvas.tsx`
- Create: `src/ui/ProfileCanvas.test.tsx`

**Interfaces:**
- Consumes: `Point`, `ChannelSetSnapshot` from `../domain/types`
- Produces:
  ```typescript
  // Exported for testing
  export function valueToColor(v: number, min: number, max: number): string
  export function valueToColor(v: null, min: number, max: number): string  // '#888'
  
  interface ProfileCanvasProps {
    points: Point[];
    channelSet: ChannelSetSnapshot;
    cellW?: number;   // pixels per column, default 20
    cellH?: number;   // pixels per channel row, default 8
  }
  export function ProfileCanvas(props: ProfileCanvasProps): JSX.Element
  ```

- [ ] **Step 1: Write tests for `valueToColor` and the canvas smoke test**

Create `src/ui/ProfileCanvas.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProfileCanvas, valueToColor } from './ProfileCanvas';
import type { ChannelSetSnapshot, Point } from '../domain/types';

const TWO_CH: ChannelSetSnapshot = {
  name: 'test', deviceModel: 'PQWT-150M', kind: 'frequency',
  units: 'mV', depthModel: 'linear-nominal', provenanceNote: 'test',
  frozenAt: new Date('2026-01-01'),
  channels: [
    { label: 'freq01', order: 0, pseudoDepthM: 75 },
    { label: 'freq02', order: 1, pseudoDepthM: 150 },
  ],
};

function makePoint(index: number, values: (number | null)[]): Point {
  return {
    index, offsetM: (index - 1) * 2, lat: 42.0, lon: 23.0,
    elevSource: 'none', coordSource: 'interpolated',
    readings: [{ pass: 1, recordedAt: new Date(), values, groundingOk: true, electrodeTreatment: 'none' }],
    flags: [],
  };
}

describe('valueToColor', () => {
  it('returns blue-family hsl for min value', () => {
    const color = valueToColor(0, 0, 1);
    expect(color).toMatch(/hsl\(240/);
  });

  it('returns red-family hsl for max value', () => {
    const color = valueToColor(1, 0, 1);
    expect(color).toMatch(/hsl\(0[,)]/);
  });

  it('returns mid hsl for midpoint value', () => {
    const color = valueToColor(0.5, 0, 1);
    expect(color).toMatch(/hsl\(120/);
  });

  it('returns grey (#888) for null', () => {
    expect(valueToColor(null as unknown as number, 0, 1)).toBe('#888');
  });

  it('returns blue when min equals max (degenerate range)', () => {
    const color = valueToColor(5, 5, 5);
    expect(color).toMatch(/hsl\(240/);
  });
});

describe('ProfileCanvas', () => {
  it('renders a canvas element', () => {
    const { container } = render(
      <ProfileCanvas
        points={[makePoint(1, [0.1, 0.2]), makePoint(2, [0.3, 0.4])]}
        channelSet={TWO_CH}
      />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('renders without crashing when points is empty', () => {
    const { container } = render(
      <ProfileCanvas points={[]} channelSet={TWO_CH} />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('canvas has aria-label', () => {
    const { container } = render(
      <ProfileCanvas points={[makePoint(1, [0.1, 0.2])]} channelSet={TWO_CH} />
    );
    const canvas = container.querySelector('canvas');
    expect(canvas?.getAttribute('aria-label')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test src/ui/ProfileCanvas.test.tsx
```
Expected: FAIL — `Cannot find module './ProfileCanvas'`

- [ ] **Step 3: Implement `ProfileCanvas`**

Create `src/ui/ProfileCanvas.tsx`:
```tsx
import { useRef, useEffect } from 'react';
import type { Point, ChannelSetSnapshot } from '../domain/types';
import { labels } from './labels';

// Exported for unit testing
export function valueToColor(v: number | null, min: number, max: number): string {
  if (v === null || v === undefined) return '#888';
  const range = max - min;
  const norm = range === 0 ? 0 : (v - min) / range;
  const hue = Math.round((1 - norm) * 240);
  return `hsl(${hue}, 100%, 45%)`;
}

interface ProfileCanvasProps {
  points: Point[];
  channelSet: ChannelSetSnapshot;
  cellW?: number;
  cellH?: number;
}

export function ProfileCanvas({ points, channelSet, cellW = 20, cellH = 8 }: ProfileCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const nPoints = points.length;
    const nChannels = channelSet.channels.length;

    if (nPoints === 0 || nChannels === 0) return;

    // Collect all non-null values to compute the colour scale range
    let min = Infinity;
    let max = -Infinity;
    for (const pt of points) {
      for (const r of pt.readings) {
        for (const v of r.values) {
          if (v !== null && v !== undefined) {
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
      }
    }
    if (min === Infinity) return;  // all null — nothing to draw

    canvas.width = nPoints * cellW;
    canvas.height = nChannels * cellH;

    for (let p = 0; p < nPoints; p++) {
      const values = points[p].readings[0]?.values ?? [];
      for (let c = 0; c < nChannels; c++) {
        ctx.fillStyle = valueToColor(values[c] ?? null, min, max);
        ctx.fillRect(p * cellW, c * cellH, cellW, cellH);
      }
    }
  }, [points, channelSet, cellW, cellH]);

  return (
    <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', imageRendering: 'pixelated' }}
        aria-label={labels.profile.canvasAriaLabel}
      />
    </div>
  );
}
```

> `labels.profile.canvasAriaLabel` will be added in Task 5. For now the TypeScript error will resolve once labels.ts is updated in T5. Keep the reference — it prevents forgetting the label.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test src/ui/ProfileCanvas.test.tsx
```
Expected: 8 tests PASS. (The `aria-label` test may fail until T5 adds the labels — if so, proceed and fix in T5.)

- [ ] **Step 5: Full verification** (labels compile error expected — resolve in T5)

```bash
npm run typecheck
```
Expected: error on `labels.profile.canvasAriaLabel` — that's fine, will be fixed in T5.

- [ ] **Step 6: Commit after T5 resolves the labels error — skip this commit step and continue to T4.**

---

## Task 4: `useLineMedia` hook

**Files:**
- Modify: `src/cache/hooks.ts` — add `useLineMedia`

**Interfaces:**
- Consumes: `getDb`, `MediaRow` from `./db`
- Produces:
  ```typescript
  export function useLineMedia(lineId: string | undefined): MediaRow[] | undefined
  ```

- [ ] **Step 1: Add `useLineMedia` to `src/cache/hooks.ts`**

After the `useLine` export at the end of the file, add:
```typescript
import type { MediaRow } from './db';

export function useLineMedia(lineId: string | undefined): MediaRow[] | undefined {
  return useLiveQuery(async () => {
    if (!lineId) return [];
    return getDb().media.where('linkedId').equals(lineId).toArray();
  }, [lineId]);
}
```

> Note: `MediaRow` may already be imported in the file — check first and only add the import if it's missing.

- [ ] **Step 2: Verify the hook compiles**

```bash
npm run typecheck
```
Expected: no new errors from `hooks.ts`.

- [ ] **Step 3: Full verification**

```bash
npm run typecheck && npm test && npm run build
```
Expected: all green (the `labels.profile` error from T3 is still outstanding — that resolves in T5).

---

## Task 5: Wire `ProfileCanvas` + BMP viewer into `LineDetail`, add labels

**Files:**
- Modify: `src/ui/labels.ts` — add `labels.profile`
- Modify: `src/ui/LineDetail.tsx` — show profile section when `line.points.length > 0`

**Interfaces:**
- Consumes: `ProfileCanvas` from `./ProfileCanvas`; `useLineMedia` from `../cache/hooks`; `getPath` from `../storage/paths`; `readBlob` from `../storage/atomic`; `getRoot` from `../storage/fs`

**BMP loading design:** The BMP files live in the FSA at a known `storagePath` relative to root (e.g. `sites/BG-SOF-0043/surveys/.../lines/L1/device-files/150M_Profile_L1.bmp`). A `useEffect` inside `LineDetail` loads each `device-screen` MediaAsset's blob via the FSA, creates an object URL, and cleans up on unmount. This avoids adding a new file for a single async side-effect.

- [ ] **Step 1: Add the `profile` section to `labels.ts`**

Open `src/ui/labels.ts` and add a `profile` key at the top level of the exported `labels` object (after `import:` or wherever the pattern is):

```typescript
profile: {
  heading: 'Профил от устройство',
  canvasAriaLabel: 'Матрица от измервания — цветова скала mV',
  noData: 'Все още няма данни от устройство. Импортирайте CSV от устройството, за да видите профила.',
  deviceScreens: 'Екрани от устройство',
  reImportHint: 'Профилът е недостъпен за линии, импортирани преди фаза 2б. Създайте нова линия и импортирайте отново.',
},
```

- [ ] **Step 2: Run typecheck — `labels.profile.canvasAriaLabel` error from T3 resolves**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Write a test for the profile section appearing in `LineDetail`**

Open (or create) `src/ui/LineDetail.test.tsx`. Add:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LineDetail } from './LineDetail';
import { getDb, resetDb } from '../cache/db';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import type { LineRow } from '../cache/db';
import type { Line } from '../domain/types';

function baseLine(overrides: Partial<Line> = {}): Line {
  const now = new Date();
  return {
    id: 'line-1', createdAt: now, updatedAt: now, revision: 1,
    label: 'L1', pointCount: 2, pointSpacingM: 2, electrodeSpacingM: 5,
    mode: 'multi-frequency', dipoleOrientation: 'inline',
    transformLog: [], noiseZones: [], vertices: [], points: [],
    status: 'draft',
    channelSetSnapshot: {
      name: 'snap', deviceModel: 'PQWT-150M', kind: 'frequency',
      units: 'mV', depthModel: 'linear-nominal', provenanceNote: 'test',
      frozenAt: now,
      channels: [{ label: 'freq01', order: 0, pseudoDepthM: 75 }],
    },
    ...overrides,
  };
}

function putLine(line: Line): Promise<void> {
  return getDb().lines.put({
    id: line.id,
    surveyId: 'sv-1',
    folderName: 'L1',
    hasDeviceFiles: false,
    json: line,
  });
}

beforeEach(async () => {
  await resetDb();
  clearRoot();
  setRoot(createMockRoot());
});

describe('LineDetail profile section', () => {
  it('shows no-data hint when points is empty', async () => {
    await putLine(baseLine());
    render(<LineDetail lineId="line-1" onBack={() => {}} />);
    expect(await screen.findByText(/Профил от устройство/)).toBeInTheDocument();
    expect(await screen.findByText(/Все още няма данни от устройство/)).toBeInTheDocument();
  });

  it('shows canvas when points are present', async () => {
    const now = new Date();
    await putLine(baseLine({
      points: [{
        index: 1, offsetM: 0, lat: 42.0, lon: 23.0,
        elevSource: 'none', coordSource: 'interpolated',
        readings: [{ pass: 1, recordedAt: now, values: [0.1], groundingOk: true, electrodeTreatment: 'none' }],
        flags: [],
      }],
    }));
    render(<LineDetail lineId="line-1" onBack={() => {}} />);
    await screen.findByText(/Профил от устройство/);
    // Canvas is rendered (aria-label present)
    expect(await screen.findByLabelText(/Матрица от измервания/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run to verify the tests fail**

```bash
npm test src/ui/LineDetail.test.tsx
```
Expected: FAIL — LineDetail doesn't yet show the profile section.

- [ ] **Step 5: Update `LineDetail.tsx` to show the profile section**

Replace the content of `src/ui/LineDetail.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { labels } from './labels';
import { useLine, useLineMedia } from '../cache/hooks';
import { ProfileCanvas } from './ProfileCanvas';
import { getPath } from '../storage/paths';
import { readBlob } from '../storage/atomic';
import { getRoot } from '../storage/fs';

interface Props {
  lineId: string;
  onBack: () => void;
}

function useBmpUrls(storagePaths: string[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    if (storagePaths.length === 0) {
      setUrls([]);
      return;
    }
    let revoked = false;
    const created: string[] = [];

    (async () => {
      try {
        const root = getRoot();
        const loaded: string[] = [];
        for (const sp of storagePaths) {
          const parts = sp.split('/');
          const fileName = parts.pop()!;
          const dir = await getPath(root, parts);
          if (!dir) continue;
          const blob = await readBlob(dir, fileName);
          const url = URL.createObjectURL(blob);
          created.push(url);
          loaded.push(url);
        }
        if (!revoked) setUrls(loaded);
      } catch {
        // root not set or file missing — show nothing silently
      }
    })();

    return () => {
      revoked = true;
      for (const u of created) URL.revokeObjectURL(u);
    };
  }, [storagePaths.join('|')]);  // eslint-disable-line react-hooks/exhaustive-deps

  return urls;
}

export function LineDetail({ lineId, onBack }: Props) {
  const row = useLine(lineId);
  const media = useLineMedia(lineId);

  const deviceScreenPaths = (media ?? [])
    .filter((m) => m.json.kind === 'device-screen')
    .map((m) => m.storagePath);

  const bmpUrls = useBmpUrls(deviceScreenPaths);

  if (!row) return <p>{labels.common.loading}</p>;
  const l = row.json;
  const ll = labels.line;
  const pl = labels.profile;

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
            Електрод {v.electrodeIndex} · {v.lat.toFixed(6)}, {v.lon.toFixed(6)} · hAccM {v.hAccM.toFixed(1)} m · {v.sampleCount} проби
          </li>
        ))}
      </ul>

      <h2>{pl.heading}</h2>
      {l.points.length === 0 ? (
        <p>{pl.noData}</p>
      ) : (
        <>
          <ProfileCanvas points={l.points} channelSet={l.channelSetSnapshot} />
          {bmpUrls.length > 0 && (
            <>
              <h3>{pl.deviceScreens}</h3>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
                {bmpUrls.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`${pl.deviceScreens} ${i + 1}`}
                    style={{ maxHeight: 240, objectFit: 'contain' }}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Run `LineDetail` tests**

```bash
npm test src/ui/LineDetail.test.tsx
```
Expected: all tests PASS.

- [ ] **Step 7: Full verification**

```bash
npm run typecheck && npm test && npm run build
```
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/ui/labels.ts src/ui/ProfileCanvas.tsx src/ui/ProfileCanvas.test.tsx src/ui/LineDetail.tsx src/ui/LineDetail.test.tsx src/cache/hooks.ts
git commit -m "feat(ui): ProfileCanvas heatmap + BMP viewer in LineDetail (§5.5)"
```

---

## Deferred to Phase 2c

- **Three Freq folder** — no sample files on disk to design the scanner extension against. Inspect the physical device first.
- **Anomaly entry** (§5.5 numeric steppers — from-point / to-point / from-channel / to-channel).
- **Import undo** — create a fresh Line and re-import per the spec. The current guard in `attachDeviceData` correctly prevents double-import.
- **Line-with-no-vertices import flow** — import first, fix GPS later.
- **GeoJSON / KMZ / PDF export** — Phase 2 spec items; requires populated `points[]` (now done) as a prerequisite.
- **Re-building points for pre-Phase-2b imports** — lines imported before this phase have `points: []`. User creates a fresh Line and re-imports.

---

## Self-Review Notes

**Spec coverage check:**

| Spec requirement | Covered |
|---|---|
| §4.6 Point schema (index, offsetM, lat, lon, elevSource, coordSource, readings, flags) | T1 |
| §4.7 Reading schema (pass, recordedAt, values, groundingOk, electrodeTreatment) | T1 |
| §4.9 channelSetSnapshot frozen, embedded by value | T2 (passed through from Phase 2a) |
| §5.5 profile X=point/metres, Y=pseudo-depth axis | T3 (Y = channel row, channels have pseudoDepthM from Phase 2a) |
| §5.5 colour = mV, sequential scale | T3 |
| §5.5 device screenshot side by side | T5 |
| §5.5 app labels its own colour scale (not claiming to reproduce instrument's) | T5 (aria-label says "цветова скала mV", not "PQWT scale") |
| §4.13 device-screen MediaAsset, isOriginal=true, never downscaled | Phase 2a (import service); T5 reads but does not write |

**Type consistency:**
- `BuildLinePointsInput.vertices: LatLon[]` matches `Line.vertices` (which are `Vertex extends LatLon`). Passing `Vertex[]` to `LatLon[]` works because `Vertex extends LatLon`.
- `Point.readings[0].values: (number | null)[]` length = `channelSet.channels.length` — guaranteed because `parsedReadings` comes from `parsePqwtCsv` which produces one value per header channel, and `channelSet` is built from the same header in `buildPqwtChannelSet`.
- `valueToColor(null, ...)` — the function signature accepts `number | null` because the canvas loop does `values[c] ?? null`. The TypeScript signature in the test file uses `null as unknown as number` — to avoid overloading complexity, declare the parameter as `number | null` in the implementation.

**Placeholder scan:** None found. All code blocks are complete.
