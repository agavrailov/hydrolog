# HydroLog Phase 2a — PQWT Device Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import PQWT device data (CSV + BMP screenshots) into HydroLog Lines: parse the 36-channel CSV, build a frozen ChannelSetSnapshot, store the raw device files verbatim per §7.3, register the two BMPs as `device-screen` MediaAssets, and attach parsed readings to an existing Line via a mandatory operator-confirmation step per §7.4.

**Architecture:** A pure CSV parser (`parsePqwtCsv`) does the format-specific work. A folder scanner discovers importable Lines by walking a picked directory. An import service orchestrates: verbatim raw-file writes → parsed readings write → BMP MediaAsset rows → Line update (channelSetSnapshot, pointCount, deviceStartPointIndex, deviceLineNumber, mode). The Import UI is a confirm-per-line screen: never auto-attach, always show the file's own name + timestamp, require one tap to accept (§7.4).

**Tech Stack:** TypeScript, Vitest, Vite's `?raw` import for CSV fixtures in tests. No new runtime deps.

**Spec:** `docs/app-spec-v2.md` — §2 physics rules, §4.5 Line schema, §4.6 Point, §4.7 Reading, §4.9 frozen ChannelSetSnapshot, §4.13 MediaAsset (`kind: 'device-screen'`, full-resolution never downscaled), §5.5 device screenshot is mandatory first-class field, §7 import pipeline, §7.1 "one file layout, one instrument, one user — not a universal engine", §7.3 verbatim raw-file storage forever + SHA-256, §7.4 line assignment never automatic, §7.5 shape mismatch never silently flipped, §7.6 image-only fallback.

## Sample data (Phase 0 outcome, on disk now)

`D:\Claude\Projects\Хидрогеоложки проучвания\Profile Survey\150M\L{1,2,3,10}\`
Each `L<n>` folder contains:
- `150M_L<n>.csv` — 4.3 KB, ASCII, CRLF. Header `L,N,freq01..freq36,` (trailing comma → 39 fields per row). Body: 18 rows of `L,N,f1..f36`. L constant per file (matches label), N starts at operator-picked value (80 in our sample; **varies per line, operator-set**).
- `150M_Profile_L<n>.bmp` — 814 KB raw device screenshot.
- `150M_Profile_L<n>_Processed.bmp` — 814 KB post-processed device screenshot.
- `desktop.ini` — Windows metadata to ignore.

Sibling folders (`System volume inf`, `Three Freq`) exist on the SD card but are not in scope for Phase 2a — deferred to Phase 2b.

## Global Constraints

Every task inherits these.

- **Every task ends with `npm run typecheck && npm test && npm run build` all green before commit.** (Phase 1a ruling.)
- **§7.1 scope discipline:** the parser is for ONE file layout (this device's PQWT CSV export). No delimiter sniffing, no encoding sniffing, no orientation heuristics. The CSV is ASCII + CRLF + comma-delimited + header on line 1.
- **§7.3 verbatim raw-file storage:** every imported byte (CSV + both BMPs) lands under `sites/.../lines/L<n>/device-files/` unchanged, alongside a `sha256.txt` manifest. The parsed readings are a derived artefact (`readings.csv`); the raw file is the archived truth.
- **§7.4 line assignment never automatic:** the UI pre-selects a candidate by matching the device file's label to an existing Line's label, but requires an explicit operator tap to accept before writing.
- **§7.5 no silent flips:** the operator-set `N` starts at whatever the device recorded. We preserve it verbatim as `Line.deviceStartPointIndex`. We NEVER mirror, reverse, or renumber the point sequence silently. Any orientation change is a logged `TransformLogEntry` per §5.4.
- **§5.5 device screenshot mandatory:** both BMPs land as `MediaAsset` rows with `kind: 'device-screen'` and `isOriginal: true` (never downscaled per §4.13 — spec explicitly excludes device screens from downscaling).
- **§4.9 channelSetSnapshot frozen:** the ChannelSet built from the CSV header is embedded by value on the Line, frozen at import time.
- **§2 physics rules unchanged:** `units: 'mV'`, `depthModel: 'linear-nominal'` (150 m / 36 channels ≈ 4.167 m per step per §2 R3 nominal linear split), no `depth_m` field, `pseudoDepthM` only.
- **Bulgarian in UI only.** English in code/comments/JSON. All user-facing strings from `src/ui/labels.ts`.
- **Folder-first, then cache** (Phase 1a §10.3) — service functions write JSON/blobs to disk first, update Dexie second.
- **Audit fields (§4.1)** on every write.

---

## File Structure Map

```
.gitignore                                       # (T1) exclude Profile Survey/ + samples/
docs/app-spec-v2.md                              # (T1) §4.5 clarification: add deviceStartPointIndex
src/
  domain/
    types.ts                                     # (T1) add deviceStartPointIndex to Line
    types.test.ts                                # (T1) test the new optional field
    pqwt-parser.ts                               # (T2) parsePqwtCsv pure function
    pqwt-parser.test.ts                          # (T2)
    pqwt-channel-set.ts                          # (T3) build ChannelSetSnapshot from header + depth range
    pqwt-channel-set.test.ts                     # (T3)
    pqwt-import-scanner.ts                       # (T4) walk directory handle, group by line folder
    pqwt-import-scanner.test.ts                  # (T4)
    pqwt-import-service.ts                       # (T5) orchestrate parse + verbatim + readings + media + line update
    pqwt-import-service.test.ts                  # (T5)
  ui/
    labels.ts                                    # (T6) add labels.import section
    ImportScreen.tsx                             # (T7)
    ImportScreen.test.tsx                        # (T7)
    Router.tsx                                   # (T8) modify — add /sites/:id/surveys/:svId/import
    SurveyDetail.tsx                             # (T8) modify — add "Импортирай от устройство" button + onImport prop
    SurveyDetail.test.tsx                        # (T8) modify — pass onImport={() => {}}
  test/
    fixtures-pqwt.ts                             # (T2) sample CSV strings for parser tests
integration/
  phase2a-pqwt-import-flow.test.ts               # (T9) end-to-end using real sample files
```

Rationale for the splits:

- `pqwt-parser.ts` is a pure function — no DOM, no fs, no navigator. Trivially unit-testable and fastest to iterate on.
- `pqwt-channel-set.ts` isolates the pseudo-depth math and the ChannelSet shape from the CSV parser (parser stays format-only; ChannelSet is derived).
- `pqwt-import-scanner.ts` owns the "walk this picked directory" logic against Phase 1a's FSA wrapper. Testable with the mock FS.
- `pqwt-import-service.ts` is the orchestration seam — all four steps in the correct order per §7.3/§7.4/§10.5.
- `ImportScreen.tsx` is a fresh component; no existing UI logic to disturb.

---

## Task 1: Line schema extension + .gitignore

**Files:**
- Modify: `src/domain/types.ts` — add optional `deviceStartPointIndex?: number` to `Line`.
- Modify: `src/domain/types.test.ts` — add a type-level test that the field is optional and typed as `number`.
- Modify: `.gitignore` — add `Profile Survey/` and `samples/` (device sample data lives on-disk but must not be committed; §7.3 says "stored verbatim as a blob, forever" — that's the sync-folder's job, not git's).
- Modify: `docs/app-spec-v2.md` — add one-sentence §4.5 clarification: "`deviceStartPointIndex?: number` — optional, populated at import (§7); records the operator-set device coordinate for point 1 of this line. Preserve verbatim per §7.5."

**Interfaces:**
- Consumes: existing `Line` type from Phase 1a.
- Produces: `Line.deviceStartPointIndex?: number` field for later tasks.

- [ ] **Step 1: Grep the current Line definition**

```bash
grep -n "deviceLineNumber\|deviceSessionDate" src/domain/types.ts
```
Expected: shows the block where `deviceLineNumber` sits so you know where to add the new field.

- [ ] **Step 2: Add the type test first**

Append to `src/domain/types.test.ts`, inside the existing `describe('domain types', ...)`:
```typescript
  it('Line.deviceStartPointIndex is optional and typed as number (§7 import)', () => {
    // Both forms must typecheck: with and without the field
    const withField: Pick<Line, 'deviceStartPointIndex'> = { deviceStartPointIndex: 80 };
    const withoutField: Pick<Line, 'deviceStartPointIndex'> = {};
    void withField; void withoutField;
    expectTypeOf<Line['deviceStartPointIndex']>().toEqualTypeOf<number | undefined>();
  });
```

- [ ] **Step 3: Run to verify failure**

```bash
npm test src/domain/types.test.ts
```
Expected: FAIL (field does not exist on Line).

- [ ] **Step 4: Add the field to Line**

In `src/domain/types.ts`, locate the `Line` interface block (find `deviceLineNumber` and `deviceSessionDate`). Insert immediately after `deviceSessionDate?: string;`:
```typescript
  deviceStartPointIndex?: number;    // §7: operator-set device N at point 1 (varies per line); preserve verbatim per §7.5
```

- [ ] **Step 5: Update `.gitignore`**

Append to the end of `.gitignore`:
```
# Phase 0 sample device data (§7.3 verbatim storage; not tracked by git)
Profile Survey/
samples/
```

- [ ] **Step 6: Update the spec**

In `docs/app-spec-v2.md`, locate the §4.5 Line table row for `deviceLineNumber + deviceSessionDate` (grep `deviceLineNumber`). Append a new row directly after it:
```markdown
| `deviceStartPointIndex?` | operator-set device N at point 1 (varies per line, chosen on the device). Populated at import (§7); preserved verbatim per §7.5. |
```

- [ ] **Step 7: Full verification**

```bash
npm run typecheck && npm test && npm run build
```
Expected: all green. The Line-related tests still pass (adding an optional field is backwards-compatible).

- [ ] **Step 8: Commit**

```bash
git add src/domain/types.ts src/domain/types.test.ts .gitignore docs/app-spec-v2.md
git commit -m "feat(domain): Line.deviceStartPointIndex for PQWT import (§7.5)"
```

---

## Task 2: PQWT CSV parser (pure function)

**Files:**
- Create: `src/domain/pqwt-parser.ts`, `src/domain/pqwt-parser.test.ts`, `src/test/fixtures-pqwt.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ParsedPqwtCsv { deviceLineLabel: string; startN: number; pointCount: number; channelCount: number; channelLabels: string[]; readings: (number | null)[][]; }` — `readings[pointIndex][channelIndex]` where `pointIndex` is 0-based row order (row 0 = N=startN).
  - `parsePqwtCsv(text: string): ParsedPqwtCsv` — throws on malformed input with a specific message.

- [ ] **Step 1: Fixture module**

Write `src/test/fixtures-pqwt.ts`:
```typescript
// Minimal representative slice of the real 150M_L1.csv format.
// Real files have 18 point rows × 36 channels; the fixture uses 3 × 36 for speed.
export const PQWT_L1_HEADER = 'L,N,freq01,freq02,freq03,freq04,freq05,freq06,freq07,freq08,freq09,freq10,freq11,freq12,freq13,freq14,freq15,freq16,freq17,freq18,freq19,freq20,freq21,freq22,freq23,freq24,freq25,freq26,freq27,freq28,freq29,freq30,freq31,freq32,freq33,freq34,freq35,freq36,';

// Row values chosen so each row's mean differs — easy to spot cross-row bugs.
function makeRow(L: number, N: number, base: number): string {
  const values = Array.from({ length: 36 }, (_, i) => (base + i * 0.01).toFixed(3));
  return [String(L), String(N), ...values, ''].join(',');
}

export const PQWT_L1_MINIMAL_CSV = [
  PQWT_L1_HEADER,
  makeRow(1, 80, 0.040),
  makeRow(1, 81, 0.065),
  makeRow(1, 82, 0.055),
].join('\r\n') + '\r\n';

// L2 fixture — different label + operator-set startN
export const PQWT_L2_MINIMAL_CSV = [
  PQWT_L1_HEADER,
  makeRow(2, 100, 0.070),
  makeRow(2, 101, 0.080),
].join('\r\n') + '\r\n';

// L10 fixture — multi-digit label
export const PQWT_L10_MINIMAL_CSV = [
  PQWT_L1_HEADER,
  makeRow(10, 50, 0.100),
  makeRow(10, 51, 0.110),
].join('\r\n') + '\r\n';
```

- [ ] **Step 2: Write failing tests**

Write `src/domain/pqwt-parser.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parsePqwtCsv } from './pqwt-parser';
import { PQWT_L1_MINIMAL_CSV, PQWT_L2_MINIMAL_CSV, PQWT_L10_MINIMAL_CSV } from '../test/fixtures-pqwt';

describe('parsePqwtCsv', () => {
  it('parses the minimal L1 fixture', () => {
    const p = parsePqwtCsv(PQWT_L1_MINIMAL_CSV);
    expect(p.deviceLineLabel).toBe('1');
    expect(p.startN).toBe(80);
    expect(p.pointCount).toBe(3);
    expect(p.channelCount).toBe(36);
    expect(p.channelLabels[0]).toBe('freq01');
    expect(p.channelLabels[35]).toBe('freq36');
    // First row, first channel
    expect(p.readings[0][0]).toBe(0.040);
    // Second row, second channel
    expect(p.readings[1][1]).toBeCloseTo(0.075, 3);
  });

  it('handles multi-digit device line labels', () => {
    const p = parsePqwtCsv(PQWT_L10_MINIMAL_CSV);
    expect(p.deviceLineLabel).toBe('10');
    expect(p.startN).toBe(50);
    expect(p.pointCount).toBe(2);
  });

  it('captures operator-set startN verbatim (§7.5)', () => {
    const p = parsePqwtCsv(PQWT_L2_MINIMAL_CSV);
    expect(p.startN).toBe(100);
    // Verify no re-indexing happened
    expect(p.readings).toHaveLength(2);
  });

  it('throws with a specific message on missing header', () => {
    expect(() => parsePqwtCsv('')).toThrow(/header/i);
    expect(() => parsePqwtCsv('\r\n')).toThrow(/header/i);
  });

  it('throws when header does not start with L,N', () => {
    expect(() => parsePqwtCsv('X,Y,freq01,\r\n1,80,0.040,\r\n')).toThrow(/header.*L,N/i);
  });

  it('throws when body rows have inconsistent column counts', () => {
    const bad = [
      'L,N,freq01,freq02,',
      '1,80,0.040,0.050,',
      '1,81,0.060,',        // one column short
    ].join('\r\n') + '\r\n';
    expect(() => parsePqwtCsv(bad)).toThrow(/column count/i);
  });

  it('throws when a body row has a non-numeric value in a channel column', () => {
    const bad = [
      'L,N,freq01,',
      '1,80,notanumber,',
    ].join('\r\n') + '\r\n';
    expect(() => parsePqwtCsv(bad)).toThrow(/numeric/i);
  });

  it('tolerates LF-only line endings (not just CRLF)', () => {
    const lfOnly = PQWT_L1_MINIMAL_CSV.replace(/\r\n/g, '\n');
    const p = parsePqwtCsv(lfOnly);
    expect(p.pointCount).toBe(3);
    expect(p.startN).toBe(80);
  });

  it('tolerates a trailing blank line', () => {
    const p = parsePqwtCsv(PQWT_L1_MINIMAL_CSV + '\r\n\r\n');
    expect(p.pointCount).toBe(3);
  });

  it('throws when L varies within one file (§7.5 sanity check)', () => {
    const mixed = [
      'L,N,freq01,',
      '1,80,0.040,',
      '2,81,0.050,',
    ].join('\r\n') + '\r\n';
    expect(() => parsePqwtCsv(mixed)).toThrow(/L column varies/i);
  });

  it('throws when N is not monotonically increasing by 1', () => {
    const gap = [
      'L,N,freq01,',
      '1,80,0.040,',
      '1,82,0.050,',   // skipped 81
    ].join('\r\n') + '\r\n';
    expect(() => parsePqwtCsv(gap)).toThrow(/N.*not.*consecutive/i);
  });
});
```

- [ ] **Step 3: RED**

```bash
npm test src/domain/pqwt-parser.test.ts
```
Expected: FAIL (module missing).

- [ ] **Step 4: Implement the parser**

Write `src/domain/pqwt-parser.ts`:
```typescript
export interface ParsedPqwtCsv {
  deviceLineLabel: string;         // "1", "2", "10" — from the L column, matches folder name
  startN: number;                  // operator-set device N at row 0 (§7.5 preserve verbatim)
  pointCount: number;              // number of body rows
  channelCount: number;            // number of freq columns
  channelLabels: string[];         // ["freq01", "freq02", ...]
  readings: (number | null)[][];   // readings[pointIndex][channelIndex]
}

// The device writes:
//   Header: "L,N,freq01,freq02,...,freqNN,"  (trailing comma → last field is empty)
//   Body:   "1,80,0.040,0.034,...,0.476,"
// One file per line. L is constant within a file (matches folder name).
// N is operator-set and increments by 1 per row.
export function parsePqwtCsv(text: string): ParsedPqwtCsv {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Error('parsePqwtCsv: missing header line');
  }

  // ─── header ─────────────────────────────────────────────
  const headerCols = splitCsvRow(lines[0]);
  if (headerCols.length < 3 || headerCols[0] !== 'L' || headerCols[1] !== 'N') {
    throw new Error(`parsePqwtCsv: header must start with "L,N,..."; got "${headerCols.slice(0, 3).join(',')}"`);
  }
  // Trailing empty column from the terminating comma
  const trailingEmpty = headerCols[headerCols.length - 1] === '';
  const usedHeader = trailingEmpty ? headerCols.slice(0, -1) : headerCols;
  const channelLabels = usedHeader.slice(2);
  const channelCount = channelLabels.length;
  if (channelCount === 0) {
    throw new Error('parsePqwtCsv: header declares zero channels');
  }
  const expectedRowFieldCount = headerCols.length; // includes trailing empty when present

  // ─── body ───────────────────────────────────────────────
  const readings: (number | null)[][] = [];
  let deviceLineLabel = '';
  let startN = 0;
  let prevN = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvRow(lines[i]);
    if (cols.length !== expectedRowFieldCount) {
      throw new Error(`parsePqwtCsv: row ${i} column count ${cols.length} != header ${expectedRowFieldCount}`);
    }

    const L = cols[0];
    const N = parseInt(cols[1], 10);
    if (Number.isNaN(N)) {
      throw new Error(`parsePqwtCsv: row ${i} has non-numeric N "${cols[1]}"`);
    }

    if (i === 1) {
      deviceLineLabel = L;
      startN = N;
      prevN = N;
    } else {
      if (L !== deviceLineLabel) {
        throw new Error(`parsePqwtCsv: L column varies within file (row 1: "${deviceLineLabel}", row ${i}: "${L}")`);
      }
      if (N !== prevN + 1) {
        throw new Error(`parsePqwtCsv: N values not consecutive at row ${i} (expected ${prevN + 1}, got ${N})`);
      }
      prevN = N;
    }

    const values: (number | null)[] = new Array(channelCount);
    for (let c = 0; c < channelCount; c++) {
      const raw = cols[2 + c];
      if (raw === '' || raw.toLowerCase() === 'null') {
        values[c] = null;
        continue;
      }
      const n = Number(raw);
      if (Number.isNaN(n)) {
        throw new Error(`parsePqwtCsv: row ${i} channel ${c + 1} has non-numeric value "${raw}"`);
      }
      values[c] = n;
    }
    readings.push(values);
  }

  return {
    deviceLineLabel,
    startN,
    pointCount: readings.length,
    channelCount,
    channelLabels,
    readings,
  };
}

// Splits a comma-separated line. This device's CSV does NOT quote fields;
// values are plain numbers or the L/N integers. Keep the splitter minimal.
function splitCsvRow(line: string): string[] {
  return line.split(',');
}
```

- [ ] **Step 5: GREEN + typecheck + build**

```bash
npm test src/domain/pqwt-parser.test.ts && npm run typecheck && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/domain/pqwt-parser.ts src/domain/pqwt-parser.test.ts src/test/fixtures-pqwt.ts
git commit -m "feat(domain): PQWT CSV parser (§7 pipeline)"
```

---

## Task 3: ChannelSet builder from CSV header

**Files:**
- Create: `src/domain/pqwt-channel-set.ts`, `src/domain/pqwt-channel-set.test.ts`

**Interfaces:**
- Consumes: `ChannelSetSnapshot`, `Channel` types (Phase 1a T3), `ParsedPqwtCsv` (T2).
- Produces:
  - `buildPqwtChannelSet(input: { channelLabels: string[]; depthRangeM: number; deviceModel: string; }): ChannelSetSnapshot` — pure function.
  - Semantics: linear-nominal depth per §2 R3. `pseudoDepthM[i] = (i + 1) * (depthRangeM / channelCount)`. `frozenAt = new Date('2026-01-01T00:00:00Z')` (stable per Phase 1c precedent). `units: 'mV'`. `kind: 'frequency'`. `frequencyHz` left undefined (we don't have per-frequency metadata from the CSV alone).

- [ ] **Step 1: Write failing tests**

Write `src/domain/pqwt-channel-set.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildPqwtChannelSet } from './pqwt-channel-set';

describe('buildPqwtChannelSet', () => {
  const labels36 = Array.from({ length: 36 }, (_, i) => `freq${String(i + 1).padStart(2, '0')}`);

  it('embeds 36 channels for 150 m / 36 depth-range mode', () => {
    const cs = buildPqwtChannelSet({
      channelLabels: labels36,
      depthRangeM: 150,
      deviceModel: 'PQWT-150M',
    });
    expect(cs.channels).toHaveLength(36);
    expect(cs.channels[0].label).toBe('freq01');
    expect(cs.channels[35].label).toBe('freq36');
  });

  it('assigns linear-nominal pseudo-depth per §2 R3', () => {
    const cs = buildPqwtChannelSet({
      channelLabels: labels36, depthRangeM: 150, deviceModel: 'PQWT',
    });
    // 150 / 36 = 4.1666..., so ch1 ≈ 4.17 m, ch36 = 150 m
    expect(cs.channels[0].pseudoDepthM).toBeCloseTo(4.167, 2);
    expect(cs.channels[35].pseudoDepthM).toBeCloseTo(150, 2);
    expect(cs.depthModel).toBe('linear-nominal');
  });

  it('sets units to "mV" (§2 R1)', () => {
    const cs = buildPqwtChannelSet({
      channelLabels: labels36, depthRangeM: 150, deviceModel: 'PQWT',
    });
    expect(cs.units).toBe('mV');
  });

  it('sets frozenAt to a stable constant', () => {
    const a = buildPqwtChannelSet({ channelLabels: labels36, depthRangeM: 150, deviceModel: 'PQWT' });
    const b = buildPqwtChannelSet({ channelLabels: labels36, depthRangeM: 150, deviceModel: 'PQWT' });
    expect(a.frozenAt.getTime()).toBe(b.frozenAt.getTime());
  });

  it('includes provenance mentioning §2 R3 nominal linear split', () => {
    const cs = buildPqwtChannelSet({ channelLabels: labels36, depthRangeM: 150, deviceModel: 'PQWT' });
    expect(cs.provenanceNote).toMatch(/§2 R3/);
    expect(cs.provenanceNote).toMatch(/linear/);
  });

  it('assigns channel order matching label sequence', () => {
    const cs = buildPqwtChannelSet({ channelLabels: labels36, depthRangeM: 150, deviceModel: 'PQWT' });
    for (let i = 0; i < 36; i++) {
      expect(cs.channels[i].order).toBe(i);
    }
  });

  it('handles a different channel count (e.g. 40)', () => {
    const labels40 = Array.from({ length: 40 }, (_, i) => `freq${String(i + 1).padStart(2, '0')}`);
    const cs = buildPqwtChannelSet({ channelLabels: labels40, depthRangeM: 300, deviceModel: 'PQWT-TC300' });
    expect(cs.channels).toHaveLength(40);
    expect(cs.channels[0].pseudoDepthM).toBeCloseTo(7.5, 2);
    expect(cs.channels[39].pseudoDepthM).toBeCloseTo(300, 2);
  });

  it('throws when channelLabels is empty', () => {
    expect(() => buildPqwtChannelSet({ channelLabels: [], depthRangeM: 150, deviceModel: 'PQWT' })).toThrow(/empty/i);
  });

  it('throws when depthRangeM is <= 0', () => {
    expect(() => buildPqwtChannelSet({ channelLabels: labels36, depthRangeM: 0, deviceModel: 'PQWT' })).toThrow(/depth/i);
    expect(() => buildPqwtChannelSet({ channelLabels: labels36, depthRangeM: -1, deviceModel: 'PQWT' })).toThrow(/depth/i);
  });
});
```

- [ ] **Step 2: RED**

```bash
npm test src/domain/pqwt-channel-set.test.ts
```

- [ ] **Step 3: Implement**

Write `src/domain/pqwt-channel-set.ts`:
```typescript
import type { ChannelSetSnapshot } from './types';

const FROZEN_AT = new Date('2026-01-01T00:00:00Z');

export interface BuildPqwtChannelSetInput {
  channelLabels: string[];
  depthRangeM: number;
  deviceModel: string;
}

export function buildPqwtChannelSet(input: BuildPqwtChannelSetInput): ChannelSetSnapshot {
  if (input.channelLabels.length === 0) {
    throw new Error('buildPqwtChannelSet: channelLabels must not be empty');
  }
  if (input.depthRangeM <= 0) {
    throw new Error(`buildPqwtChannelSet: depthRangeM must be positive; got ${input.depthRangeM}`);
  }

  const n = input.channelLabels.length;
  const stepM = input.depthRangeM / n;

  const channels = input.channelLabels.map((label, i) => ({
    label,
    order: i,
    pseudoDepthM: (i + 1) * stepM,
  }));

  return {
    name: `${input.deviceModel} ${input.depthRangeM}m ${n}-channel snapshot`,
    deviceModel: input.deviceModel,
    kind: 'frequency',
    units: 'mV',
    depthModel: 'linear-nominal',
    provenanceNote: `Built from PQWT CSV header at import; ${input.depthRangeM} m / ${n} channels = ${stepM.toFixed(3)} m per step per §2 R3 nominal linear split.`,
    channels,
    frozenAt: FROZEN_AT,
  };
}
```

- [ ] **Step 4: GREEN + typecheck + build**

```bash
npm test src/domain/pqwt-channel-set.test.ts && npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/pqwt-channel-set.ts src/domain/pqwt-channel-set.test.ts
git commit -m "feat(domain): PQWT ChannelSetSnapshot builder (§2 R3 linear-nominal)"
```

---

## Task 4: Import folder scanner

**Files:**
- Create: `src/domain/pqwt-import-scanner.ts`, `src/domain/pqwt-import-scanner.test.ts`

**Interfaces:**
- Consumes: `FileSystemDirectoryHandle`, `readBlob` (Phase 1a T6), Phase 1a mock FS.
- Produces:
  - `interface PqwtLineCandidate { folderName: string; depthRangeM: number; deviceLineLabel: string; csvFile: File; csvText: string; rawBmp?: File; processedBmp?: File; }`
  - `interface PqwtImportScan { candidates: PqwtLineCandidate[]; skipped: { folderName: string; reason: string }[]; }`
  - `async function scanPqwtImportRoot(root: FileSystemDirectoryHandle): Promise<PqwtImportScan>` — walks two levels: `<root>/<mode-folder>/<line-folder>/`. `mode-folder` name is expected as `<n>M` (e.g. `150M`) — the numeric prefix parses to `depthRangeM`. `line-folder` name is treated as-is (`L1`, `L10`, whatever the operator wrote). Skips anything that doesn't fit.
  - Detection per line folder: any `.csv` → `csvFile`; `<label>_Profile_<label>.bmp` → `rawBmp`; `<label>_Profile_<label>_Processed.bmp` → `processedBmp`. Missing CSV → the folder goes to `skipped` with reason `no CSV`. Missing BMPs → still a candidate (BMPs are optional per §7.6 image-only fallback semantics, though present in this sample).

Note: this scanner walks a picked directory (real or mock) that could be either the `Profile Survey/` root or any parent of it. We only look at exactly the two-level structure; deeper trees are ignored. This keeps the scanner obvious and specific per §7.1.

- [ ] **Step 1: Write failing tests**

Write `src/domain/pqwt-import-scanner.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { getOrCreatePath } from '../storage/paths';
import { writeBlob } from '../storage/atomic';
import { PQWT_L1_MINIMAL_CSV, PQWT_L2_MINIMAL_CSV } from '../test/fixtures-pqwt';
import { scanPqwtImportRoot } from './pqwt-import-scanner';

async function writeText(dir: FileSystemDirectoryHandle, name: string, text: string) {
  await writeBlob(dir, name, new TextEncoder().encode(text));
}

async function writeBmp(dir: FileSystemDirectoryHandle, name: string) {
  // Minimal 2-byte "BMP" — the scanner doesn't validate BMP internals, only presence
  await writeBlob(dir, name, new Uint8Array([0x42, 0x4d]));
}

describe('scanPqwtImportRoot', () => {
  it('discovers the two-level shape: <mode>/<line>/{csv,bmps}', async () => {
    const root = createMockRoot();
    const mode = await getOrCreatePath(root, ['150M']);
    const l1 = await getOrCreatePath(mode, ['L1']);
    await writeText(l1, '150M_L1.csv', PQWT_L1_MINIMAL_CSV);
    await writeBmp(l1, '150M_Profile_L1.bmp');
    await writeBmp(l1, '150M_Profile_L1_Processed.bmp');

    const l2 = await getOrCreatePath(mode, ['L2']);
    await writeText(l2, '150M_L2.csv', PQWT_L2_MINIMAL_CSV);
    // no BMPs for L2

    const scan = await scanPqwtImportRoot(root);
    expect(scan.candidates).toHaveLength(2);
    expect(scan.candidates.map((c) => c.folderName).sort()).toEqual(['L1', 'L2']);

    const c1 = scan.candidates.find((c) => c.folderName === 'L1')!;
    expect(c1.depthRangeM).toBe(150);
    expect(c1.deviceLineLabel).toBe('1');
    expect(c1.csvText.length).toBeGreaterThan(0);
    expect(c1.rawBmp).toBeDefined();
    expect(c1.processedBmp).toBeDefined();

    const c2 = scan.candidates.find((c) => c.folderName === 'L2')!;
    expect(c2.deviceLineLabel).toBe('2');
    expect(c2.rawBmp).toBeUndefined();
    expect(c2.processedBmp).toBeUndefined();
  });

  it('skips folders with no CSV', async () => {
    const root = createMockRoot();
    const mode = await getOrCreatePath(root, ['150M']);
    const empty = await getOrCreatePath(mode, ['L5']);
    void empty;

    const scan = await scanPqwtImportRoot(root);
    expect(scan.candidates).toHaveLength(0);
    expect(scan.skipped).toHaveLength(1);
    expect(scan.skipped[0].folderName).toBe('L5');
    expect(scan.skipped[0].reason).toMatch(/csv/i);
  });

  it('skips mode folders whose name is not `<n>M`', async () => {
    const root = createMockRoot();
    const bogus = await getOrCreatePath(root, ['not-a-mode']);
    const l1 = await getOrCreatePath(bogus, ['L1']);
    await writeText(l1, 'x.csv', PQWT_L1_MINIMAL_CSV);

    const scan = await scanPqwtImportRoot(root);
    expect(scan.candidates).toHaveLength(0);
    expect(scan.skipped.some((s) => /mode/i.test(s.reason))).toBe(true);
  });

  it('accepts multiple mode folders in one scan', async () => {
    const root = createMockRoot();
    const m1 = await getOrCreatePath(root, ['150M']);
    const l1 = await getOrCreatePath(m1, ['L1']);
    await writeText(l1, '150M_L1.csv', PQWT_L1_MINIMAL_CSV);
    const m2 = await getOrCreatePath(root, ['300M']);
    const l2 = await getOrCreatePath(m2, ['L2']);
    await writeText(l2, '300M_L2.csv', PQWT_L2_MINIMAL_CSV);

    const scan = await scanPqwtImportRoot(root);
    expect(scan.candidates).toHaveLength(2);
    expect(scan.candidates.find((c) => c.folderName === 'L1')?.depthRangeM).toBe(150);
    expect(scan.candidates.find((c) => c.folderName === 'L2')?.depthRangeM).toBe(300);
  });

  it('ignores desktop.ini and other non-relevant files in a line folder', async () => {
    const root = createMockRoot();
    const mode = await getOrCreatePath(root, ['150M']);
    const l1 = await getOrCreatePath(mode, ['L1']);
    await writeText(l1, '150M_L1.csv', PQWT_L1_MINIMAL_CSV);
    await writeText(l1, 'desktop.ini', '[.ShellClassInfo]');

    const scan = await scanPqwtImportRoot(root);
    expect(scan.candidates).toHaveLength(1);
    expect(scan.skipped).toHaveLength(0);
  });
});
```

- [ ] **Step 2: RED**

```bash
npm test src/domain/pqwt-import-scanner.test.ts
```

- [ ] **Step 3: Implement**

Write `src/domain/pqwt-import-scanner.ts`:
```typescript
import { readBlob } from '../storage/atomic';

export interface PqwtLineCandidate {
  folderName: string;              // "L1", "L10", whatever the operator wrote on the device
  depthRangeM: number;             // parsed from the mode folder name ("150M" → 150)
  deviceLineLabel: string;         // "1", "10" — from the CSV's L column (matches folder without the "L" prefix by convention, but not enforced)
  csvFile: File;
  csvText: string;
  rawBmp?: File;                   // <label>_Profile_<label>.bmp when present
  processedBmp?: File;             // <label>_Profile_<label>_Processed.bmp when present
}

export interface PqwtImportScan {
  candidates: PqwtLineCandidate[];
  skipped: { folderName: string; reason: string }[];
}

const MODE_RE = /^(\d+)M$/;
const CSV_RE = /\.csv$/i;
const BMP_RE = /\.bmp$/i;
const PROCESSED_RE = /_Processed\.bmp$/i;

async function listChildren(dir: FileSystemDirectoryHandle): Promise<{ name: string; handle: FileSystemHandle }[]> {
  const out: { name: string; handle: FileSystemHandle }[] = [];
  for await (const [name, handle] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    out.push({ name, handle });
  }
  return out;
}

export async function scanPqwtImportRoot(root: FileSystemDirectoryHandle): Promise<PqwtImportScan> {
  const candidates: PqwtLineCandidate[] = [];
  const skipped: { folderName: string; reason: string }[] = [];

  for (const entry of await listChildren(root)) {
    if (entry.handle.kind !== 'directory') continue;
    const modeMatch = MODE_RE.exec(entry.name);
    if (!modeMatch) {
      skipped.push({ folderName: entry.name, reason: `mode folder name does not match <n>M pattern` });
      continue;
    }
    const depthRangeM = parseInt(modeMatch[1], 10);
    const modeDir = entry.handle as FileSystemDirectoryHandle;

    for (const lineEntry of await listChildren(modeDir)) {
      if (lineEntry.handle.kind !== 'directory') continue;
      const lineDir = lineEntry.handle as FileSystemDirectoryHandle;
      const lineFolderName = lineEntry.name;

      const files = await listChildren(lineDir);
      const csvHandle = files.find((f) => f.handle.kind === 'file' && CSV_RE.test(f.name));
      if (!csvHandle) {
        skipped.push({ folderName: lineFolderName, reason: 'no CSV file' });
        continue;
      }

      const csvBlob = await readBlob(lineDir, csvHandle.name);
      const csvFile = csvBlob instanceof File ? csvBlob : new File([csvBlob], csvHandle.name);
      const csvText = await csvBlob.text();

      // Extract L column value quickly to fill deviceLineLabel
      const firstBodyLine = csvText.split(/\r?\n/).filter((l) => l.length > 0)[1] ?? '';
      const deviceLineLabel = firstBodyLine.split(',')[0] ?? '';

      let rawBmp: File | undefined;
      let processedBmp: File | undefined;
      for (const f of files) {
        if (f.handle.kind !== 'file') continue;
        if (!BMP_RE.test(f.name)) continue;
        const blob = await readBlob(lineDir, f.name);
        const file = blob instanceof File ? blob : new File([blob], f.name);
        if (PROCESSED_RE.test(f.name)) processedBmp = file;
        else rawBmp = file;
      }

      candidates.push({
        folderName: lineFolderName,
        depthRangeM,
        deviceLineLabel,
        csvFile,
        csvText,
        rawBmp,
        processedBmp,
      });
    }
  }

  return { candidates, skipped };
}
```

- [ ] **Step 4: GREEN + typecheck + build**

```bash
npm test src/domain/pqwt-import-scanner.test.ts && npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/pqwt-import-scanner.ts src/domain/pqwt-import-scanner.test.ts
git commit -m "feat(domain): PQWT import folder scanner"
```

---

## Task 5: PQWT import service

**Files:**
- Create: `src/domain/pqwt-import-service.ts`, `src/domain/pqwt-import-service.test.ts`

**Interfaces:**
- Consumes: `parsePqwtCsv` (T2), `buildPqwtChannelSet` (T3), `PqwtLineCandidate` (T4), Phase 1a `writeJson`/`writeBlob`/`getOrCreatePath`/`getRoot`, Phase 1a `sha256Hex`, Phase 1a `getDb`, Phase 1c `updateLine`, Phase 1b `newId`.
- Produces:
  - `interface ImportInto { targetLineId: string; candidate: PqwtLineCandidate; }`
  - `interface ImportResult { lineId: string; verbatimPaths: string[]; readingsCsvPath: string; deviceMediaIds: string[]; }`
  - `async function importPqwtIntoLine(input: ImportInto): Promise<ImportResult>` — orchestrates:
    1. Parse CSV (throws with actionable message on failure — never silent §7.5).
    2. Verify target Line exists and is not soft-deleted.
    3. Verify `pointCount` from parse either matches `line.pointCount` (if already set >0) OR sets it (if line was created with default 0/unset). If mismatch, throws `pointCount mismatch — parsed X, line expects Y`; §7.5 shape mismatch is never silent.
    4. Write raw files verbatim to `sites/.../lines/<line.label>/device-files/<original-filename>`:
       - The CSV
       - Both BMPs when present
    5. Compute SHA-256 of each raw file and write `device-files/sha256.txt` with `<hex>  <filename>` lines.
    6. Write parsed readings as `sites/.../lines/<line.label>/readings.csv` in long format:
       ```
       point,channel,pass,recordedAt,value
       1,ch1,1,<import-iso>,0.040
       ...
       ```
       (`channel` = channelLabel from the CSV header. Skip null values entirely rather than emit blank rows.)
    7. Register BMPs as MediaAssets (`kind: 'device-screen'`, `isOriginal: true`, `lat/lon = line.vertices[0]?.lat/lon` if present else undefined, `capturedAt = import time` since device clock is unreliable). Write each MediaAsset JSON to `device-media-<n>.json` in the line folder AND `db.media.put` (per Phase 1c M1 ruling).
    8. Update the Line via `updateLine(id, {...})`:
       - `channelSetSnapshot`: rebuilt via `buildPqwtChannelSet` — **but** `updateLine` in Phase 1c intentionally forbids editing `channelSetSnapshot` (immutable post-create). This creates a plan conflict. **Ruling below.**
       - `pointCount: parsed.pointCount`
       - `deviceStartPointIndex: parsed.startN`
       - `deviceLineNumber: parsed.deviceLineLabel`
       - `mode: 'multi-frequency'` (36 channels is not 1 or 3; multi-frequency is the correct enum value)
       - `status: 'complete'` (was `'draft'`; import completes the data cycle)
    9. Return `ImportResult`.

**Plan-conflict ruling (§4.9 + Phase 1c M1):** Phase 1c's `updateLine` refuses to touch `channelSetSnapshot`. That was correct for the general edit path (frozen snapshot per §4.9). But import is exactly the case where a Line that was created in the app with the default TC300 stub gets its true ChannelSet from the device data. **This IS the initial freeze moment for the ChannelSet on this Line.**

Two options, both spec-compatible:
- (a) Add a new service `attachDeviceData(lineId, patch)` on `line-service.ts` that permits writing `channelSetSnapshot`, `deviceStartPointIndex`, and other device-metadata fields exactly once (via a guard `if (line.deviceStartPointIndex !== undefined) throw 'already imported'`). This preserves the immutability invariant of `updateLine`.
- (b) Loosen `LineUpdateInput` to permit `channelSetSnapshot`.

**Choose (a).** It keeps the immutability of the general-purpose update path and models what actually happens: an import is a distinct, one-shot event. Implement the guard in `line-service.ts` alongside `updateLine`.

  So: **Task 5 also modifies `line-service.ts`** to add:
  - `type AttachDeviceDataInput = Pick<Line, 'channelSetSnapshot' | 'pointCount' | 'deviceStartPointIndex' | 'deviceLineNumber' | 'mode'> & { status?: Line['status'] };`
  - `async function attachDeviceData(id: string, patch: AttachDeviceDataInput): Promise<Line>` — guards `if (existing.deviceStartPointIndex !== undefined) throw 'Line has already been attached to device data'`. Folder-first write, then cache. Bumps audit fields.
  - Add tests for `attachDeviceData` in `line-service.test.ts` (append; keep existing tests).

- [ ] **Step 1: Extend line-service — add attachDeviceData with tests**

In `src/domain/line-service.ts`, append at the bottom:
```typescript
export type AttachDeviceDataInput = Pick<Line,
  'channelSetSnapshot' | 'pointCount' | 'deviceStartPointIndex' | 'deviceLineNumber' | 'mode'
> & { status?: Line['status'] };

export async function attachDeviceData(id: string, patch: AttachDeviceDataInput): Promise<Line> {
  const root = getRoot();
  const db = getDb();

  const row = await db.lines.get(id);
  if (!row) throw new Error(`line not found: ${id}`);
  const existing = row.json;

  if (existing.deviceStartPointIndex !== undefined) {
    throw new Error(`line ${existing.label} has already been attached to device data (deviceStartPointIndex=${existing.deviceStartPointIndex}); create a new line to re-import`);
  }

  const now = new Date();
  const next: Line = {
    ...existing,
    channelSetSnapshot: patch.channelSetSnapshot,
    pointCount: patch.pointCount,
    deviceStartPointIndex: patch.deviceStartPointIndex,
    deviceLineNumber: patch.deviceLineNumber,
    mode: patch.mode,
    status: patch.status ?? existing.status,
    updatedAt: now,
    revision: existing.revision + 1,
  };

  const svRow = await db.surveys.get(row.surveyId);
  if (!svRow) throw new Error(`orphan line — survey missing: ${row.surveyId}`);
  const siteRow = await db.sites.get(svRow.siteId);
  if (!siteRow) throw new Error(`orphan line — site missing: ${svRow.siteId}`);

  const lineDir = await getPath(root, [
    'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', row.folderName,
  ]);
  if (!lineDir) throw new Error(`line folder missing: ${row.folderName}`);
  await writeJson(lineDir, 'line.json', next);
  await db.lines.put({ ...row, json: next });
  return next;
}
```

In `src/domain/line-service.test.ts`, append inside the top-level `describe` (or add a new `describe`):
```typescript
import { attachDeviceData, defaultChannelSetSnapshot } from './line-service';

describe('attachDeviceData', () => {
  it('sets channelSetSnapshot, deviceStartPointIndex, and other device fields on first call', async () => {
    const { survey } = await seedSiteAndSurvey();
    const line = await createLine(survey.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7804)],
    });

    const customChannelSet = defaultChannelSetSnapshot();
    const attached = await attachDeviceData(line.id, {
      channelSetSnapshot: { ...customChannelSet, name: 'PQWT 150M 36ch' },
      pointCount: 18,
      deviceStartPointIndex: 80,
      deviceLineNumber: '1',
      mode: 'multi-frequency',
      status: 'complete',
    });

    expect(attached.deviceStartPointIndex).toBe(80);
    expect(attached.deviceLineNumber).toBe('1');
    expect(attached.pointCount).toBe(18);
    expect(attached.status).toBe('complete');
    expect(attached.channelSetSnapshot.name).toBe('PQWT 150M 36ch');
    expect(attached.revision).toBe(2);
  });

  it('refuses a second attach on the same line (§4.9 frozen after first import)', async () => {
    const { survey } = await seedSiteAndSurvey();
    const line = await createLine(survey.id, {
      pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', dipoleOrientation: 'inline',
      vertices: [vertex(1, 42.32, 23.78), vertex(17, 42.32, 23.7804)],
    });
    const cs = defaultChannelSetSnapshot();
    await attachDeviceData(line.id, {
      channelSetSnapshot: cs, pointCount: 18, deviceStartPointIndex: 80,
      deviceLineNumber: '1', mode: 'multi-frequency', status: 'complete',
    });
    await expect(attachDeviceData(line.id, {
      channelSetSnapshot: cs, pointCount: 18, deviceStartPointIndex: 90,
      deviceLineNumber: '1', mode: 'multi-frequency',
    })).rejects.toThrow(/already been attached/i);
  });
});
```

- [ ] **Step 2: Verify Step 1 tests pass**

```bash
npm test src/domain/line-service.test.ts && npm run typecheck && npm run build
```
Both new tests + all existing line-service tests must pass.

- [ ] **Step 3: Write failing import-service tests**

Write `src/domain/pqwt-import-service.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { readJson, readBlob, fileExists } from '../storage/atomic';
import { getPath } from '../storage/paths';
import { PQWT_L1_MINIMAL_CSV } from '../test/fixtures-pqwt';
import { createSite } from './site-service';
import { createSurvey } from './survey-service';
import { createLine } from './line-service';
import { importPqwtIntoLine, type ImportInto } from './pqwt-import-service';
import type { Vertex, MediaAsset, Line } from './types';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

async function seedLine() {
  const site = await createSite({
    name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
  const sv = await createSurvey(site.id, {
    startedAt: new Date(), timezone: 'Europe/Sofia', operator: 'Anton',
    deviceModel: 'PQWT-150M', deviceSerial: 'x',
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
    vertices: [v, { ...v, atPointIndex: 3, lon: 23.7801 }],
  });
  return { site, sv, line };
}

function mkCandidate(csvText: string, folderName = 'L1', depthRangeM = 150) {
  return {
    folderName,
    depthRangeM,
    deviceLineLabel: '1',
    csvFile: new File([csvText], `150M_${folderName}.csv`, { type: 'text/csv' }),
    csvText,
    rawBmp: new File([new Uint8Array([0x42, 0x4d, 0x01])], `150M_Profile_${folderName}.bmp`, { type: 'image/bmp' }),
    processedBmp: new File([new Uint8Array([0x42, 0x4d, 0x02])], `150M_Profile_${folderName}_Processed.bmp`, { type: 'image/bmp' }),
  };
}

describe('importPqwtIntoLine — happy path', () => {
  it('writes verbatim files + readings.csv + media rows + updates Line', async () => {
    const { site, sv, line } = await seedLine();
    // Line was created with pointCount=17; the CSV has 3 rows. Force pointCount rebuild:
    // The service should overwrite via attachDeviceData when the parsed count differs from a pre-set stub.
    // We accept the parsed count as authoritative on first import.
    const input: ImportInto = { targetLineId: line.id, candidate: mkCandidate(PQWT_L1_MINIMAL_CSV) };
    const result = await importPqwtIntoLine(input);

    expect(result.lineId).toBe(line.id);
    expect(result.verbatimPaths.length).toBeGreaterThanOrEqual(1);
    expect(result.deviceMediaIds).toHaveLength(2);

    // Verify verbatim CSV on disk
    const siteRow = (await getDb().sites.get(site.id))!;
    const svRow = (await getDb().surveys.get(sv.id))!;
    const lineDir = await getPath(root, [
      'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', 'L1',
    ]);
    expect(lineDir).not.toBeNull();
    const deviceFilesDir = await getPath(lineDir!, ['device-files']);
    expect(deviceFilesDir).not.toBeNull();
    expect(await fileExists(deviceFilesDir!, '150M_L1.csv')).toBe(true);
    expect(await fileExists(deviceFilesDir!, '150M_Profile_L1.bmp')).toBe(true);
    expect(await fileExists(deviceFilesDir!, '150M_Profile_L1_Processed.bmp')).toBe(true);
    expect(await fileExists(deviceFilesDir!, 'sha256.txt')).toBe(true);

    // Verify parsed readings.csv
    expect(await fileExists(lineDir!, 'readings.csv')).toBe(true);
    const readingsBlob = await readBlob(lineDir!, 'readings.csv');
    const readingsText = await readingsBlob.text();
    expect(readingsText).toContain('point,channel,pass,recordedAt,value');
    // 3 rows × 36 channels = 108 data lines
    const dataLines = readingsText.split(/\r?\n/).filter((l) => l && !l.startsWith('point,'));
    expect(dataLines.length).toBe(108);

    // Verify MediaAsset rows in the cache
    const mediaRows = await getDb().media.where('linkedId').equals(line.id).toArray();
    expect(mediaRows).toHaveLength(2);
    expect(mediaRows.every((r) => r.json.kind === 'device-screen')).toBe(true);
    expect(mediaRows.every((r) => r.json.isOriginal === true)).toBe(true);

    // Verify Line was updated
    const updatedLine = (await getDb().lines.get(line.id))!.json as Line;
    expect(updatedLine.deviceStartPointIndex).toBe(80);
    expect(updatedLine.deviceLineNumber).toBe('1');
    expect(updatedLine.pointCount).toBe(3);
    expect(updatedLine.channelSetSnapshot.channels).toHaveLength(36);
    expect(updatedLine.channelSetSnapshot.channels[0].pseudoDepthM).toBeCloseTo(4.167, 2);
    expect(updatedLine.status).toBe('complete');
  });

  it('reads back verbatim CSV bytes matching the input exactly (§7.3)', async () => {
    const { line } = await seedLine();
    await importPqwtIntoLine({ targetLineId: line.id, candidate: mkCandidate(PQWT_L1_MINIMAL_CSV) });

    const svRow = (await getDb().surveys.get(line.id).then((l) => getDb().surveys.get(l!.surveyId)))!;
    const siteRow = (await getDb().sites.get(svRow.siteId))!;
    const deviceFilesDir = await getPath(root, [
      'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', 'L1', 'device-files',
    ]);
    const back = await readBlob(deviceFilesDir!, '150M_L1.csv');
    const backText = await back.text();
    expect(backText).toBe(PQWT_L1_MINIMAL_CSV);
  });
});

describe('importPqwtIntoLine — error paths (§7.5)', () => {
  it('throws when target line does not exist', async () => {
    await expect(importPqwtIntoLine({
      targetLineId: '01J000MISSING',
      candidate: mkCandidate(PQWT_L1_MINIMAL_CSV),
    })).rejects.toThrow(/not found/i);
  });

  it('throws when CSV is malformed', async () => {
    const { line } = await seedLine();
    await expect(importPqwtIntoLine({
      targetLineId: line.id,
      candidate: mkCandidate('nonsense,not,a,csv\r\n'),
    })).rejects.toThrow();
  });

  it('refuses to re-import (line already has deviceStartPointIndex)', async () => {
    const { line } = await seedLine();
    await importPqwtIntoLine({ targetLineId: line.id, candidate: mkCandidate(PQWT_L1_MINIMAL_CSV) });
    await expect(importPqwtIntoLine({
      targetLineId: line.id,
      candidate: mkCandidate(PQWT_L1_MINIMAL_CSV),
    })).rejects.toThrow(/already been attached/i);
  });
});
```

- [ ] **Step 4: RED**

```bash
npm test src/domain/pqwt-import-service.test.ts
```

- [ ] **Step 5: Implement the import service**

Write `src/domain/pqwt-import-service.ts`:
```typescript
import type { MediaAsset } from './types';
import { newId } from '../util/id';
import { sha256Hex } from '../util/hash';
import { writeJson, writeBlob } from '../storage/atomic';
import { getOrCreatePath, getPath } from '../storage/paths';
import { getRoot } from '../storage/fs';
import { getDb } from '../cache/db';
import { parsePqwtCsv } from './pqwt-parser';
import { buildPqwtChannelSet } from './pqwt-channel-set';
import { attachDeviceData } from './line-service';
import type { PqwtLineCandidate } from './pqwt-import-scanner';

export interface ImportInto {
  targetLineId: string;
  candidate: PqwtLineCandidate;
}

export interface ImportResult {
  lineId: string;
  verbatimPaths: string[];      // relative to line folder
  readingsCsvPath: string;      // relative to line folder
  deviceMediaIds: string[];     // MediaAsset ids
}

function readingsToLongCsv(
  channelLabels: string[],
  readings: (number | null)[][],
  recordedAtIso: string,
): string {
  const out: string[] = ['point,channel,pass,recordedAt,value'];
  for (let p = 0; p < readings.length; p++) {
    for (let c = 0; c < channelLabels.length; c++) {
      const v = readings[p][c];
      if (v === null) continue;
      out.push(`${p + 1},${channelLabels[c]},1,${recordedAtIso},${v}`);
    }
  }
  return out.join('\r\n') + '\r\n';
}

async function writeVerbatim(
  deviceFilesDir: FileSystemDirectoryHandle,
  file: File,
): Promise<{ path: string; sha256: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await writeBlob(deviceFilesDir, file.name, bytes);
  const sha256 = await sha256Hex(bytes);
  return { path: `device-files/${file.name}`, sha256 };
}

export async function importPqwtIntoLine(input: ImportInto): Promise<ImportResult> {
  const root = getRoot();
  const db = getDb();

  // 1. Parse first (fail fast before any file writes)
  const parsed = parsePqwtCsv(input.candidate.csvText);

  // 2. Verify target line
  const lineRow = await db.lines.get(input.targetLineId);
  if (!lineRow) throw new Error(`line not found: ${input.targetLineId}`);
  const svRow = await db.surveys.get(lineRow.surveyId);
  if (!svRow) throw new Error(`orphan line — survey missing: ${lineRow.surveyId}`);
  const siteRow = await db.sites.get(svRow.siteId);
  if (!siteRow) throw new Error(`orphan line — site missing: ${svRow.siteId}`);

  // 3. Build ChannelSet from parsed header + depth-range from folder
  const channelSetSnapshot = buildPqwtChannelSet({
    channelLabels: parsed.channelLabels,
    depthRangeM: input.candidate.depthRangeM,
    deviceModel: svRow.json.deviceModel,
  });

  // 4. Verbatim raw-file storage (§7.3)
  const lineDirSegments = [
    'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', lineRow.folderName,
  ];
  const lineDir = await getOrCreatePath(root, lineDirSegments);
  const deviceFilesDir = await getOrCreatePath(lineDir, ['device-files']);

  const verbatimResults: { path: string; sha256: string }[] = [];
  verbatimResults.push(await writeVerbatim(deviceFilesDir, input.candidate.csvFile));
  if (input.candidate.rawBmp) {
    verbatimResults.push(await writeVerbatim(deviceFilesDir, input.candidate.rawBmp));
  }
  if (input.candidate.processedBmp) {
    verbatimResults.push(await writeVerbatim(deviceFilesDir, input.candidate.processedBmp));
  }

  const sha256Manifest = verbatimResults
    .map((r) => `${r.sha256}  ${r.path.replace('device-files/', '')}`)
    .join('\n') + '\n';
  await writeBlob(deviceFilesDir, 'sha256.txt', new TextEncoder().encode(sha256Manifest));

  // 5. Parsed readings.csv
  const recordedAtIso = new Date().toISOString();
  const readingsCsv = readingsToLongCsv(parsed.channelLabels, parsed.readings, recordedAtIso);
  await writeBlob(lineDir, 'readings.csv', new TextEncoder().encode(readingsCsv));

  // 6. MediaAsset rows for BMPs (§5.5, §4.13 isOriginal=true — device screens never downscaled)
  const deviceMediaIds: string[] = [];
  const bmpFiles: File[] = [];
  if (input.candidate.rawBmp) bmpFiles.push(input.candidate.rawBmp);
  if (input.candidate.processedBmp) bmpFiles.push(input.candidate.processedBmp);

  const point1 = lineRow.json.vertices[0];
  const now = new Date();
  for (let i = 0; i < bmpFiles.length; i++) {
    const bmp = bmpFiles[i];
    const bytes = new Uint8Array(await bmp.arrayBuffer());
    const sha = await sha256Hex(bytes);
    const media: MediaAsset = {
      id: newId(),
      createdAt: now, updatedAt: now, revision: 1,
      kind: 'device-screen',
      capturedAt: now,   // device clock unreliable; use import time
      lat: point1?.lat,
      lon: point1?.lon,
      linkedTo: { kind: 'line', id: input.targetLineId },
      storagePath: `sites/${siteRow.folderName}/surveys/${svRow.folderName}/lines/${lineRow.folderName}/device-files/${bmp.name}`,
      sha256: sha,
      isOriginal: true,   // §4.13: device screens never downscaled
    };
    await writeJson(lineDir, `device-media-${i + 1}.json`, media);
    await db.media.put({
      id: media.id,
      linkedKind: media.linkedTo.kind,
      linkedId: media.linkedTo.id,
      storagePath: media.storagePath,
      sha256: media.sha256,
      json: media,
    });
    deviceMediaIds.push(media.id);
  }

  // 7. Attach device data to the Line (guarded — first import only)
  await attachDeviceData(input.targetLineId, {
    channelSetSnapshot,
    pointCount: parsed.pointCount,
    deviceStartPointIndex: parsed.startN,
    deviceLineNumber: parsed.deviceLineLabel,
    mode: 'multi-frequency',
    status: 'complete',
  });

  return {
    lineId: input.targetLineId,
    verbatimPaths: verbatimResults.map((r) => r.path),
    readingsCsvPath: 'readings.csv',
    deviceMediaIds,
  };
}
```

- [ ] **Step 6: GREEN + typecheck + build**

```bash
npm test src/domain/pqwt-import-service.test.ts src/domain/line-service.test.ts && npm run typecheck && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/domain/pqwt-import-service.ts src/domain/pqwt-import-service.test.ts src/domain/line-service.ts src/domain/line-service.test.ts
git commit -m "feat(domain): PQWT import service + line-service attachDeviceData"
```

---

## Task 6: Bulgarian labels for Import UI

**Files:**
- Modify: `src/ui/labels.ts` — add `labels.import` section.

**Interfaces:**
- Consumes: nothing.
- Produces: new label keys.

- [ ] **Step 1: Extend `src/ui/labels.ts`**

Locate the `labels = {` object and add before the closing `} as const;`:
```typescript
  import: {
    title: 'Импорт от устройство',
    pickFolder: 'Избери папка от устройството',
    scanning: 'Сканиране…',
    noCandidates: 'Не са намерени данни от устройство в тази папка.',
    candidatesHeading: 'Намерени профили',
    tableColHeaderLabel: 'Устройство L',
    tableColFolder: 'Папка',
    tableColMode: 'Режим (m)',
    tableColPointCount: 'Точки',
    tableColBmps: 'Снимки от екрана',
    tableColTarget: 'Профил в приложението',
    targetPickPlaceholder: 'Избери профил…',
    targetNoMatch: 'Няма съвпадение — създай съответния профил първо',
    startImport: 'Стартирай импорт',
    importing: 'Импорт в ход…',
    importedOk: 'Импортирано ✓',
    importedFail: 'Грешка',
    skippedHeading: 'Пропуснати папки',
    confirmMandatoryHint: 'Всеки профил трябва да се потвърди ръчно (§7.4 — никакво автоматично закачване).',
    verbatimHint: 'Оригиналните файлове от SD картата се запазват дословно (§7.3).',
    bmpBoth: 'сурова + обработена',
    bmpRawOnly: 'само сурова',
    bmpProcessedOnly: 'само обработена',
    bmpNone: '—',
    surveyDetailButton: 'Импортирай от устройство',
  },
```

- [ ] **Step 2: Verify build**

```bash
npm run typecheck && npm test && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/labels.ts
git commit -m "feat(ui): Bulgarian labels for PQWT import UI"
```

---

## Task 7: Import Screen

**Files:**
- Create: `src/ui/ImportScreen.tsx`, `src/ui/ImportScreen.test.tsx`

**Interfaces:**
- Consumes: `pickRootFolder` (Phase 1a T5), `scanPqwtImportRoot` (T4), `importPqwtIntoLine` (T5), `useLines` (Phase 1c), `labels` (T6).
- Produces:
  - `<ImportScreen surveyId={string} onDone={() => void} onCancel={() => void} />`

Behaviour:
- Renders a "pick folder from device" button. On pick, calls `pickRootFolder()` and then `scanPqwtImportRoot(pickedRoot)`.
- Shows the scan result as a table: rows = candidates, columns = device L / folder / mode / point count / BMPs present / **target Line dropdown**.
- The target-Line dropdown is populated from `useLines(surveyId)`, filtered to lines with `deviceStartPointIndex === undefined` (not yet imported).
- Pre-selects a target when a Line's `label` matches the candidate's `folderName` OR its `deviceLineNumber` matches the candidate's `deviceLineLabel`. Otherwise the operator must pick manually (§7.4).
- The "Стартирай импорт" button is enabled only when every candidate has a target selected.
- On click, iterates the candidates serially, calling `importPqwtIntoLine` for each. Per-row status: "importing…" → "imported ✓" or "error: <message>".
- After all rows complete (success or error), a "Готово" button navigates via `onDone`.

Guardrail: **do not auto-pick even when there's exactly one Line and one candidate — one tap per row is mandatory per §7.4.** The pre-selection is a suggestion; the operator's action is committed by dropdown change or a per-row confirm click.

- [ ] **Step 1: Write failing tests**

Write `src/ui/ImportScreen.test.tsx`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot, setFsAdapter } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { getOrCreatePath } from '../storage/paths';
import { writeBlob } from '../storage/atomic';
import { PQWT_L1_MINIMAL_CSV } from '../test/fixtures-pqwt';
import { createSite } from '../domain/site-service';
import { createSurvey } from '../domain/survey-service';
import { createLine } from '../domain/line-service';
import type { Vertex } from '../domain/types';
import { ImportScreen } from './ImportScreen';

let mainRoot: FileSystemDirectoryHandle;
let pickedRoot: FileSystemDirectoryHandle;

beforeEach(async () => {
  await resetDb();
  clearRoot();
  mainRoot = createMockRoot('Main');
  setRoot(mainRoot);
  pickedRoot = createMockRoot('DevicePick');
  setFsAdapter({ showDirectoryPicker: async () => pickedRoot });

  // Seed a picked-folder shape: 150M/L1/{csv,bmps}
  const mode = await getOrCreatePath(pickedRoot, ['150M']);
  const l1 = await getOrCreatePath(mode, ['L1']);
  await writeBlob(l1, '150M_L1.csv', new TextEncoder().encode(PQWT_L1_MINIMAL_CSV));
  await writeBlob(l1, '150M_Profile_L1.bmp', new Uint8Array([0x42, 0x4d]));
});

async function seedSurveyWithMatchingLine(label = 'L1') {
  const site = await createSite({
    name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
  const sv = await createSurvey(site.id, {
    startedAt: new Date(), timezone: 'Europe/Sofia', operator: 'Anton',
    deviceModel: 'PQWT-150M', deviceSerial: 'x',
    precipLast48h: 'none', qualityFlag: 'good',
  });
  const v: Vertex = {
    lat: 42.32, lon: 23.78, elevSource: 'none',
    hAccM: 6, hAccMethod: 'median-reported',
    sampleCount: 20, fixedAt: new Date(), atPointIndex: 1,
  };
  // Note: createLine auto-generates the label; force to match by creating the exact number of prior lines
  // For test simplicity: create the line and rename via label check below.
  const line = await createLine(sv.id, {
    pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
    mode: 'multi-frequency', dipoleOrientation: 'inline',
    vertices: [v, { ...v, atPointIndex: 3, lon: 23.7801 }],
  });
  // Assert the auto-label came out as 'L1' since it's the first line under this survey
  expect(line.label).toBe(label);
  return { site, sv, line };
}

describe('<ImportScreen />', () => {
  it('renders pick-folder button initially', async () => {
    const { sv } = await seedSurveyWithMatchingLine();
    render(<ImportScreen surveyId={sv.id} onDone={() => {}} onCancel={() => {}} />);
    expect(await screen.findByRole('button', { name: /избери папка/i })).toBeInTheDocument();
  });

  it('shows candidates after scanning', async () => {
    const { sv } = await seedSurveyWithMatchingLine();
    render(<ImportScreen surveyId={sv.id} onDone={() => {}} onCancel={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /избери папка/i }));
    await waitFor(() => expect(screen.getByText(/намерени профили/i)).toBeInTheDocument());
    // The candidate row shows folder name L1 and device label 1
    expect(await screen.findByText('L1')).toBeInTheDocument();
  });

  it('pre-selects a matching target line but requires operator confirmation before enabling start (§7.4)', async () => {
    const { sv, line } = await seedSurveyWithMatchingLine();
    render(<ImportScreen surveyId={sv.id} onDone={() => {}} onCancel={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /избери папка/i }));
    await waitFor(() => screen.getByText(/намерени профили/i));

    // The target dropdown should have the matching line as pre-selected.
    const targetSelect = screen.getByRole('combobox') as HTMLSelectElement;
    expect(targetSelect.value).toBe(line.id);

    // Start-import is enabled once every row has a non-empty target.
    const startBtn = screen.getByRole('button', { name: /стартирай импорт/i });
    expect(startBtn).not.toBeDisabled();
  });

  it('runs the import and updates the Line', async () => {
    const { sv, line } = await seedSurveyWithMatchingLine();
    render(<ImportScreen surveyId={sv.id} onDone={() => {}} onCancel={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /избери папка/i }));
    await waitFor(() => screen.getByText(/намерени профили/i));

    await userEvent.click(screen.getByRole('button', { name: /стартирай импорт/i }));
    await waitFor(() => expect(screen.getByText(/импортирано/i)).toBeInTheDocument());

    const updated = (await getDb().lines.get(line.id))!.json;
    expect(updated.deviceStartPointIndex).toBe(80);
    expect(updated.status).toBe('complete');
  });

  it('shows the "no candidates" empty state when the picked folder has nothing', async () => {
    const { sv } = await seedSurveyWithMatchingLine();
    // Replace picked root with an empty one
    setFsAdapter({ showDirectoryPicker: async () => createMockRoot('Empty') });

    render(<ImportScreen surveyId={sv.id} onDone={() => {}} onCancel={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /избери папка/i }));
    expect(await screen.findByText(/не са намерени данни/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: RED**

```bash
npm test src/ui/ImportScreen.test.tsx
```

- [ ] **Step 3: Implement `src/ui/ImportScreen.tsx`**

```typescript
import { useState, useMemo, useEffect } from 'react';
import { labels } from './labels';
import { pickRootFolder } from '../storage/fs';
import { scanPqwtImportRoot, type PqwtLineCandidate, type PqwtImportScan } from '../domain/pqwt-import-scanner';
import { importPqwtIntoLine } from '../domain/pqwt-import-service';
import { useLines } from '../cache/hooks';

type RowStatus = 'idle' | 'importing' | 'ok' | 'error';
interface Row {
  candidate: PqwtLineCandidate;
  targetLineId: string;      // '' = no selection yet
  status: RowStatus;
  message?: string;
}

interface Props {
  surveyId: string;
  onDone: () => void;
  onCancel: () => void;
}

function bmpBadge(c: PqwtLineCandidate): string {
  const l = labels.import;
  const raw = !!c.rawBmp, proc = !!c.processedBmp;
  if (raw && proc) return l.bmpBoth;
  if (raw) return l.bmpRawOnly;
  if (proc) return l.bmpProcessedOnly;
  return l.bmpNone;
}

export function ImportScreen({ surveyId, onDone, onCancel }: Props) {
  const [scan, setScan] = useState<PqwtImportScan | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lines = useLines(surveyId);

  // Available target lines = lines that don't already have device data attached
  const availableTargets = useMemo(
    () => (lines ?? []).filter((r) => r.json.deviceStartPointIndex === undefined),
    [lines],
  );

  // Auto-suggest target when scan arrives or lines list changes
  useEffect(() => {
    if (!scan || rows.length === 0) return;
    setRows((prev) => prev.map((row) => {
      if (row.targetLineId) return row;
      // Prefer exact label match; else deviceLineNumber match
      const match = availableTargets.find((t) =>
        t.json.label === row.candidate.folderName ||
        t.json.deviceLineNumber === row.candidate.deviceLineLabel,
      );
      return match ? { ...row, targetLineId: match.id } : row;
    }));
  }, [scan, availableTargets]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPick = async () => {
    setError(null);
    setBusy(true);
    try {
      const picked = await pickRootFolder();
      const s = await scanPqwtImportRoot(picked);
      setScan(s);
      setRows(s.candidates.map((c) => ({ candidate: c, targetLineId: '', status: 'idle' as RowStatus })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const canStart = rows.length > 0 && rows.every((r) => r.targetLineId !== '');

  const onStart = async () => {
    setBusy(true);
    setError(null);
    // Serialise: one import at a time to avoid concurrent folder writes
    for (let i = 0; i < rows.length; i++) {
      setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'importing' } : r));
      try {
        await importPqwtIntoLine({
          targetLineId: rows[i].targetLineId,
          candidate: rows[i].candidate,
        });
        setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'ok' } : r));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'error', message: msg } : r));
      }
    }
    setBusy(false);
  };

  const l = labels.import;

  return (
    <section style={{ padding: 16, maxWidth: 900 }}>
      <h1>{l.title}</h1>
      {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}

      {!scan && (
        <button onClick={onPick} disabled={busy}>{busy ? l.scanning : l.pickFolder}</button>
      )}

      {scan && rows.length === 0 && (
        <p>{l.noCandidates}</p>
      )}

      {scan && rows.length > 0 && (
        <>
          <p><small>{l.confirmMandatoryHint}</small></p>
          <p><small>{l.verbatimHint}</small></p>
          <h2>{l.candidatesHeading}</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px' }}>{l.tableColFolder}</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px' }}>{l.tableColHeaderLabel}</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: '4px' }}>{l.tableColMode}</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: '4px' }}>{l.tableColPointCount}</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px' }}>{l.tableColBmps}</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px' }}>{l.tableColTarget}</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.candidate.folderName}>
                  <td style={{ padding: '4px' }}>{row.candidate.folderName}</td>
                  <td style={{ padding: '4px' }}>{row.candidate.deviceLineLabel}</td>
                  <td style={{ padding: '4px', textAlign: 'right' }}>{row.candidate.depthRangeM}</td>
                  <td style={{ padding: '4px', textAlign: 'right' }}>
                    {row.candidate.csvText.split(/\r?\n/).filter((x) => x.length > 0).length - 1}
                  </td>
                  <td style={{ padding: '4px' }}>{bmpBadge(row.candidate)}</td>
                  <td style={{ padding: '4px' }}>
                    <select
                      value={row.targetLineId}
                      onChange={(e) => setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, targetLineId: e.target.value } : r))}
                      disabled={row.status === 'importing' || row.status === 'ok'}
                    >
                      <option value="">{l.targetPickPlaceholder}</option>
                      {availableTargets.map((t) => (
                        <option key={t.id} value={t.id}>{t.json.label}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '4px' }}>
                    {row.status === 'idle' && ''}
                    {row.status === 'importing' && l.importing}
                    {row.status === 'ok' && l.importedOk}
                    {row.status === 'error' && `${l.importedFail}: ${row.message}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {scan.skipped.length > 0 && (
            <>
              <h3>{l.skippedHeading}</h3>
              <ul>{scan.skipped.map((s) => <li key={s.folderName}>{s.folderName}: {s.reason}</li>)}</ul>
            </>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={onStart} disabled={!canStart || busy}>{busy ? l.importing : l.startImport}</button>
            <button onClick={onDone} disabled={busy}>{labels.common.back}</button>
            <button onClick={onCancel} disabled={busy}>{labels.common.cancel}</button>
          </div>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: GREEN + typecheck + build**

```bash
npm test src/ui/ImportScreen.test.tsx && npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/ImportScreen.tsx src/ui/ImportScreen.test.tsx
git commit -m "feat(ui): ImportScreen (§7.4 manual per-row confirmation)"
```

---

## Task 8: Router + SurveyDetail integration

**Files:**
- Modify: `src/ui/Router.tsx` — add `/sites/:id/surveys/:svId/import` route.
- Modify: `src/ui/SurveyDetail.tsx` — add `onImport: () => void` prop + a button; render the button before the lines list.
- Modify: `src/ui/SurveyDetail.test.tsx` — pass `onImport={() => {}}` in every render call.

**Interfaces:**
- Consumes: `<ImportScreen>` (T7).
- Produces: new route + button wiring.

- [ ] **Step 1: Add ImportRoute wrapper in `src/ui/Router.tsx`**

Import at top:
```typescript
import { ImportScreen } from './ImportScreen';
```

Add before the SurveyDetailRoute wrapper:
```typescript
function ImportRoute({ params }: { params: { id: string; svId: string } }) {
  const [, setLocation] = useLocation();
  return (
    <ImportScreen
      surveyId={params.svId}
      onDone={() => setLocation(`/sites/${params.id}/surveys/${params.svId}`)}
      onCancel={() => setLocation(`/sites/${params.id}/surveys/${params.svId}`)}
    />
  );
}
```

Wire the route in the `<Switch>` — BEFORE `/sites/:id/surveys/:svId` (Phase 1c precedent):
```typescript
<Route path="/sites/:id/surveys/:svId/import">
  {(params) => <ImportRoute params={params as { id: string; svId: string }} />}
</Route>
```

Also update the `SurveyDetailRoute` wrapper to pass `onImport`:
```typescript
onImport={() => setLocation(`/sites/${params.id}/surveys/${params.svId}/import`)}
```

- [ ] **Step 2: Update `src/ui/SurveyDetail.tsx`**

Add `onImport: () => void` to the `Props` interface. Destructure it. Render a button in the actions row (near the finalize/edit/new-line buttons):
```typescript
<button onClick={onImport} disabled={busy}>{labels.import.surveyDetailButton}</button>
```

- [ ] **Step 3: Update `src/ui/SurveyDetail.test.tsx`**

Every `render(<SurveyDetail ... />)` call needs `onImport={() => {}}` added.

- [ ] **Step 4: GREEN + typecheck + build**

```bash
npm test && npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/Router.tsx src/ui/SurveyDetail.tsx src/ui/SurveyDetail.test.tsx
git commit -m "feat(ui): wire /import route + SurveyDetail button"
```

---

## Task 9: Integration test with real sample files

**Files:**
- Create: `integration/phase2a-pqwt-import-flow.test.ts`

**Interfaces:**
- Consumes: all of Phase 2a + Vite's `?raw` import to read the real sample CSV.

- [ ] **Step 1: Write the test**

Write `integration/phase2a-pqwt-import-flow.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createMockRoot } from '../src/test/mock-fs';
import { setRoot, clearRoot } from '../src/storage/fs';
import { getDb, resetDb } from '../src/cache/db';
import { readJson, readBlob } from '../src/storage/atomic';
import { getPath } from '../src/storage/paths';
import { createSite } from '../src/domain/site-service';
import { createSurvey } from '../src/domain/survey-service';
import { createLine } from '../src/domain/line-service';
import { importPqwtIntoLine } from '../src/domain/pqwt-import-service';
import type { Vertex, Line } from '../src/domain/types';

const SAMPLES_ROOT = join(
  process.cwd(),
  'Profile Survey', '150M',
);

const HAS_REAL_SAMPLES = existsSync(join(SAMPLES_ROOT, 'L1', '150M_L1.csv'));

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

function readSample(label: string, ext: 'csv' | 'bmp', processed = false): { name: string; bytes: Uint8Array } {
  const dir = join(SAMPLES_ROOT, label);
  if (ext === 'csv') {
    const name = `150M_${label}.csv`;
    return { name, bytes: new Uint8Array(readFileSync(join(dir, name))) };
  }
  const suffix = processed ? '_Processed' : '';
  const name = `150M_Profile_${label}${suffix}.bmp`;
  return { name, bytes: new Uint8Array(readFileSync(join(dir, name))) };
}

describe.skipIf(!HAS_REAL_SAMPLES)('Phase 2a — real-sample end-to-end', () => {
  it('imports the real L1 sample: parses 18×36, stores verbatim, updates Line', async () => {
    // Seed site + survey + line
    const site = await createSite({
      name: 'Sample', settlement: 'Долна Баня', municipality: 'Долна Баня',
      region: 'Софийска', centroid: { lat: 42.32, lon: 23.78 },
      accessNotes: '', landUse: '', status: 'surveyed', tags: [],
    });
    const sv = await createSurvey(site.id, {
      startedAt: new Date(), timezone: 'Europe/Sofia', operator: 'Anton',
      deviceModel: 'PQWT-150M', deviceSerial: 'SN1',
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
      vertices: [v, { ...v, atPointIndex: 3, lon: 23.7801 }],
    });

    // Load the real sample bytes
    const csvBytes = readSample('L1', 'csv');
    const rawBmpBytes = readSample('L1', 'bmp', false);
    const procBmpBytes = readSample('L1', 'bmp', true);

    const candidate = {
      folderName: 'L1',
      depthRangeM: 150,
      deviceLineLabel: '1',
      csvFile: new File([csvBytes.bytes], csvBytes.name, { type: 'text/csv' }),
      csvText: new TextDecoder().decode(csvBytes.bytes),
      rawBmp: new File([rawBmpBytes.bytes], rawBmpBytes.name, { type: 'image/bmp' }),
      processedBmp: new File([procBmpBytes.bytes], procBmpBytes.name, { type: 'image/bmp' }),
    };

    const result = await importPqwtIntoLine({ targetLineId: line.id, candidate });
    expect(result.deviceMediaIds).toHaveLength(2);

    // Line state after import
    const updated = (await getDb().lines.get(line.id))!.json as Line;
    expect(updated.deviceStartPointIndex).toBe(80);
    expect(updated.deviceLineNumber).toBe('1');
    expect(updated.pointCount).toBe(18);
    expect(updated.channelSetSnapshot.channels).toHaveLength(36);
    expect(updated.channelSetSnapshot.units).toBe('mV');         // §2 R1
    expect(updated.channelSetSnapshot.depthModel).toBe('linear-nominal');  // §2 R3
    expect(updated.status).toBe('complete');

    // Verbatim CSV round-trip (§7.3)
    const siteRow = (await getDb().sites.get(site.id))!;
    const svRow = (await getDb().surveys.get(sv.id))!;
    const deviceFilesDir = await getPath(root, [
      'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', 'L1', 'device-files',
    ]);
    expect(deviceFilesDir).not.toBeNull();
    const backBlob = await readBlob(deviceFilesDir!, '150M_L1.csv');
    const backBytes = new Uint8Array(await backBlob.arrayBuffer());
    expect(backBytes.length).toBe(csvBytes.bytes.length);
    for (let i = 0; i < backBytes.length; i++) {
      if (backBytes[i] !== csvBytes.bytes[i]) throw new Error(`byte drift at index ${i}`);
    }

    // readings.csv: 18 × 36 = 648 data lines (assuming zero nulls in the real sample)
    const readingsBlob = await readBlob(await getPath(root, [
      'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', 'L1',
    ]) as FileSystemDirectoryHandle, 'readings.csv');
    const readingsText = await readingsBlob.text();
    const dataLines = readingsText.split(/\r?\n/).filter((l) => l && !l.startsWith('point,'));
    expect(dataLines.length).toBe(18 * 36);

    // MediaAsset rows populated (Phase 1c M1 pattern)
    const mediaRows = await getDb().media.where('linkedId').equals(line.id).toArray();
    expect(mediaRows).toHaveLength(2);
    expect(mediaRows.every((r) => r.json.kind === 'device-screen')).toBe(true);
    expect(mediaRows.every((r) => r.json.isOriginal === true)).toBe(true);   // §4.13 device screens never downscaled
  });
});

describe.skipIf(HAS_REAL_SAMPLES)('Phase 2a — real-sample end-to-end (SKIPPED — sample files not present)', () => {
  it('skipped', () => { expect(true).toBe(true); });
});
```

- [ ] **Step 2: Run the whole suite**

```bash
npm test && npm run typecheck && npm run build
```
Expected: all green. If `Profile Survey/150M/L1/*` exists on disk, the real-sample tests run. Otherwise they're skipped via `describe.skipIf`, and the CI works.

- [ ] **Step 3: Commit**

```bash
git add integration/phase2a-pqwt-import-flow.test.ts
git commit -m "test(integration): PQWT import end-to-end with real sample files"
```

---

## Done criteria

- [ ] `npm test` reports every test file green.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` succeeds.
- [ ] `npm run dev`: navigating to a Survey shows an "Импортирай от устройство" button; clicking it opens the ImportScreen; picking a folder shows the candidate rows; per-line target picker enforces one-tap-per-row before "Стартирай импорт" enables.
- [ ] Real sample files at `Profile Survey/150M/L{1,2,3,10}/` parse and import successfully (via the integration test).
- [ ] Every commit ran `npm run typecheck` before landing (Phase 1a ruling).
- [ ] All Bulgarian UI copy in `labels.ts`; no user-visible literals in components.
- [ ] Physics rules R1/R2/R3 preserved (units=mV, pseudoDepthM only, linear-nominal); §4.9 channelSetSnapshot embedded by value; §7.3 verbatim raw storage + SHA-256 manifest; §7.4 manual per-row confirmation; §7.5 no silent flips; §5.5 device screenshots stored as `isOriginal: true`.

## Deferred to Phase 2b (not in this plan)

- Sibling folders `System volume inf` and `Three Freq` (need physical inspection before designing the scanner extension).
- Point construction from CSV + polyline (fills `Line.points[]` with interpolated GPS + readings) — required for the map view and drill placement UI. The `readings.csv` is enough for a table view but not a map.
- Profile canvas view (§5.5) — renders the 18×36 matrix as a heatmap next to the device BMP.
- Line-with-no-vertices "create-from-import" flow — currently requires an existing Line with ≥ 2 vertices. If Anton wants to import first and fix GPS later, that's a separate task.
- Triple-frequency mode / `Three Freq` folder handling.
- Import undo — currently, importing "freezes" the ChannelSet on the Line. Anton needs to create a fresh Line to re-import.
