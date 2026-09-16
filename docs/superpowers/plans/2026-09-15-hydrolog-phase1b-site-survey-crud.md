# HydroLog Phase 1b — Site + Survey CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Site + Survey CRUD on top of Phase 1a's storage foundation: forms, detail screens, search, routing, soft-delete with tombstones, and a finalize-survey action that respects the backup-freshness gate from spec §10.9.

**Architecture:** Domain service functions (`site-service.ts`, `survey-service.ts`) own the write path — each function writes JSON to the folder atomically (Phase 1a) then updates the Dexie cache row directly. Reads flow through `useLiveQuery` hooks so the UI re-renders when the cache changes. Routing uses `wouter` (2 KB hook-based router). All user-facing strings live in `src/ui/labels.ts` (Bulgarian).

**Tech Stack:** React 18, TypeScript 5, Vitest, Dexie 4 (Phase 1a), `dexie-react-hooks` (new — for `useLiveQuery`), `wouter` (new — routing).

**Spec:** `docs/app-spec-v2.md` — §4.2 Site fields, §4.4 Survey fields, §4.1 audit fields (id, createdAt, updatedAt, deletedAt?, revision), §10.9 "A survey cannot be finalized while the folder's last-synced time is older than the survey's `startedAt`", §10.5 write order (already enforced by Phase 1a's `writeSurveyUpdate`).

## Global Constraints

Every task inherits these. Copied verbatim so they travel with the plan.

- **Every task ends with `npm run typecheck && npm test && npm run build` all green before commit.** Phase 1a's ruling: scoped `npm test <path>` isn't enough — full typecheck must pass per task.
- **Folder-first write, then cache.** Service functions write to the folder via Phase 1a's `writeJson`/`writeBlob` first, then update Dexie via `db.<table>.put(row)`. If the folder write throws, the cache update does not run. §10.3 invariant preserved.
- **Audit fields on every write (§4.1).** New records: `id = newId()`, `createdAt = now`, `updatedAt = now`, `revision = 1`. Updates: `updatedAt = now`, `revision += 1`. `deletedAt` set only by softDelete.
- **Physics rules R1/R2/R3/R6 unchanged** — Phase 1a's types enforce them. Do not weaken.
- **Bulgarian UI strings.** Every user-visible string comes from `src/ui/labels.ts`. English in code, comments, JSON field names, and commit messages.
- **Timestamps** ISO 8601 UTC in JSON via `.toISOString()`; `Date` objects in memory.
- **ULID** IDs via Phase 1a's `newId()`.
- **Chrome-family only.** No polyfills for Firefox/Safari/iOS.
- **Finalize gate (§10.9):** `finalizeSurvey` refuses if the sync-canary probe timestamp is older than the survey's `startedAt` OR if no probe exists.

---

## File Structure Map

Files created or modified across the plan. Task numbers in parentheses.

```
package.json                                    # (T4, T11) new deps
src/
  domain/
    site-code.ts                                # (T1) region → code prefix + sequence
    site-code.test.ts                           # (T1)
    site-service.ts                             # (T2) createSite/updateSite/softDeleteSite/restoreSite
    site-service.test.ts                        # (T2)
    survey-service.ts                           # (T3) createSurvey/updateSurvey/finalizeSurvey
    survey-service.test.ts                      # (T3)
  cache/
    hooks.ts                                    # (T4) useLiveQuery-backed reactive queries
    hooks.test.tsx                              # (T4)
  storage/
    fs.ts                                       # (T2) modify — add getRoot/setRoot module-local handle store
  ui/
    labels.ts                                   # (T5) Bulgarian UI strings
    SiteForm.tsx                                # (T6)
    SiteForm.test.tsx                           # (T6)
    SurveyForm.tsx                              # (T7)
    SurveyForm.test.tsx                         # (T7)
    SiteDetail.tsx                              # (T8)
    SiteDetail.test.tsx                         # (T8)
    SurveyDetail.tsx                            # (T9)
    SurveyDetail.test.tsx                       # (T9)
    SiteList.tsx                                # (T10) modify — add search filter
    SiteList.test.tsx                           # (T10) new
    Router.tsx                                  # (T11) route table
    Router.test.tsx                             # (T11)
    Home.tsx                                    # (T11) modify — render Router when ready
  App.tsx                                       # (T11) unchanged; Home still renders
integration/
  phase1b-crud-flow.test.ts                     # (T12) full end-to-end site→survey CRUD
```

Rationale for the splits:

- `domain/` grows two service files. Each owns one entity's writes; they share only utilities. Keeping them separate means a Site edit and a Survey edit are reviewed independently.
- `cache/hooks.ts` is the single reactive-read entry point. Every screen imports from here — never `getDb()` directly — so if we later add pagination or memoization, one file changes.
- `ui/labels.ts` centralises Bulgarian strings. Screens import `label.siteCreate.title` (English keys, Bulgarian values). This avoids sprinkling literals across components and lets a future English translation ship as one file swap.
- Forms and detail screens are per-entity files. Not overloading one component with modes ("form=create|edit|view") — separate files, each with one job.

---

## Task 1: Site code generator

**Files:**
- Create: `src/domain/site-code.ts`, `src/domain/site-code.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `regionCode(regionName: string): string` — transliterate first three letters of Cyrillic region name to ASCII uppercase (e.g. `'Софийска'` → `'SOF'`, `'Пловдив'` → `'PLO'`). Falls back to `'XXX'` if the input has fewer than 3 Cyrillic letters.
  - `generateSiteCode(regionName: string, existingCodes: string[]): string` — returns `` `BG-${regionCode}-${nnnn}` `` where `nnnn` is a 4-digit zero-padded number, one greater than the max sequence found in `existingCodes` with matching `BG-<regionCode>-` prefix. Empty list → `'0001'`.

- [ ] **Step 1: Write failing tests**

Write `src/domain/site-code.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { regionCode, generateSiteCode } from './site-code';

describe('regionCode', () => {
  it('transliterates Cyrillic first 3 letters to Latin uppercase', () => {
    expect(regionCode('Софийска')).toBe('SOF');
    expect(regionCode('Пловдив')).toBe('PLO');
    expect(regionCode('Варна')).toBe('VAR');
    expect(regionCode('Бургас')).toBe('BUR');
  });

  it('handles mixed-case input', () => {
    expect(regionCode('софийска')).toBe('SOF');
  });

  it('handles ASCII input pass-through', () => {
    expect(regionCode('Sofia')).toBe('SOF');
    expect(regionCode('London')).toBe('LON');
  });

  it('returns XXX for input with fewer than 3 letters', () => {
    expect(regionCode('')).toBe('XXX');
    expect(regionCode('ab')).toBe('XXX');
    expect(regionCode('А')).toBe('XXX');
  });

  it('ignores non-letter characters when taking first 3', () => {
    expect(regionCode('  Софийска  ')).toBe('SOF');
    expect(regionCode('С-о-ф')).toBe('SOF');
  });
});

describe('generateSiteCode', () => {
  it('returns 0001 for the first site in a region', () => {
    expect(generateSiteCode('Софийска', [])).toBe('BG-SOF-0001');
  });

  it('increments the sequence for the same region', () => {
    expect(generateSiteCode('Софийска', ['BG-SOF-0001', 'BG-SOF-0002'])).toBe('BG-SOF-0003');
  });

  it('ignores codes from other regions when computing sequence', () => {
    expect(generateSiteCode('Пловдив', ['BG-SOF-0042', 'BG-PLO-0001'])).toBe('BG-PLO-0002');
  });

  it('zero-pads sequence to 4 digits', () => {
    expect(generateSiteCode('Софийска', ['BG-SOF-0099'])).toBe('BG-SOF-0100');
  });

  it('handles gaps in the sequence by using max+1', () => {
    expect(generateSiteCode('Софийска', ['BG-SOF-0001', 'BG-SOF-0003'])).toBe('BG-SOF-0004');
  });

  it('ignores malformed codes', () => {
    expect(generateSiteCode('Софийска', ['not-a-code', 'BG-SOF-XX', 'BG-SOF-0005'])).toBe('BG-SOF-0006');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test src/domain/site-code.test.ts
```
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/domain/site-code.ts`**

```typescript
// Cyrillic → Latin transliteration for Bulgarian letters.
// Source: standard Bulgarian ISO 9 / Streamlined System (2006).
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
};

function transliterate(input: string): string {
  const lower = input.toLowerCase();
  let out = '';
  for (const ch of lower) {
    out += TRANSLIT[ch] ?? (/[a-z]/.test(ch) ? ch : '');
  }
  return out;
}

export function regionCode(regionName: string): string {
  const latin = transliterate(regionName);
  const lettersOnly = latin.replace(/[^a-z]/g, '');
  if (lettersOnly.length < 3) return 'XXX';
  return lettersOnly.slice(0, 3).toUpperCase();
}

export function generateSiteCode(regionName: string, existingCodes: string[]): string {
  const rc = regionCode(regionName);
  const prefix = `BG-${rc}-`;
  const pattern = new RegExp(`^${prefix}(\\d{4})$`);
  let max = 0;
  for (const code of existingCodes) {
    const m = pattern.exec(code);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  const next = max + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test src/domain/site-code.test.ts && npm run typecheck && npm run build
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/domain/site-code.ts src/domain/site-code.test.ts
git commit -m "feat(domain): site code generator with Cyrillic-to-Latin region prefix"
```

---

## Task 2: Site service (write path)

**Files:**
- Create: `src/domain/site-service.ts`, `src/domain/site-service.test.ts`
- Modify: `src/storage/fs.ts` — add module-local root handle store: `getRoot()`, `setRoot(handle)`, `clearRoot()`.

**Interfaces:**
- Consumes: `newId` (T4 P1a), `writeJson` (T6 P1a), `getOrCreatePath` + `siteFolderName` + `sanitizeFolderName` (T7 P1a), `getDb` (T9 P1a), `Site` (T3 P1a), `generateSiteCode` (T1 above).
- Produces:
  - `setRoot(handle: FileSystemDirectoryHandle): void`, `getRoot(): FileSystemDirectoryHandle` (throws if not set), `clearRoot(): void` — in `fs.ts`.
  - `createSite(input: SiteCreateInput): Promise<Site>` where `SiteCreateInput = Omit<Site, 'id' | 'code' | 'createdAt' | 'updatedAt' | 'revision' | 'deletedAt'>`. Generates code, ULID, timestamps; writes `site.json`; puts a `SiteRow` in the cache; returns the full `Site`.
  - `updateSite(id: string, patch: Partial<Omit<Site, 'id' | 'code' | 'createdAt' | 'revision' | 'deletedAt'>>): Promise<Site>` — bumps `updatedAt` and `revision`, rewrites `site.json`, updates cache row. Throws if the site doesn't exist or is soft-deleted.
  - `softDeleteSite(id: string): Promise<void>` — sets `deletedAt`, moves `site.json` to `_tombstones/<siteFolderName>_<isoTimestamp>.json`, removes the site's cache row.
  - `restoreSite(tombstoneName: string): Promise<Site>` — reads the tombstone, writes back to `sites/<siteFolderName>/site.json`, clears `deletedAt`, bumps `updatedAt`+`revision`, puts cache row.

- [ ] **Step 1: Modify `src/storage/fs.ts` — add root handle store**

Append these exports below the existing `verifyPermission` function:
```typescript
let currentRoot: FileSystemDirectoryHandle | null = null;

export function setRoot(handle: FileSystemDirectoryHandle): void {
  currentRoot = handle;
}

export function getRoot(): FileSystemDirectoryHandle {
  if (!currentRoot) {
    throw new Error('root folder not set — call setRoot() after picking a folder');
  }
  return currentRoot;
}

export function clearRoot(): void {
  currentRoot = null;
}
```

- [ ] **Step 2: Write failing tests**

Write `src/domain/site-service.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { readJson, fileExists } from '../storage/atomic';
import { getPath } from '../storage/paths';
import { createSite, updateSite, softDeleteSite, restoreSite } from './site-service';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

describe('createSite', () => {
  it('creates site.json, generates a code, populates the cache', async () => {
    const site = await createSite({
      name: 'Ivanov',
      settlement: 'Долна Баня',
      municipality: 'Долна Баня',
      region: 'Софийска',
      centroid: { lat: 42.32, lon: 23.78 },
      accessNotes: '',
      landUse: '',
      status: 'surveyed',
      tags: [],
    });
    expect(site.code).toBe('BG-SOF-0001');
    expect(site.revision).toBe(1);
    expect(site.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    // Folder written
    const siteDir = await getPath(root, ['sites', 'BG-SOF-0001_Ivanov']);
    expect(siteDir).not.toBeNull();
    expect(await fileExists(siteDir!, 'site.json')).toBe(true);

    // Cache populated
    const row = await getDb().sites.get(site.id);
    expect(row?.code).toBe('BG-SOF-0001');
    expect(row?.folderName).toBe('BG-SOF-0001_Ivanov');
  });

  it('assigns sequential codes within the same region', async () => {
    const a = await createSite({
      name: 'A', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    const b = await createSite({
      name: 'B', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    expect(a.code).toBe('BG-SOF-0001');
    expect(b.code).toBe('BG-SOF-0002');
  });
});

describe('updateSite', () => {
  it('bumps updatedAt and revision, rewrites site.json', async () => {
    const site = await createSite({
      name: 'x', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    const originalUpdated = site.updatedAt;
    // Ensure a measurable clock tick
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateSite(site.id, { accessNotes: 'gate on the north side' });
    expect(updated.revision).toBe(2);
    expect(updated.accessNotes).toBe('gate on the north side');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(new Date(originalUpdated).getTime());

    const siteDir = await getPath(root, ['sites', site.code + '_x']);
    const persisted = await readJson<typeof site>(siteDir!, 'site.json');
    expect(persisted.accessNotes).toBe('gate on the north side');
  });

  it('throws when the site does not exist', async () => {
    await expect(updateSite('01J000MISSING', { accessNotes: 'x' })).rejects.toThrow(/not found/i);
  });
});

describe('softDeleteSite + restoreSite', () => {
  it('moves site.json to _tombstones and removes the cache row', async () => {
    const site = await createSite({
      name: 'DeleteMe', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    await softDeleteSite(site.id);

    const siteDir = await getPath(root, ['sites', site.code + '_DeleteMe']);
    expect(await fileExists(siteDir!, 'site.json')).toBe(false);

    const tombstones = await getPath(root, ['_tombstones']);
    expect(tombstones).not.toBeNull();
    let tombstoneFile: string | null = null;
    for await (const [name, h] of (tombstones as any).entries()) {
      if (h.kind === 'file' && name.startsWith(`${site.code}_DeleteMe_`)) {
        tombstoneFile = name;
      }
    }
    expect(tombstoneFile).not.toBeNull();

    expect(await getDb().sites.get(site.id)).toBeUndefined();

    // Restore round-trips
    const restored = await restoreSite(tombstoneFile!);
    expect(restored.id).toBe(site.id);
    expect(restored.deletedAt).toBeUndefined();
    expect(restored.revision).toBe(site.revision + 1);
    expect(await getDb().sites.get(site.id)).toBeDefined();
    expect(await fileExists(siteDir!, 'site.json')).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npm test src/domain/site-service.test.ts
```
Expected: FAIL (module missing).

- [ ] **Step 4: Implement `src/domain/site-service.ts`**

```typescript
import type { Site } from './types';
import { newId } from '../util/id';
import { writeJson, readJson, fileExists } from '../storage/atomic';
import { getOrCreatePath, getPath, siteFolderName } from '../storage/paths';
import { getRoot } from '../storage/fs';
import { getDb } from '../cache/db';
import { generateSiteCode } from './site-code';

export type SiteCreateInput = Omit<
  Site, 'id' | 'code' | 'createdAt' | 'updatedAt' | 'revision' | 'deletedAt'
>;

export type SiteUpdateInput = Partial<
  Omit<Site, 'id' | 'code' | 'createdAt' | 'revision' | 'deletedAt'>
>;

export async function createSite(input: SiteCreateInput): Promise<Site> {
  const root = getRoot();
  const db = getDb();

  const existing = await db.sites.toArray();
  const code = generateSiteCode(input.region, existing.map((r) => r.code));

  const now = new Date();
  const site: Site = {
    ...input,
    id: newId(),
    code,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };

  const folderName = siteFolderName(code, input.name);
  const siteDir = await getOrCreatePath(root, ['sites', folderName]);
  await writeJson(siteDir, 'site.json', site);

  await db.sites.put({
    id: site.id,
    code: site.code,
    folderName,
    json: site,
  });

  return site;
}

export async function updateSite(id: string, patch: SiteUpdateInput): Promise<Site> {
  const root = getRoot();
  const db = getDb();

  const row = await db.sites.get(id);
  if (!row) throw new Error(`site not found: ${id}`);

  const existing = row.json;
  const next: Site = {
    ...existing,
    ...patch,
    id: existing.id,
    code: existing.code,
    createdAt: existing.createdAt,
    updatedAt: new Date(),
    revision: existing.revision + 1,
  };

  const siteDir = await getPath(root, ['sites', row.folderName]);
  if (!siteDir) throw new Error(`site folder missing: ${row.folderName}`);
  await writeJson(siteDir, 'site.json', next);

  await db.sites.put({ ...row, json: next });
  return next;
}

export async function softDeleteSite(id: string): Promise<void> {
  const root = getRoot();
  const db = getDb();

  const row = await db.sites.get(id);
  if (!row) throw new Error(`site not found: ${id}`);

  const now = new Date();
  const tombstoned: Site = {
    ...row.json,
    deletedAt: now,
    updatedAt: now,
    revision: row.json.revision + 1,
  };

  const tombstonesDir = await getOrCreatePath(root, ['_tombstones']);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const tombstoneName = `${row.folderName}_${stamp}.json`;
  await writeJson(tombstonesDir, tombstoneName, tombstoned);

  const siteDir = await getPath(root, ['sites', row.folderName]);
  if (siteDir && (await fileExists(siteDir, 'site.json'))) {
    await siteDir.removeEntry('site.json');
  }

  await db.sites.delete(id);
}

export async function restoreSite(tombstoneName: string): Promise<Site> {
  const root = getRoot();
  const db = getDb();

  const tombstonesDir = await getPath(root, ['_tombstones']);
  if (!tombstonesDir) throw new Error('_tombstones/ not found');
  const stored = await readJson<Site>(tombstonesDir, tombstoneName);

  const restored: Site = {
    ...stored,
    deletedAt: undefined,
    updatedAt: new Date(),
    revision: stored.revision + 1,
  };

  const folderName = siteFolderName(restored.code, restored.name);
  const siteDir = await getOrCreatePath(root, ['sites', folderName]);
  await writeJson(siteDir, 'site.json', restored);
  await tombstonesDir.removeEntry(tombstoneName);

  await db.sites.put({
    id: restored.id,
    code: restored.code,
    folderName,
    json: restored,
  });

  return restored;
}
```

- [ ] **Step 5: Run to verify pass**

```bash
npm test src/domain/site-service.test.ts src/storage/fs.test.ts && npm run typecheck && npm run build
```
Expected: all green (including the existing fs.test.ts — verify the new exports didn't break anything).

- [ ] **Step 6: Commit**

```bash
git add src/domain/site-service.ts src/domain/site-service.test.ts src/storage/fs.ts
git commit -m "feat(domain): site CRUD service (create/update/softDelete/restore)"
```

---

## Task 3: Survey service (write path + finalize gate)

**Files:**
- Create: `src/domain/survey-service.ts`, `src/domain/survey-service.test.ts`

**Interfaces:**
- Consumes: `newId` (T4 P1a), `writeJson` (T6 P1a), `getOrCreatePath` + `surveyFolderName` (T7 P1a), `getDb` (T9 P1a), `getRoot` (T2 above), `Survey` (T3 P1a), `readLatestSyncedProbe` (T12 P1a).
- Produces:
  - `createSurvey(siteId: string, input: SurveyCreateInput): Promise<Survey>` where `SurveyCreateInput = Omit<Survey, 'id' | 'siteId' | 'createdAt' | 'updatedAt' | 'revision' | 'deletedAt' | 'finalizedAt'>`. Reads existing surveys under the site to compute the next sequence number for `surveyFolderName(startedAt, seq)`. Writes `survey.json`. Puts cache row.
  - `updateSurvey(id: string, patch: SurveyUpdateInput, opts?: { editReason?: string }): Promise<Survey>` — bumps `updatedAt`+`revision`. If `finalizedAt` is set, requires `opts.editReason` (throws otherwise). The reason goes into a `survey.json` extension `editHistory: [{ at, reason, revision }]`.
  - `finalizeSurvey(id: string): Promise<Survey>` — sets `finalizedAt = now`. Throws if the sync probe is missing OR older than the survey's `startedAt` (§10.9 gate). Bumps `updatedAt`+`revision`.

- [ ] **Step 1: Write failing tests**

Write `src/domain/survey-service.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { readJson } from '../storage/atomic';
import { getPath } from '../storage/paths';
import { writeSyncProbe } from '../storage/sync';
import { createSite } from './site-service';
import { createSurvey, updateSurvey, finalizeSurvey } from './survey-service';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

async function makeSite() {
  return createSite({
    name: 'S', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
}

describe('createSurvey', () => {
  it('creates survey.json under the site and populates the cache', async () => {
    const site = await makeSite();
    const survey = await createSurvey(site.id, {
      startedAt: new Date('2026-09-15T10:00:00Z'),
      timezone: 'Europe/Sofia',
      operator: 'Anton',
      deviceModel: 'PQWT-TC300',
      deviceSerial: 'SN123',
      precipLast48h: 'none',
      qualityFlag: 'good',
    });
    expect(survey.siteId).toBe(site.id);
    expect(survey.revision).toBe(1);
    expect(survey.finalizedAt).toBeUndefined();

    const svDir = await getPath(root, ['sites', 'BG-SOF-0001_S', 'surveys', '2026-09-15T10-00_s01']);
    expect(svDir).not.toBeNull();
    const persisted = await readJson<typeof survey>(svDir!, 'survey.json');
    expect(persisted.operator).toBe('Anton');

    const row = await getDb().surveys.get(survey.id);
    expect(row?.siteId).toBe(site.id);
    expect(row?.folderName).toBe('2026-09-15T10-00_s01');
  });

  it('assigns sequential seq numbers for surveys on the same date', async () => {
    const site = await makeSite();
    const t = new Date('2026-09-15T10:00:00Z');
    const a = await createSurvey(site.id, {
      startedAt: t, timezone: 'Europe/Sofia', operator: 'Anton',
      deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    const b = await createSurvey(site.id, {
      startedAt: t, timezone: 'Europe/Sofia', operator: 'Anton',
      deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    const rowA = await getDb().surveys.get(a.id);
    const rowB = await getDb().surveys.get(b.id);
    expect(rowA?.folderName).toBe('2026-09-15T10-00_s01');
    expect(rowB?.folderName).toBe('2026-09-15T10-00_s02');
  });
});

describe('updateSurvey', () => {
  it('bumps revision and updatedAt without a reason on a draft', async () => {
    const site = await makeSite();
    const survey = await createSurvey(site.id, {
      startedAt: new Date('2026-09-15T10:00:00Z'), timezone: 'Europe/Sofia',
      operator: 'Anton', deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateSurvey(survey.id, { operator: 'Иван' });
    expect(updated.revision).toBe(2);
    expect(updated.operator).toBe('Иван');
  });

  it('rejects edits on a finalized survey without a reason', async () => {
    const site = await makeSite();
    const survey = await createSurvey(site.id, {
      startedAt: new Date(Date.now() - 3600_000), timezone: 'Europe/Sofia',
      operator: 'Anton', deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    await writeSyncProbe(root, new Date()); // pass the finalize gate
    await finalizeSurvey(survey.id);
    await expect(updateSurvey(survey.id, { operator: 'x' })).rejects.toThrow(/reason/i);
  });

  it('accepts edits on a finalized survey when a reason is provided; appends editHistory', async () => {
    const site = await makeSite();
    const survey = await createSurvey(site.id, {
      startedAt: new Date(Date.now() - 3600_000), timezone: 'Europe/Sofia',
      operator: 'Anton', deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    await writeSyncProbe(root, new Date());
    await finalizeSurvey(survey.id);
    const edited = await updateSurvey(survey.id, { operator: 'Ivan' }, { editReason: 'typo fix' });
    expect((edited as any).editHistory).toBeDefined();
    expect((edited as any).editHistory[0].reason).toBe('typo fix');
  });
});

describe('finalizeSurvey (§10.9 gate)', () => {
  it('throws when no sync probe exists', async () => {
    const site = await makeSite();
    const survey = await createSurvey(site.id, {
      startedAt: new Date('2026-09-15T10:00:00Z'), timezone: 'Europe/Sofia',
      operator: 'Anton', deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    await expect(finalizeSurvey(survey.id)).rejects.toThrow(/backup/i);
  });

  it('throws when the probe is older than the survey.startedAt', async () => {
    const site = await makeSite();
    // Probe written yesterday
    await writeSyncProbe(root, new Date(Date.now() - 24 * 3600_000));
    // Survey started this morning
    const survey = await createSurvey(site.id, {
      startedAt: new Date(), timezone: 'Europe/Sofia',
      operator: 'Anton', deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    await expect(finalizeSurvey(survey.id)).rejects.toThrow(/backup/i);
  });

  it('succeeds when the probe is newer than the survey.startedAt', async () => {
    const site = await makeSite();
    const survey = await createSurvey(site.id, {
      startedAt: new Date(Date.now() - 3600_000), timezone: 'Europe/Sofia',
      operator: 'Anton', deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    await writeSyncProbe(root, new Date());
    const finalized = await finalizeSurvey(survey.id);
    expect(finalized.finalizedAt).toBeDefined();
    expect(finalized.revision).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test src/domain/survey-service.test.ts
```
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/domain/survey-service.ts`**

```typescript
import type { Survey } from './types';
import { newId } from '../util/id';
import { writeJson } from '../storage/atomic';
import { getOrCreatePath, getPath, surveyFolderName } from '../storage/paths';
import { getRoot } from '../storage/fs';
import { getDb } from '../cache/db';
import { readLatestSyncedProbe } from '../storage/sync';

export type SurveyCreateInput = Omit<
  Survey,
  'id' | 'siteId' | 'createdAt' | 'updatedAt' | 'revision' | 'deletedAt' | 'finalizedAt'
>;

export type SurveyUpdateInput = Partial<
  Omit<Survey, 'id' | 'siteId' | 'createdAt' | 'revision' | 'deletedAt'>
>;

interface EditHistoryEntry {
  at: string;      // ISO
  reason: string;
  revision: number;
}

interface SurveyWithHistory extends Survey {
  editHistory?: EditHistoryEntry[];
}

async function nextSequenceForDate(
  siteId: string,
  startedAt: Date,
): Promise<number> {
  const db = getDb();
  const rows = await db.surveys.where('siteId').equals(siteId).toArray();
  // Match "YYYY-MM-DDTHH-mm_sNN" for the same minute stamp.
  const stamp = surveyFolderName(startedAt, 1).slice(0, -4); // strip "_s01"
  let max = 0;
  for (const r of rows) {
    if (r.folderName.startsWith(stamp)) {
      const m = /_s(\d{2})$/.exec(r.folderName);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
  }
  return max + 1;
}

export async function createSurvey(
  siteId: string,
  input: SurveyCreateInput,
): Promise<Survey> {
  const root = getRoot();
  const db = getDb();

  const siteRow = await db.sites.get(siteId);
  if (!siteRow) throw new Error(`site not found: ${siteId}`);

  const seq = await nextSequenceForDate(siteId, input.startedAt);
  const folderName = surveyFolderName(input.startedAt, seq);

  const now = new Date();
  const survey: Survey = {
    ...input,
    id: newId(),
    siteId,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };

  const svDir = await getOrCreatePath(root, [
    'sites', siteRow.folderName, 'surveys', folderName,
  ]);
  await writeJson(svDir, 'survey.json', survey);

  await db.surveys.put({
    id: survey.id,
    siteId,
    folderName,
    json: survey,
  });

  return survey;
}

export async function updateSurvey(
  id: string,
  patch: SurveyUpdateInput,
  opts?: { editReason?: string },
): Promise<Survey> {
  const root = getRoot();
  const db = getDb();

  const row = await db.surveys.get(id);
  if (!row) throw new Error(`survey not found: ${id}`);
  const existing = row.json as SurveyWithHistory;

  if (existing.finalizedAt && !opts?.editReason) {
    throw new Error(
      'survey is finalized; edits require an editReason to be recorded',
    );
  }

  const now = new Date();
  const next: SurveyWithHistory = {
    ...existing,
    ...patch,
    id: existing.id,
    siteId: existing.siteId,
    createdAt: existing.createdAt,
    updatedAt: now,
    revision: existing.revision + 1,
  };

  if (opts?.editReason) {
    const entry: EditHistoryEntry = {
      at: now.toISOString(),
      reason: opts.editReason,
      revision: next.revision,
    };
    next.editHistory = [...(existing.editHistory ?? []), entry];
  }

  const siteRow = await db.sites.get(existing.siteId);
  if (!siteRow) throw new Error(`orphan survey — site missing: ${existing.siteId}`);
  const svDir = await getPath(root, ['sites', siteRow.folderName, 'surveys', row.folderName]);
  if (!svDir) throw new Error(`survey folder missing: ${row.folderName}`);
  await writeJson(svDir, 'survey.json', next);

  await db.surveys.put({ ...row, json: next });
  return next;
}

export async function finalizeSurvey(id: string): Promise<Survey> {
  const root = getRoot();
  const db = getDb();

  const row = await db.surveys.get(id);
  if (!row) throw new Error(`survey not found: ${id}`);

  const lastProbe = await readLatestSyncedProbe(root);
  if (!lastProbe) {
    throw new Error('backup out of date — no sync probe found; sync before finalizing');
  }
  const startedAt = new Date(row.json.startedAt);
  if (lastProbe.getTime() < startedAt.getTime()) {
    throw new Error(
      `backup out of date — last sync probe (${lastProbe.toISOString()}) is older than survey.startedAt (${startedAt.toISOString()}). Sync before finalizing.`,
    );
  }

  const now = new Date();
  const finalized: Survey = {
    ...row.json,
    finalizedAt: now,
    updatedAt: now,
    revision: row.json.revision + 1,
  };

  const siteRow = await db.sites.get(row.siteId);
  if (!siteRow) throw new Error(`orphan survey — site missing: ${row.siteId}`);
  const svDir = await getPath(root, ['sites', siteRow.folderName, 'surveys', row.folderName]);
  if (!svDir) throw new Error(`survey folder missing: ${row.folderName}`);
  await writeJson(svDir, 'survey.json', finalized);

  await db.surveys.put({ ...row, json: finalized });
  return finalized;
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test src/domain/survey-service.test.ts && npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/survey-service.ts src/domain/survey-service.test.ts
git commit -m "feat(domain): survey CRUD service with §10.9 finalize gate"
```

---

## Task 4: Live-query hooks

**Files:**
- Create: `src/cache/hooks.ts`, `src/cache/hooks.test.tsx`
- Modify: `package.json` — add `dexie-react-hooks@^1.1.7`

**Interfaces:**
- Consumes: `getDb` (T9 P1a).
- Produces:
  - `useSites(filter?: SiteFilter): SiteRow[]` — returns all non-deleted sites, ordered by `code`. Optional filter narrows by name/settlement/tag.
  - `useSite(id: string): SiteRow | undefined`
  - `useSurveys(siteId: string): SurveyRow[]` — ordered by `folderName` desc (newest first).
  - `useSurvey(id: string): SurveyRow | undefined`
  - `type SiteFilter = { query?: string; tag?: string }`

Notes on `useLiveQuery`: it returns `undefined` on the first render and the real value after Dexie's initial query resolves. Consumers should tolerate `undefined`.

- [ ] **Step 1: Install `dexie-react-hooks`**

Run:
```bash
npm install --save dexie-react-hooks@^1.1.7
```

- [ ] **Step 2: Write failing tests**

Write `src/cache/hooks.test.tsx`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { getDb, resetDb } from './db';
import { useSites, useSite, useSurveys, useSurvey } from './hooks';

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
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npm test src/cache/hooks.test.tsx
```
Expected: FAIL.

- [ ] **Step 4: Implement `src/cache/hooks.ts`**

```typescript
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb, SiteRow, SurveyRow } from './db';

export interface SiteFilter {
  query?: string;
  tag?: string;
}

function matches(row: SiteRow, filter: SiteFilter): boolean {
  const q = filter.query?.toLowerCase().trim();
  if (q) {
    const hay = [
      row.json.name, row.json.settlement, row.json.municipality,
      ...(row.json.tags ?? []),
    ].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (filter.tag && !(row.json.tags ?? []).includes(filter.tag)) return false;
  return true;
}

export function useSites(filter: SiteFilter = {}): SiteRow[] | undefined {
  return useLiveQuery(async () => {
    const all = await getDb().sites.orderBy('code').toArray();
    const live = all.filter((r) => !r.json.deletedAt);
    return live.filter((r) => matches(r, filter));
  }, [filter.query, filter.tag]);
}

export function useSite(id: string | undefined): SiteRow | undefined {
  return useLiveQuery(async () => {
    if (!id) return undefined;
    return getDb().sites.get(id);
  }, [id]);
}

export function useSurveys(siteId: string | undefined): SurveyRow[] | undefined {
  return useLiveQuery(async () => {
    if (!siteId) return [];
    const rows = await getDb().surveys.where('siteId').equals(siteId).toArray();
    return rows
      .filter((r) => !r.json.deletedAt)
      .sort((a, b) => b.folderName.localeCompare(a.folderName));
  }, [siteId]);
}

export function useSurvey(id: string | undefined): SurveyRow | undefined {
  return useLiveQuery(async () => {
    if (!id) return undefined;
    return getDb().surveys.get(id);
  }, [id]);
}
```

- [ ] **Step 5: Run to verify pass**

```bash
npm test src/cache/hooks.test.tsx && npm run typecheck && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/cache/hooks.ts src/cache/hooks.test.tsx package.json package-lock.json
git commit -m "feat(cache): useLiveQuery-backed reactive hooks for sites and surveys"
```

---

## Task 5: Bulgarian UI labels

**Files:**
- Create: `src/ui/labels.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a `labels` object with nested string values, keyed in English, values in Bulgarian.

- [ ] **Step 1: Write `src/ui/labels.ts`**

```typescript
export const labels = {
  common: {
    save: 'Запази',
    cancel: 'Откажи',
    edit: 'Редактирай',
    delete: 'Изтрий',
    restore: 'Възстанови',
    back: 'Назад',
    loading: 'Зарежда се…',
    required: 'Задължително',
    yes: 'Да',
    no: 'Не',
    search: 'Търсене',
    newItem: 'Ново',
  },
  home: {
    pickFolder: 'Избери папка',
    scanning: 'Сканиране…',
    sitesHeading: 'Обекти',
    noSites: 'Все още няма обекти. Създай първия.',
    newSite: 'Нов обект',
  },
  site: {
    title: 'Обект',
    fields: {
      name: 'Име',
      code: 'Код',
      settlement: 'Населено място',
      ekatte: 'ЕКАТТЕ',
      cadastralParcelId: 'Кадастрален идентификатор',
      municipality: 'Община',
      region: 'Област',
      centroidLat: 'Ширина',
      centroidLon: 'Дължина',
      accessNotes: 'Достъп (бележки)',
      landUse: 'Ползване на терена',
      tags: 'Тагове (със запетая)',
      status: 'Статус',
    },
    statusOptions: {
      surveyed: 'проучен',
      recommended: 'препоръчан',
      'not-recommended': 'непрепоръчан',
      drilled: 'сондиран',
      archived: 'архивиран',
    },
    createTitle: 'Нов обект',
    editTitle: 'Редакция на обект',
    deleteConfirm: 'Сигурен ли си, че искаш да изтриеш този обект?',
    surveysHeading: 'Проучвания',
    noSurveys: 'Няма проучвания. Създай първото.',
    newSurvey: 'Ново проучване',
  },
  survey: {
    title: 'Проучване',
    fields: {
      startedAt: 'Начало',
      endedAt: 'Край',
      timezone: 'Часова зона',
      operator: 'Оператор',
      deviceModel: 'Уред (модел)',
      deviceSerial: 'Сериен номер',
      firmware: 'Firmware',
      weather: 'Време',
      airTempC: 'Температура (°C)',
      precipLast48h: 'Валежи в последните 48 ч',
      terrain: 'Терен',
      purpose: 'Цел',
      summary: 'Резюме',
      qualityFlag: 'Качество',
    },
    precipOptions: {
      none: 'без',
      light: 'леки',
      heavy: 'силни',
    },
    qualityOptions: {
      good: 'добро',
      noisy: 'зашумено',
      'repeat-needed': 'нуждае се от повторение',
    },
    createTitle: 'Ново проучване',
    editTitle: 'Редакция на проучване',
    finalize: 'Заключи проучването',
    finalized: 'Заключено на',
    editAfterFinalize: 'Промяна след заключване',
    editReasonLabel: 'Причина за промяната',
    editReasonRequired: 'Моля, посочи причина за редакцията на заключено проучване.',
    linesHeading: 'Профили',
    linesPlaceholder: 'Профилите ще бъдат добавени в следваща фаза.',
    finalizeErrorBackup: 'Не мога да заключа: резервното копие не е синхронизирано след началото на проучването. Синхронизирай Drive/Syncthing и опитай отново.',
  },
  errors: {
    generic: 'Възникна грешка. Виж конзолата за подробности.',
    notFound: 'Не е намерено.',
  },
} as const;
```

- [ ] **Step 2: Verify build**

```bash
npm run typecheck && npm run build
```
No tests for this file — it's pure data. Type-safety is verified when other tasks import it.

- [ ] **Step 3: Commit**

```bash
git add src/ui/labels.ts
git commit -m "feat(ui): Bulgarian UI label catalog"
```

---

## Task 6: Site form

**Files:**
- Create: `src/ui/SiteForm.tsx`, `src/ui/SiteForm.test.tsx`

**Interfaces:**
- Consumes: `createSite`, `updateSite`, `SiteCreateInput`, `SiteUpdateInput` (T2), `labels` (T5), types (T3 P1a).
- Produces:
  - `<SiteForm mode="create" onSaved={(site) => void} onCancel={() => void} />`
  - `<SiteForm mode="edit" siteRow={SiteRow} onSaved={(site) => void} onCancel={() => void} />`

Behaviour: uncontrolled form using a single ref-based state. On submit, calls `createSite` or `updateSite` and invokes `onSaved` with the returned `Site`. In `create` mode, shows a live preview of the generated code (`labels.site.fields.code`: `<будет генериран при запис>` until saved). Errors from the service are surfaced in a `<div role="alert">` at the top of the form.

- [ ] **Step 1: Write failing tests**

Write `src/ui/SiteForm.test.tsx`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { resetDb, getDb } from '../cache/db';
import { SiteForm } from './SiteForm';
import { createSite } from '../domain/site-service';

beforeEach(async () => {
  await resetDb();
  clearRoot();
  setRoot(createMockRoot());
});

describe('<SiteForm mode="create">', () => {
  it('submits and calls onSaved with the new Site', async () => {
    const onSaved = vi.fn();
    render(<SiteForm mode="create" onSaved={onSaved} onCancel={() => {}} />);

    await userEvent.type(screen.getByLabelText(/име/i), 'Ivanov');
    await userEvent.type(screen.getByLabelText(/населено място/i), 'Долна Баня');
    await userEvent.type(screen.getByLabelText(/община/i), 'Долна Баня');
    await userEvent.type(screen.getByLabelText(/област/i), 'Софийска');
    await userEvent.type(screen.getByLabelText(/ширина/i), '42.32');
    await userEvent.type(screen.getByLabelText(/дължина/i), '23.78');

    await userEvent.click(screen.getByRole('button', { name: /запази/i }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const site = onSaved.mock.calls[0][0];
    expect(site.code).toBe('BG-SOF-0001');
    expect(site.name).toBe('Ivanov');
    expect(await getDb().sites.count()).toBe(1);
  });

  it('surfaces service errors in a role=alert region', async () => {
    // Force an error by not setting root
    clearRoot();
    render(<SiteForm mode="create" onSaved={() => {}} onCancel={() => {}} />);

    await userEvent.type(screen.getByLabelText(/име/i), 'X');
    await userEvent.type(screen.getByLabelText(/област/i), 'Софийска');
    await userEvent.type(screen.getByLabelText(/ширина/i), '0');
    await userEvent.type(screen.getByLabelText(/дължина/i), '0');
    await userEvent.click(screen.getByRole('button', { name: /запази/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/root folder/i);
  });
});

describe('<SiteForm mode="edit">', () => {
  it('pre-fills fields and updates on save', async () => {
    const site = await createSite({
      name: 'Ivanov', settlement: 'Долна Баня', municipality: 'Долна Баня',
      region: 'Софийска', centroid: { lat: 42.32, lon: 23.78 },
      accessNotes: '', landUse: '', status: 'surveyed', tags: [],
    });
    const row = (await getDb().sites.get(site.id))!;
    const onSaved = vi.fn();
    render(<SiteForm mode="edit" siteRow={row} onSaved={onSaved} onCancel={() => {}} />);

    const notes = screen.getByLabelText(/достъп/i);
    await userEvent.type(notes, 'портата е от север');
    await userEvent.click(screen.getByRole('button', { name: /запази/i }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const updated = onSaved.mock.calls[0][0];
    expect(updated.revision).toBe(2);
    expect(updated.accessNotes).toBe('портата е от север');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test src/ui/SiteForm.test.tsx
```

- [ ] **Step 3: Implement `src/ui/SiteForm.tsx`**

```typescript
import { useState, FormEvent } from 'react';
import { labels } from './labels';
import type { Site } from '../domain/types';
import type { SiteRow } from '../cache/db';
import { createSite, updateSite, SiteCreateInput } from '../domain/site-service';

type CreateProps = {
  mode: 'create';
  onSaved: (site: Site) => void;
  onCancel: () => void;
};
type EditProps = {
  mode: 'edit';
  siteRow: SiteRow;
  onSaved: (site: Site) => void;
  onCancel: () => void;
};
type Props = CreateProps | EditProps;

interface FormState {
  name: string;
  settlement: string;
  ekatte: string;
  cadastralParcelId: string;
  municipality: string;
  region: string;
  centroidLat: string;
  centroidLon: string;
  accessNotes: string;
  landUse: string;
  tags: string;
  status: Site['status'];
}

function initialFromRow(row: SiteRow): FormState {
  const s = row.json;
  return {
    name: s.name,
    settlement: s.settlement,
    ekatte: s.ekatte ?? '',
    cadastralParcelId: s.cadastralParcelId ?? '',
    municipality: s.municipality,
    region: s.region,
    centroidLat: String(s.centroid.lat),
    centroidLon: String(s.centroid.lon),
    accessNotes: s.accessNotes,
    landUse: s.landUse,
    tags: (s.tags ?? []).join(', '),
    status: s.status,
  };
}

const EMPTY: FormState = {
  name: '', settlement: '', ekatte: '', cadastralParcelId: '',
  municipality: '', region: '',
  centroidLat: '', centroidLon: '',
  accessNotes: '', landUse: '',
  tags: '', status: 'surveyed',
};

export function SiteForm(props: Props) {
  const initial = props.mode === 'edit' ? initialFromRow(props.siteRow) : EMPTY;
  const [state, setState] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const centroid = {
        lat: Number(state.centroidLat),
        lon: Number(state.centroidLon),
      };
      const tags = state.tags.split(',').map((t) => t.trim()).filter(Boolean);
      const base: SiteCreateInput = {
        name: state.name,
        settlement: state.settlement,
        ekatte: state.ekatte || undefined,
        cadastralParcelId: state.cadastralParcelId || undefined,
        municipality: state.municipality,
        region: state.region,
        centroid,
        accessNotes: state.accessNotes,
        landUse: state.landUse,
        tags,
        status: state.status,
      };
      if (props.mode === 'create') {
        const site = await createSite(base);
        props.onSaved(site);
      } else {
        const site = await updateSite(props.siteRow.id, base);
        props.onSaved(site);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const l = labels.site;
  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
      <h2>{props.mode === 'create' ? l.createTitle : l.editTitle}</h2>

      {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}

      <label>{l.fields.name}
        <input value={state.name} onChange={(e) => set('name', e.target.value)} required />
      </label>
      <label>{l.fields.settlement}
        <input value={state.settlement} onChange={(e) => set('settlement', e.target.value)} required />
      </label>
      <label>{l.fields.ekatte}
        <input value={state.ekatte} onChange={(e) => set('ekatte', e.target.value)} />
      </label>
      <label>{l.fields.cadastralParcelId}
        <input value={state.cadastralParcelId} onChange={(e) => set('cadastralParcelId', e.target.value)} />
      </label>
      <label>{l.fields.municipality}
        <input value={state.municipality} onChange={(e) => set('municipality', e.target.value)} required />
      </label>
      <label>{l.fields.region}
        <input value={state.region} onChange={(e) => set('region', e.target.value)} required />
      </label>
      <label>{l.fields.centroidLat}
        <input type="number" step="any" value={state.centroidLat}
               onChange={(e) => set('centroidLat', e.target.value)} required />
      </label>
      <label>{l.fields.centroidLon}
        <input type="number" step="any" value={state.centroidLon}
               onChange={(e) => set('centroidLon', e.target.value)} required />
      </label>
      <label>{l.fields.accessNotes}
        <textarea value={state.accessNotes} onChange={(e) => set('accessNotes', e.target.value)} />
      </label>
      <label>{l.fields.landUse}
        <input value={state.landUse} onChange={(e) => set('landUse', e.target.value)} />
      </label>
      <label>{l.fields.tags}
        <input value={state.tags} onChange={(e) => set('tags', e.target.value)} />
      </label>
      <label>{l.fields.status}
        <select value={state.status} onChange={(e) => set('status', e.target.value as Site['status'])}>
          {(Object.keys(l.statusOptions) as (keyof typeof l.statusOptions)[]).map((k) => (
            <option key={k} value={k}>{l.statusOptions[k]}</option>
          ))}
        </select>
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving}>{labels.common.save}</button>
        <button type="button" onClick={props.onCancel} disabled={saving}>{labels.common.cancel}</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run tests, typecheck, build**

```bash
npm test src/ui/SiteForm.test.tsx && npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/SiteForm.tsx src/ui/SiteForm.test.tsx
git commit -m "feat(ui): SiteForm (create + edit) with Bulgarian labels"
```

---

## Task 7: Survey form

**Files:**
- Create: `src/ui/SurveyForm.tsx`, `src/ui/SurveyForm.test.tsx`

**Interfaces:**
- Consumes: `createSurvey`, `updateSurvey`, `SurveyCreateInput` (T3), `labels` (T5), types.
- Produces:
  - `<SurveyForm mode="create" siteId={string} onSaved={(sv: Survey) => void} onCancel={() => void} />`
  - `<SurveyForm mode="edit" surveyRow={SurveyRow} onSaved={(sv: Survey) => void} onCancel={() => void} />`

Behaviour: identical shape to `SiteForm`. In `edit` mode on a finalized survey, an `editReason` textarea appears and is required — the form passes it as `opts.editReason` to `updateSurvey`. `startedAt` uses `type="datetime-local"`.

- [ ] **Step 1: Write failing tests**

Write `src/ui/SurveyForm.test.tsx`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { createSite } from '../domain/site-service';
import { createSurvey, finalizeSurvey } from '../domain/survey-service';
import { writeSyncProbe } from '../storage/sync';
import { SurveyForm } from './SurveyForm';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

async function makeSite() {
  return createSite({
    name: 'S', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
}

describe('<SurveyForm mode="create">', () => {
  it('creates a survey under the given site', async () => {
    const site = await makeSite();
    const onSaved = vi.fn();
    render(<SurveyForm mode="create" siteId={site.id} onSaved={onSaved} onCancel={() => {}} />);

    await userEvent.clear(screen.getByLabelText(/начало/i));
    await userEvent.type(screen.getByLabelText(/начало/i), '2026-09-15T10:00');
    await userEvent.type(screen.getByLabelText(/оператор/i), 'Anton');
    await userEvent.type(screen.getByLabelText(/уред \(модел\)/i), 'PQWT-TC300');
    await userEvent.type(screen.getByLabelText(/сериен номер/i), 'SN1');
    await userEvent.click(screen.getByRole('button', { name: /запази/i }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const sv = onSaved.mock.calls[0][0];
    expect(sv.operator).toBe('Anton');
    expect(await getDb().surveys.count()).toBe(1);
  });
});

describe('<SurveyForm mode="edit">', () => {
  it('requires an edit reason when the survey is finalized', async () => {
    const site = await makeSite();
    const sv = await createSurvey(site.id, {
      startedAt: new Date(Date.now() - 3600_000),
      timezone: 'Europe/Sofia', operator: 'Anton',
      deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    await writeSyncProbe(root, new Date());
    await finalizeSurvey(sv.id);
    const row = (await getDb().surveys.get(sv.id))!;

    const onSaved = vi.fn();
    render(<SurveyForm mode="edit" surveyRow={row} onSaved={onSaved} onCancel={() => {}} />);

    // Reason textarea must be visible for a finalized survey
    expect(screen.getByLabelText(/причина за промяната/i)).toBeInTheDocument();

    // Submit without reason: expect a client-side alert
    await userEvent.click(screen.getByRole('button', { name: /запази/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/посочи причина/i);
    expect(onSaved).not.toHaveBeenCalled();

    // Fill reason and submit
    await userEvent.type(screen.getByLabelText(/причина за промяната/i), 'typo fix');
    await userEvent.click(screen.getByRole('button', { name: /запази/i }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test src/ui/SurveyForm.test.tsx
```

- [ ] **Step 3: Implement `src/ui/SurveyForm.tsx`**

```typescript
import { useState, FormEvent } from 'react';
import { labels } from './labels';
import type { Survey } from '../domain/types';
import type { SurveyRow } from '../cache/db';
import { createSurvey, updateSurvey, SurveyCreateInput } from '../domain/survey-service';

type CreateProps = {
  mode: 'create';
  siteId: string;
  onSaved: (sv: Survey) => void;
  onCancel: () => void;
};
type EditProps = {
  mode: 'edit';
  surveyRow: SurveyRow;
  onSaved: (sv: Survey) => void;
  onCancel: () => void;
};
type Props = CreateProps | EditProps;

interface FormState {
  startedAt: string;        // datetime-local value: "YYYY-MM-DDTHH:mm"
  endedAt: string;
  timezone: string;
  operator: string;
  deviceModel: string;
  deviceSerial: string;
  firmware: string;
  weather: string;
  airTempC: string;
  precipLast48h: Survey['precipLast48h'];
  terrain: string;
  purpose: string;
  summary: string;
  qualityFlag: Survey['qualityFlag'];
}

function toLocalInput(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

function initialFromRow(row: SurveyRow): FormState {
  const s = row.json;
  return {
    startedAt: toLocalInput(new Date(s.startedAt)),
    endedAt: s.endedAt ? toLocalInput(new Date(s.endedAt)) : '',
    timezone: s.timezone,
    operator: s.operator,
    deviceModel: s.deviceModel,
    deviceSerial: s.deviceSerial,
    firmware: s.firmware ?? '',
    weather: s.weather ?? '',
    airTempC: s.airTempC != null ? String(s.airTempC) : '',
    precipLast48h: s.precipLast48h,
    terrain: s.terrain ?? '',
    purpose: s.purpose ?? '',
    summary: s.summary ?? '',
    qualityFlag: s.qualityFlag,
  };
}

const EMPTY: FormState = {
  startedAt: toLocalInput(new Date()),
  endedAt: '',
  timezone: 'Europe/Sofia',
  operator: '',
  deviceModel: 'PQWT-TC300',
  deviceSerial: '',
  firmware: '',
  weather: '',
  airTempC: '',
  precipLast48h: 'none',
  terrain: '',
  purpose: '',
  summary: '',
  qualityFlag: 'good',
};

export function SurveyForm(props: Props) {
  const initial = props.mode === 'edit' ? initialFromRow(props.surveyRow) : EMPTY;
  const [state, setState] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editReason, setEditReason] = useState('');

  const isFinalized = props.mode === 'edit' && !!props.surveyRow.json.finalizedAt;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isFinalized && !editReason.trim()) {
      setError(labels.survey.editReasonRequired);
      return;
    }

    setSaving(true);
    try {
      const base: SurveyCreateInput = {
        startedAt: new Date(state.startedAt),
        endedAt: state.endedAt ? new Date(state.endedAt) : undefined,
        timezone: state.timezone,
        operator: state.operator,
        deviceModel: state.deviceModel,
        deviceSerial: state.deviceSerial,
        firmware: state.firmware || undefined,
        weather: state.weather || undefined,
        airTempC: state.airTempC ? Number(state.airTempC) : undefined,
        precipLast48h: state.precipLast48h,
        terrain: state.terrain || undefined,
        purpose: state.purpose || undefined,
        summary: state.summary || undefined,
        qualityFlag: state.qualityFlag,
      };
      if (props.mode === 'create') {
        const sv = await createSurvey(props.siteId, base);
        props.onSaved(sv);
      } else {
        const sv = await updateSurvey(props.surveyRow.id, base, {
          editReason: isFinalized ? editReason.trim() : undefined,
        });
        props.onSaved(sv);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const l = labels.survey;
  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
      <h2>{props.mode === 'create' ? l.createTitle : l.editTitle}</h2>

      {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}

      <label>{l.fields.startedAt}
        <input type="datetime-local" value={state.startedAt}
               onChange={(e) => set('startedAt', e.target.value)} required />
      </label>
      <label>{l.fields.endedAt}
        <input type="datetime-local" value={state.endedAt}
               onChange={(e) => set('endedAt', e.target.value)} />
      </label>
      <label>{l.fields.timezone}
        <input value={state.timezone} onChange={(e) => set('timezone', e.target.value)} required />
      </label>
      <label>{l.fields.operator}
        <input value={state.operator} onChange={(e) => set('operator', e.target.value)} required />
      </label>
      <label>{l.fields.deviceModel}
        <input value={state.deviceModel} onChange={(e) => set('deviceModel', e.target.value)} required />
      </label>
      <label>{l.fields.deviceSerial}
        <input value={state.deviceSerial} onChange={(e) => set('deviceSerial', e.target.value)} required />
      </label>
      <label>{l.fields.firmware}
        <input value={state.firmware} onChange={(e) => set('firmware', e.target.value)} />
      </label>
      <label>{l.fields.weather}
        <input value={state.weather} onChange={(e) => set('weather', e.target.value)} />
      </label>
      <label>{l.fields.airTempC}
        <input type="number" step="any" value={state.airTempC}
               onChange={(e) => set('airTempC', e.target.value)} />
      </label>
      <label>{l.fields.precipLast48h}
        <select value={state.precipLast48h}
                onChange={(e) => set('precipLast48h', e.target.value as Survey['precipLast48h'])}>
          {(Object.keys(l.precipOptions) as (keyof typeof l.precipOptions)[]).map((k) => (
            <option key={k} value={k}>{l.precipOptions[k]}</option>
          ))}
        </select>
      </label>
      <label>{l.fields.terrain}
        <input value={state.terrain} onChange={(e) => set('terrain', e.target.value)} />
      </label>
      <label>{l.fields.purpose}
        <input value={state.purpose} onChange={(e) => set('purpose', e.target.value)} />
      </label>
      <label>{l.fields.summary}
        <textarea value={state.summary} onChange={(e) => set('summary', e.target.value)} />
      </label>
      <label>{l.fields.qualityFlag}
        <select value={state.qualityFlag}
                onChange={(e) => set('qualityFlag', e.target.value as Survey['qualityFlag'])}>
          {(Object.keys(l.qualityOptions) as (keyof typeof l.qualityOptions)[]).map((k) => (
            <option key={k} value={k}>{l.qualityOptions[k]}</option>
          ))}
        </select>
      </label>

      {isFinalized && (
        <label>{l.editReasonLabel}
          <textarea value={editReason} onChange={(e) => setEditReason(e.target.value)}
                    aria-required="true" />
        </label>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving}>{labels.common.save}</button>
        <button type="button" onClick={props.onCancel} disabled={saving}>{labels.common.cancel}</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run tests, typecheck, build**

```bash
npm test src/ui/SurveyForm.test.tsx && npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/SurveyForm.tsx src/ui/SurveyForm.test.tsx
git commit -m "feat(ui): SurveyForm (create + edit) with §10.9-aware edit-reason requirement"
```

---

## Task 8: Site detail screen

**Files:**
- Create: `src/ui/SiteDetail.tsx`, `src/ui/SiteDetail.test.tsx`

**Interfaces:**
- Consumes: `useSite`, `useSurveys` (T4), `softDeleteSite` (T2), `labels` (T5), types.
- Produces:
  - `<SiteDetail siteId={string} onEdit={() => void} onDeleted={() => void} onNewSurvey={() => void} onOpenSurvey={(surveyId: string) => void} />`

Renders: site header (name, code), all metadata fields (read-only view), a surveys list under the site (or "no surveys yet"), "Edit", "Delete", and "New survey" buttons. Delete calls `softDeleteSite` and invokes `onDeleted`.

- [ ] **Step 1: Write failing tests**

Write `src/ui/SiteDetail.test.tsx`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { createSite } from '../domain/site-service';
import { createSurvey } from '../domain/survey-service';
import { SiteDetail } from './SiteDetail';

beforeEach(async () => {
  await resetDb();
  clearRoot();
  setRoot(createMockRoot());
});

describe('<SiteDetail />', () => {
  it('renders the site fields and its surveys', async () => {
    const site = await createSite({
      name: 'Ivanov', settlement: 'Долна Баня', municipality: 'Долна Баня',
      region: 'Софийска', centroid: { lat: 42.32, lon: 23.78 },
      accessNotes: '', landUse: '', status: 'surveyed', tags: [],
    });
    await createSurvey(site.id, {
      startedAt: new Date('2026-09-15T10:00:00Z'),
      timezone: 'Europe/Sofia', operator: 'Anton',
      deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });

    render(<SiteDetail
      siteId={site.id}
      onEdit={() => {}}
      onDeleted={() => {}}
      onNewSurvey={() => {}}
      onOpenSurvey={() => {}}
    />);

    expect(await screen.findByText('Ivanov')).toBeInTheDocument();
    expect(screen.getByText('BG-SOF-0001')).toBeInTheDocument();
    // The survey list shows the surveyed operator
    expect(await screen.findByText(/Anton/)).toBeInTheDocument();
  });

  it('soft-deletes and calls onDeleted', async () => {
    const site = await createSite({
      name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    const onDeleted = vi.fn();
    render(<SiteDetail
      siteId={site.id}
      onEdit={() => {}}
      onDeleted={onDeleted}
      onNewSurvey={() => {}}
      onOpenSurvey={() => {}}
    />);

    // Confirm dialog via window.confirm — stub it to true
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await screen.findByText('X');
    await userEvent.click(screen.getByRole('button', { name: /изтрий/i }));
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(await getDb().sites.count()).toBe(0);
  });

  it('shows "no surveys" empty state when there are none', async () => {
    const site = await createSite({
      name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    render(<SiteDetail
      siteId={site.id}
      onEdit={() => {}}
      onDeleted={() => {}}
      onNewSurvey={() => {}}
      onOpenSurvey={() => {}}
    />);
    expect(await screen.findByText(/няма проучвания/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test src/ui/SiteDetail.test.tsx
```

- [ ] **Step 3: Implement `src/ui/SiteDetail.tsx`**

```typescript
import { useState } from 'react';
import { labels } from './labels';
import { useSite, useSurveys } from '../cache/hooks';
import { softDeleteSite } from '../domain/site-service';

interface Props {
  siteId: string;
  onEdit: () => void;
  onDeleted: () => void;
  onNewSurvey: () => void;
  onOpenSurvey: (surveyId: string) => void;
}

export function SiteDetail(props: Props) {
  const site = useSite(props.siteId);
  const surveys = useSurveys(props.siteId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!site) return <p>{labels.common.loading}</p>;

  const onDelete = async () => {
    if (!window.confirm(labels.site.deleteConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      await softDeleteSite(props.siteId);
      props.onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const s = site.json;
  const l = labels.site;
  return (
    <section style={{ padding: 16, maxWidth: 720 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{s.name}</h1>
        <code>{s.code}</code>
      </header>

      {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}

      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px' }}>
        <dt>{l.fields.settlement}</dt><dd>{s.settlement}</dd>
        <dt>{l.fields.municipality}</dt><dd>{s.municipality}</dd>
        <dt>{l.fields.region}</dt><dd>{s.region}</dd>
        <dt>{l.fields.centroidLat}</dt><dd>{s.centroid.lat}</dd>
        <dt>{l.fields.centroidLon}</dt><dd>{s.centroid.lon}</dd>
        {s.ekatte && (<><dt>{l.fields.ekatte}</dt><dd>{s.ekatte}</dd></>)}
        {s.cadastralParcelId && (<><dt>{l.fields.cadastralParcelId}</dt><dd>{s.cadastralParcelId}</dd></>)}
        {s.accessNotes && (<><dt>{l.fields.accessNotes}</dt><dd>{s.accessNotes}</dd></>)}
        {s.landUse && (<><dt>{l.fields.landUse}</dt><dd>{s.landUse}</dd></>)}
        {s.tags?.length ? (<><dt>{l.fields.tags}</dt><dd>{s.tags.join(', ')}</dd></>) : null}
        <dt>{l.fields.status}</dt><dd>{l.statusOptions[s.status]}</dd>
      </dl>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={props.onEdit} disabled={busy}>{labels.common.edit}</button>
        <button onClick={onDelete} disabled={busy}>{labels.common.delete}</button>
        <button onClick={props.onNewSurvey} disabled={busy}>{l.newSurvey}</button>
      </div>

      <h2>{l.surveysHeading}</h2>
      {surveys === undefined ? (
        <p>{labels.common.loading}</p>
      ) : surveys.length === 0 ? (
        <p>{l.noSurveys}</p>
      ) : (
        <ul>
          {surveys.map((sv) => (
            <li key={sv.id}>
              <button
                style={{ background: 'none', border: 'none', padding: 0, color: 'steelblue', cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => props.onOpenSurvey(sv.id)}
              >
                {sv.folderName} · {sv.json.operator}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run tests, typecheck, build**

```bash
npm test src/ui/SiteDetail.test.tsx && npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/SiteDetail.tsx src/ui/SiteDetail.test.tsx
git commit -m "feat(ui): SiteDetail — read view + surveys list + edit/delete/new-survey actions"
```

---

## Task 9: Survey detail screen

**Files:**
- Create: `src/ui/SurveyDetail.tsx`, `src/ui/SurveyDetail.test.tsx`

**Interfaces:**
- Consumes: `useSurvey` (T4), `finalizeSurvey` (T3), `labels` (T5), types.
- Produces:
  - `<SurveyDetail surveyId={string} onEdit={() => void} onBack={() => void} />`

Renders: header (folder name + operator + finalized status), all metadata fields, a "Lines" placeholder section (`labels.survey.linesPlaceholder`), an Edit button, a Finalize button (hidden if already finalized). Finalize calls `finalizeSurvey`; on error, surfaces the message in a role=alert region.

- [ ] **Step 1: Write failing tests**

Write `src/ui/SurveyDetail.test.tsx`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { createSite } from '../domain/site-service';
import { createSurvey } from '../domain/survey-service';
import { writeSyncProbe } from '../storage/sync';
import { SurveyDetail } from './SurveyDetail';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

async function seed() {
  const site = await createSite({
    name: 'S', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
  const sv = await createSurvey(site.id, {
    startedAt: new Date(Date.now() - 3600_000),
    timezone: 'Europe/Sofia', operator: 'Anton',
    deviceModel: 'PQWT-TC300', deviceSerial: 'x',
    precipLast48h: 'none', qualityFlag: 'good',
  });
  return { site, sv };
}

describe('<SurveyDetail />', () => {
  it('renders survey fields and the lines placeholder', async () => {
    const { sv } = await seed();
    render(<SurveyDetail surveyId={sv.id} onEdit={() => {}} onBack={() => {}} />);
    expect(await screen.findByText('Anton')).toBeInTheDocument();
    expect(screen.getByText(/следваща фаза/i)).toBeInTheDocument();
  });

  it('finalize button succeeds when the sync probe is fresh', async () => {
    const { sv } = await seed();
    await writeSyncProbe(root, new Date());

    render(<SurveyDetail surveyId={sv.id} onEdit={() => {}} onBack={() => {}} />);
    await screen.findByText('Anton');
    await userEvent.click(screen.getByRole('button', { name: /заключи/i }));

    await screen.findByText(/заключено/i);
  });

  it('finalize surfaces the §10.9 backup error when the probe is missing', async () => {
    const { sv } = await seed();
    // No probe written
    render(<SurveyDetail surveyId={sv.id} onEdit={() => {}} onBack={() => {}} />);
    await screen.findByText('Anton');
    await userEvent.click(screen.getByRole('button', { name: /заключи/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/backup|синхрон/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test src/ui/SurveyDetail.test.tsx
```

- [ ] **Step 3: Implement `src/ui/SurveyDetail.tsx`**

```typescript
import { useState } from 'react';
import { labels } from './labels';
import { useSurvey } from '../cache/hooks';
import { finalizeSurvey } from '../domain/survey-service';

interface Props {
  surveyId: string;
  onEdit: () => void;
  onBack: () => void;
}

export function SurveyDetail({ surveyId, onEdit, onBack }: Props) {
  const row = useSurvey(surveyId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!row) return <p>{labels.common.loading}</p>;
  const s = row.json;
  const l = labels.survey;

  const onFinalize = async () => {
    setError(null);
    setBusy(true);
    try {
      await finalizeSurvey(surveyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ padding: 16, maxWidth: 720 }}>
      <button onClick={onBack}>{labels.common.back}</button>

      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{l.title}</h1>
        <code>{row.folderName}</code>
      </header>

      {s.finalizedAt && (
        <p>{l.finalized}: {new Date(s.finalizedAt).toLocaleString('bg-BG')}</p>
      )}

      {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}

      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px' }}>
        <dt>{l.fields.startedAt}</dt><dd>{new Date(s.startedAt).toLocaleString('bg-BG')}</dd>
        {s.endedAt && (<><dt>{l.fields.endedAt}</dt><dd>{new Date(s.endedAt).toLocaleString('bg-BG')}</dd></>)}
        <dt>{l.fields.timezone}</dt><dd>{s.timezone}</dd>
        <dt>{l.fields.operator}</dt><dd>{s.operator}</dd>
        <dt>{l.fields.deviceModel}</dt><dd>{s.deviceModel}</dd>
        <dt>{l.fields.deviceSerial}</dt><dd>{s.deviceSerial}</dd>
        {s.firmware && (<><dt>{l.fields.firmware}</dt><dd>{s.firmware}</dd></>)}
        {s.weather && (<><dt>{l.fields.weather}</dt><dd>{s.weather}</dd></>)}
        {s.airTempC != null && (<><dt>{l.fields.airTempC}</dt><dd>{s.airTempC}</dd></>)}
        <dt>{l.fields.precipLast48h}</dt><dd>{l.precipOptions[s.precipLast48h]}</dd>
        {s.terrain && (<><dt>{l.fields.terrain}</dt><dd>{s.terrain}</dd></>)}
        {s.purpose && (<><dt>{l.fields.purpose}</dt><dd>{s.purpose}</dd></>)}
        {s.summary && (<><dt>{l.fields.summary}</dt><dd>{s.summary}</dd></>)}
        <dt>{l.fields.qualityFlag}</dt><dd>{l.qualityOptions[s.qualityFlag]}</dd>
      </dl>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={onEdit} disabled={busy}>{labels.common.edit}</button>
        {!s.finalizedAt && (
          <button onClick={onFinalize} disabled={busy}>{l.finalize}</button>
        )}
      </div>

      <h2>{l.linesHeading}</h2>
      <p>{l.linesPlaceholder}</p>
    </section>
  );
}
```

- [ ] **Step 4: Run tests, typecheck, build**

```bash
npm test src/ui/SurveyDetail.test.tsx && npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/SurveyDetail.tsx src/ui/SurveyDetail.test.tsx
git commit -m "feat(ui): SurveyDetail — read view + finalize action"
```

---

## Task 10: SiteList with search filter

**Files:**
- Modify: `src/ui/SiteList.tsx` — replace direct `getDb()` query with `useSites({ query })` hook; add a search input.
- Create: `src/ui/SiteList.test.tsx`

**Interfaces:**
- Consumes: `useSites` (T4), `labels` (T5).
- Produces:
  - `<SiteList onOpen={(siteId: string) => void} />` — renders a text input and a list of sites; each row calls `onOpen(id)` when clicked.

- [ ] **Step 1: Write failing test**

Write `src/ui/SiteList.test.tsx`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { resetDb } from '../cache/db';
import { createSite } from '../domain/site-service';
import { SiteList } from './SiteList';

beforeEach(async () => {
  await resetDb();
  clearRoot();
  setRoot(createMockRoot());
});

describe('<SiteList />', () => {
  it('renders all sites and calls onOpen when clicked', async () => {
    const a = await createSite({
      name: 'Ivanov', settlement: 'Долна Баня', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    await createSite({
      name: 'Petrov', settlement: 'Костенец', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });

    const onOpen = vi.fn();
    render(<SiteList onOpen={onOpen} />);

    expect(await screen.findByText(/Ivanov/)).toBeInTheDocument();
    expect(screen.getByText(/Petrov/)).toBeInTheDocument();

    await userEvent.click(screen.getByText(/Ivanov/));
    expect(onOpen).toHaveBeenCalledWith(a.id);
  });

  it('filters by search query (case-insensitive)', async () => {
    await createSite({
      name: 'Ivanov', settlement: 'Долна Баня', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    await createSite({
      name: 'Petrov', settlement: 'Костенец', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });

    render(<SiteList onOpen={() => {}} />);
    await screen.findByText(/Ivanov/);

    await userEvent.type(screen.getByRole('searchbox'), 'костен');
    expect(await screen.findByText(/Petrov/)).toBeInTheDocument();
    expect(screen.queryByText(/Ivanov/)).not.toBeInTheDocument();
  });

  it('shows empty state when no sites match', async () => {
    render(<SiteList onOpen={() => {}} />);
    expect(await screen.findByText(/няма обекти/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test src/ui/SiteList.test.tsx
```

- [ ] **Step 3: Rewrite `src/ui/SiteList.tsx`**

Replace the entire file:
```typescript
import { useState } from 'react';
import { labels } from './labels';
import { useSites } from '../cache/hooks';

interface Props {
  onOpen: (siteId: string) => void;
}

export function SiteList({ onOpen }: Props) {
  const [query, setQuery] = useState('');
  const sites = useSites({ query });

  if (sites === undefined) return <p>{labels.common.loading}</p>;

  return (
    <div>
      <input
        type="search"
        placeholder={labels.common.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%', padding: 8, marginBottom: 8 }}
      />
      {sites.length === 0 ? (
        <p>{labels.home.noSites}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {sites.map((s) => (
            <li key={s.id} style={{ padding: '4px 0' }}>
              <button
                onClick={() => onOpen(s.id)}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  color: 'steelblue', cursor: 'pointer', textDecoration: 'underline',
                  fontSize: 'inherit', fontFamily: 'inherit',
                }}
              >
                <strong>{s.code}</strong> — {s.json.name} ({s.json.settlement})
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests, typecheck, build**

```bash
npm test src/ui/SiteList.test.tsx src/ui/Home.test.tsx && npm run typecheck && npm run build
```
(Home.test.tsx also renders SiteList — verify no regression.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/SiteList.tsx src/ui/SiteList.test.tsx
git commit -m "feat(ui): SiteList uses useSites hook + adds live search filter"
```

---

## Task 11: Routing with wouter

**Files:**
- Create: `src/ui/Router.tsx`, `src/ui/Router.test.tsx`
- Modify: `src/ui/Home.tsx` — after the folder is picked, render `<Router />` instead of `<SiteList />` directly. Keep the `SyncIndicator` + `<h1>` header.
- Modify: `package.json` — add `wouter@^3.3.5`.

**Interfaces:**
- Consumes: `<SiteList>` (T10), `<SiteForm>` (T6), `<SurveyForm>` (T7), `<SiteDetail>` (T8), `<SurveyDetail>` (T9), `wouter`.
- Produces:
  - `<Router />` renders the correct screen for each route:
    - `/` → `<SiteList onOpen={id => setLocation('/sites/' + id)} />` + a `New site` button that navigates to `/sites/new`.
    - `/sites/new` → `<SiteForm mode="create" onSaved={(site) => setLocation('/sites/' + site.id)} onCancel={() => setLocation('/')} />`.
    - `/sites/:id` → `<SiteDetail siteId={id} onEdit={→ /sites/:id/edit} onDeleted={→ /} onNewSurvey={→ /sites/:id/surveys/new} onOpenSurvey={svId => /sites/:id/surveys/:svId} />`.
    - `/sites/:id/edit` → `<SiteForm mode="edit" siteRow={row}` — hook to load row via `useSite(id)`; if `undefined`, render loading.
    - `/sites/:id/surveys/new` → `<SurveyForm mode="create" siteId={id} onSaved={sv => /sites/:id/surveys/:sv.id} onCancel={→ /sites/:id} />`.
    - `/sites/:id/surveys/:svId` → `<SurveyDetail surveyId={svId} onEdit={→ /sites/:id/surveys/:svId/edit} onBack={→ /sites/:id} />`.
    - `/sites/:id/surveys/:svId/edit` → `<SurveyForm mode="edit" surveyRow={row}` — hook via `useSurvey(svId)`.
    - Any other path → 404 fallback.

- [ ] **Step 1: Install wouter**

```bash
npm install --save wouter@^3.3.5
```

- [ ] **Step 2: Write failing test**

Write `src/ui/Router.test.tsx`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router as WRouter } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { resetDb } from '../cache/db';
import { createSite } from '../domain/site-service';
import { Router } from './Router';

beforeEach(async () => {
  await resetDb();
  clearRoot();
  setRoot(createMockRoot());
});

function renderAt(path: string) {
  const { hook } = memoryLocation({ path });
  return render(
    <WRouter hook={hook}>
      <Router />
    </WRouter>,
  );
}

describe('<Router />', () => {
  it('renders SiteList at "/"', async () => {
    renderAt('/');
    expect(await screen.findByRole('searchbox')).toBeInTheDocument();
  });

  it('renders SiteForm create at "/sites/new"', async () => {
    renderAt('/sites/new');
    expect(await screen.findByText(/нов обект/i)).toBeInTheDocument();
  });

  it('renders SiteDetail at "/sites/:id"', async () => {
    const site = await createSite({
      name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    renderAt(`/sites/${site.id}`);
    expect(await screen.findByText('X')).toBeInTheDocument();
    expect(screen.getByText(site.code)).toBeInTheDocument();
  });

  it('navigates from list to detail via click', async () => {
    const site = await createSite({
      name: 'Ivanov', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    renderAt('/');
    await screen.findByText(/Ivanov/);
    await userEvent.click(screen.getByText(/Ivanov/));
    expect(await screen.findByText('Ivanov', { selector: 'h1' })).toBeInTheDocument();
    expect(screen.getByText(site.code)).toBeInTheDocument();
  });

  it('renders a 404 for unknown paths', () => {
    renderAt('/nope');
    expect(screen.getByText(/не е намерено/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Implement `src/ui/Router.tsx`**

```typescript
import { Route, Switch, useLocation, useRoute } from 'wouter';
import { labels } from './labels';
import { SiteList } from './SiteList';
import { SiteForm } from './SiteForm';
import { SurveyForm } from './SurveyForm';
import { SiteDetail } from './SiteDetail';
import { SurveyDetail } from './SurveyDetail';
import { useSite, useSurvey } from '../cache/hooks';

function SiteEditRoute({ params }: { params: { id: string } }) {
  const row = useSite(params.id);
  const [, setLocation] = useLocation();
  if (!row) return <p>{labels.common.loading}</p>;
  return (
    <SiteForm
      mode="edit"
      siteRow={row}
      onSaved={() => setLocation(`/sites/${params.id}`)}
      onCancel={() => setLocation(`/sites/${params.id}`)}
    />
  );
}

function SurveyNewRoute({ params }: { params: { id: string } }) {
  const [, setLocation] = useLocation();
  return (
    <SurveyForm
      mode="create"
      siteId={params.id}
      onSaved={(sv) => setLocation(`/sites/${params.id}/surveys/${sv.id}`)}
      onCancel={() => setLocation(`/sites/${params.id}`)}
    />
  );
}

function SurveyEditRoute({ params }: { params: { id: string; svId: string } }) {
  const row = useSurvey(params.svId);
  const [, setLocation] = useLocation();
  if (!row) return <p>{labels.common.loading}</p>;
  return (
    <SurveyForm
      mode="edit"
      surveyRow={row}
      onSaved={() => setLocation(`/sites/${params.id}/surveys/${params.svId}`)}
      onCancel={() => setLocation(`/sites/${params.id}/surveys/${params.svId}`)}
    />
  );
}

function SiteDetailRoute({ params }: { params: { id: string } }) {
  const [, setLocation] = useLocation();
  return (
    <SiteDetail
      siteId={params.id}
      onEdit={() => setLocation(`/sites/${params.id}/edit`)}
      onDeleted={() => setLocation('/')}
      onNewSurvey={() => setLocation(`/sites/${params.id}/surveys/new`)}
      onOpenSurvey={(svId) => setLocation(`/sites/${params.id}/surveys/${svId}`)}
    />
  );
}

function SurveyDetailRoute({ params }: { params: { id: string; svId: string } }) {
  const [, setLocation] = useLocation();
  return (
    <SurveyDetail
      surveyId={params.svId}
      onEdit={() => setLocation(`/sites/${params.id}/surveys/${params.svId}/edit`)}
      onBack={() => setLocation(`/sites/${params.id}`)}
    />
  );
}

function HomeRoute() {
  const [, setLocation] = useLocation();
  return (
    <div>
      <button onClick={() => setLocation('/sites/new')} style={{ marginBottom: 8 }}>
        {labels.home.newSite}
      </button>
      <SiteList onOpen={(id) => setLocation(`/sites/${id}`)} />
    </div>
  );
}

function SiteNewRoute() {
  const [, setLocation] = useLocation();
  return (
    <SiteForm
      mode="create"
      onSaved={(site) => setLocation(`/sites/${site.id}`)}
      onCancel={() => setLocation('/')}
    />
  );
}

export function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRoute} />
      <Route path="/sites/new" component={SiteNewRoute} />
      <Route path="/sites/:id/edit">
        {(params) => <SiteEditRoute params={params as { id: string }} />}
      </Route>
      <Route path="/sites/:id/surveys/new">
        {(params) => <SurveyNewRoute params={params as { id: string }} />}
      </Route>
      <Route path="/sites/:id/surveys/:svId/edit">
        {(params) => <SurveyEditRoute params={params as { id: string; svId: string }} />}
      </Route>
      <Route path="/sites/:id/surveys/:svId">
        {(params) => <SurveyDetailRoute params={params as { id: string; svId: string }} />}
      </Route>
      <Route path="/sites/:id">
        {(params) => <SiteDetailRoute params={params as { id: string }} />}
      </Route>
      <Route>
        <p>{labels.errors.notFound}</p>
      </Route>
    </Switch>
  );
}
```

- [ ] **Step 4: Modify `src/ui/Home.tsx`**

Replace the ready-branch body to render `<Router />` instead of `<h2>Sites</h2><SiteList />`:

Locate the block:
```typescript
      <section>
        <h2>Sites</h2>
        <SiteList />
      </section>
```
Replace with:
```typescript
      <Router />
```

Add near the top:
```typescript
import { Router } from './Router';
```
Remove the now-unused `SiteList` import.

Additionally, when `Home` calls `loadRoot(root)`, it should also register the root with the storage layer for service functions:
```typescript
// At the top of the file, alongside existing imports:
import { setRoot } from '../storage/fs';
```
Inside `loadRoot`, after `if (!(await verifyPermission(root))) throw ...`, add:
```typescript
setRoot(root);
```

- [ ] **Step 5: Update `src/ui/Home.test.tsx`**

The existing "after picking a folder with a site, lists the site" test used `screen.getByText('BG-SOF-0043')`. That still works because the SiteList is now rendered under Router at `/`. No test changes should be needed, but run to confirm — if the assertion regressed because of the routing wrapper, adjust to `await screen.findByText('BG-SOF-0043')`.

- [ ] **Step 6: Run all tests, typecheck, build**

```bash
npm test && npm run typecheck && npm run build
```
Expected: everything green.

- [ ] **Step 7: Commit**

```bash
git add src/ui/Router.tsx src/ui/Router.test.tsx src/ui/Home.tsx package.json package-lock.json
git commit -m "feat(ui): wire wouter router for site + survey CRUD screens"
```

---

## Task 12: Integration test — full CRUD flow

**Files:**
- Create: `integration/phase1b-crud-flow.test.ts`

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Write the test**

Write `integration/phase1b-crud-flow.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../src/test/mock-fs';
import { setRoot, clearRoot } from '../src/storage/fs';
import { getDb, resetDb } from '../src/cache/db';
import { readJson } from '../src/storage/atomic';
import { getPath } from '../src/storage/paths';
import { writeSyncProbe } from '../src/storage/sync';
import { createSite, updateSite, softDeleteSite, restoreSite } from '../src/domain/site-service';
import { createSurvey, updateSurvey, finalizeSurvey } from '../src/domain/survey-service';
import type { Site, Survey } from '../src/domain/types';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

describe('Phase 1b full CRUD flow', () => {
  it('create site → create survey → edit both → finalize → soft-delete → restore', async () => {
    // 1. Create a site
    const site = await createSite({
      name: 'Ivanov', settlement: 'Долна Баня', municipality: 'Долна Баня',
      region: 'Софийска', centroid: { lat: 42.32, lon: 23.78 },
      accessNotes: '', landUse: '', status: 'surveyed', tags: ['pilot'],
    });
    expect(site.code).toBe('BG-SOF-0001');
    expect(site.revision).toBe(1);

    // 2. Create a survey under it
    const startedAt = new Date(Date.now() - 3600_000);
    const sv = await createSurvey(site.id, {
      startedAt,
      timezone: 'Europe/Sofia',
      operator: 'Anton',
      deviceModel: 'PQWT-TC300',
      deviceSerial: 'SN1',
      precipLast48h: 'none',
      qualityFlag: 'good',
    });
    expect(sv.siteId).toBe(site.id);
    expect(sv.revision).toBe(1);

    // 3. Edit the site — bumps revision
    const site2 = await updateSite(site.id, { accessNotes: 'north gate' });
    expect(site2.revision).toBe(2);
    expect(site2.accessNotes).toBe('north gate');

    // 4. Edit the survey (still a draft — no reason needed)
    const sv2 = await updateSurvey(sv.id, { summary: 'clean survey' });
    expect(sv2.revision).toBe(2);
    expect(sv2.summary).toBe('clean survey');

    // 5. Finalize the survey (needs a fresh probe)
    await writeSyncProbe(root, new Date());
    const svFinal = await finalizeSurvey(sv.id);
    expect(svFinal.finalizedAt).toBeDefined();
    expect(svFinal.revision).toBe(3);

    // 6. Edit after finalize — requires a reason
    await expect(updateSurvey(sv.id, { operator: 'x' })).rejects.toThrow(/reason/i);
    const svEdited = await updateSurvey(sv.id, { operator: 'Ivan' }, { editReason: 'typo' });
    expect((svEdited as any).editHistory).toBeDefined();
    expect((svEdited as any).editHistory[0].reason).toBe('typo');
    expect(svEdited.revision).toBe(4);

    // 7. Verify JSON on disk matches the cache
    const svDir = await getPath(root, ['sites', 'BG-SOF-0001_Ivanov', 'surveys', (await getDb().surveys.get(sv.id))!.folderName]);
    const persisted = await readJson<Survey>(svDir!, 'survey.json');
    expect(persisted.operator).toBe('Ivan');
    expect(persisted.finalizedAt).toBeDefined();
    expect(persisted.revision).toBe(4);

    // 8. Soft-delete the site (survey rows remain but the site is gone from the cache)
    await softDeleteSite(site.id);
    expect(await getDb().sites.get(site.id)).toBeUndefined();

    const tombs = await getPath(root, ['_tombstones']);
    let tombName: string | null = null;
    for await (const [n, h] of (tombs as any).entries()) {
      if (h.kind === 'file' && n.startsWith('BG-SOF-0001_Ivanov_')) tombName = n;
    }
    expect(tombName).not.toBeNull();

    // 9. Restore
    const restored = await restoreSite(tombName!);
    expect(restored.id).toBe(site.id);
    expect(restored.deletedAt).toBeUndefined();
    expect(await getDb().sites.get(site.id)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the whole suite**

```bash
npm test && npm run typecheck && npm run build
```
Expected: all green.

- [ ] **Step 3: Manual sanity check (optional but recommended)**

Run:
```bash
npm run dev
```
Open the printed localhost URL. Pick a scratch folder. Click "Нов обект", fill the form, save. See the new site in the list. Click it — see the detail. Add a survey. Finalize (may hit backup gate — write a probe manually or accept the friendly error).

- [ ] **Step 4: Commit**

```bash
git add integration/phase1b-crud-flow.test.ts
git commit -m "test(integration): Phase 1b full CRUD flow (site + survey lifecycle)"
```

---

## Done criteria

All true before this plan is considered complete:

- [ ] `npm test` reports every test file green (target: ~90+ tests total).
- [ ] `npm run typecheck` passes with no errors.
- [ ] `npm run build` produces a `dist/` folder without errors.
- [ ] `npm run dev` opens an app that can pick a folder, create/edit/delete sites, create/edit/finalize surveys, and shows the sync-indicator honestly.
- [ ] The integration test in `integration/phase1b-crud-flow.test.ts` proves the full CRUD lifecycle works end-to-end.
- [ ] Git history has one commit per task (12 commits total).
- [ ] All Bulgarian UI copy lives in `src/ui/labels.ts` — no user-visible string literals in components.
- [ ] Every task ran `npm run typecheck` before its commit (per Phase 1a's ruling).
