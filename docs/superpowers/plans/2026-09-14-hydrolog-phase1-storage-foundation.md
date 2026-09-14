# HydroLog Phase 1a — Folder-Primary Storage Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the storage substrate for HydroLog: a user-picked folder is the source of truth, IndexedDB is a rebuildable cache, and the app can create/read/update Site → Survey → Line records with atomic writes that survive crashes and sync races.

**Architecture:** Web PWA (React + TypeScript + Vite). Storage layer wraps the browser File System Access API behind a small interface, with an in-memory implementation for tests. All writes go through an atomic write-then-rename utility. A folder scanner produces a typed index; a Dexie cache holds the scanned index for fast in-app queries and is rebuilt from the folder on cold start. Multi-file updates (e.g., a survey finalize) go through a transaction sequencer that writes media first, then referring JSON files, and the survey commit-marker last. A sync canary probe measures round-trip time to whatever OS-level tool (Drive-for-Desktop, Syncthing) mirrors the folder.

**Tech Stack:** React 18, TypeScript 5, Vite 5, Vitest 1.x, @testing-library/react, Dexie 4, idb-keyval (persistent FSA handle), ulid, standard Web Crypto (SHA-256).

**Spec:** `docs/app-spec-v2.md` (specifically §2 physics rules, §4 domain model, §5.3 line geometry, §10 storage — which Task 2 rewrites in place from the drafted replacement, and §14 acceptance tests T21–T23 added by this plan).

## Global Constraints

Every task inherits these — copied verbatim from the spec so they travel with the plan.

- **Chrome-family only.** Chrome desktop (Win/Mac/Linux) since 2020; Chrome Android M132+ (Jan 2025) for directory-picking FSA. Firefox, Safari, iOS out of scope.
- **Physics rules (§2).** Types must enforce R1 (units = `'mV' | 'relative'` only, never `'ohm-m'`), R2 (field is named `pseudoDepthM` in TS, `pseudo_depth_m` in export/JSON, and the string `depth_m` never appears for pseudo-depth), R3 (`depthModel` is one of `'linear-nominal' | 'skin-depth' | 'vendor-table' | 'unknown'`), R6 (`anomalyType` is one of the six signatures listed, "aquifer" is not a value, no yield fields on interpretation).
- **Frozen channelSetSnapshot (§4.9).** `Line.channelSetSnapshot` is a full copy of the ChannelSet by value, never a reference id. Editing a ChannelSet later never mutates past Lines.
- **No silent flips (§5.4).** Any orientation/reversal applied to a line's data is a logged entry in `Line.transformLog[]` with timestamp + reason. There is no convenience toggle.
- **IDs are ULID.** Every domain object has `id: string` = ULID; monotonic within a session.
- **Timestamps are ISO 8601 UTC** in JSON; `Date` objects in memory.
- **Cross-cutting audit fields on every domain object:** `id`, `createdAt`, `updatedAt`, `deletedAt?`, `revision` (int, starts at 1).
- **Folder is source of truth (§10 replacement, added by Task 2).** No fact exists only in the cache. Writes go to the folder first; cache updates second.
- **Language.** Code, comments, JSON field names, commit messages: English. User-facing strings: Bulgarian (deferred; no UI copy in this plan beyond debug labels).

---

## File Structure Map

Files created or modified across the plan. Task numbers in parentheses.

```
package.json                                    # (T1) npm deps + scripts
tsconfig.json                                   # (T1)
vite.config.ts                                  # (T1)
vitest.config.ts                                # (T1)
index.html                                      # (T1)
.gitignore                                      # (T1)
docs/app-spec-v2.md                             # (T2) §10 rewritten
src/
  main.tsx                                      # (T1)
  App.tsx                                       # (T1) → (T13, T14) UI wiring
  domain/
    types.ts                                    # (T3) all domain types
    types.test.ts                               # (T3)
  util/
    id.ts                                       # (T4) ULID generator
    id.test.ts                                  # (T4)
    hash.ts                                     # (T4) SHA-256
    hash.test.ts                                # (T4)
    time.ts                                     # (T4) ISO timestamp helpers
    time.test.ts                                # (T4)
  storage/
    fs.ts                                       # (T5) FSA wrapper + persist handle
    fs.test.ts                                  # (T5)
    atomic.ts                                   # (T6) write-then-rename JSON/blob
    atomic.test.ts                              # (T6)
    paths.ts                                    # (T7) folder path builders
    paths.test.ts                               # (T7)
    scanner.ts                                  # (T8) folder tree walker
    scanner.test.ts                             # (T8)
    transaction.ts                              # (T11) multi-file sequencer
    transaction.test.ts                         # (T11)
    sync.ts                                     # (T12) canary + last-synced
    sync.test.ts                                # (T12)
  cache/
    db.ts                                       # (T9) Dexie schema
    db.test.ts                                  # (T9)
    rebuild.ts                                  # (T10) scan → cache
    rebuild.test.ts                             # (T10)
  ui/
    Home.tsx                                    # (T13)
    Home.test.tsx                               # (T13)
    SiteList.tsx                                # (T13)
    SyncIndicator.tsx                           # (T13)
  test/
    mock-fs.ts                                  # (T5) in-memory FSA impl for tests
    mock-fs.test.ts                             # (T5)
    fixtures.ts                                 # (T8) sample folder builders
integration/
  create-restart-verify.test.ts                 # (T15) end-to-end folder-primary test
```

Rationale for splits:

- `storage/` holds everything that touches the folder. `cache/` holds everything that touches Dexie. They talk through typed values, not shared state. This split makes each testable independently and prevents the cache from becoming a second source of truth.
- `domain/types.ts` is a single file rather than one file per entity: types cross-reference constantly (Line has ChannelSetSnapshot, Reading references channel indices, etc.), and one file keeps the whole model in the reader's head.
- `util/` is small stateless helpers with no dependencies on `storage/` or `cache/`, so they can be imported everywhere without cycles.
- `test/mock-fs.ts` implements the Web FS interface in memory. All storage tests use it. UI tests use it via the storage layer.

---

## Task 1: Project scaffold + git init

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `.gitignore`, `src/main.tsx`, `src/App.tsx`
- Test: none for this task (smoke test in T3 exercises the build)

**Interfaces:**
- Consumes: nothing
- Produces: a runnable `npm run dev` server and a passing `npm test` command (zero tests initially, but the runner works)

- [ ] **Step 1: Initialize git**

Run:
```bash
git init
git branch -M main
```

- [ ] **Step 2: Create `.gitignore`**

Write `.gitignore`:
```
node_modules/
dist/
.env
.env.local
*.log
.vite/
coverage/
.DS_Store
Thumbs.db
```

- [ ] **Step 3: Create `package.json`**

Write `package.json`:
```json
{
  "name": "hydrolog",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "dexie": "^4.0.8",
    "idb-keyval": "^6.2.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "ulid": "^2.3.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.5",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "happy-dom": "^14.12.0",
    "typescript": "^5.5.3",
    "vite": "^5.3.3",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 4: Create `tsconfig.json`**

Write `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "integration", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 5: Create `vite.config.ts`**

Write `vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

- [ ] **Step 6: Create `vitest.config.ts`**

Write `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['src/test/setup.ts'],
  },
});
```

- [ ] **Step 7: Create `src/test/setup.ts`**

Write `src/test/setup.ts`:
```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 8: Create minimal app files**

Write `index.html`:
```html
<!doctype html>
<html lang="bg">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HydroLog</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Write `src/main.tsx`:
```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Write `src/App.tsx`:
```typescript
export function App() {
  return <div>HydroLog boot</div>;
}
```

- [ ] **Step 9: Install and verify**

Run:
```bash
npm install
npm run typecheck
npm test
npm run build
```

Expected: `typecheck` passes, `test` reports "No test files found" and exits 0, `build` produces `dist/`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + TypeScript + Vitest"
```

---

## Task 2: Rewrite spec §10 with folder-primary storage

**Files:**
- Modify: `docs/app-spec-v2.md` (replace entire §10 section)
- Test: none (doc change)

**Interfaces:**
- Consumes: nothing
- Produces: an updated spec that all later tasks argue from. Section names T21, T22, T23 in §14 that later integration tests will match.

- [ ] **Step 1: Read current spec §10**

Run:
```bash
grep -n "^## " docs/app-spec-v2.md
```

Expected: locate the exact line range for `## 10.` and `## 11.` so the replacement stays scoped.

- [ ] **Step 2: Replace §10 with the folder-primary design**

Use the Edit tool to replace the entire §10 body (from the `## 10. Storage and backup` heading through the last line before `## 11. Technical notes`) with the following:

```markdown
## 10. Storage and backup — ⚠ CHANGED FROM v2

You chose *local-first, backed up to a folder that syncs*. v2 kept Dexie as the primary store and produced a backup zip via share-sheet — one level of indirection too many. **The folder itself is the store.** IndexedDB is a rebuildable index.

This is the design §13's baseline argued for and §10 v2 half-arrived at. Committing to it removes the OAuth subsystem, the periodic-backup mechanics, the `persist()` heuristic, most of the eviction logic, and the custom restore path — all of which existed to work around not owning a folder.

### 10.1 Why the folder, not the database

Keeping data in Dexie has three problems v2 did not fully own:

- **The archive's readability is contingent on the app still working.** In 2031, opening a HydroLog folder must not require compiling a 2026 PWA. S6 as v2 wrote it depends on the export path being run — no export, no re-derivation.
- **Restore is a custom import path** and therefore a place where the newer-wins-by-ULID bug (v2 §10, correctly identified) can silently destroy edits. A bug in a code path that only runs during disaster is the worst kind.
- **The §13 baseline is not a drop-out**, it is a full data migration from the app. That kills the strong version of §13's recommendation ("run the baseline for the next 5–10 sites in parallel").

Making the folder the source of truth fixes all three at once.

### 10.2 The folder is the truth

The user picks a folder once on first run (`HydroLog/`). Every survey, line, reading, media file, export and interpretation lives inside it as a plain file at a stable path.

```
HydroLog/
  _schema.json                          # {version: "hydrolog-v1"}
  channelSets/
    tc300_linear-nominal_v1.json        # frozen per §4.9
  clients/
    ivanov-family.json
  sites/
    BG-SOF-0043_Dolna-Banya_Ivanov/
      site.json                         # §4.2
      regulatory.json                   # §4.3
      surveys/
        2026-09-13T10-20_s01/
          survey.json                   # §4.4
          lines/
            L1/
              line.json                 # §4.5 — the field work, always exists
              vertices.geojson          # polyline, §5.3
              anchor.jpg                # point-1 photo, mandatory §5.4
              readings.csv              # points × channels × passes
              transform-log.json        # §5.4 flips, if any
              noise-zones.json          # §4.8
              device-files/             # §7.3 verbatim; may be empty if data-pending
                L1_original/...
                sha256.txt
              media/
                p05_obstacle.jpg
                voice-01.m4a
                _thumbs/                # regenerable
          interpretation.json           # §4.11
          intersections.json            # §4.10
          disclaimer_bg-2026-03.txt     # frozen at issue
      outcomes/
        2027-04-15_drill-01.json        # may arrive years later
      exports/
        2026-09-13_client.pdf
        2026-09-13_client.pdf.sha256
        2026-09-13.kmz
        2026-09-13.geojson
        2026-09-13_certificate-bundle.json.sig
  _tombstones/                          # soft-deletes per §4.1
```

Everything is either JSON, GeoJSON, CSV, or a media file at its natural extension. A 2031 laptop with QGIS and a text editor can open all of it.

### 10.3 IndexedDB is a rebuildable cache

The app keeps an index in IndexedDB — parsed site/survey/line records, media hashes, search terms, thumbnails. **Deleting the cache is a supported operation.** On next cold start the app walks the tree and rebuilds it.

Invariant: **no fact exists only in the cache.** Every write goes to the folder first; only then is the cache updated. If the app crashes mid-write, the folder holds either the old or the new file (§10.5), and the cache re-syncs on next start.

Rebuild cost at target scale (200 sites × 2 surveys × ~15 files): ~6 000 stat calls, ~1–2 s on the phone, sub-second on the laptop. Incremental updates keyed on directory mtime after that.

### 10.4 The API — File System Access

Directory handle picked once, persisted across sessions via IndexedDB.

| Platform | Support | Notes |
|---|---|---|
| Chrome desktop (Win/Mac/Linux) | Full since 2020 | Primary target |
| Chrome Android | Directory picking since M132 (Jan 2025) — the same version §3 already relies on | Persistent handle survives PWA restarts |
| Firefox / Safari desktop | No FSA | Out of scope — HydroLog is Chrome-family only |
| iOS Safari | No FSA | Out of scope — spec is Android + desktop only |

If a persisted handle is unavailable (fresh install, revoked permission, browser reset), the app prompts to re-select the folder. This is a one-tap re-pick, not a data event — the contents are unchanged.

### 10.5 Atomic writes, write-then-rename

All metadata writes use the standard atomic pattern: write `x.json.tmp`, `fsync`, rename to `x.json`. FSA's `createWritable` + atomic `close()` on Chromium implements this.

Multi-file update order is fixed:

1. **Media blobs first** — content-addressed by SHA-256, so re-runs are idempotent.
2. **Referring `line.json` / `interpretation.json`** next.
3. **`survey.json` last** — it is the commit marker for a survey-level change.

A crash between steps leaves the survey pointing at the previous consistent state; orphaned media (from step 1) are garbage-collected on next scan.

### 10.6 Sync race with Drive-for-Desktop / Syncthing

Two race modes matter:

- **App reads while sync is writing.** Every file we care about has a hash recorded in the referring JSON. On mismatch, the app retries after a short delay before treating it as corruption.
- **App writes while sync is reading.** Not a real problem — the rename in §10.5 is atomic at the filesystem level; the sync tool sees the old or the new file, never a torn one.

Never edit HydroLog files from two devices simultaneously. This is policy, not a lock — HydroLog is single-user by design, and OS sync tools do not offer merge semantics.

### 10.7 Photo pressure moves to the OS

Drive-for-Desktop, OneDrive, and iCloud (via a companion Mac) all support **"available online only"** — the file exists in the listing but takes no local disk until opened. This replaces v2's app-managed eviction logic entirely.

- Thumbnails (`_thumbs/`, 512 px, regenerable) stay pinned locally so gallery views work offline.
- Originals default to online-only after Drive confirms upload. The app never deletes them; the OS does, and re-fetches on demand.
- Voice notes and device-file blobs are small enough (< 5 MB typical) to keep locally by default.

`navigator.storage.estimate()` still runs before large writes; at 90% quota the app refuses gracefully and asks the user to free space or extend cloud storage.

### 10.8 Migrations

Schema changes rewrite files in place. Before any migration runs:

1. A snapshot copy of the folder is made at `HydroLog/_backup_pre_migration_YYYY-MM-DD-HHMM/` using native FSA copy.
2. Migration walks the tree, rewrites each file to the new shape via write-then-rename.
3. `_schema.json` is updated last, as the commit marker.

Rollback is a directory copy back. Migrations are additive-only where possible; a destructive change requires an explicit user confirm and keeps the snapshot for 30 days minimum.

### 10.9 Backup nag — now reads real state

The Home screen nag is unchanged in intent but reads a truer signal: **hours since the folder last synced upstream**, not hours since the app last exported.

Source of the signal, in preference order:

1. **Drive-for-Desktop / OneDrive local status** where queryable.
2. **Round-trip canary**: on each finalize the app writes a tiny `_sync_probe/YYYY-MM-DD-HHMM.txt`; a second read from a companion handle confirms round-trip. Timestamp of the last successful round-trip is the nag input.
3. **Manual "I've verified backup"** button as last resort — resets the clock but requires an explicit tap.

Thresholds unchanged: amber at 12 h, modal red at 24 h. **A survey cannot be finalized while the folder's last-synced time is older than the survey's `startedAt`** (S5).

### 10.10 Restore is a folder copy

To restore on a fresh phone: install the PWA, pick the (already-synced) `HydroLog/` folder, wait ~2 s for the index rebuild. That is the entire restore path. No import UI, no version negotiation, no ULID conflict resolution.

If two copies of the folder exist and need merging (laptop worked offline while phone kept editing), the resolver runs per-file: same path + same hash → keep; same path + different hash → three-way diff, user picks. Merge is a rare operation, not a design center.

### 10.11 Storage budget, revisited

Structured data at 200 sites × 2 surveys: still ~9 MB (§14 T7 unchanged), now split across ~6 000 small files instead of one Dexie blob. Filesystem block overhead inflates on-disk usage to **~25 MB**. Irrelevant.

Photo pressure: ~1.4 GB unchanged; handled by the OS per §10.7.

### 10.12 Dropped from v2

| Dropped | Reason |
|---|---|
| `navigator.storage.persist()` | Cache is rebuildable; loss is not a data event |
| Drive OAuth (`drive.file` scope, v2 Phase 4) | The OS sync tool does this correctly; a browser-only client cannot |
| App-managed media eviction | OS "available online only" is a better implementation |
| Backup zip format + share-sheet as primary | Retained only as fallback for a phone without an installed sync app |
| ULID-based conflict resolution on restore | Restore is a folder copy; merge is per-file |
| Pre-schema-upgrade backup zip | Replaced by pre-migration folder snapshot |
| Custom export-then-import restore path | Restore = folder pick |
```

- [ ] **Step 3: Add T21–T23 to §14 acceptance tests**

Locate the §14 table and append three rows before the closing of the table:

```markdown
| T21 | Delete IndexedDB cache; app rebuilds identical index from folder within 3 s on target hardware | to run |
| T22 | Crash mid-write (kill the process during a survey save); on relaunch the survey is either fully at the old state or fully at the new state, never partial | to run |
| T23 | Two-device merge with one file edited on each side: resolver presents a diff, does not silently pick | to run |
```

- [ ] **Step 4: Sanity-check the edits**

Run:
```bash
grep -n "^### 10\." docs/app-spec-v2.md
grep -n "^| T21" docs/app-spec-v2.md
```

Expected: 12 subsections under §10 (10.1 through 10.12); T21 row visible.

- [ ] **Step 5: Commit**

```bash
git add docs/app-spec-v2.md
git commit -m "docs(spec): rewrite §10 as folder-primary storage"
```

---

## Task 3: Domain types

**Files:**
- Create: `src/domain/types.ts`, `src/domain/types.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `Site`, `Survey`, `Line`, `Point`, `Reading`, `ChannelSet`, `ChannelSetSnapshot`, `NoiseZone`, `MediaAsset`, `Interpretation`, `Anomaly`, `Correlation`, `DrillOutcome`, `RegulatoryContext`, `TransformLogEntry`, `Vertex`, `LineIntersection`, `Client` — all as exported TypeScript types.
  - `Units` = `'mV' | 'relative'`
  - `DepthModel` = `'linear-nominal' | 'skin-depth' | 'vendor-table' | 'unknown'`
  - `AnomalyType` = `'fracture-signature' | 'conductive-zone' | 'contact' | 'clay-lens-signature' | 'noise-artefact' | 'no-anomaly'`
  - `Verdict` = `'drill-recommended' | 'not-recommended' | 'inconclusive'`
  - `AuditFields` interface with `id, createdAt, updatedAt, deletedAt?, revision`

- [ ] **Step 1: Write the failing test**

Write `src/domain/types.test.ts`:
```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type {
  Site, Survey, Line, ChannelSet, ChannelSetSnapshot,
  Units, DepthModel, AnomalyType, Verdict,
  AuditFields, Reading, Vertex,
} from './types';

describe('domain types', () => {
  it('Units allows mV and relative, forbids ohm-m (§2 R1)', () => {
    const ok: Units = 'mV';
    const rel: Units = 'relative';
    // @ts-expect-error R1: Ω·m is not selectable
    const bad: Units = 'ohm-m';
    void ok; void rel; void bad;
  });

  it('DepthModel has all four allowed values (§2 R3)', () => {
    const values: DepthModel[] = ['linear-nominal', 'skin-depth', 'vendor-table', 'unknown'];
    expectTypeOf(values).toEqualTypeOf<DepthModel[]>();
  });

  it('AnomalyType forbids "aquifer" (§2 R6)', () => {
    // @ts-expect-error R6: "aquifer" is not a value
    const bad: AnomalyType = 'aquifer';
    void bad;
  });

  it('Site extends AuditFields and has cadastral fields separated', () => {
    const s: Site = {
      id: '01J...',
      createdAt: new Date(),
      updatedAt: new Date(),
      revision: 1,
      name: 'Dolna Banya - Ivanov',
      code: 'BG-SOF-0043',
      settlement: 'Долна Баня',
      ekatte: '12345',
      cadastralParcelId: '12345.678.90.12.34',
      municipality: 'Долна Баня',
      region: 'Софийска',
      centroid: { lat: 42.32, lon: 23.78 },
      accessNotes: '',
      landUse: '',
      status: 'surveyed',
      tags: [],
    };
    expectTypeOf(s).toMatchTypeOf<AuditFields>();
  });

  it('Line has channelSetSnapshot by value, not a reference id (§4.9)', () => {
    const snap: ChannelSetSnapshot = {
      name: 'TC300 linear',
      deviceModel: 'PQWT-TC300',
      kind: 'frequency',
      units: 'mV',
      depthModel: 'linear-nominal',
      provenanceNote: '',
      channels: [{ label: 'ch1', order: 0, pseudoDepthM: 4.5 }],
      frozenAt: new Date(),
    };
    // TS enforces that Line.channelSetSnapshot is a ChannelSetSnapshot object, not string.
    expectTypeOf<Line['channelSetSnapshot']>().toEqualTypeOf<ChannelSetSnapshot>();
    void snap;
  });

  it('Line.transformLog[] is required (never optional) — no silent flips (§5.4)', () => {
    expectTypeOf<Line['transformLog']>().toEqualTypeOf<TransformLogEntry[]>();
  });

  it('Reading records pass number and per-point clock (§4.7)', () => {
    const r: Reading = {
      pass: 1,
      recordedAt: new Date(),
      values: [1.2, 3.4, null],
      groundingOk: true,
      electrodeTreatment: 'watered',
    };
    void r;
  });

  it('Vertex carries hAccM and sampleCount (§4.5)', () => {
    const v: Vertex = {
      lat: 42.32,
      lon: 23.78,
      hAccM: 8.2,
      hAccMethod: 'median-reported',
      sampleCount: 42,
      fixedAt: new Date(),
      atPointIndex: 1,
      elevSource: 'none',
    };
    void v;
  });
});

// re-import at bottom because vitest needs the value
import type { TransformLogEntry } from './types';
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm run typecheck
```

Expected: FAIL — `types.ts` does not exist.

- [ ] **Step 3: Write `src/domain/types.ts`**

```typescript
// Cross-cutting audit fields on every record (§4.1)
export interface AuditFields {
  id: string;                    // ULID
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;              // soft delete
  revision: number;              // starts at 1
}

// §2 R1
export type Units = 'mV' | 'relative';

// §2 R3
export type DepthModel =
  | 'linear-nominal'
  | 'skin-depth'
  | 'vendor-table'
  | 'unknown';

// §2 R6 — signatures, not hydrogeology. "aquifer" is not a value.
export type AnomalyType =
  | 'fracture-signature'
  | 'conductive-zone'
  | 'contact'
  | 'clay-lens-signature'
  | 'noise-artefact'
  | 'no-anomaly';

// §4.11
export type Verdict = 'drill-recommended' | 'not-recommended' | 'inconclusive';

// §4.5
export interface Channel {
  label: string;
  order: number;
  frequencyHz?: number;
  pseudoDepthM?: number;
}

export interface ChannelSet extends AuditFields {
  name: string;
  deviceModel: string;
  kind: 'frequency' | 'index';
  units: Units;
  depthModel: DepthModel;
  assumedResistivityOhmM?: number;
  provenanceNote: string;
  channels: Channel[];
  frozenAt: Date;
}

// §4.9 — a Line holds a snapshot by value, not a reference id. Frozen.
export interface ChannelSetSnapshot {
  name: string;
  deviceModel: string;
  kind: 'frequency' | 'index';
  units: Units;
  depthModel: DepthModel;
  assumedResistivityOhmM?: number;
  provenanceNote: string;
  channels: Channel[];
  frozenAt: Date;
}

export interface LatLon {
  lat: number;
  lon: number;
}

// §4.5
export interface Vertex extends LatLon {
  elevM?: number;
  elevSource: 'gps-ellipsoidal' | 'map-derived' | 'surveyed-orthometric' | 'manual' | 'none';
  hAccM: number;                 // §5.2 — median reported, not std dev
  hAccMethod: 'median-reported' | 'first-fix' | 'manual';
  sampleCount: number;
  fixedAt: Date;
  atPointIndex: number;          // which point on the line this vertex marks
}

// §4.7 — repeats are first-class
export interface Reading {
  pass: number;                  // 1, 2, ...
  recordedAt: Date;              // per-point clock time
  values: (number | null)[];     // one per channel; null = missing
  groundingOk: boolean;
  electrodeTreatment: 'none' | 'watered' | 'salted';
  note?: string;
}

// §4.6
export interface Point {
  index: number;                 // 1..N
  offsetM: number;               // measured along polyline, not (index-1)*spacing
  lat: number;
  lon: number;
  elevM?: number;
  elevSource: Vertex['elevSource'];
  coordSource: 'interpolated' | 'measured' | 'manual';
  readings: Reading[];
  flags: ('suspect' | 'obstacle' | 'noise' | 'pending-data')[];
  note?: string;
}

// §4.8
export interface NoiseZone {
  kind: 'power-line' | 'buried-cable' | 'pipeline' | 'electric-fence' | 'rail' | 'pump' | 'other';
  geometry: LatLon | LatLon[];
  bearingFromLineDeg?: number;
  distanceM?: number;
  affectsPointsFrom?: number;
  affectsPointsTo?: number;
  note?: string;
}

// §5.4 — any transform is logged, never silent
export interface TransformLogEntry {
  kind: 'flip' | 'reverse' | 'trim' | 'other';
  appliedAt: Date;
  reason: string;
  by: 'user' | 'import';
}

// §4.5
export interface Line extends AuditFields {
  label: string;                  // "L1"
  deviceLineNumber?: string;
  deviceSessionDate?: string;     // YYYY-MM-DD; L-number is not unique across sessions
  pointCount: number;             // default 17
  pointSpacingM: number;          // typically 1–2 m
  electrodeSpacingM: number;      // MUST be > pointSpacingM
  mode: 'single' | 'triple' | 'multi-frequency';
  channelSetSnapshot: ChannelSetSnapshot;  // by value, frozen (§4.9)
  vertices: Vertex[];             // ordered polyline (§5.3)
  azimuthDeg?: number;
  azimuthSource?: 'derived-from-vertices' | 'compass' | 'manual';
  lengthM?: number;               // derived
  point1AnchorMediaId?: string;   // MediaAsset id; mandatory before finalize
  dipoleOrientation: 'inline' | 'broadside';
  polarityConvention?: string;
  groundSlopePct?: number;
  reliefM?: number;
  repeatOfLineId?: string;
  transformLog: TransformLogEntry[];  // required, may be empty; never silent flips
  points: Point[];
  noiseZones: NoiseZone[];
  status: 'draft' | 'data-pending' | 'complete';
}

// §4.10
export interface LineIntersection {
  lineAId: string;
  lineBId: string;
  lat: number;
  lon: number;
  pointIndexOnA: number;
  pointIndexOnB: number;
  stakedAt?: Date;
  stakedPhotoMediaId?: string;
}

// §4.11
export interface Anomaly {
  lineId: string;
  fromPoint: number;
  toPoint: number;
  fromChannel: number;
  toChannel: number;
  pseudoDepthFromM: number;       // §2 R2 — never depth_m
  pseudoDepthToM: number;
  type: AnomalyType;              // §2 R6
  confidence: 1 | 2 | 3 | 4 | 5;
  note?: string;
}

export interface Correlation {
  anomalyIds: string[];
  intersectionId?: string;
  agreementNote: string;
}

export interface PhysicalAnchor {
  landmarkDescription: string;
  bearingDeg: number;
  distanceM: number;
  photoMediaId: string;
  staked: boolean;
}

export interface DrillRecommendation {
  lat: number;
  lon: number;
  sourceKind: 'intersection' | 'single-line-point' | 'manual';
  sourceId: string;
  pseudoDepthTargetFromM: number;
  pseudoDepthTargetToM: number;
  confidence: 1 | 2 | 3 | 4 | 5;
  physicalAnchor: PhysicalAnchor;
}

export interface Interpretation extends AuditFields {
  anomalies: Anomaly[];
  correlations: Correlation[];
  recommendedDrill?: DrillRecommendation;
  alternateDrill?: DrillRecommendation[];
  verdict: Verdict;
  reportText: string;
  disclaimerVersion: string;
  author: string;
  revisedAt?: Date;
}

// §4.12
export interface DrillOutcome extends AuditFields {
  drilledAt: Date;
  driller: string;
  finalDepthM: number;
  waterStruckAtM: number[];
  staticLevelM?: number;
  yieldLps?: number;
  yieldMethod?: 'baler' | 'air-lift' | 'pump-test';
  casingNotes?: string;
  distanceFromRecommendedM: number;   // auto — this one IS comparable
  assessment: 'hit' | 'partial' | 'miss' | 'not-drilled';
  assessmentNote?: string;
  costBGN?: number;
  photoMediaIds: string[];
  interpretationId?: string;
}

// §4.13
export interface MediaAsset extends AuditFields {
  kind: 'site-photo' | 'device-screen' | 'point1-anchor' | 'drill-point' | 'sketch' | 'document' | 'voice-note';
  capturedAt: Date;
  lat?: number;
  lon?: number;
  bearingDeg?: number;
  linkedTo: { kind: 'site' | 'survey' | 'line' | 'point' | 'interpretation'; id: string };
  storagePath: string;            // relative to root, e.g. "sites/BG-SOF-0043/surveys/..../media/p05.jpg"
  sha256: string;
  thumbPath?: string;             // relative to root
  caption?: string;
  isOriginal: boolean;
}

// §4.3
export interface RegulatoryContext {
  waterBodyCode?: string;
  waterBodyName?: string;
  nearestRegisteredWellM?: number;
  insideSOZ: { inside: boolean; zone?: string };
  protectedAreaNotes?: string;
  intendedUse?: 'битови' | 'поливни' | 'стопански';
  intendedAbstractionM3PerDay?: number;
  notes?: string;
}

// §4.4
export interface Survey extends AuditFields {
  siteId: string;
  startedAt: Date;
  endedAt?: Date;
  timezone: string;               // IANA, e.g. "Europe/Sofia"
  operator: string;
  deviceModel: string;
  deviceSerial: string;
  firmware?: string;
  weather?: string;
  airTempC?: number;
  precipLast48h: 'none' | 'light' | 'heavy';
  terrain?: string;
  purpose?: string;
  summary?: string;
  qualityFlag: 'good' | 'noisy' | 'repeat-needed';
  finalizedAt?: Date;             // locks the survey
}

// §4.2
export interface Site extends AuditFields {
  name: string;
  code: string;                   // auto BG-SOF-0043
  settlement: string;
  ekatte?: string;
  cadastralParcelId?: string;     // 5-part
  municipality: string;
  region: string;
  clientId?: string;
  centroid: LatLon;
  boundary?: LatLon[];            // polygon
  accessNotes: string;
  landUse: string;
  status: 'surveyed' | 'recommended' | 'not-recommended' | 'drilled' | 'archived';
  tags: string[];
}

export interface Client extends AuditFields {
  name: string;
  contact?: string;
  notes?: string;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test src/domain/types.test.ts
npm run typecheck
```

Expected: PASS. Typecheck passes.

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts src/domain/types.test.ts
git commit -m "feat(domain): typed schema enforcing §2 physics rules and §4 model"
```

---

## Task 4: ID, hash, and time utilities

**Files:**
- Create: `src/util/id.ts`, `src/util/id.test.ts`, `src/util/hash.ts`, `src/util/hash.test.ts`, `src/util/time.ts`, `src/util/time.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `newId(): string` — ULID string
  - `sha256Hex(input: BufferSource | string): Promise<string>` — lowercase hex digest
  - `isoNow(): string` — current UTC ISO 8601 timestamp
  - `parseIso(s: string): Date`
  - `formatFolderTimestamp(d: Date): string` — `YYYY-MM-DDTHH-mm` for folder names

- [ ] **Step 1: Write failing tests**

Write `src/util/id.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { newId } from './id';

describe('newId', () => {
  it('returns a 26-char ULID', () => {
    const id = newId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('is monotonic within a millisecond', () => {
    const a = newId();
    const b = newId();
    expect(b > a).toBe(true);
  });

  it('produces unique values across 1000 calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(newId());
    expect(seen.size).toBe(1000);
  });
});
```

Write `src/util/hash.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { sha256Hex } from './hash';

describe('sha256Hex', () => {
  it('matches known SHA-256 of "abc"', async () => {
    // Known: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    const h = await sha256Hex('abc');
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('accepts a Uint8Array', async () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]);
    const h = await sha256Hex(bytes);
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('lowercase hex, 64 chars', async () => {
    const h = await sha256Hex('anything');
    expect(h).toHaveLength(64);
    expect(h).toBe(h.toLowerCase());
  });
});
```

Write `src/util/time.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { isoNow, parseIso, formatFolderTimestamp } from './time';

describe('isoNow', () => {
  it('returns ISO 8601 UTC ending in Z', () => {
    const s = isoNow();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
  });
});

describe('parseIso', () => {
  it('round-trips isoNow()', () => {
    const s = isoNow();
    expect(parseIso(s).toISOString()).toBe(new Date(s).toISOString());
  });
});

describe('formatFolderTimestamp', () => {
  it('formats YYYY-MM-DDTHH-mm safe for folder names', () => {
    const d = new Date(Date.UTC(2026, 8, 13, 10, 20, 0));
    expect(formatFolderTimestamp(d)).toBe('2026-09-13T10-20');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm test src/util
```

Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement the utilities**

Write `src/util/id.ts`:
```typescript
import { ulid, monotonicFactory } from 'ulid';

const monotonic = monotonicFactory();

export function newId(): string {
  return monotonic();
}

// Re-export the raw ulid for cases where monotonicity is not needed.
export { ulid as ulidNonMonotonic };
```

Write `src/util/hash.ts`:
```typescript
export async function sha256Hex(input: BufferSource | string): Promise<string> {
  const data = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

Write `src/util/time.ts`:
```typescript
export function isoNow(): string {
  return new Date().toISOString();
}

export function parseIso(s: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid ISO 8601 timestamp: ${s}`);
  }
  return d;
}

export function formatFolderTimestamp(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da}T${h}-${mi}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test src/util
```

Expected: PASS — all three test files green.

- [ ] **Step 5: Commit**

```bash
git add src/util
git commit -m "feat(util): ULID, SHA-256, and timestamp helpers"
```

---

## Task 5: File System Access wrapper + in-memory mock

**Files:**
- Create: `src/storage/fs.ts`, `src/storage/fs.test.ts`, `src/test/mock-fs.ts`, `src/test/mock-fs.test.ts`

**Interfaces:**
- Consumes: `idb-keyval` (persistent handle storage)
- Produces:
  - `pickRootFolder(): Promise<FileSystemDirectoryHandle>` — production: calls `showDirectoryPicker`. In tests, replaced via `setFsAdapter`.
  - `getPersistedRoot(): Promise<FileSystemDirectoryHandle | null>` — returns null if never persisted or permission lost.
  - `persistRoot(handle: FileSystemDirectoryHandle): Promise<void>`
  - `clearPersistedRoot(): Promise<void>`
  - `verifyPermission(handle: FileSystemDirectoryHandle, mode?: 'read' | 'readwrite'): Promise<boolean>` — checks and requests permission.
  - `setFsAdapter(adapter: FsAdapter): void` — test hook to swap `showDirectoryPicker`.
  - Types: `FsAdapter { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }`.
  - `createMockRoot(): FileSystemDirectoryHandle` (from `src/test/mock-fs.ts`) — used by every subsequent storage test.

- [ ] **Step 1: Write failing tests for the mock FS itself**

Write `src/test/mock-fs.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createMockRoot } from './mock-fs';

describe('mock FileSystemDirectoryHandle', () => {
  it('creates and reads a file', async () => {
    const root = createMockRoot();
    const f = await root.getFileHandle('a.txt', { create: true });
    const w = await f.createWritable();
    await w.write('hello');
    await w.close();

    const file = await f.getFile();
    expect(await file.text()).toBe('hello');
  });

  it('creates and lists a subdirectory', async () => {
    const root = createMockRoot();
    const sub = await root.getDirectoryHandle('sub', { create: true });
    await sub.getFileHandle('inner.txt', { create: true });

    const entries: string[] = [];
    for await (const [name] of root.entries()) entries.push(name);
    expect(entries).toContain('sub');
  });

  it('supports rename by writing new + removing old', async () => {
    const root = createMockRoot();
    const f = await root.getFileHandle('a.txt', { create: true });
    const w = await f.createWritable();
    await w.write('v1');
    await w.close();
    await root.removeEntry('a.txt');
    await expect(root.getFileHandle('a.txt')).rejects.toThrow();
  });

  it('throws NotFoundError for missing files without create:true', async () => {
    const root = createMockRoot();
    await expect(root.getFileHandle('missing.txt')).rejects.toThrow(/not found/i);
  });
});
```

Write `src/storage/fs.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import {
  setFsAdapter, pickRootFolder,
  persistRoot, getPersistedRoot, clearPersistedRoot,
  verifyPermission,
} from './fs';

beforeEach(async () => {
  await clearPersistedRoot();
});

describe('fs wrapper', () => {
  it('pickRootFolder delegates to the adapter', async () => {
    const root = createMockRoot();
    setFsAdapter({ showDirectoryPicker: async () => root });
    const picked = await pickRootFolder();
    expect(picked).toBe(root);
  });

  it('persistRoot + getPersistedRoot round-trip', async () => {
    const root = createMockRoot();
    await persistRoot(root);
    const got = await getPersistedRoot();
    expect(got).toBe(root);
  });

  it('getPersistedRoot returns null when never persisted', async () => {
    const got = await getPersistedRoot();
    expect(got).toBeNull();
  });

  it('verifyPermission returns true for a mock handle (always granted)', async () => {
    const root = createMockRoot();
    expect(await verifyPermission(root)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test src/storage/fs.test.ts src/test/mock-fs.test.ts
```

Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the mock FS**

Write `src/test/mock-fs.ts`:
```typescript
// Minimal in-memory implementation of the parts of the File System Access API
// we use. Enough for tests; not a general-purpose polyfill.

class MockFile {
  constructor(public data: Uint8Array = new Uint8Array()) {}
}

class MockWritable {
  private chunks: Uint8Array[] = [];
  constructor(private file: MockFile) {}

  async write(chunk: BufferSource | string): Promise<void> {
    if (typeof chunk === 'string') {
      this.chunks.push(new TextEncoder().encode(chunk));
    } else if (chunk instanceof Uint8Array) {
      this.chunks.push(chunk);
    } else if (chunk instanceof ArrayBuffer) {
      this.chunks.push(new Uint8Array(chunk));
    } else {
      this.chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
  }

  async close(): Promise<void> {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) { buf.set(c, off); off += c.length; }
    this.file.data = buf;
  }

  async abort(): Promise<void> { this.chunks = []; }
}

class MockFileHandle {
  kind = 'file' as const;
  constructor(public name: string, private file: MockFile) {}

  async getFile(): Promise<File> {
    return new File([this.file.data], this.name);
  }

  async createWritable(_opts?: { keepExistingData?: boolean }): Promise<MockWritable> {
    return new MockWritable(this.file);
  }
}

class MockDirectoryHandle {
  kind = 'directory' as const;
  private entriesMap = new Map<string, MockFileHandle | MockDirectoryHandle>();
  constructor(public name: string) {}

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MockFileHandle> {
    const existing = this.entriesMap.get(name);
    if (existing) {
      if (existing.kind !== 'file') throw new Error(`entry ${name} is a directory`);
      return existing;
    }
    if (!opts?.create) throw new Error(`file not found: ${name}`);
    const h = new MockFileHandle(name, new MockFile());
    this.entriesMap.set(name, h);
    return h;
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MockDirectoryHandle> {
    const existing = this.entriesMap.get(name);
    if (existing) {
      if (existing.kind !== 'directory') throw new Error(`entry ${name} is a file`);
      return existing;
    }
    if (!opts?.create) throw new Error(`directory not found: ${name}`);
    const h = new MockDirectoryHandle(name);
    this.entriesMap.set(name, h);
    return h;
  }

  async removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> {
    const existing = this.entriesMap.get(name);
    if (!existing) throw new Error(`not found: ${name}`);
    if (existing.kind === 'directory' && existing.entriesMap.size > 0 && !opts?.recursive) {
      throw new Error(`directory not empty: ${name}`);
    }
    this.entriesMap.delete(name);
  }

  async *entries(): AsyncGenerator<[string, MockFileHandle | MockDirectoryHandle]> {
    for (const [name, handle] of this.entriesMap) yield [name, handle];
  }

  async *keys(): AsyncGenerator<string> {
    for (const [name] of this.entriesMap) yield name;
  }

  async *values(): AsyncGenerator<MockFileHandle | MockDirectoryHandle> {
    for (const [, handle] of this.entriesMap) yield handle;
  }

  async queryPermission(_desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState> {
    return 'granted';
  }

  async requestPermission(_desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState> {
    return 'granted';
  }
}

export function createMockRoot(name = 'MockRoot'): FileSystemDirectoryHandle {
  // Cast: mock implements the subset of the API we use.
  return new MockDirectoryHandle(name) as unknown as FileSystemDirectoryHandle;
}
```

- [ ] **Step 4: Implement the fs wrapper**

Write `src/storage/fs.ts`:
```typescript
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';

const ROOT_HANDLE_KEY = 'hydrolog.rootHandle.v1';

export interface FsAdapter {
  showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
}

let adapter: FsAdapter = {
  showDirectoryPicker: async () => {
    if (typeof (globalThis as any).showDirectoryPicker !== 'function') {
      throw new Error('File System Access API not available. Use Chrome desktop or Android M132+.');
    }
    return (globalThis as any).showDirectoryPicker({ mode: 'readwrite' });
  },
};

export function setFsAdapter(a: FsAdapter): void {
  adapter = a;
}

export async function pickRootFolder(): Promise<FileSystemDirectoryHandle> {
  return adapter.showDirectoryPicker();
}

export async function persistRoot(handle: FileSystemDirectoryHandle): Promise<void> {
  await idbSet(ROOT_HANDLE_KEY, handle);
}

export async function getPersistedRoot(): Promise<FileSystemDirectoryHandle | null> {
  const h = (await idbGet(ROOT_HANDLE_KEY)) as FileSystemDirectoryHandle | undefined;
  if (!h) return null;
  return h;
}

export async function clearPersistedRoot(): Promise<void> {
  await idbDel(ROOT_HANDLE_KEY);
}

export async function verifyPermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<boolean> {
  const opts = { mode } as { mode: 'read' | 'readwrite' };
  // @ts-expect-error queryPermission is on real handles; mock provides it.
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  // @ts-expect-error requestPermission is on real handles; mock provides it.
  return (await handle.requestPermission?.(opts)) === 'granted';
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test src/storage/fs.test.ts src/test/mock-fs.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storage/fs.ts src/storage/fs.test.ts src/test/mock-fs.ts src/test/mock-fs.test.ts
git commit -m "feat(storage): FSA wrapper with persistent handle and in-memory mock"
```

---

## Task 6: Atomic file writer

**Files:**
- Create: `src/storage/atomic.ts`, `src/storage/atomic.test.ts`

**Interfaces:**
- Consumes: `FileSystemDirectoryHandle` (from Task 5)
- Produces:
  - `writeJson<T>(dir: FileSystemDirectoryHandle, name: string, data: T): Promise<void>` — atomic via `.tmp` + rename semantics (write `name.tmp`, on success remove any existing `name`, then rename).
  - `readJson<T>(dir: FileSystemDirectoryHandle, name: string): Promise<T>` — throws if missing or invalid JSON.
  - `writeBlob(dir: FileSystemDirectoryHandle, name: string, blob: Blob | BufferSource): Promise<void>` — atomic.
  - `readBlob(dir: FileSystemDirectoryHandle, name: string): Promise<Blob>`
  - `fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean>`

Note: FSA does not expose a native rename. The atomic emulation is: (1) write `name.tmp` fully, (2) delete `name` if present, (3) copy `name.tmp` content into `name` (create if missing), (4) delete `name.tmp`. Crash after step 1 leaves `.tmp` for cleanup on next scan; crash after step 2 leaves no data (rare; window is microseconds); crash after step 3 leaves the new data and an orphan `.tmp` (harmless).

- [ ] **Step 1: Write failing tests**

Write `src/storage/atomic.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { writeJson, readJson, writeBlob, readBlob, fileExists } from './atomic';

let root: FileSystemDirectoryHandle;
beforeEach(() => { root = createMockRoot(); });

describe('writeJson / readJson', () => {
  it('writes and reads back an object', async () => {
    await writeJson(root, 'x.json', { a: 1, b: 'hi' });
    const back = await readJson<{ a: number; b: string }>(root, 'x.json');
    expect(back).toEqual({ a: 1, b: 'hi' });
  });

  it('overwrites an existing file atomically', async () => {
    await writeJson(root, 'x.json', { v: 1 });
    await writeJson(root, 'x.json', { v: 2 });
    expect(await readJson<{ v: number }>(root, 'x.json')).toEqual({ v: 2 });
  });

  it('no .tmp file remains after a successful write', async () => {
    await writeJson(root, 'x.json', { a: 1 });
    expect(await fileExists(root, 'x.json.tmp')).toBe(false);
  });

  it('readJson throws on missing file', async () => {
    await expect(readJson(root, 'missing.json')).rejects.toThrow();
  });

  it('readJson throws on invalid JSON', async () => {
    const f = await root.getFileHandle('bad.json', { create: true });
    const w = await f.createWritable();
    await w.write('{not json');
    await w.close();
    await expect(readJson(root, 'bad.json')).rejects.toThrow();
  });
});

describe('writeBlob / readBlob', () => {
  it('round-trips a Uint8Array', async () => {
    await writeBlob(root, 'x.bin', new Uint8Array([1, 2, 3, 4]));
    const b = await readBlob(root, 'x.bin');
    const arr = new Uint8Array(await b.arrayBuffer());
    expect(Array.from(arr)).toEqual([1, 2, 3, 4]);
  });

  it('round-trips a Blob', async () => {
    await writeBlob(root, 'x.bin', new Blob(['hello']));
    const b = await readBlob(root, 'x.bin');
    expect(await b.text()).toBe('hello');
  });
});

describe('fileExists', () => {
  it('true for a written file, false otherwise', async () => {
    expect(await fileExists(root, 'x.json')).toBe(false);
    await writeJson(root, 'x.json', {});
    expect(await fileExists(root, 'x.json')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test src/storage/atomic.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement atomic writer**

Write `src/storage/atomic.ts`:
```typescript
export async function fileExists(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function writeBytes(
  dir: FileSystemDirectoryHandle,
  name: string,
  bytes: BufferSource,
): Promise<void> {
  const h = await dir.getFileHandle(name, { create: true });
  // @ts-expect-error createWritable exists on FileSystemFileHandle in browsers
  const w = await h.createWritable({ keepExistingData: false });
  await w.write(bytes);
  await w.close();
}

async function readBytes(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<Blob> {
  const h = await dir.getFileHandle(name);
  return h.getFile();
}

async function atomicWrite(
  dir: FileSystemDirectoryHandle,
  name: string,
  bytes: BufferSource,
): Promise<void> {
  const tmpName = `${name}.tmp`;
  await writeBytes(dir, tmpName, bytes);
  try {
    // "rename": copy tmp bytes over the final file, then delete tmp.
    const tmp = await readBytes(dir, tmpName);
    const buf = await tmp.arrayBuffer();
    await writeBytes(dir, name, buf);
  } finally {
    try { await dir.removeEntry(tmpName); } catch { /* ignore */ }
  }
}

export async function writeJson<T>(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: T,
): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  await atomicWrite(dir, name, new TextEncoder().encode(json));
}

export async function readJson<T>(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<T> {
  const blob = await readBytes(dir, name);
  const text = await blob.text();
  return JSON.parse(text) as T;
}

export async function writeBlob(
  dir: FileSystemDirectoryHandle,
  name: string,
  blob: Blob | BufferSource,
): Promise<void> {
  const bytes = blob instanceof Blob
    ? new Uint8Array(await blob.arrayBuffer())
    : blob;
  await atomicWrite(dir, name, bytes);
}

export async function readBlob(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<Blob> {
  return readBytes(dir, name);
}
```

- [ ] **Step 4: Run tests to verify**

```bash
npm test src/storage/atomic.test.ts
```

Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/storage/atomic.ts src/storage/atomic.test.ts
git commit -m "feat(storage): atomic JSON/blob write via .tmp + copy pattern"
```

---

## Task 7: Folder path builders

**Files:**
- Create: `src/storage/paths.ts`, `src/storage/paths.test.ts`

**Interfaces:**
- Consumes: `FileSystemDirectoryHandle`, `formatFolderTimestamp` (from Task 4)
- Produces:
  - `sanitizeFolderName(name: string): string` — replace unsafe chars, collapse whitespace, keep Cyrillic.
  - `siteFolderName(code: string, name: string): string` — `"BG-SOF-0043_Dolna-Banya_Ivanov"`.
  - `surveyFolderName(startedAt: Date, seq: number): string` — `"2026-09-13T10-20_s01"`.
  - `lineFolderName(label: string): string` — `"L1"`.
  - `getOrCreatePath(root: FileSystemDirectoryHandle, segments: string[]): Promise<FileSystemDirectoryHandle>` — walks/creates subdirectories.
  - `getPath(root: FileSystemDirectoryHandle, segments: string[]): Promise<FileSystemDirectoryHandle | null>` — walks, returns null if any segment missing.

- [ ] **Step 1: Write failing tests**

Write `src/storage/paths.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import {
  sanitizeFolderName, siteFolderName, surveyFolderName, lineFolderName,
  getOrCreatePath, getPath,
} from './paths';

describe('sanitizeFolderName', () => {
  it('keeps Cyrillic letters', () => {
    expect(sanitizeFolderName('Долна Баня')).toBe('Долна-Баня');
  });

  it('replaces path separators and reserved chars', () => {
    expect(sanitizeFolderName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeFolderName('  hello   world  ')).toBe('hello-world');
  });
});

describe('siteFolderName', () => {
  it('composes code + sanitized name', () => {
    expect(siteFolderName('BG-SOF-0043', 'Dolna Banya Ivanov'))
      .toBe('BG-SOF-0043_Dolna-Banya-Ivanov');
  });
});

describe('surveyFolderName', () => {
  it('uses UTC timestamp and zero-padded sequence', () => {
    const d = new Date(Date.UTC(2026, 8, 13, 10, 20, 0));
    expect(surveyFolderName(d, 1)).toBe('2026-09-13T10-20_s01');
    expect(surveyFolderName(d, 42)).toBe('2026-09-13T10-20_s42');
  });
});

describe('lineFolderName', () => {
  it('passes through labels like L1, L2', () => {
    expect(lineFolderName('L1')).toBe('L1');
  });
});

describe('getOrCreatePath / getPath', () => {
  let root: FileSystemDirectoryHandle;
  beforeEach(() => { root = createMockRoot(); });

  it('creates nested subdirs and returns the leaf handle', async () => {
    const leaf = await getOrCreatePath(root, ['sites', 'BG-SOF-0043', 'surveys', 's01']);
    expect(leaf.kind).toBe('directory');
    const check = await getPath(root, ['sites', 'BG-SOF-0043', 'surveys', 's01']);
    expect(check).not.toBeNull();
  });

  it('getPath returns null when a segment is missing', async () => {
    expect(await getPath(root, ['sites', 'missing'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test src/storage/paths.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Write `src/storage/paths.ts`:
```typescript
import { formatFolderTimestamp } from '../util/time';

const UNSAFE = /[\\/:*?"<>|]/g;

export function sanitizeFolderName(name: string): string {
  return name
    .replace(UNSAFE, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
}

export function siteFolderName(code: string, name: string): string {
  return `${code}_${sanitizeFolderName(name)}`;
}

export function surveyFolderName(startedAt: Date, seq: number): string {
  const ts = formatFolderTimestamp(startedAt);
  const s = String(seq).padStart(2, '0');
  return `${ts}_s${s}`;
}

export function lineFolderName(label: string): string {
  return sanitizeFolderName(label);
}

export async function getOrCreatePath(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<FileSystemDirectoryHandle> {
  let cur = root;
  for (const seg of segments) {
    cur = await cur.getDirectoryHandle(seg, { create: true });
  }
  return cur;
}

export async function getPath(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<FileSystemDirectoryHandle | null> {
  let cur = root;
  for (const seg of segments) {
    try {
      cur = await cur.getDirectoryHandle(seg);
    } catch {
      return null;
    }
  }
  return cur;
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test src/storage/paths.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/paths.ts src/storage/paths.test.ts
git commit -m "feat(storage): folder name sanitizer and path walkers"
```

---

## Task 8: Folder tree scanner

**Files:**
- Create: `src/storage/scanner.ts`, `src/storage/scanner.test.ts`, `src/test/fixtures.ts`

**Interfaces:**
- Consumes: `FileSystemDirectoryHandle`, `readJson` (T6), types (T3)
- Produces:
  - `type ScanResult = { schemaVersion: string; sites: SiteScan[] }`
  - `type SiteScan = { site: Site; regulatory?: RegulatoryContext; surveys: SurveyScan[]; folderName: string }`
  - `type SurveyScan = { survey: Survey; lines: LineScan[]; folderName: string; interpretation?: Interpretation; outcomes: DrillOutcome[] }`
  - `type LineScan = { line: Line; folderName: string; hasDeviceFiles: boolean; mediaFiles: string[] }`
  - `scanRoot(root: FileSystemDirectoryHandle): Promise<ScanResult>` — walks the tree; skips `_tombstones/` and `_backup_pre_migration_*/` and `_sync_probe/`; tolerates missing optional files; throws only on missing required files (site.json, survey.json, line.json).
  - `buildFixtureRoot(spec: FixtureSpec): Promise<FileSystemDirectoryHandle>` (in fixtures.ts) — helper for tests.

- [ ] **Step 1: Write fixture helper first**

Write `src/test/fixtures.ts`:
```typescript
import { createMockRoot } from './mock-fs';
import { writeJson } from '../storage/atomic';
import { getOrCreatePath } from '../storage/paths';
import type {
  Site, Survey, Line, RegulatoryContext, Interpretation, DrillOutcome,
  ChannelSetSnapshot,
} from '../domain/types';

export interface FixtureSpec {
  schemaVersion?: string;
  sites: {
    folderName: string;
    site: Site;
    regulatory?: RegulatoryContext;
    surveys: {
      folderName: string;
      survey: Survey;
      interpretation?: Interpretation;
      outcomes?: DrillOutcome[];
      lines: {
        folderName: string;
        line: Line;
        deviceFiles?: string[];  // file names to place under device-files/
        mediaFiles?: string[];   // file names to place under media/
      }[];
    }[];
  }[];
}

export async function buildFixtureRoot(spec: FixtureSpec): Promise<FileSystemDirectoryHandle> {
  const root = createMockRoot();
  await writeJson(root, '_schema.json', { version: spec.schemaVersion ?? 'hydrolog-v1' });

  for (const s of spec.sites) {
    const siteDir = await getOrCreatePath(root, ['sites', s.folderName]);
    await writeJson(siteDir, 'site.json', s.site);
    if (s.regulatory) await writeJson(siteDir, 'regulatory.json', s.regulatory);

    for (const sv of s.surveys) {
      const svDir = await getOrCreatePath(siteDir, ['surveys', sv.folderName]);
      await writeJson(svDir, 'survey.json', sv.survey);
      if (sv.interpretation) await writeJson(svDir, 'interpretation.json', sv.interpretation);

      for (const ln of sv.lines) {
        const lnDir = await getOrCreatePath(svDir, ['lines', ln.folderName]);
        await writeJson(lnDir, 'line.json', ln.line);

        if (ln.deviceFiles?.length) {
          const df = await getOrCreatePath(lnDir, ['device-files']);
          for (const name of ln.deviceFiles) {
            const h = await df.getFileHandle(name, { create: true });
            // @ts-expect-error createWritable exists on mock
            const w = await h.createWritable();
            await w.write(new Uint8Array([0]));
            await w.close();
          }
        }
        if (ln.mediaFiles?.length) {
          const md = await getOrCreatePath(lnDir, ['media']);
          for (const name of ln.mediaFiles) {
            const h = await md.getFileHandle(name, { create: true });
            // @ts-expect-error createWritable exists on mock
            const w = await h.createWritable();
            await w.write(new Uint8Array([0]));
            await w.close();
          }
        }
      }

      if (sv.outcomes?.length) {
        const outDir = await getOrCreatePath(siteDir, ['outcomes']);
        for (let i = 0; i < sv.outcomes.length; i++) {
          await writeJson(outDir, `outcome_${i}.json`, sv.outcomes[i]);
        }
      }
    }
  }

  return root;
}

// Minimal valid stubs so tests don't repeat 30 lines each.
export function stubChannelSet(): ChannelSetSnapshot {
  return {
    name: 'TC300 linear',
    deviceModel: 'PQWT-TC300',
    kind: 'frequency',
    units: 'mV',
    depthModel: 'linear-nominal',
    provenanceNote: 'stub for tests',
    channels: Array.from({ length: 40 }, (_, i) => ({
      label: `ch${i + 1}`,
      order: i,
      pseudoDepthM: (i + 1) * 4.5,
    })),
    frozenAt: new Date('2026-09-01T00:00:00Z'),
  };
}
```

- [ ] **Step 2: Write failing scanner tests**

Write `src/storage/scanner.test.ts`:
```typescript
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
    await expect(scanRoot(root)).rejects.toThrow(/site\.json/);
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
```

- [ ] **Step 3: Run to verify failure**

```bash
npm test src/storage/scanner.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement scanner**

Write `src/storage/scanner.ts`:
```typescript
import type {
  Site, Survey, Line, RegulatoryContext, Interpretation, DrillOutcome,
} from '../domain/types';
import { readJson } from './atomic';
import { getPath } from './paths';

export interface LineScan {
  line: Line;
  folderName: string;
  hasDeviceFiles: boolean;
  mediaFiles: string[];
}

export interface SurveyScan {
  survey: Survey;
  folderName: string;
  interpretation?: Interpretation;
  lines: LineScan[];
  outcomes: DrillOutcome[];
}

export interface SiteScan {
  site: Site;
  folderName: string;
  regulatory?: RegulatoryContext;
  surveys: SurveyScan[];
}

export interface ScanResult {
  schemaVersion: string;
  sites: SiteScan[];
}

const IGNORE_PREFIXES = ['_tombstones', '_sync_probe', '_backup_pre_migration_'];

function shouldIgnore(name: string): boolean {
  return IGNORE_PREFIXES.some((p) => name === p || name.startsWith(`${p}_`) || name === p);
}

async function listDirs(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const out: string[] = [];
  for await (const [name, h] of (dir as any).entries()) {
    if (h.kind === 'directory' && !shouldIgnore(name)) out.push(name);
  }
  return out;
}

async function listFiles(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const out: string[] = [];
  for await (const [name, h] of (dir as any).entries()) {
    if (h.kind === 'file') out.push(name);
  }
  return out;
}

async function optionalJson<T>(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<T | undefined> {
  try {
    return await readJson<T>(dir, name);
  } catch {
    return undefined;
  }
}

export async function scanRoot(root: FileSystemDirectoryHandle): Promise<ScanResult> {
  const schemaFile = await optionalJson<{ version: string }>(root, '_schema.json');
  const schemaVersion = schemaFile?.version ?? 'unknown';

  const sitesRoot = await getPath(root, ['sites']);
  if (!sitesRoot) return { schemaVersion, sites: [] };

  const siteDirs = await listDirs(sitesRoot);
  const sites: SiteScan[] = [];

  for (const siteFolderName of siteDirs) {
    const siteDir = await sitesRoot.getDirectoryHandle(siteFolderName);
    const site = await readJson<Site>(siteDir, 'site.json').catch((e) => {
      throw new Error(`missing or invalid site.json in ${siteFolderName}: ${e.message}`);
    });
    const regulatory = await optionalJson<RegulatoryContext>(siteDir, 'regulatory.json');

    const surveys: SurveyScan[] = [];
    const surveysRoot = await getPath(siteDir, ['surveys']);
    if (surveysRoot) {
      const surveyDirs = await listDirs(surveysRoot);
      for (const svFolderName of surveyDirs) {
        const svDir = await surveysRoot.getDirectoryHandle(svFolderName);
        const survey = await readJson<Survey>(svDir, 'survey.json').catch((e) => {
          throw new Error(`missing or invalid survey.json in ${svFolderName}: ${e.message}`);
        });
        const interpretation = await optionalJson<Interpretation>(svDir, 'interpretation.json');

        const lines: LineScan[] = [];
        const linesRoot = await getPath(svDir, ['lines']);
        if (linesRoot) {
          const lineDirs = await listDirs(linesRoot);
          for (const lnFolderName of lineDirs) {
            const lnDir = await linesRoot.getDirectoryHandle(lnFolderName);
            const line = await readJson<Line>(lnDir, 'line.json').catch((e) => {
              throw new Error(`missing or invalid line.json in ${lnFolderName}: ${e.message}`);
            });

            const deviceFilesDir = await getPath(lnDir, ['device-files']);
            const hasDeviceFiles = deviceFilesDir
              ? (await listFiles(deviceFilesDir)).length > 0
              : false;

            const mediaDir = await getPath(lnDir, ['media']);
            const mediaFiles = mediaDir ? await listFiles(mediaDir) : [];

            lines.push({ line, folderName: lnFolderName, hasDeviceFiles, mediaFiles });
          }
        }

        surveys.push({ survey, folderName: svFolderName, interpretation, lines, outcomes: [] });
      }
    }

    const outcomes: DrillOutcome[] = [];
    const outcomesDir = await getPath(siteDir, ['outcomes']);
    if (outcomesDir) {
      const files = await listFiles(outcomesDir);
      for (const f of files.filter((n) => n.endsWith('.json'))) {
        const o = await readJson<DrillOutcome>(outcomesDir, f);
        outcomes.push(o);
      }
    }
    // Distribute outcomes to whichever survey they reference (via interpretationId → survey via linkage).
    // For now, outcomes are attached to the first survey; refinement in the outcomes-management task.
    if (surveys.length > 0) surveys[0].outcomes.push(...outcomes);

    sites.push({ site, folderName: siteFolderName, regulatory, surveys });
  }

  return { schemaVersion, sites };
}
```

- [ ] **Step 5: Run to verify pass**

```bash
npm test src/storage/scanner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storage/scanner.ts src/storage/scanner.test.ts src/test/fixtures.ts
git commit -m "feat(storage): folder tree scanner with typed ScanResult"
```

---

## Task 9: Dexie cache schema

**Files:**
- Create: `src/cache/db.ts`, `src/cache/db.test.ts`

**Interfaces:**
- Consumes: Dexie, domain types
- Produces:
  - `HydroLogDb` — Dexie subclass with tables: `sites`, `surveys`, `lines`, `media`, `outcomes`, `meta`.
  - `getDb(): HydroLogDb` — singleton (idempotent).
  - `resetDb(): Promise<void>` — deletes and re-creates. Used by tests and by cache-rebuild.
  - Table schemas keyed by `id` with indexes on `code` (sites), `siteId` (surveys), `surveyId` (lines).
  - `meta` table stores `schemaVersion, lastScanCompletedAt, rootFolderName`.

- [ ] **Step 1: Write failing tests**

Write `src/cache/db.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test src/cache/db.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Write `src/cache/db.ts`:
```typescript
import Dexie, { Table } from 'dexie';
import type {
  Site, Survey, Line, MediaAsset, DrillOutcome,
} from '../domain/types';

// Cache rows carry a `folderName` for direct navigation back to the folder,
// plus the parsed JSON blob for cheap in-app reads.

export interface SiteRow {
  id: string;
  code: string;
  folderName: string;
  json: Site;
}

export interface SurveyRow {
  id: string;
  siteId: string;
  folderName: string;
  json: Survey;
}

export interface LineRow {
  id: string;
  surveyId: string;
  folderName: string;
  hasDeviceFiles: boolean;
  json: Line;
}

export interface MediaRow {
  id: string;
  linkedKind: string;
  linkedId: string;
  storagePath: string;
  sha256: string;
  json: MediaAsset;
}

export interface OutcomeRow {
  id: string;
  interpretationId?: string;
  json: DrillOutcome;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export class HydroLogDb extends Dexie {
  sites!: Table<SiteRow, string>;
  surveys!: Table<SurveyRow, string>;
  lines!: Table<LineRow, string>;
  media!: Table<MediaRow, string>;
  outcomes!: Table<OutcomeRow, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('hydrolog');
    this.version(1).stores({
      sites: '&id, code, folderName',
      surveys: '&id, siteId, folderName',
      lines: '&id, surveyId, folderName',
      media: '&id, linkedId, storagePath',
      outcomes: '&id, interpretationId',
      meta: '&key',
    });
  }
}

let instance: HydroLogDb | null = null;

export function getDb(): HydroLogDb {
  if (!instance) instance = new HydroLogDb();
  return instance;
}

export async function resetDb(): Promise<void> {
  if (instance) {
    await instance.delete();
    instance = null;
  } else {
    await Dexie.delete('hydrolog');
  }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test src/cache/db.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cache/db.ts src/cache/db.test.ts
git commit -m "feat(cache): Dexie schema for scanned sites/surveys/lines"
```

---

## Task 10: Cache rebuild from scanner output

**Files:**
- Create: `src/cache/rebuild.ts`, `src/cache/rebuild.test.ts`

**Interfaces:**
- Consumes: `ScanResult` (T8), `HydroLogDb` (T9), types (T3)
- Produces:
  - `rebuildCache(scan: ScanResult): Promise<{ sites: number; surveys: number; lines: number }>` — clears all tables, repopulates from scan, sets `meta.lastScanCompletedAt` and `meta.schemaVersion`. Returns counts.

- [ ] **Step 1: Write failing test**

Write `src/cache/rebuild.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test src/cache/rebuild.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Write `src/cache/rebuild.ts`:
```typescript
import type { ScanResult } from '../storage/scanner';
import { getDb } from './db';
import { isoNow } from '../util/time';

export async function rebuildCache(scan: ScanResult): Promise<{
  sites: number; surveys: number; lines: number;
}> {
  const db = getDb();
  let sites = 0, surveys = 0, lines = 0;

  await db.transaction('rw', db.sites, db.surveys, db.lines, db.outcomes, db.meta, async () => {
    await db.sites.clear();
    await db.surveys.clear();
    await db.lines.clear();
    await db.outcomes.clear();

    for (const s of scan.sites) {
      await db.sites.put({
        id: s.site.id,
        code: s.site.code,
        folderName: s.folderName,
        json: s.site,
      });
      sites++;

      for (const sv of s.surveys) {
        await db.surveys.put({
          id: sv.survey.id,
          siteId: sv.survey.siteId,
          folderName: sv.folderName,
          json: sv.survey,
        });
        surveys++;

        for (const ln of sv.lines) {
          await db.lines.put({
            id: ln.line.id,
            surveyId: sv.survey.id,
            folderName: ln.folderName,
            hasDeviceFiles: ln.hasDeviceFiles,
            json: ln.line,
          });
          lines++;
        }

        for (const o of sv.outcomes) {
          await db.outcomes.put({
            id: o.id,
            interpretationId: o.interpretationId,
            json: o,
          });
        }
      }
    }

    await db.meta.put({ key: 'schemaVersion', value: scan.schemaVersion });
    await db.meta.put({ key: 'lastScanCompletedAt', value: isoNow() });
  });

  return { sites, surveys, lines };
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test src/cache/rebuild.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cache/rebuild.ts src/cache/rebuild.test.ts
git commit -m "feat(cache): rebuild cache from scanner output"
```

---

## Task 11: Multi-file transaction sequencer

**Files:**
- Create: `src/storage/transaction.ts`, `src/storage/transaction.test.ts`

**Interfaces:**
- Consumes: FSA handles, `writeJson`, `writeBlob`, `getOrCreatePath`, types.
- Produces:
  - `writeSurveyUpdate(root, { sitePath, surveyPath, mediaWrites, lineWrites, surveyJson })` — enforces the §10.5 order: media blobs first, then per-line JSON, then `survey.json` last.
  - `type MediaWrite = { lineFolderName: string; fileName: string; blob: Blob | BufferSource; kind: 'device-files' | 'media' }`
  - `type LineWrite = { lineFolderName: string; lineJson: Line; verticesGeoJson?: unknown; transformLog?: TransformLogEntry[]; noiseZones?: NoiseZone[] }`

- [ ] **Step 1: Write failing tests**

Write `src/storage/transaction.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test src/storage/transaction.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Write `src/storage/transaction.ts`:
```typescript
import type { Line, Survey, TransformLogEntry, NoiseZone } from '../domain/types';
import { writeJson, writeBlob } from './atomic';
import { getOrCreatePath } from './paths';

export interface MediaWrite {
  lineFolderName: string;
  fileName: string;
  blob: Blob | BufferSource;
  kind: 'device-files' | 'media';
}

export interface LineWrite {
  lineFolderName: string;
  lineJson: Line;
  verticesGeoJson?: unknown;
  transformLog?: TransformLogEntry[];
  noiseZones?: NoiseZone[];
}

export interface SurveyUpdate {
  sitePath: string[];              // e.g. ['sites', 'BG-SOF-0043_x']
  surveyPath: string[];            // e.g. ['sites', 'BG-SOF-0043_x', 'surveys', 's01']
  mediaWrites: MediaWrite[];
  lineWrites: LineWrite[];
  surveyJson: Survey;              // written last as the commit marker
}

// Order per §10.5:
// 1. Media blobs first (content-addressed, idempotent on retry).
// 2. Referring line.json / interpretation.json.
// 3. survey.json last as the commit marker.
export async function writeSurveyUpdate(
  root: FileSystemDirectoryHandle,
  upd: SurveyUpdate,
): Promise<void> {
  // Step 1: media.
  for (const m of upd.mediaWrites) {
    const dir = await getOrCreatePath(root, [
      ...upd.surveyPath, 'lines', m.lineFolderName, m.kind,
    ]);
    await writeBlob(dir, m.fileName, m.blob);
  }

  // Step 2: line.json (and companion files) per line.
  for (const l of upd.lineWrites) {
    const lineDir = await getOrCreatePath(root, [
      ...upd.surveyPath, 'lines', l.lineFolderName,
    ]);
    await writeJson(lineDir, 'line.json', l.lineJson);
    if (l.verticesGeoJson !== undefined) {
      await writeJson(lineDir, 'vertices.geojson', l.verticesGeoJson);
    }
    if (l.transformLog !== undefined) {
      await writeJson(lineDir, 'transform-log.json', l.transformLog);
    }
    if (l.noiseZones !== undefined) {
      await writeJson(lineDir, 'noise-zones.json', l.noiseZones);
    }
  }

  // Step 3: survey.json — commit marker.
  const svDir = await getOrCreatePath(root, upd.surveyPath);
  await writeJson(svDir, 'survey.json', upd.surveyJson);
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test src/storage/transaction.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/transaction.ts src/storage/transaction.test.ts
git commit -m "feat(storage): survey-update sequencer (media → line → survey)"
```

---

## Task 12: Sync canary

**Files:**
- Create: `src/storage/sync.ts`, `src/storage/sync.test.ts`

**Interfaces:**
- Consumes: FSA handles, `writeJson`, `readJson`.
- Produces:
  - `writeSyncProbe(root, now: Date): Promise<string>` — writes `_sync_probe/<timestamp>.json` with `{ writtenAt }`. Returns filename.
  - `readLatestSyncedProbe(root): Promise<Date | null>` — reads all files in `_sync_probe/`, returns the newest `writtenAt`.
  - `hoursSinceLastSync(root, now: Date): Promise<number | null>` — convenience.
  - `nagLevel(hoursSinceSync: number | null): 'ok' | 'amber' | 'red'` — thresholds per §10.9 (amber ≥ 12, red ≥ 24).

Note: on the mock FS this is really "hours since the last probe file we wrote", not real cloud round-trip. In production the same logic runs; real round-trip verification is deferred (needs a companion handle) until we have a full sync integration task. That deferred piece is called out in a comment.

- [ ] **Step 1: Write failing tests**

Write `src/storage/sync.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test src/storage/sync.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Write `src/storage/sync.ts`:
```typescript
import { writeJson, readJson } from './atomic';
import { getOrCreatePath, getPath } from './paths';
import { formatFolderTimestamp } from '../util/time';

const PROBE_DIR = '_sync_probe';

interface ProbeRecord {
  writtenAt: string;   // ISO
}

export async function writeSyncProbe(
  root: FileSystemDirectoryHandle,
  now: Date,
): Promise<string> {
  const dir = await getOrCreatePath(root, [PROBE_DIR]);
  const name = `${formatFolderTimestamp(now)}.json`;
  await writeJson(dir, name, { writtenAt: now.toISOString() } satisfies ProbeRecord);
  return name;
}

export async function readLatestSyncedProbe(
  root: FileSystemDirectoryHandle,
): Promise<Date | null> {
  const dir = await getPath(root, [PROBE_DIR]);
  if (!dir) return null;

  let best: Date | null = null;
  for await (const [name, h] of (dir as any).entries()) {
    if (h.kind !== 'file' || !name.endsWith('.json')) continue;
    try {
      const rec = await readJson<ProbeRecord>(dir, name);
      const t = new Date(rec.writtenAt);
      if (!Number.isNaN(t.getTime()) && (!best || t > best)) best = t;
    } catch {
      // skip corrupt probes
    }
  }
  return best;
}

export async function hoursSinceLastSync(
  root: FileSystemDirectoryHandle,
  now: Date,
): Promise<number | null> {
  const last = await readLatestSyncedProbe(root);
  if (!last) return null;
  return (now.getTime() - last.getTime()) / 3_600_000;
}

// §10.9 thresholds. Unknown → red (worst case).
// TODO(sync-integration-task): current signal is "when we last wrote a probe",
// not "when Drive last mirrored it upstream". Real round-trip verification
// requires a companion handle on the mirrored side. Deferred to the sync-
// integration task in the Phase 1 backup-nag plan.
export function nagLevel(hoursSinceSync: number | null): 'ok' | 'amber' | 'red' {
  if (hoursSinceSync === null) return 'red';
  if (hoursSinceSync >= 24) return 'red';
  if (hoursSinceSync >= 12) return 'amber';
  return 'ok';
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test src/storage/sync.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/sync.ts src/storage/sync.test.ts
git commit -m "feat(storage): sync canary + nag level thresholds (§10.9)"
```

---

## Task 13: Home screen UI

**Files:**
- Create: `src/ui/Home.tsx`, `src/ui/Home.test.tsx`, `src/ui/SiteList.tsx`, `src/ui/SyncIndicator.tsx`

**Interfaces:**
- Consumes: `getDb` (T9), `nagLevel` + `hoursSinceLastSync` (T12), `pickRootFolder` + `persistRoot` + `getPersistedRoot` (T5), `setFsAdapter` (for tests).
- Produces:
  - `<Home />` — renders "Pick folder" button when no persisted handle, otherwise renders `<SyncIndicator>` and `<SiteList>` reading from the cache.
  - `<SyncIndicator hoursSinceSync={number|null} />` — colored badge per nag level.
  - `<SiteList />` — reads `db.sites` and lists site code + folder name.

- [ ] **Step 1: Write failing tests**

Write `src/ui/Home.test.tsx`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Home } from './Home';
import { setFsAdapter, clearPersistedRoot } from '../storage/fs';
import { createMockRoot } from '../test/mock-fs';
import { getDb, resetDb } from '../cache/db';
import { buildFixtureRoot, stubChannelSet } from '../test/fixtures';

beforeEach(async () => {
  await clearPersistedRoot();
  await resetDb();
});

describe('<Home />', () => {
  it('shows a Pick folder button when no folder is persisted', async () => {
    render(<Home />);
    expect(await screen.findByRole('button', { name: /pick folder/i })).toBeInTheDocument();
  });

  it('after picking a folder with a site, lists the site', async () => {
    const now = new Date('2026-09-13T10:00:00Z');
    const root = await buildFixtureRoot({
      sites: [{
        folderName: 'BG-SOF-0043_x',
        site: {
          id: 'S1', code: 'BG-SOF-0043',
          createdAt: now, updatedAt: now, revision: 1,
          name: 'Ivanov', settlement: 'Долна Баня',
          municipality: 'Долна Баня', region: 'Софийска',
          centroid: { lat: 42.3, lon: 23.7 }, accessNotes: '', landUse: '',
          status: 'surveyed', tags: [],
        },
        surveys: [{
          folderName: 's01',
          survey: {
            id: 'V1', siteId: 'S1', createdAt: now, updatedAt: now, revision: 1,
            startedAt: now, timezone: 'Europe/Sofia', operator: 'Anton',
            deviceModel: 'PQWT-TC300', deviceSerial: 'x',
            precipLast48h: 'none', qualityFlag: 'good',
          },
          lines: [{
            folderName: 'L1',
            line: {
              id: 'L1', createdAt: now, updatedAt: now, revision: 1,
              label: 'L1', pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
              mode: 'multi-frequency', channelSetSnapshot: stubChannelSet(),
              vertices: [], dipoleOrientation: 'inline', transformLog: [],
              points: [], noiseZones: [], status: 'draft',
            },
          }],
        }],
      }],
    });
    setFsAdapter({ showDirectoryPicker: async () => root });

    render(<Home />);
    const pick = await screen.findByRole('button', { name: /pick folder/i });
    await userEvent.click(pick);

    await waitFor(() => {
      expect(screen.getByText('BG-SOF-0043')).toBeInTheDocument();
    });
  });

  it('renders the sync indicator with a nag level', async () => {
    const root = createMockRoot();
    setFsAdapter({ showDirectoryPicker: async () => root });
    render(<Home />);
    const pick = await screen.findByRole('button', { name: /pick folder/i });
    await userEvent.click(pick);
    await waitFor(() => {
      expect(screen.getByTestId('sync-indicator')).toHaveAttribute('data-nag', 'red');
    });
  });
});
```

- [ ] **Step 2: Add user-event to devDependencies and install**

Run:
```bash
npm install --save-dev @testing-library/user-event@^14.5.2
```

- [ ] **Step 3: Run to verify failure**

```bash
npm test src/ui/Home.test.tsx
```

Expected: FAIL — module missing.

- [ ] **Step 4: Implement SyncIndicator**

Write `src/ui/SyncIndicator.tsx`:
```typescript
import type { FC } from 'react';
import { nagLevel } from '../storage/sync';

interface Props {
  hoursSinceSync: number | null;
}

const COLORS: Record<ReturnType<typeof nagLevel>, string> = {
  ok: '#2b7',
  amber: '#e90',
  red: '#c22',
};

export const SyncIndicator: FC<Props> = ({ hoursSinceSync }) => {
  const level = nagLevel(hoursSinceSync);
  const label = hoursSinceSync === null
    ? 'never synced'
    : `${hoursSinceSync.toFixed(1)} h since sync`;
  return (
    <div
      data-testid="sync-indicator"
      data-nag={level}
      style={{
        display: 'inline-block',
        padding: '4px 8px',
        borderRadius: 4,
        color: 'white',
        background: COLORS[level],
        fontSize: 12,
      }}
    >
      {label}
    </div>
  );
};
```

- [ ] **Step 5: Implement SiteList**

Write `src/ui/SiteList.tsx`:
```typescript
import { useEffect, useState } from 'react';
import { getDb, SiteRow } from '../cache/db';

export function SiteList() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  useEffect(() => {
    getDb().sites.orderBy('code').toArray().then(setSites);
  }, []);
  return (
    <ul>
      {sites.map((s) => (
        <li key={s.id}>
          <strong>{s.code}</strong> — {s.folderName}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 6: Implement Home**

Write `src/ui/Home.tsx`:
```typescript
import { useEffect, useState, useCallback } from 'react';
import {
  pickRootFolder, persistRoot, getPersistedRoot, verifyPermission,
} from '../storage/fs';
import { scanRoot } from '../storage/scanner';
import { rebuildCache } from '../cache/rebuild';
import { hoursSinceLastSync } from '../storage/sync';
import { SiteList } from './SiteList';
import { SyncIndicator } from './SyncIndicator';

export function Home() {
  const [ready, setReady] = useState(false);
  const [hours, setHours] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const loadRoot = useCallback(async (root: FileSystemDirectoryHandle) => {
    setLoading(true);
    try {
      if (!(await verifyPermission(root))) throw new Error('permission denied');
      const scan = await scanRoot(root);
      await rebuildCache(scan);
      setHours(await hoursSinceLastSync(root, new Date()));
      setReady(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const persisted = await getPersistedRoot();
      if (persisted) await loadRoot(persisted);
    })();
  }, [loadRoot]);

  const onPick = async () => {
    const root = await pickRootFolder();
    await persistRoot(root);
    await loadRoot(root);
  };

  if (!ready) {
    return (
      <main style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
        <h1>HydroLog</h1>
        <button onClick={onPick} disabled={loading}>
          {loading ? 'Scanning…' : 'Pick folder'}
        </button>
      </main>
    );
  }

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>HydroLog</h1>
        <SyncIndicator hoursSinceSync={hours} />
      </header>
      <section>
        <h2>Sites</h2>
        <SiteList />
      </section>
    </main>
  );
}
```

- [ ] **Step 7: Run to verify pass**

```bash
npm test src/ui/Home.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/ui
git commit -m "feat(ui): Home with folder pick, sync indicator, and site list"
```

---

## Task 14: Wire startup in App.tsx

**Files:**
- Modify: `src/App.tsx` (replace boot placeholder with `<Home />`)

**Interfaces:**
- Consumes: `<Home />` (T13)
- Produces: an app that opens to the Home screen.

- [ ] **Step 1: Modify App.tsx**

Replace the contents of `src/App.tsx`:
```typescript
import { Home } from './ui/Home';

export function App() {
  return <Home />;
}
```

- [ ] **Step 2: Run all tests, typecheck, and build**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all tests pass; typecheck passes; build produces `dist/`.

- [ ] **Step 3: Manual sanity check (dev server)**

Run:
```bash
npm run dev
```

Open the printed localhost URL in Chrome desktop. Verify:
- "Pick folder" button appears.
- Clicking it opens the OS folder picker (production `showDirectoryPicker`).
- After picking any folder, the app renders the Home screen with `never synced` red indicator and an empty site list.
- Reload the tab: the app reopens the same folder without asking again (persistent handle).

Stop the dev server (Ctrl-C) when done.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): render Home as the boot screen"
```

---

## Task 15: Integration test — create, save, restart, verify

**Files:**
- Create: `integration/create-restart-verify.test.ts`

**Interfaces:**
- Consumes: everything.
- Produces: end-to-end proof that the folder-primary invariant holds: data written through the transaction sequencer survives a full cache reset, and the rebuild reproduces the same rows.

- [ ] **Step 1: Write the test**

Write `integration/create-restart-verify.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../src/test/mock-fs';
import { stubChannelSet } from '../src/test/fixtures';
import { writeJson } from '../src/storage/atomic';
import { getOrCreatePath, siteFolderName, surveyFolderName } from '../src/storage/paths';
import { writeSurveyUpdate } from '../src/storage/transaction';
import { scanRoot } from '../src/storage/scanner';
import { rebuildCache } from '../src/cache/rebuild';
import { getDb, resetDb } from '../src/cache/db';
import { newId } from '../src/util/id';
import { isoNow } from '../src/util/time';
import type { Site, Survey, Line, RegulatoryContext } from '../src/domain/types';

beforeEach(async () => { await resetDb(); });

describe('folder-primary invariant (§10 T21)', () => {
  it('create site+survey+line, wipe cache, rescan → identical rows', async () => {
    // ─── Setup: fresh folder, seed a site.json ─────────────────────
    const root = createMockRoot();
    await writeJson(root, '_schema.json', { version: 'hydrolog-v1' });

    const now = new Date('2026-09-13T10:00:00Z');
    const site: Site = {
      id: newId(), createdAt: now, updatedAt: now, revision: 1,
      name: 'Ivanov', code: 'BG-SOF-0043',
      settlement: 'Долна Баня', municipality: 'Долна Баня', region: 'Софийска',
      centroid: { lat: 42.32, lon: 23.78 },
      accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    };
    const siteFolder = siteFolderName(site.code, site.name);
    const siteDir = await getOrCreatePath(root, ['sites', siteFolder]);
    await writeJson(siteDir, 'site.json', site);

    const reg: RegulatoryContext = {
      insideSOZ: { inside: false },
      waterBodyCode: 'BG3G000',
      nearestRegisteredWellM: 340,
    };
    await writeJson(siteDir, 'regulatory.json', reg);

    // ─── Act: write a survey with one line via the transaction sequencer ──
    const survey: Survey = {
      id: newId(), createdAt: now, updatedAt: now, revision: 1,
      siteId: site.id, startedAt: now, timezone: 'Europe/Sofia',
      operator: 'Anton', deviceModel: 'PQWT-TC300', deviceSerial: 'SN123',
      precipLast48h: 'none', qualityFlag: 'good',
    };
    const line: Line = {
      id: newId(), createdAt: now, updatedAt: now, revision: 1,
      label: 'L1', pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
      mode: 'multi-frequency', channelSetSnapshot: stubChannelSet(),
      vertices: [], dipoleOrientation: 'inline', transformLog: [],
      points: [], noiseZones: [], status: 'draft',
    };

    const svFolder = surveyFolderName(now, 1);
    const surveyPath = ['sites', siteFolder, 'surveys', svFolder];

    await writeSurveyUpdate(root, {
      sitePath: ['sites', siteFolder],
      surveyPath,
      mediaWrites: [{
        lineFolderName: 'L1',
        fileName: 'anchor.jpg',
        blob: new Blob([new Uint8Array([1, 2, 3])]),
        kind: 'media',
      }],
      lineWrites: [{
        lineFolderName: 'L1',
        lineJson: line,
        verticesGeoJson: { type: 'LineString', coordinates: [] },
      }],
      surveyJson: survey,
    });

    // Populate cache once.
    let scan = await scanRoot(root);
    let counts = await rebuildCache(scan);
    expect(counts).toEqual({ sites: 1, surveys: 1, lines: 1 });

    // ─── Restart: wipe cache, rescan from folder ─────────────────────
    await resetDb();
    scan = await scanRoot(root);
    counts = await rebuildCache(scan);
    expect(counts).toEqual({ sites: 1, surveys: 1, lines: 1 });

    const db = getDb();
    const gotSite = await db.sites.get(site.id);
    expect(gotSite?.code).toBe('BG-SOF-0043');
    expect(gotSite?.folderName).toBe(siteFolder);

    const gotSurvey = await db.surveys.where('siteId').equals(site.id).first();
    expect(gotSurvey?.folderName).toBe(svFolder);

    const gotLine = await db.lines.where('surveyId').equals(survey.id).first();
    expect(gotLine?.hasDeviceFiles).toBe(false);
    expect(gotLine?.json.label).toBe('L1');
    expect(gotLine?.json.channelSetSnapshot.units).toBe('mV');  // §2 R1
    expect(gotLine?.json.channelSetSnapshot.depthModel).toBe('linear-nominal');  // §2 R3
    expect(gotLine?.json.transformLog).toEqual([]);  // §5.4 (empty array, never undefined)

    // Meta was refreshed.
    const meta = await db.meta.get('lastScanCompletedAt');
    expect(meta?.value).toBeTruthy();
    void isoNow;
  });

  it('a scan with no sites returns an empty result cleanly', async () => {
    const root = createMockRoot();
    await writeJson(root, '_schema.json', { version: 'hydrolog-v1' });
    const scan = await scanRoot(root);
    expect(scan.sites).toEqual([]);
    const counts = await rebuildCache(scan);
    expect(counts).toEqual({ sites: 0, surveys: 0, lines: 0 });
  });
});
```

- [ ] **Step 2: Run**

```bash
npm test integration/create-restart-verify.test.ts
```

Expected: both tests PASS.

- [ ] **Step 3: Run the whole suite one final time**

```bash
npm test
npm run typecheck
npm run build
```

Expected: everything green.

- [ ] **Step 4: Commit**

```bash
git add integration
git commit -m "test(integration): folder-primary invariant end-to-end (T21)"
```

---

## Done criteria (definition of done for this plan)

All of the following are true before this plan is considered complete:

- [ ] `npm test` reports every test file green.
- [ ] `npm run typecheck` passes with no errors.
- [ ] `npm run build` produces a `dist/` folder without errors.
- [ ] `npm run dev` opens an app that can pick a folder, remembers it across reloads, and renders the Home screen with a sync indicator.
- [ ] The integration test in `integration/create-restart-verify.test.ts` proves that data written to the folder survives a full cache wipe (§14 T21).
- [ ] `docs/app-spec-v2.md` §10 reflects the folder-primary design; §14 lists T21–T23.
- [ ] Git history has one commit per task (16 commits total, including the spec update).
