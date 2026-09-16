# Phase 3 — Visual Design & Mobile UX Overhaul

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform HydroLog from unstyled functional code into a polished, field-ready mobile instrument interface with smart pre-fill to minimize typing on phone.

**Architecture:** Single `src/ui/styles/` directory for design tokens and base styles; component-level CSS classes replacing all inline `style={{}}` props; localStorage for operator preferences; Geolocation API for GPS-prefill in SiteForm.

**Tech Stack:** React 18, plain CSS (no CSS-in-JS, no Tailwind), Google Fonts via `<link>`, localStorage, browser Geolocation API

**Spec:** This file

## Design Direction: "Field Instrument Dark"

HydroLog is used outdoors by field geologists — often in direct sunlight, sometimes with gloved hands. The aesthetic should feel like a precision survey instrument: authoritative, legible at a glance, engineered for task completion rather than marketing appeal.

**Reference:** Leica survey equipment UI, Garmin GPS devices, scientific data terminals

- **Base:** Deep navy `#0d1b2a` — reduces glare, saves phone battery, looks authoritative
- **Primary accent:** Amber `#f59e0b` — geological strata color, visible in sunlight
- **Secondary:** Sky `#38bdf8` — water/aquifer reference
- **Typography:** `IBM Plex Sans` (body/labels) + `IBM Plex Mono` (coordinates, codes, measurements) — designed for technical interfaces, free, excellent Cyrillic support
- **Touch targets:** Minimum 48 px — gloved-hand safe
- **Key differentiator:** Tap-button groups replace dropdowns for short option lists (≤5 options); no keyboard for choices

## Global Constraints

- No new dependencies — pure CSS + browser APIs
- All existing tests must continue to pass (no JSX structure changes that break test queries)
- Bulgarian labels unchanged
- `canvas.getContext?.('2d')` optional chaining preserved
- Form submit handlers unchanged — only visual layer changes
- Inline `style={{}}` props replaced by CSS classes; any that can't be removed safely stay

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `public/index.html` | Modify | Add Google Fonts `<link>` |
| `src/ui/styles/tokens.css` | Create | CSS custom properties (design tokens) |
| `src/ui/styles/base.css` | Create | Reset, global typography, buttons, inputs, cards |
| `src/ui/styles/index.css` | Create | Barrel that imports tokens + base |
| `src/main.tsx` | Modify | Import `./ui/styles/index.css` |
| `src/ui/Home.tsx` | Modify | App shell styling, pick-folder screen |
| `src/ui/Router.tsx` | Modify | Breadcrumb back-nav styling |
| `src/ui/SiteList.tsx` | Modify | Card list + FAB, search pill |
| `src/ui/SiteForm.tsx` | Modify | GPS prefill, region dropdown, status tap-buttons, styled inputs |
| `src/ui/SiteDetail.tsx` | Modify | Info card layout, status badge |
| `src/ui/SurveyForm.tsx` | Modify | Operator/device localStorage recall, tap-button groups |
| `src/ui/SurveyDetail.tsx` | Modify | Survey card, finalize chip |
| `src/ui/LineCaptureScreen.tsx` | Modify | +/- stepper buttons, mode tap-buttons, GPS progress ring |
| `src/ui/LineDetail.tsx` | Modify | Profile section heading, info grid |
| `src/ui/AnomalyForm.tsx` | Modify | Stepper inputs, compact layout |
| `src/ui/ImportScreen.tsx` | Modify | Table styling, candidate cards |
| `src/ui/SyncIndicator.tsx` | Modify | Pill badge styling |
| `src/ui/util/useLastUsed.ts` | Create | localStorage hook for operator/device recall |
| `src/ui/util/useGeoLocation.ts` | Create | One-shot geolocation hook |
| `src/ui/BG_REGIONS.ts` | Create | Array of 28 Bulgarian regions for dropdown |

---

### Task 1: Design tokens + base styles + fonts

**Files:**
- Create: `src/ui/styles/tokens.css`
- Create: `src/ui/styles/base.css`
- Create: `src/ui/styles/index.css`
- Modify: `public/index.html`
- Modify: `src/main.tsx`

- [ ] **Step 1: Create `src/ui/styles/tokens.css`**

```css
:root {
  /* ── Surfaces ── */
  --bg-base:     #0d1b2a;
  --bg-surface:  #152236;
  --bg-elevated: #1c2f45;
  --bg-input:    #0f2135;
  --bg-tap-active: #1e3a57;

  /* ── Brand ── */
  --color-primary:     #f59e0b;   /* amber — geological strata */
  --color-primary-dim: #92600a;
  --color-secondary:   #38bdf8;   /* sky — water/aquifer */
  --color-danger:      #f87171;
  --color-success:     #34d399;
  --color-warn:        #fb923c;

  /* ── Text ── */
  --text-base:   #d1e4f5;
  --text-muted:  #607d93;
  --text-faint:  #354f66;
  --text-on-primary: #0d1b2a;

  /* ── Borders ── */
  --border-subtle: rgba(56, 189, 248, 0.12);
  --border-input:  rgba(56, 189, 248, 0.25);
  --border-focus:  #38bdf8;

  /* ── Radii ── */
  --r-sm:  6px;
  --r-md:  12px;
  --r-lg:  20px;
  --r-pill: 999px;

  /* ── Spacing ── */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  /* ── Touch ── */
  --touch-min: 48px;
  --input-h:   52px;
  --header-h:  56px;

  /* ── Typography ── */
  --font-body: 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;

  /* ── Shadows ── */
  --shadow-card: 0 2px 8px rgba(0, 0, 0, 0.4);
  --shadow-fab:  0 4px 16px rgba(245, 158, 11, 0.4);
}
```

- [ ] **Step 2: Create `src/ui/styles/base.css`**

```css
/* ── Reset ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body, #root {
  height: 100%;
  background: var(--bg-base);
  color: var(--text-base);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* ── Typography ── */
h1 { font-size: 1.75rem; font-weight: 700; letter-spacing: -0.02em; color: var(--text-base); }
h2 { font-size: 1.25rem; font-weight: 600; color: var(--text-base); margin-bottom: var(--space-3); }
h3 { font-size: 1.05rem; font-weight: 600; color: var(--text-muted); }
code, .mono { font-family: var(--font-mono); font-size: 0.85em; color: var(--color-secondary); }
small { font-size: 0.8rem; color: var(--text-muted); }

/* ── App shell ── */
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  max-width: 600px;
  margin: 0 auto;
}

.app-header {
  position: sticky; top: 0; z-index: 10;
  height: var(--header-h);
  padding: 0 var(--space-4);
  display: flex; align-items: center; justify-content: space-between;
  background: var(--bg-base);
  border-bottom: 1px solid var(--border-subtle);
}

.app-header__title {
  font-family: var(--font-mono);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-primary);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.app-content {
  flex: 1;
  padding: var(--space-4);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* ── Cards ── */
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
  padding: var(--space-4);
  margin-bottom: var(--space-3);
  box-shadow: var(--shadow-card);
}

.card--interactive {
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.card--interactive:hover, .card--interactive:focus {
  background: var(--bg-elevated);
  border-color: var(--border-input);
  outline: none;
}
.card--interactive:active { background: var(--bg-tap-active); }

/* ── Buttons ── */
button, .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--touch-min);
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--r-md);
  font-family: var(--font-body);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}
button:disabled { opacity: 0.45; cursor: not-allowed; }

.btn-primary {
  background: var(--color-primary);
  color: var(--text-on-primary);
}
.btn-primary:hover:not(:disabled) { background: #fbbf24; }

.btn-secondary {
  background: var(--bg-elevated);
  color: var(--text-base);
  border: 1px solid var(--border-input);
}
.btn-secondary:hover:not(:disabled) { background: var(--bg-tap-active); }

.btn-ghost {
  background: transparent;
  color: var(--text-muted);
  padding: 0 var(--space-2);
}
.btn-ghost:hover:not(:disabled) { color: var(--text-base); }

.btn-danger {
  background: transparent;
  color: var(--color-danger);
  border: 1px solid var(--color-danger);
}
.btn-danger:hover:not(:disabled) { background: rgba(248, 113, 113, 0.1); }

.btn-full { width: 100%; }

.btn-row {
  display: flex; gap: var(--space-2);
  margin-top: var(--space-4);
}

/* ── Tap-button groups (replaces dropdowns for ≤5 options) ── */
.tap-group {
  display: flex; flex-wrap: wrap; gap: var(--space-2);
}
.tap-btn {
  flex: 1 1 auto;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  background: var(--bg-input);
  border: 1px solid var(--border-input);
  border-radius: var(--r-sm);
  color: var(--text-muted);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  transition: all 0.12s;
}
.tap-btn--active {
  background: var(--bg-tap-active);
  border-color: var(--color-secondary);
  color: var(--color-secondary);
  font-weight: 700;
}

/* ── Stepper (numeric ±) ── */
.stepper {
  display: flex; align-items: center; gap: var(--space-2);
}
.stepper__btn {
  width: 44px; height: 44px;
  min-height: 44px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-input);
  border-radius: var(--r-sm);
  color: var(--text-base);
  font-size: 1.3rem;
  font-weight: 700;
  padding: 0;
  flex-shrink: 0;
}
.stepper__value {
  flex: 1;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 1.2rem;
  color: var(--text-base);
  background: var(--bg-input);
  border: 1px solid var(--border-input);
  border-radius: var(--r-sm);
  height: 44px;
  display: flex; align-items: center; justify-content: center;
}

/* ── Form fields ── */
.field {
  display: flex; flex-direction: column; gap: var(--space-1);
  margin-bottom: var(--space-4);
}
.field__label {
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.field__label--required::after {
  content: ' *';
  color: var(--color-primary);
}

input[type="text"],
input[type="number"],
input[type="search"],
input[type="datetime-local"],
input[type="email"],
textarea,
select {
  width: 100%;
  height: var(--input-h);
  padding: 0 var(--space-3);
  background: var(--bg-input);
  border: 1px solid var(--border-input);
  border-radius: var(--r-sm);
  color: var(--text-base);
  font-family: var(--font-body);
  font-size: 1rem;
  outline: none;
  transition: border-color 0.15s;
  appearance: none;
  -webkit-appearance: none;
}
textarea {
  height: auto;
  min-height: 80px;
  padding: var(--space-3);
  resize: vertical;
}
select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2338bdf8' stroke-width='1.5' fill='none'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 14px center; padding-right: 36px; }
input:focus, textarea:focus, select:focus { border-color: var(--border-focus); box-shadow: 0 0 0 3px rgba(56,189,248,0.12); }
input::placeholder { color: var(--text-faint); }

/* mono inputs for coords */
.input--mono { font-family: var(--font-mono); letter-spacing: 0.03em; }

/* ── Form layout ── */
.form-page {
  max-width: 100%;
}
.form-page h2 { margin-bottom: var(--space-5); }

.form-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

/* ── GPS button ── */
.gps-btn {
  display: flex; align-items: center; gap: var(--space-2);
  background: var(--bg-elevated);
  border: 1px dashed var(--color-secondary);
  border-radius: var(--r-sm);
  color: var(--color-secondary);
  font-size: 0.9rem;
  font-weight: 600;
  height: var(--touch-min);
  padding: 0 var(--space-3);
  cursor: pointer;
  width: 100%;
  justify-content: center;
}
.gps-btn:disabled { opacity: 0.5; }

/* ── Status / badge chips ── */
.chip {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--r-pill);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
}
.chip--surveyed    { background: rgba(56,189,248,0.15); color: #38bdf8; }
.chip--recommended { background: rgba(52,211,153,0.15); color: #34d399; }
.chip--not-recommended { background: rgba(248,113,113,0.15); color: #f87171; }
.chip--drilled     { background: rgba(245,158,11,0.15);  color: #f59e0b; }
.chip--archived    { background: rgba(96,125,147,0.15);  color: #607d93; }

/* ── Section headings ── */
.section-heading {
  display: flex; align-items: center; justify-content: space-between;
  margin: var(--space-5) 0 var(--space-3);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
}

/* ── Definition list (details view) ── */
.detail-grid {
  display: grid;
  grid-template-columns: minmax(100px, max-content) 1fr;
  gap: var(--space-1) var(--space-4);
  margin: var(--space-3) 0;
}
.detail-grid dt {
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  padding-top: 2px;
}
.detail-grid dd {
  font-size: 0.95rem;
  color: var(--text-base);
}

/* ── Alert / error ── */
.alert {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--r-sm);
  font-size: 0.9rem;
  margin-bottom: var(--space-3);
}
.alert--error { background: rgba(248,113,113,0.1); border: 1px solid var(--color-danger); color: var(--color-danger); }
.alert--warn  { background: rgba(251,146,60,0.1);  border: 1px solid var(--color-warn);   color: var(--color-warn); }
.alert--info  { background: rgba(56,189,248,0.08); border: 1px solid var(--border-input);  color: var(--color-secondary); }

/* ── GPS progress ── */
.gps-progress {
  display: flex; flex-direction: column; align-items: center; gap: var(--space-3);
  padding: var(--space-5);
}
.gps-ring {
  width: 80px; height: 80px;
  border-radius: 50%;
  border: 3px solid var(--border-subtle);
  border-top-color: var(--color-secondary);
  animation: spin 1.2s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Coord display ── */
.coord-display {
  font-family: var(--font-mono);
  font-size: 1rem;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm);
  padding: var(--space-3) var(--space-4);
  line-height: 1.8;
}
.coord-display__row { display: flex; justify-content: space-between; gap: var(--space-4); }
.coord-display__label { color: var(--text-muted); font-size: 0.8rem; }
.coord-display__value { color: var(--color-secondary); }

/* ── FAB ── */
.fab {
  position: fixed;
  bottom: var(--space-5);
  right: var(--space-4);
  width: 56px; height: 56px;
  border-radius: 50%;
  background: var(--color-primary);
  color: var(--text-on-primary);
  font-size: 1.6rem;
  font-weight: 300;
  line-height: 1;
  box-shadow: var(--shadow-fab);
  border: none;
  cursor: pointer;
  z-index: 20;
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.15s, box-shadow 0.15s;
}
.fab:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(245,158,11,0.5); }

/* ── Search bar ── */
.search-bar {
  position: relative;
  margin-bottom: var(--space-4);
}
.search-bar input {
  padding-left: 44px;
  border-radius: var(--r-pill);
  background: var(--bg-surface);
}
.search-bar::before {
  content: '🔍';
  position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
  font-size: 0.9rem;
  pointer-events: none;
  opacity: 0.5;
}

/* ── Loading skeleton ── */
.loading-text { color: var(--text-muted); font-size: 0.9rem; }

/* ── Site list items ── */
.site-card__code   { font-family: var(--font-mono); font-size: 0.78rem; color: var(--color-primary); font-weight: 700; }
.site-card__name   { font-size: 1rem; font-weight: 600; color: var(--text-base); }
.site-card__meta   { font-size: 0.82rem; color: var(--text-muted); margin-top: 2px; }
.site-card__row    { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-1); }

/* ── Survey list items ── */
.survey-card__date { font-family: var(--font-mono); font-size: 0.82rem; color: var(--color-primary); }
.survey-card__meta { font-size: 0.85rem; color: var(--text-muted); margin-top: 2px; }

/* ── Sync indicator ── */
.sync-indicator {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  padding: 3px 8px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border-subtle);
  color: var(--text-muted);
}
.sync-indicator--warn { border-color: var(--color-warn); color: var(--color-warn); }

/* ── Import table ── */
.import-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.import-table th { text-align: left; padding: var(--space-2) var(--space-2); color: var(--text-muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border-subtle); }
.import-table td { padding: var(--space-2) var(--space-2); border-bottom: 1px solid var(--border-subtle); color: var(--text-base); vertical-align: middle; }
.import-table tr:last-child td { border-bottom: none; }

/* ── Canvas wrapper ── */
.canvas-wrapper { overflow-x: auto; overflow-y: hidden; margin: var(--space-3) 0; background: var(--bg-surface); border-radius: var(--r-sm); padding: var(--space-2); }

/* ── Anomaly list ── */
.anomaly-item { display: flex; align-items: center; justify-content: space-between; padding: var(--space-2) 0; border-bottom: 1px solid var(--border-subtle); }
.anomaly-item__meta { font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-muted); }
.anomaly-item__type { font-size: 0.85rem; font-weight: 600; color: var(--color-secondary); }
```

- [ ] **Step 3: Create `src/ui/styles/index.css`**

```css
@import './tokens.css';
@import './base.css';
```

- [ ] **Step 4: Update `public/index.html`** — add inside `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
```

- [ ] **Step 5: Update `src/main.tsx`** — add as first import:

```typescript
import './ui/styles/index.css';
```

- [ ] **Step 6: Verify app compiles** (check dev server, no style errors)

```
npx vite build --mode development 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
git add src/ui/styles/ public/index.html src/main.tsx
git commit -m "feat(design): design token foundation — dark navy/amber instrument theme"
```

---

### Task 2: Utility hooks — localStorage recall + Geolocation prefill

**Files:**
- Create: `src/ui/util/useLastUsed.ts`
- Create: `src/ui/util/useGeoLocation.ts`
- Create: `src/ui/BG_REGIONS.ts`

- [ ] **Step 1: Create `src/ui/util/useLastUsed.ts`**

```typescript
// Persists a value to localStorage and restores it on mount.
// Key is namespaced under 'hydrolog.lastUsed.{key}'.
import { useState, useEffect } from 'react';

export function useLastUsed<T>(key: string, defaultValue: T): [T, (v: T) => void] {
  const storageKey = `hydrolog.lastUsed.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw !== null ? (JSON.parse(raw) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const set = (v: T) => {
    setValue(v);
    try { localStorage.setItem(storageKey, JSON.stringify(v)); } catch {}
  };

  return [value, set];
}
```

- [ ] **Step 2: Create `src/ui/util/useGeoLocation.ts`**

```typescript
// One-shot geolocation grab; returns current position or error.
import { useState } from 'react';

export interface GeoResult {
  lat: number;
  lon: number;
  accuracyM: number;
}

export function useGeoLocation() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grab = (onResult: (r: GeoResult) => void) => {
    if (!navigator.geolocation) {
      setError('GPS не се поддържа от браузъра.');
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoading(false);
        onResult({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        });
      },
      (err) => {
        setLoading(false);
        setError(`GPS грешка: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return { loading, error, grab };
}
```

- [ ] **Step 3: Create `src/ui/BG_REGIONS.ts`**

```typescript
export const BG_REGIONS: string[] = [
  'Благоевградска',
  'Бургаска',
  'Варненска',
  'Великотърновска',
  'Видинска',
  'Врачанска',
  'Габровска',
  'Добричка',
  'Кърджалийска',
  'Кюстендилска',
  'Ловешка',
  'Монтанска',
  'Пазарджишка',
  'Перникска',
  'Плевенска',
  'Пловдивска',
  'Разградска',
  'Русенска',
  'Силистренска',
  'Сливенска',
  'Смолянска',
  'Софийска',
  'Софийска (столица)',
  'Старозагорска',
  'Търговищка',
  'Хасковска',
  'Шуменска',
  'Ямболска',
];
```

- [ ] **Step 4: Commit**

```bash
git add src/ui/util/ src/ui/BG_REGIONS.ts
git commit -m "feat(ui): useLastUsed, useGeoLocation, BG_REGIONS constants"
```

---

### Task 3: App shell — Home + Router

**Files:**
- Modify: `src/ui/Home.tsx`
- Modify: `src/ui/Router.tsx` (if back nav lives there)
- Modify: `src/ui/SyncIndicator.tsx`

The goal is a fixed app header with "HYDROLOG" in mono amber, a sync badge top-right, and the content area below.

- [ ] **Step 1: Restyle `src/ui/SyncIndicator.tsx`**

```tsx
interface Props { hoursSinceSync: number | null; }

export function SyncIndicator({ hoursSinceSync }: Props) {
  if (hoursSinceSync === null) return null;
  const warn = hoursSinceSync > 48;
  return (
    <span className={`sync-indicator${warn ? ' sync-indicator--warn' : ''}`}>
      {warn ? '⚠ ' : ''}{Math.round(hoursSinceSync)}г без синхрон
    </span>
  );
}
```

- [ ] **Step 2: Restyle `src/ui/Home.tsx`**

Pick-folder screen:
```tsx
// Not-ready state
<div className="app-shell">
  <header className="app-header">
    <span className="app-header__title">HydroLog</span>
  </header>
  <main className="app-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-5)' }}>
    <div style={{ textAlign: 'center' }}>
      <h1 style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>HydroLog</h1>
      <p style={{ color: 'var(--text-muted)', maxWidth: 280 }}>Изберете работната папка за да продължите</p>
    </div>
    <button className="btn-primary btn-full" onClick={onPick} disabled={loading} style={{ maxWidth: 280 }}>
      {loading ? '⟳ ' + labels.home.scanning : '📂 ' + labels.home.pickFolder}
    </button>
  </main>
</div>
```

Ready state:
```tsx
<div className="app-shell">
  <header className="app-header">
    <span className="app-header__title">HydroLog</span>
    <SyncIndicator hoursSinceSync={hours} />
  </header>
  <main className="app-content">
    <Router />
  </main>
</div>
```

Remove `fontFamily: 'system-ui, sans-serif'` inline styles.

- [ ] **Step 3: Commit**

```bash
git add src/ui/Home.tsx src/ui/SyncIndicator.tsx
git commit -m "feat(ui): app shell dark header, SyncIndicator badge"
```

---

### Task 4: SiteList — card list + FAB

**Files:**
- Modify: `src/ui/SiteList.tsx`

Replace the plain `<ul>` with styled card buttons. Add FAB for "New Site" (the FAB calls back to the router which already handles navigation to `/sites/new`).

```tsx
export function SiteList({ onOpen, onNew }: Props) {  // add onNew prop
  const [query, setQuery] = useState('');
  const sites = useSites({ query });

  return (
    <div>
      <div className="section-heading">
        <h2 style={{ margin: 0 }}>{labels.home.sitesHeading}</h2>
      </div>

      <div className="search-bar">
        <input
          type="search"
          placeholder={labels.common.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {sites === undefined && <p className="loading-text">{labels.common.loading}</p>}
      {sites?.length === 0 && <p className="loading-text">{labels.home.noSites}</p>}

      {sites?.map((s) => (
        <button
          key={s.id}
          className="card card--interactive btn-ghost"
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: 'var(--space-4)' }}
          onClick={() => onOpen(s.id)}
        >
          <div className="site-card__row">
            <span className="site-card__code">{s.code}</span>
            <span className={`chip chip--${s.json.status}`}>{labels.site.statusOptions[s.json.status]}</span>
          </div>
          <div className="site-card__name">{s.json.name}</div>
          <div className="site-card__meta">{s.json.settlement} · {s.json.municipality}</div>
        </button>
      ))}

      <button className="fab" onClick={onNew} aria-label={labels.home.newSite}>+</button>
    </div>
  );
}
```

Note: `onNew` prop needs to be added and wired in Router.tsx.

- [ ] **Commit:**
```bash
git add src/ui/SiteList.tsx
git commit -m "feat(ui): SiteList — card list with status chip + FAB"
```

---

### Task 5: SiteForm — GPS prefill + region dropdown + styled

**Files:**
- Modify: `src/ui/SiteForm.tsx`

Key changes:
1. **GPS button** — `useGeoLocation` fills centroidLat/Lon automatically
2. **Region** — `<select>` with BG_REGIONS (no typing required)
3. **Status** — tap-button group instead of `<select>`
4. **Form fields** — use `.field` / `.field__label` / `.field__label--required` classes

```tsx
import { useGeoLocation } from './util/useGeoLocation';
import { BG_REGIONS } from './BG_REGIONS';

// In component:
const geo = useGeoLocation();

// GPS button (replaces two bare number inputs):
<div className="field">
  <span className="field__label field__label--required">
    {l.fields.centroidLat} / {l.fields.centroidLon}
  </span>
  <button
    type="button"
    className="gps-btn"
    onClick={() => geo.grab((r) => {
      set('centroidLat', r.lat.toFixed(6));
      set('centroidLon', r.lon.toFixed(6));
    })}
    disabled={geo.loading}
  >
    {geo.loading ? '⟳ GPS…' : '📍 Взими текущото местоположение'}
  </button>
  {(state.centroidLat || state.centroidLon) && (
    <div className="form-row-2" style={{ marginTop: 'var(--space-2)' }}>
      <div className="field">
        <span className="field__label">Ширина</span>
        <input className="input--mono" type="number" step="any" value={state.centroidLat}
               onChange={(e) => set('centroidLat', e.target.value)} required />
      </div>
      <div className="field">
        <span className="field__label">Дължина</span>
        <input className="input--mono" type="number" step="any" value={state.centroidLon}
               onChange={(e) => set('centroidLon', e.target.value)} required />
      </div>
    </div>
  )}
  {geo.error && <div className="alert alert--error">{geo.error}</div>}
</div>

// Region — select from list:
<div className="field">
  <label className="field__label field__label--required">{l.fields.region}</label>
  <select value={state.region} onChange={(e) => set('region', e.target.value)} required>
    <option value="">— изберете —</option>
    {BG_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
  </select>
</div>

// Status — tap-button group:
<div className="field">
  <span className="field__label">{l.fields.status}</span>
  <div className="tap-group">
    {(Object.keys(l.statusOptions) as (keyof typeof l.statusOptions)[]).map((k) => (
      <button
        key={k} type="button"
        className={`tap-btn${state.status === k ? ' tap-btn--active' : ''}`}
        onClick={() => set('status', k)}
      >
        {l.statusOptions[k]}
      </button>
    ))}
  </div>
</div>
```

Wrap all other inputs in `.field` + `.field__label` divs. Replace `style={{ display: 'grid', gap: 8 }}` on `<form>` with `className="form-page"`.

- [ ] **Commit:**
```bash
git add src/ui/SiteForm.tsx
git commit -m "feat(ui): SiteForm — GPS prefill, region dropdown, status tap-buttons"
```

---

### Task 6: SurveyForm — localStorage recall + tap-button groups

**Files:**
- Modify: `src/ui/SurveyForm.tsx`

Key changes:
1. **Operator** — `useLastUsed('operator', '')` — recalls last operator on new survey
2. **Device model** — `useLastUsed('deviceModel', 'PQWT-TC300')` — recalls last device
3. **Device serial** — `useLastUsed('deviceSerial', '')` — recalls last serial
4. **precipLast48h** — tap-button group (3 options: без / леки / силни)
5. **qualityFlag** — tap-button group (3 options)
6. **Timezone** — auto-detect `Intl.DateTimeFormat().resolvedOptions().timeZone` as initial value (fall back to `'Europe/Sofia'`)

```tsx
import { useLastUsed } from './util/useLastUsed';

// Auto-detected timezone default:
function detectTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'Europe/Sofia'; }
}

// In EMPTY:
const EMPTY: FormState = {
  ...
  timezone: detectTimezone(),
  operator: '',   // will be overridden by useLastUsed
  deviceModel: 'PQWT-TC300',
  deviceSerial: '',
  ...
};

// In component (create mode only):
const [lastOperator, setLastOperator] = useLastUsed('operator', '');
const [lastDeviceModel, setLastDeviceModel] = useLastUsed('deviceModel', 'PQWT-TC300');
const [lastDeviceSerial, setLastDeviceSerial] = useLastUsed('deviceSerial', '');

// Initialise from lastUsed in create mode:
useEffect(() => {
  if (props.mode === 'create') {
    setState((s) => ({
      ...s,
      operator: lastOperator || s.operator,
      deviceModel: lastDeviceModel || s.deviceModel,
      deviceSerial: lastDeviceSerial || s.deviceSerial,
    }));
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);   // only on mount

// On submit success, persist:
setLastOperator(state.operator);
setLastDeviceModel(state.deviceModel);
setLastDeviceSerial(state.deviceSerial);

// Device model — tap buttons for known models:
const DEVICE_MODELS = ['PQWT-TC150', 'PQWT-TC300', 'PQWT-TC500', 'PQWT-S150'];
<div className="field">
  <span className="field__label field__label--required">{l.fields.deviceModel}</span>
  <div className="tap-group">
    {DEVICE_MODELS.map((m) => (
      <button key={m} type="button"
        className={`tap-btn${state.deviceModel === m ? ' tap-btn--active' : ''}`}
        onClick={() => set('deviceModel', m)}>
        {m}
      </button>
    ))}
  </div>
</div>

// precipLast48h tap-buttons:
<div className="field">
  <span className="field__label">{l.fields.precipLast48h}</span>
  <div className="tap-group">
    {(Object.keys(l.precipOptions) as (keyof typeof l.precipOptions)[]).map((k) => (
      <button key={k} type="button"
        className={`tap-btn${state.precipLast48h === k ? ' tap-btn--active' : ''}`}
        onClick={() => set('precipLast48h', k)}>
        {l.precipOptions[k]}
      </button>
    ))}
  </div>
</div>

// qualityFlag tap-buttons:
<div className="field">
  <span className="field__label">{l.fields.qualityFlag}</span>
  <div className="tap-group">
    {(Object.keys(l.qualityOptions) as (keyof typeof l.qualityOptions)[]).map((k) => (
      <button key={k} type="button"
        className={`tap-btn${state.qualityFlag === k ? ' tap-btn--active' : ''}`}
        onClick={() => set('qualityFlag', k)}>
        {l.qualityOptions[k]}
      </button>
    ))}
  </div>
</div>
```

- [ ] **Commit:**
```bash
git add src/ui/SurveyForm.tsx
git commit -m "feat(ui): SurveyForm — operator/device recall, tap-button groups, timezone auto-detect"
```

---

### Task 7: LineCaptureScreen — stepper buttons + mode tap-groups + GPS ring

**Files:**
- Modify: `src/ui/LineCaptureScreen.tsx`

Key changes:
1. **pointCount** — `+` / `−` stepper (most common values: 17 or custom multiples)
2. **pointSpacingM / electrodeSpacingM** — `+` / `−` steppers (0.5 step)
3. **mode** — tap-button group
4. **dipoleOrientation** — tap-button group
5. **GPS stage** — spinning ring instead of plain text
6. **Recall last params** — `useLastUsed('lineParams', DEFAULT_PARAMS)`

```tsx
// Stepper component (inline):
function Stepper({ value, onChange, min, max, step = 1 }: {
  value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number;
}) {
  return (
    <div className="stepper">
      <button type="button" className="stepper__btn"
        onClick={() => onChange(Math.max(min, parseFloat((value - step).toFixed(2))))}
        disabled={value <= min}>−</button>
      <div className="stepper__value">{value}</div>
      <button type="button" className="stepper__btn"
        onClick={() => onChange(Math.min(max, parseFloat((value + step).toFixed(2))))}
        disabled={value >= max}>+</button>
    </div>
  );
}

// GPS progress stage:
{sampling && samplingProgress && (
  <div className="gps-progress">
    <div className="gps-ring" />
    <p style={{ textAlign: 'center' }}>
      <strong>{samplingProgress.n}</strong> {l.gpsSampleCount}<br />
      <span style={{ color: 'var(--text-muted)' }}>
        {l.gpsAccuracy} {samplingProgress.acc.toFixed(1)} {l.gpsMeters}
      </span>
    </p>
    <small className="alert alert--info">{l.keepScreenOn}</small>
  </div>
)}

// GPS result display:
{currentVertex && (
  <div className="coord-display">
    <div className="coord-display__row">
      <span className="coord-display__label">Lat</span>
      <span className="coord-display__value">{currentVertex.lat.toFixed(6)}</span>
    </div>
    <div className="coord-display__row">
      <span className="coord-display__label">Lon</span>
      <span className="coord-display__value">{currentVertex.lon.toFixed(6)}</span>
    </div>
    <div className="coord-display__row">
      <span className="coord-display__label">Точност</span>
      <span className={currentVertex.hAccM > 15 ? 'coord-display__value' : 'coord-display__value'}
            style={{ color: currentVertex.hAccM > 15 ? 'var(--color-warn)' : 'var(--color-success)' }}>
        ±{currentVertex.hAccM.toFixed(1)} м
      </span>
    </div>
  </div>
)}
```

Recall params with `useLastUsed('lineParams', DEFAULT_PARAMS)` and call `setLastParams(params)` before navigating to stage `p1`.

- [ ] **Commit:**
```bash
git add src/ui/LineCaptureScreen.tsx
git commit -m "feat(ui): LineCaptureScreen — steppers, tap-groups, GPS ring, param recall"
```

---

### Task 8: SiteDetail + SurveyDetail styling

**Files:**
- Modify: `src/ui/SiteDetail.tsx`
- Modify: `src/ui/SurveyDetail.tsx`

**SiteDetail changes:**
- Replace `<dl style="grid">` with `<dl className="detail-grid">`
- Add status chip next to site name
- Survey list → card buttons (matching SiteList card style)
- Action buttons → `btn-secondary` + `btn-danger` classes

**SurveyDetail changes:**
- Survey metadata in `detail-grid`
- Line list → cards showing label, point count, status chip (`draft` / `complete`)
- Import button → primary CTA at bottom

```tsx
// SiteDetail header:
<header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
  <div>
    <h1 style={{ marginBottom: 4 }}>{s.name}</h1>
    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
      <code>{s.code}</code>
      <span className={`chip chip--${s.status}`}>{l.statusOptions[s.status]}</span>
    </div>
  </div>
</header>

<dl className="detail-grid">
  <dt>{l.fields.settlement}</dt><dd>{s.settlement}</dd>
  ...
</dl>

// Action row:
<div className="btn-row">
  <button className="btn-secondary" onClick={props.onEdit}>{labels.common.edit}</button>
  <button className="btn-danger" onClick={onDelete} disabled={busy}>{labels.common.delete}</button>
  <button className="btn-primary" onClick={props.onNewSurvey}>{l.newSurvey}</button>
</div>
```

- [ ] **Commit:**
```bash
git add src/ui/SiteDetail.tsx src/ui/SurveyDetail.tsx
git commit -m "feat(ui): SiteDetail + SurveyDetail — info cards, status chips, styled actions"
```

---

### Task 9: LineDetail + AnomalyForm styling

**Files:**
- Modify: `src/ui/LineDetail.tsx`
- Modify: `src/ui/AnomalyForm.tsx`

**LineDetail changes:**
- `<dl>` → `detail-grid`
- Canvas section → `canvas-wrapper`
- Anomaly list → `anomaly-item` rows
- AnomalyForm embedded below canvas with card wrapper

**AnomalyForm changes:**
- Stepper inputs for fromPoint/toPoint/fromChannel/toChannel (use same `Stepper` component or inline steppers)
- Type → tap-button group (6 options, 2 per row via `flex-wrap`)
- Confidence → tap-button group (5 stars `★` labels)

```tsx
// Confidence tap-buttons with star rating feel:
<div className="tap-group">
  {([1,2,3,4,5] as const).map((c) => (
    <button key={c} type="button"
      className={`tap-btn${confidence === c ? ' tap-btn--active' : ''}`}
      onClick={() => setConfidence(c)}
      style={{ minWidth: 44 }}>
      {'★'.repeat(c)}
    </button>
  ))}
</div>
```

- [ ] **Commit:**
```bash
git add src/ui/LineDetail.tsx src/ui/AnomalyForm.tsx
git commit -m "feat(ui): LineDetail + AnomalyForm — detail grid, canvas wrapper, star confidence"
```

---

### Task 10: ImportScreen styling

**Files:**
- Modify: `src/ui/ImportScreen.tsx`

Replace bare table with `import-table` class, wrap candidate cards, style status badges.

- [ ] **Commit:**
```bash
git add src/ui/ImportScreen.tsx
git commit -m "feat(ui): ImportScreen — styled table, candidate status indicators"
```

---

## Smart Pre-fill Summary

| Screen | Field | Pre-fill method |
|---|---|---|
| SiteForm | Centroid lat/lon | Browser Geolocation API (one-tap GPS button) |
| SiteForm | Region | Dropdown (28 Bulgarian regions, no typing) |
| SiteForm | Status | Default `surveyed`, tap-button group |
| SurveyForm | startedAt | Already: `new Date()` |
| SurveyForm | timezone | `Intl.DateTimeFormat().resolvedOptions().timeZone` |
| SurveyForm | operator | `localStorage` — recalls last used |
| SurveyForm | deviceModel | `localStorage` + known-model tap-buttons |
| SurveyForm | deviceSerial | `localStorage` — recalls last used |
| SurveyForm | precipLast48h | Default `none`, tap-button group |
| SurveyForm | qualityFlag | Default `good`, tap-button group |
| LineCaptureScreen | All params | `localStorage` — recalls last used set |
| LineCaptureScreen | mode | Default `multi-frequency`, tap-button group |
| LineCaptureScreen | dipoleOrientation | Default `inline`, tap-button group |

## Visual Consistency Checklist (verify before each commit)

- [ ] All interactive elements ≥ 48px touch target
- [ ] No `style={{ fontFamily: 'system-ui' }}` remaining
- [ ] All form inputs use `.field` / `.field__label` wrapper
- [ ] Error states use `.alert.alert--error` not `style={{ color: 'crimson' }}`
- [ ] Tests still pass: `npx vitest run`
