# Final-Review Fix Report — Phase 1b

## M1 (Critical) — restore-after-rename corrupts the folder graph

### Changes

**`src/domain/site-service.ts`**
- Line 13-15: Narrowed `SiteUpdateInput` — added `'name'` to the `Omit` list so `updateSite` no longer accepts a `name` property.
- Lines 17-19: Added internal `interface TombstonedSite extends Site { folderName?: string }`.
- `softDeleteSite` (line ~82): Changed tombstone type to `TombstonedSite` and added `folderName: row.folderName` to the payload, persisting the original folder name into the tombstone JSON.
- `restoreSite` (line ~108, ~117): Changed read type to `TombstonedSite`; folderName now computed as `stored.folderName ?? siteFolderName(restored.code, restored.name)` — prefers persisted value, backward-compatible fallback for old tombstones without `folderName`.

**`src/ui/SiteForm.tsx`**
- Added `SiteUpdateInput` to imports from `site-service`.
- Split `onSubmit` into two branches: create branch builds `SiteCreateInput` (includes `name`); edit branch builds `SiteUpdateInput` (omits `name`).
- Form render: in edit mode, replaces the name `<label>/<input>` block with `<h3 style={{marginTop:0}}>{state.name}</h3>` (read-only immutable display).

### Test added
- `integration/phase1b-crud-flow.test.ts`: new `it('restore after ordinary edits keeps the folder graph intact')` — creates site + survey, edits accessNotes, soft-deletes, restores, verifies site folder + surveys/ subtree still present and survey row still in cache.
- `src/domain/site-service.test.ts`: new `it('SiteUpdateInput does not accept a name property (Option B guard)')` — `@ts-expect-error` compile-time assertion.

---

## M2 (High) — soft-delete leaves dangling surveys in the cache

### Changes

**`src/cache/hooks.ts`**
- `useSurveys` (line 37-44): Added `const site = await getDb().sites.get(siteId); if (!site) return [];` guard before fetching survey rows. Orphan surveys hidden until site is restored; Dexie mutation triggers re-run automatically on restore.

### Test added
- `src/cache/hooks.test.tsx`: new `it('useSurveys returns empty array when the parent site row is missing')` — inserts a survey with siteId `'MISSING'` (no corresponding site row), asserts `useSurveys('MISSING')` returns `[]`.

---

## Hygiene — remaining English strings in Home.tsx

### Changes

**`src/ui/Home.tsx`**
- Added `import { labels } from './labels';`.
- Replaced `'Scanning…'` with `labels.home.scanning`.
- Replaced `'Pick folder'` with `labels.home.pickFolder`.

**`src/ui/Home.test.tsx`** (pre-existing test file, not new)
- Updated 3 occurrences of `/pick folder/i` regex to `/избери папка/i` to match the now-Bulgarian button text.

Note: `labels.home.pickFolder` (`'Избери папка'`) and `labels.home.scanning` (`'Сканиране…'`) already existed in `src/ui/labels.ts` — no label additions needed.

---

## Test / Typecheck / Build output

```
Test Files  26 passed (26)
Tests       132 passed (132)
Start at    10:34:55
Duration    5.43s
```

Typecheck: `tsc --noEmit` — exit 0, no errors.

Build: `vite build` — exit 0, `dist/assets/index-D95ZzqZm.js 279.30 kB`.

---

## Surprises

- `Home.test.tsx` had 3 existing tests using `/pick folder/i` regex — these broke immediately after the hygiene fix and had to be updated to `/избери папка/i`. The fix was straightforward and is a correct consequence of the label hygiene change.
- The `useSurveys` test needed a site row pre-inserted in the existing `useSurveys returns surveys under a site` test (it already had one via `db.sites.put(siteRow('A', ...))`), so the existing test continued to pass correctly with the new guard.
