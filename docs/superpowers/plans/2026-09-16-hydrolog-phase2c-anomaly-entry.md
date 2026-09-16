# Phase 2c — Anomaly Entry on the Profile Canvas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a field operator mark rectangular anomaly regions on the measurement matrix and persist them as `Anomaly` records inside an `Interpretation` document.

**Architecture:** One `Interpretation` per line stored at `lines/{lineFolderName}/interpretation.json` in FSA and mirrored to a new Dexie `interpretations` table (version 2). The entry UI uses numeric steppers (from-point / to-point / from-channel / to-channel) per §5.5. The `ProfileCanvas` draws semi-transparent overlay rects for all confirmed anomalies.

**Tech Stack:** TypeScript, React 18, Dexie 4, File System Access API, Vitest + Testing Library

**Spec:** docs/superpowers/plans/2026-09-16-hydrolog-phase2c-anomaly-entry.md (this file) + §4.11, §5.5

## Global Constraints

- All writes: FSA first, then Dexie — never reversed
- Bulgarian copy for all UI labels
- `Anomaly.pseudoDepthFromM` / `pseudoDepthToM` — derived from `channelSetSnapshot.channels`, never user-entered
- `AnomalyType` values must match `src/domain/types.ts` exactly
- `canvas.getContext?.('2d')` — optional chaining required (happy-dom lacks getContext)
- Dexie version bumps are append-only; version 1 schema must not be modified
- One interpretation per line only (Phase 2c scope)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/domain/types.ts` | Modify | Add `id: string` to `Anomaly` |
| `src/cache/db.ts` | Modify | Add `InterpretationRow`, bump to version 2 |
| `src/cache/hooks.ts` | Modify | Add `useInterpretation(lineId)` |
| `src/domain/interpretation-service.ts` | Create | `getOrCreateInterpretation`, `addAnomaly`, `removeAnomaly` |
| `src/domain/interpretation-service.test.ts` | Create | Service integration tests |
| `src/ui/ProfileCanvas.tsx` | Modify | Draw anomaly overlay rects |
| `src/ui/ProfileCanvas.test.tsx` | Modify | Test overlay prop accepted without crash |
| `src/ui/labels.ts` | Modify | Add `anomaly` section (Bulgarian) |
| `src/ui/AnomalyForm.tsx` | Create | Stepper form for anomaly entry |
| `src/ui/AnomalyForm.test.tsx` | Create | Form render + submit tests |
| `src/ui/LineDetail.tsx` | Modify | Wire form, list, delete, pass anomalies to canvas |
| `src/ui/LineDetail.test.tsx` | Modify | Anomaly round-trip test |

---

### Task 1: Types + DB + interpretation-service

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/cache/db.ts`
- Modify: `src/cache/hooks.ts`
- Create: `src/domain/interpretation-service.ts`
- Create: `src/domain/interpretation-service.test.ts`

**Interfaces produced:**

```typescript
// in types.ts — Anomaly gains id
export interface Anomaly {
  id: string;
  lineId: string;
  fromPoint: number; toPoint: number;
  fromChannel: number; toChannel: number;
  pseudoDepthFromM: number; pseudoDepthToM: number;
  type: AnomalyType;
  confidence: 1 | 2 | 3 | 4 | 5;
  note?: string;
}

// in db.ts
export interface InterpretationRow {
  id: string;      // interpretation ULID
  lineId: string;  // one-to-one per line (Phase 2c)
  json: Interpretation;
}

// in interpretation-service.ts
export interface AnomalyInput {
  fromPoint: number; toPoint: number;
  fromChannel: number; toChannel: number;
  type: AnomalyType;
  confidence: 1 | 2 | 3 | 4 | 5;
  note?: string;
}
export function getOrCreateInterpretation(lineId: string): Promise<Interpretation>
export function addAnomaly(lineId: string, input: AnomalyInput): Promise<Interpretation>
export function removeAnomaly(lineId: string, anomalyId: string): Promise<Interpretation>
```

- [ ] **Step 1: Write failing tests**

```typescript
// src/domain/interpretation-service.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { resetDb } from '../cache/db';
import { createSite } from './site-service';
import { createSurvey } from './survey-service';
import { createLine } from './line-service';
import { getOrCreateInterpretation, addAnomaly, removeAnomaly } from './interpretation-service';
import type { Vertex } from './types';

function v(atPointIndex: number): Vertex {
  return {
    lat: 42.32, lon: 23.78, elevSource: 'none',
    hAccM: 6, hAccMethod: 'median-reported',
    sampleCount: 10, fixedAt: new Date(), atPointIndex,
  };
}

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
  return createLine(sv.id, {
    pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
    mode: 'multi-frequency', dipoleOrientation: 'inline',
    vertices: [v(1), v(17)],
  });
}

beforeEach(async () => {
  await resetDb();
  clearRoot();
  setRoot(createMockRoot());
});

describe('getOrCreateInterpretation', () => {
  it('creates a fresh interpretation with no anomalies', async () => {
    const line = await seedLine();
    const interp = await getOrCreateInterpretation(line.id);
    expect(interp.id).toBeTruthy();
    expect(interp.anomalies).toHaveLength(0);
    expect(interp.verdict).toBe('inconclusive');
  });

  it('returns the same id on second call', async () => {
    const line = await seedLine();
    const a = await getOrCreateInterpretation(line.id);
    const b = await getOrCreateInterpretation(line.id);
    expect(b.id).toBe(a.id);
  });
});

describe('addAnomaly', () => {
  it('appends anomaly with generated id and computed pseudoDepth', async () => {
    const line = await seedLine();
    const interp = await addAnomaly(line.id, {
      fromPoint: 3, toPoint: 7,
      fromChannel: 1, toChannel: 2,
      type: 'fracture-signature', confidence: 3,
    });
    expect(interp.anomalies).toHaveLength(1);
    const a = interp.anomalies[0];
    expect(a.id).toBeTruthy();
    expect(a.lineId).toBe(line.id);
    expect(a.fromPoint).toBe(3);
    expect(a.toPoint).toBe(7);
    expect(a.type).toBe('fracture-signature');
    expect(a.confidence).toBe(3);
    // pseudoDepthFromM comes from channelSetSnapshot.channels[0].pseudoDepthM
    expect(typeof a.pseudoDepthFromM).toBe('number');
    expect(typeof a.pseudoDepthToM).toBe('number');
  });

  it('persists: second getOrCreate returns updated anomalies', async () => {
    const line = await seedLine();
    await addAnomaly(line.id, {
      fromPoint: 1, toPoint: 5, fromChannel: 1, toChannel: 1,
      type: 'conductive-zone', confidence: 2,
    });
    const interp = await getOrCreateInterpretation(line.id);
    expect(interp.anomalies).toHaveLength(1);
  });
});

describe('removeAnomaly', () => {
  it('removes by id', async () => {
    const line = await seedLine();
    const interp = await addAnomaly(line.id, {
      fromPoint: 1, toPoint: 5, fromChannel: 1, toChannel: 1,
      type: 'noise-artefact', confidence: 1,
    });
    const removed = await removeAnomaly(line.id, interp.anomalies[0].id);
    expect(removed.anomalies).toHaveLength(0);
  });

  it('is a no-op for unknown id', async () => {
    const line = await seedLine();
    await addAnomaly(line.id, {
      fromPoint: 1, toPoint: 5, fromChannel: 1, toChannel: 1,
      type: 'noise-artefact', confidence: 1,
    });
    const result = await removeAnomaly(line.id, 'nonexistent-id');
    expect(result.anomalies).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```
npx vitest run src/domain/interpretation-service.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Add `id` to `Anomaly` in `src/domain/types.ts`**

In the `Anomaly` interface, insert `id: string;` as the first field.

- [ ] **Step 4: Add `InterpretationRow` to `src/cache/db.ts` and bump to version 2**

Add import of `Interpretation` to the type imports.
Add `InterpretationRow` interface.
Add `interpretations` table field to `HydroLogDb`.
Add `this.version(2).stores({ interpretations: '&id, lineId' })`.

- [ ] **Step 5: Add `useInterpretation` to `src/cache/hooks.ts`**

```typescript
export function useInterpretation(lineId: string | undefined): InterpretationRow | undefined {
  return useLiveQuery(async () => {
    if (!lineId) return undefined;
    return getDb().interpretations.where('lineId').equals(lineId).first();
  }, [lineId]);
}
```

- [ ] **Step 6: Create `src/domain/interpretation-service.ts`**

```typescript
import type { Interpretation, Anomaly, AnomalyType } from './types';
import { newId } from '../util/id';
import { writeJson, readJson } from '../storage/atomic';
import { getOrCreatePath, getPath } from '../storage/paths';
import { getRoot } from '../storage/fs';
import { getDb } from '../cache/db';

export interface AnomalyInput {
  fromPoint: number;
  toPoint: number;
  fromChannel: number;
  toChannel: number;
  type: AnomalyType;
  confidence: 1 | 2 | 3 | 4 | 5;
  note?: string;
}

async function resolveLineDir(lineId: string): Promise<FileSystemDirectoryHandle> {
  const db = getDb();
  const root = getRoot();
  const row = await db.lines.get(lineId);
  if (!row) throw new Error(`line not found: ${lineId}`);
  const svRow = await db.surveys.get(row.surveyId);
  if (!svRow) throw new Error(`orphan line — survey missing: ${row.surveyId}`);
  const siteRow = await db.sites.get(svRow.siteId);
  if (!siteRow) throw new Error(`orphan line — site missing: ${svRow.siteId}`);
  const dir = await getPath(root, [
    'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', row.folderName,
  ]);
  if (!dir) throw new Error(`line folder missing: ${row.folderName}`);
  return dir;
}

async function loadFromFsa(lineDir: FileSystemDirectoryHandle): Promise<Interpretation | null> {
  try {
    return await readJson<Interpretation>(lineDir, 'interpretation.json');
  } catch {
    return null;
  }
}

async function save(lineId: string, interp: Interpretation): Promise<void> {
  const db = getDb();
  const dir = await resolveLineDir(lineId);
  await writeJson(dir, 'interpretation.json', interp);
  await db.interpretations.put({ id: interp.id, lineId, json: interp });
}

export async function getOrCreateInterpretation(lineId: string): Promise<Interpretation> {
  const db = getDb();
  const existing = await db.interpretations.where('lineId').equals(lineId).first();
  if (existing) return existing.json;

  const dir = await resolveLineDir(lineId);
  const fromDisk = await loadFromFsa(dir);
  if (fromDisk) {
    await db.interpretations.put({ id: fromDisk.id, lineId, json: fromDisk });
    return fromDisk;
  }

  const now = new Date();
  const fresh: Interpretation = {
    id: newId(),
    createdAt: now, updatedAt: now, revision: 1,
    anomalies: [], correlations: [],
    verdict: 'inconclusive',
    reportText: '', disclaimerVersion: '1.0', author: '',
  };
  await save(lineId, fresh);
  return fresh;
}

export async function addAnomaly(lineId: string, input: AnomalyInput): Promise<Interpretation> {
  const interp = await getOrCreateInterpretation(lineId);
  const db = getDb();
  const lineRow = await db.lines.get(lineId);
  if (!lineRow) throw new Error(`line not found: ${lineId}`);
  const channels = lineRow.json.channelSetSnapshot.channels;

  const pseudoDepthFromM = channels[input.fromChannel - 1]?.pseudoDepthM ?? 0;
  const pseudoDepthToM = channels[input.toChannel - 1]?.pseudoDepthM ?? 0;

  const anomaly: Anomaly = {
    id: newId(),
    lineId,
    fromPoint: input.fromPoint,
    toPoint: input.toPoint,
    fromChannel: input.fromChannel,
    toChannel: input.toChannel,
    pseudoDepthFromM,
    pseudoDepthToM,
    type: input.type,
    confidence: input.confidence,
    note: input.note,
  };

  const now = new Date();
  const next: Interpretation = {
    ...interp,
    anomalies: [...interp.anomalies, anomaly],
    updatedAt: now,
    revision: interp.revision + 1,
  };
  await save(lineId, next);
  return next;
}

export async function removeAnomaly(lineId: string, anomalyId: string): Promise<Interpretation> {
  const interp = await getOrCreateInterpretation(lineId);
  const now = new Date();
  const next: Interpretation = {
    ...interp,
    anomalies: interp.anomalies.filter((a) => a.id !== anomalyId),
    updatedAt: now,
    revision: interp.revision + 1,
  };
  await save(lineId, next);
  return next;
}
```

- [ ] **Step 7: Run tests — verify they pass**

```
npx vitest run src/domain/interpretation-service.test.ts
```
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add src/domain/types.ts src/cache/db.ts src/cache/hooks.ts \
  src/domain/interpretation-service.ts src/domain/interpretation-service.test.ts
git commit -m "feat(domain): Anomaly.id + Interpretation DB table + interpretation-service"
```

---

### Task 2: ProfileCanvas anomaly overlay

**Files:**
- Modify: `src/ui/ProfileCanvas.tsx`
- Modify: `src/ui/ProfileCanvas.test.tsx`

**Interfaces consumed:** `Anomaly` from `../domain/types` (now has `id`)

- [ ] **Step 1: Write failing test**

Add to `src/ui/ProfileCanvas.test.tsx`:

```typescript
import type { Anomaly } from '../domain/types';

it('renders without crashing when anomalies prop provided', () => {
  const anomaly: Anomaly = {
    id: 'a1', lineId: 'l1',
    fromPoint: 1, toPoint: 1, fromChannel: 1, toChannel: 1,
    pseudoDepthFromM: 0, pseudoDepthToM: 75,
    type: 'fracture-signature', confidence: 3,
  };
  const { container } = render(
    <ProfileCanvas
      points={[makePoint(1, [0.1, 0.2])]}
      channelSet={TWO_CH}
      anomalies={[anomaly]}
    />
  );
  expect(container.querySelector('canvas')).not.toBeNull();
});
```

- [ ] **Step 2: Run — verify FAIL** (prop not accepted yet)

```
npx vitest run src/ui/ProfileCanvas.test.tsx
```

- [ ] **Step 3: Update ProfileCanvas.tsx**

Add `anomalies?: Anomaly[]` to `ProfileCanvasProps`.
Import `Anomaly` from `../domain/types`.
After the heatmap drawing loop, add the overlay:

```typescript
if (anomalies && anomalies.length > 0) {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 220, 0, 0.25)';
  ctx.strokeStyle = 'rgba(120, 80, 0, 0.85)';
  ctx.lineWidth = 1;
  for (const a of anomalies) {
    const x = (a.fromPoint - 1) * cellW;
    const y = (a.fromChannel - 1) * cellH;
    const w = (a.toPoint - a.fromPoint + 1) * cellW;
    const h = (a.toChannel - a.fromChannel + 1) * cellH;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}
```

Also pass `anomalies` as a dependency to the `useEffect`.

- [ ] **Step 4: Run — verify PASS**

```
npx vitest run src/ui/ProfileCanvas.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/ProfileCanvas.tsx src/ui/ProfileCanvas.test.tsx
git commit -m "feat(ui): ProfileCanvas anomaly overlay rects"
```

---

### Task 3: AnomalyForm component

**Files:**
- Create: `src/ui/AnomalyForm.tsx`
- Create: `src/ui/AnomalyForm.test.tsx`

**Interfaces consumed:** `AnomalyInput` from `../domain/interpretation-service`, `AnomalyType` from `../domain/types`, `labels.anomaly`

- [ ] **Step 1: Add `anomaly` labels section to `src/ui/labels.ts`**

```typescript
anomaly: {
  heading: 'Аномалии',
  addButton: 'Добави аномалия',
  deleteButton: 'Изтрий',
  formHeading: 'Нова аномалия',
  fields: {
    fromPoint: 'От точка',
    toPoint: 'До точка',
    fromChannel: 'От канал',
    toChannel: 'До канал',
    type: 'Вид',
    confidence: 'Увереност (1–5)',
    note: 'Бележка',
  },
  typeOptions: {
    'fracture-signature': 'Сигнатура на пукнатина',
    'conductive-zone': 'Проводяща зона',
    'contact': 'Контакт',
    'clay-lens-signature': 'Сигнатура на глинена леща',
    'noise-artefact': 'Шумов артефакт',
    'no-anomaly': 'Без аномалия',
  } as Record<string, string>,
  confidenceOptions: {
    1: '1 — слаба',
    2: '2 — умерена',
    3: '3 — добра',
    4: '4 — висока',
    5: '5 — сигурна',
  } as Record<number, string>,
  noAnomalies: 'Все още няма маркирани аномалии.',
},
```

- [ ] **Step 2: Write failing tests**

```typescript
// src/ui/AnomalyForm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnomalyForm } from './AnomalyForm';

const defaults = { pointCount: 17, channelCount: 36 };

describe('<AnomalyForm />', () => {
  it('renders from/to point and channel steppers', () => {
    render(<AnomalyForm {...defaults} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/від точка|від точка|від точка|От точка/i)).toBeInTheDocument();
  });

  it('calls onSubmit with correct values', () => {
    const onSubmit = vi.fn();
    render(<AnomalyForm {...defaults} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /Добави/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
    const arg = onSubmit.mock.calls[0][0];
    expect(arg.fromPoint).toBeGreaterThanOrEqual(1);
    expect(arg.toPoint).toBeGreaterThanOrEqual(arg.fromPoint);
    expect(arg.fromChannel).toBeGreaterThanOrEqual(1);
    expect(arg.toChannel).toBeGreaterThanOrEqual(arg.fromChannel);
    expect(arg.type).toBeTruthy();
    expect(arg.confidence).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 3: Run — verify FAIL** (module not found)

```
npx vitest run src/ui/AnomalyForm.test.tsx
```

- [ ] **Step 4: Create `src/ui/AnomalyForm.tsx`**

```tsx
import { useState } from 'react';
import type { AnomalyInput } from '../domain/interpretation-service';
import type { AnomalyType } from '../domain/types';
import { labels } from './labels';

interface Props {
  pointCount: number;
  channelCount: number;
  onSubmit: (input: AnomalyInput) => void;
}

const ANOMALY_TYPES: AnomalyType[] = [
  'fracture-signature', 'conductive-zone', 'contact',
  'clay-lens-signature', 'noise-artefact', 'no-anomaly',
];

export function AnomalyForm({ pointCount, channelCount, onSubmit }: Props) {
  const [fromPoint, setFromPoint] = useState(1);
  const [toPoint, setToPoint] = useState(Math.min(5, pointCount));
  const [fromChannel, setFromChannel] = useState(1);
  const [toChannel, setToChannel] = useState(Math.min(5, channelCount));
  const [type, setType] = useState<AnomalyType>('fracture-signature');
  const [confidence, setConfidence] = useState<1|2|3|4|5>(3);
  const [note, setNote] = useState('');
  const al = labels.anomaly;
  const fl = al.fields;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      fromPoint: Math.min(fromPoint, toPoint),
      toPoint: Math.max(fromPoint, toPoint),
      fromChannel: Math.min(fromChannel, toChannel),
      toChannel: Math.max(fromChannel, toChannel),
      type, confidence,
      note: note.trim() || undefined,
    });
    setNote('');
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
      <h3 style={{ margin: 0 }}>{al.formHeading}</h3>
      <label>
        {fl.fromPoint}
        <input
          aria-label={fl.fromPoint}
          type="number" min={1} max={pointCount} value={fromPoint}
          onChange={(e) => setFromPoint(Number(e.target.value))}
        />
      </label>
      <label>
        {fl.toPoint}
        <input
          aria-label={fl.toPoint}
          type="number" min={1} max={pointCount} value={toPoint}
          onChange={(e) => setToPoint(Number(e.target.value))}
        />
      </label>
      <label>
        {fl.fromChannel}
        <input
          aria-label={fl.fromChannel}
          type="number" min={1} max={channelCount} value={fromChannel}
          onChange={(e) => setFromChannel(Number(e.target.value))}
        />
      </label>
      <label>
        {fl.toChannel}
        <input
          aria-label={fl.toChannel}
          type="number" min={1} max={channelCount} value={toChannel}
          onChange={(e) => setToChannel(Number(e.target.value))}
        />
      </label>
      <label>
        {fl.type}
        <select value={type} onChange={(e) => setType(e.target.value as AnomalyType)}>
          {ANOMALY_TYPES.map((t) => (
            <option key={t} value={t}>{al.typeOptions[t]}</option>
          ))}
        </select>
      </label>
      <label>
        {fl.confidence}
        <select
          value={confidence}
          onChange={(e) => setConfidence(Number(e.target.value) as 1|2|3|4|5)}
        >
          {([1,2,3,4,5] as const).map((c) => (
            <option key={c} value={c}>{al.confidenceOptions[c]}</option>
          ))}
        </select>
      </label>
      <label>
        {fl.note}
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="submit">{al.addButton}</button>
    </form>
  );
}
```

- [ ] **Step 5: Run — verify PASS**

```
npx vitest run src/ui/AnomalyForm.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add src/ui/labels.ts src/ui/AnomalyForm.tsx src/ui/AnomalyForm.test.tsx
git commit -m "feat(ui): AnomalyForm — numeric stepper anomaly entry"
```

---

### Task 4: Wire LineDetail

**Files:**
- Modify: `src/ui/LineDetail.tsx`
- Modify: `src/ui/LineDetail.test.tsx`

**Interfaces consumed:**
- `useInterpretation(lineId)` from `../cache/hooks`
- `addAnomaly`, `removeAnomaly`, `AnomalyInput` from `../domain/interpretation-service`
- `AnomalyForm` from `./AnomalyForm`
- `labels.anomaly`

- [ ] **Step 1: Write failing test**

Add to `src/ui/LineDetail.test.tsx`:

```typescript
import { addAnomaly } from '../domain/interpretation-service';
// ...

it('shows anomaly list and delete button after addAnomaly', async () => {
  const line = await seedLine();
  const now = new Date();
  const onePoint: Point = {
    index: 1, offsetM: 0, lat: 42.32, lon: 23.78,
    elevSource: 'none', coordSource: 'interpolated',
    readings: [{ pass: 1, recordedAt: now, values: [0.1], groundingOk: true, electrodeTreatment: 'none' }],
    flags: [],
  };
  await attachDeviceData(line.id, {
    channelSetSnapshot: line.channelSetSnapshot,
    pointCount: 1,
    deviceStartPointIndex: 80,
    deviceLineNumber: '1',
    mode: 'multi-frequency',
    status: 'complete',
    points: [onePoint],
  });
  await addAnomaly(line.id, {
    fromPoint: 1, toPoint: 1, fromChannel: 1, toChannel: 1,
    type: 'fracture-signature', confidence: 3,
  });

  render(<LineDetail lineId={line.id} onBack={() => {}} />);
  expect(await screen.findByText('fracture-signature')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Изтрий/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run — verify FAIL**

```
npx vitest run src/ui/LineDetail.test.tsx
```

- [ ] **Step 3: Update `src/ui/LineDetail.tsx`**

Add imports:
```typescript
import { useInterpretation } from '../cache/hooks';
import { addAnomaly, removeAnomaly } from '../domain/interpretation-service';
import type { AnomalyInput } from '../domain/interpretation-service';
import { AnomalyForm } from './AnomalyForm';
```

Inside the component, after `useBmpUrls`:
```typescript
const interpretation = useInterpretation(lineId);
const anomalies = interpretation?.json.anomalies ?? [];

async function handleAddAnomaly(input: AnomalyInput) {
  await addAnomaly(lineId, input);
}

async function handleRemoveAnomaly(anomalyId: string) {
  await removeAnomaly(lineId, anomalyId);
}
```

In the JSX, after ProfileCanvas, add:
```tsx
<h2>{al.heading}</h2>
{anomalies.length === 0 ? (
  <p>{al.noAnomalies}</p>
) : (
  <ul>
    {anomalies.map((a) => (
      <li key={a.id}>
        {a.type} · т.{a.fromPoint}–{a.toPoint} · к.{a.fromChannel}–{a.toChannel} · {a.confidence}★
        {a.note && ` — ${a.note}`}
        <button onClick={() => handleRemoveAnomaly(a.id)} style={{ marginLeft: 8 }}>
          {al.deleteButton}
        </button>
      </li>
    ))}
  </ul>
)}
<AnomalyForm
  pointCount={l.pointCount}
  channelCount={l.channelSetSnapshot.channels.length}
  onSubmit={handleAddAnomaly}
/>
```

The `al` variable: `const al = labels.anomaly;`

Pass `anomalies` to ProfileCanvas: `<ProfileCanvas points={l.points} channelSet={l.channelSetSnapshot} anomalies={anomalies} />`

- [ ] **Step 4: Run — verify PASS**

```
npx vitest run src/ui/LineDetail.test.tsx
```

- [ ] **Step 5: Run full suite**

```
npx vitest run
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui/LineDetail.tsx src/ui/LineDetail.test.tsx
git commit -m "feat(ui): wire anomaly list + form into LineDetail"
```
