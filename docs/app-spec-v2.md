# HydroLog — PQWT Survey Record System
### Requirements specification v2 · 13 September 2026 · for review

Offline-first PWA for recording, archiving and exporting geoelectric water-prospecting surveys made with a PQWT natural-electric-field instrument. Single user (Антон), installable on Android and desktop, no app store, no backend.

> **v2 note.** v1 was scored by three independent critics (domain fit 6.0, build feasibility 6.5, adversarial 6.0) and the geometry claims were tested executably. This version fixes 29 findings. Sections marked **⚠ CHANGED FROM YOUR CHOICE** are places where the evidence pushed against an option you picked — decide those explicitly.

---

## 0. The rule that governs everything else

**Phase 0 comes before any code is written: get three real `L1/L2/…` folders off the instrument's SD card and look at them.**

PQWT does not publish its file format. Every manual describes the on-screen workflow and says each line is exported as a folder containing three files (*System volume inf*, *Profile Survey*, *Three Freq*), and stops there. Until those files are opened, §7 of this document is a guess and its estimate is unbounded.

Three outcomes, and the spec must survive all three:

| What the SD card turns out to hold | Consequence |
|---|---|
| **Delimited text / simple binary matrix** (likely) | §7 as written. Parser is ~40–100 lines for the real format, not a universal engine. |
| **Proprietary binary readable only by the vendor's Windows software** | Numbers come out of that software as CSV on the laptop; the phone app imports that CSV. Add one step to the workflow, lose nothing. |
| **Only BMP/PNG screen captures, no numeric file** | **The profile view, the drag-to-mark interpretation, the CSV of values and the pseudo-depth statistics are all dead.** The app becomes a geo-referenced survey register with attached instrument images — still worth building (that is Phase 1 and it is the part with commercial value), but you must know this before budgeting Phase 2. Fallback path: store the image, transcribe the handful of values you actually use by hand, or OCR later on the laptop. |

Half a day of work. It is the highest-value half-day in the project.

---

## 1. Purpose and success criteria

**Purpose.** A permanent, searchable, geo-referenced record of every site surveyed: where the line was, when, with what instrument in what conditions, what it measured, what you concluded, where you recommended drilling, and — when it eventually comes back — what the drill actually found.

The record has three jobs, in order of commercial weight:
1. **Evidence for a client** — a defensible one-page verdict sold through an agency.
2. **A track record** — the accumulating set of predictions versus drilled outcomes. This is the asset. Nobody else in the Bulgarian market can show one.
3. **A working archive** — so a site surveyed in 2026 can be re-opened, defended or re-interpreted in 2031.

### Success criteria (each is a test in §14)

| # | Criterion |
|---|---|
| S1 | A full survey (site, 1 line, 17 points, device files, 3 photos, verdict) is recorded offline in ≤ 6 min of interaction, excluding GPS settling and walking. |
| S2 | Any past site is found in ≤ 15 s by name, village, client, date, tag or map position. |
| S3 | Exports open unmodified in QGIS, Google Earth and a handheld GPS. |
| S4 | The recommended drill point is re-found on site within **10 m by GPS, and within 1 m using the recorded physical anchor** (bearing + distance from a named landmark, plus a photo). |
| S5 | **Loss of the phone loses at most one working day.** The app makes this true by refusing to be the only copy (§10). |
| S6 | Any survey ≥ 3 years old can be re-derived from stored raw material: original device files, the exact channel set used, the interpretation as it stood at export, and the disclaimer version the client received. |

**Non-goals (v1):** multi-user, app store, geophysical inversion, live cable link to the instrument, invoicing/CRM, automatic cadastral lookup.

---

## 2. What the instrument actually measures — and the honesty rules that follow

This section is normative. It exists because the easiest way to build a worthless archive is to record device numbers as if they were physics.

**Facts.**
- The PQWT TC/S series measures the **natural electric field as a potential difference in millivolts (mV)** across a fixed electrode dipole, at 33 (TC150) / 40 (TC300) / 56 (TC500) frequencies. Resolution 0.001 mV.
- It does **not** measure resistivity. There is no Ω·m anywhere in its output.
- The vertical axis of its profile is a **frequency-derived pseudo-depth**. PQWT's own documentation describes it as a nominal linear mapping (e.g. 33 frequencies over 150 m ≈ one step per 4.5 m). True skin depth scales as √(ρ/f) and depends on a bulk resistivity the instrument never measures.
- A mV value is only comparable between two lines if the **electrode spacing is identical**.
- The manual makes a **"Line Test" grounding check mandatory before each recording**, and prescribes watering or salting electrodes on hard ground — because contact resistance dominates the error budget.

**Rules the software must enforce.**

| R | Rule |
|---|---|
| R1 | The only unit offered for a channel value is **mV** (plus `relative` for normalised/derived sets). **Ω·m is not selectable.** |
| R2 | The vertical axis is named **`pseudoDepthM`** in the schema, `pseudo_depth_m` in exports, and labelled **"ориентировъчна дълбочина"** in every Bulgarian-facing output. The string `depth_m` never appears for this quantity. |
| R3 | Every ChannelSet stores its `depthModel` (`linear-nominal` \| `skin-depth` \| `vendor-table` \| `unknown`), the assumed resistivity if any, and a free-text provenance note. A channel set with `depthModel: unknown` renders the y-axis as **channel index**, not metres. |
| R4 | Two lines may only be plotted on a shared colour scale if `electrodeSpacingM` matches. Otherwise the app scales them independently and says so on the plot. |
| R5 | Prediction-vs-outcome comparison (§6.7) reports **`pseudoDepthPredicted` and `actualDepthM` side by side, never an auto-computed difference**, and every statistic built on them is labelled as calibration of *this operator with this instrument*, not as measured accuracy. |
| R6 | Anomaly types are signatures, not hydrogeology: `fracture-signature`, `conductive-zone`, `contact`, `clay-lens-signature`, `noise-artefact`, `no-anomaly`. **"Aquifer" is not an available value.** Yield is never predicted by the app. |

---

## 3. Platform

**Offline-first PWA**, React + TypeScript + Vite, installed on the Android phone and used on the laptop from the same codebase.

| Field reality | How the spec handles it |
|---|---|
| Reading the SD card | File System Access API now works on Android Chrome (shipped M132, Jan 2025) — directory picking included. `<input type="file" multiple>` remains the fallback; both reach SD card and USB-OTG via the system picker. |
| Chinese instrument encoding | `new TextDecoder('gbk')` is standard in every current browser. Non-issue. |
| Browser GPS 3–10 m | Point positions are **computed**, never sampled per point (§5.2). Endpoint fixes use multi-sample averaging with wake lock. Absolute accuracy carried into every export. |
| Screen sleeps during a 60 s GPS average | Screen Wake Lock API, **re-acquired on `visibilitychange`** (Android auto-releases it when the document hides). Geolocation stops entirely in a backgrounded tab — the app shows a "keep this screen on" state and a live sample counter. |
| Storage eviction | §10. The answer is not `persist()`; it is never being the only copy. |
| Offline basemap | **PMTiles**, not tile prefetching (§9). |

---

## 4. Domain model

```
Client?
 └── Site                    обект — a property being assessed
      ├── Survey             проучване — one visit, one date
      │    ├── Line          профил — L1, L2 … (polyline, not necessarily straight)
      │    │    ├── Point    точка 1..N (default 17)
      │    │    │    └── Reading[]   one per pass — repeats are first-class
      │    │    ├── NoiseZone[]      located interference, with geometry
      │    │    └── GroundingCheck   Line Test result, electrode treatment
      │    ├── LineIntersection[]    computed where lines cross
      │    ├── Interpretation        anomalies, correlations, drill recommendation
      │    ├── MediaAsset[]          photos, device screens, voice notes, sketches
      │    └── ImportBatch[]         raw device files, verbatim, forever
      ├── RegulatoryContext          water body, СОЗ, nearest registered well
      └── DrillOutcome[]             what the drill found — may arrive years later
```

### 4.1 Cross-cutting fields on every record
`id` (ULID), `createdAt`, `updatedAt`, `deletedAt` (soft delete), `revision` (int). No record is ever hard-deleted; restore and merge logic depend on `updatedAt`, which v1 did not have.

### 4.2 Site
`name`, `code` (auto `BG-SOF-0043`), `settlement`, `ekatte` (ЕКАТТЕ settlement code), `cadastralParcelId` (ПИ идентификатор — **a separate field**, 5-part), `municipality`, `region`, `clientId?`, `centroid`, `boundary?` (polygon), `accessNotes`, `landUse`, `status` (`surveyed` \| `recommended` \| `not-recommended` \| `drilled` \| `archived`), `tags[]`.

### 4.3 RegulatoryContext (per site — fields a permit chain actually consumes)
`waterBodyCode` (код на подземното водно тяло, `BG3G…`), `waterBodyName`, `nearestRegisteredWellM?`, `insideSOZ` (bool + which zone) — a target inside someone else's санитарно-охранителна зона is dead on arrival and you want to know while standing on the site — `protectedAreaNotes`, `intendedUse` (битови / поливни / стопански), `intendedAbstractionM3PerDay?`, `notes`.

*This does not make you the author of a хидрогеоложка обосновка — that must come from a чл. 126-registered entity. It makes your survey a usable annex for one.*

### 4.4 Survey
`siteId`, `startedAt`, `endedAt`, `timezone`, `operator`, `deviceModel`, `deviceSerial`, `firmware`, `weather`, `airTempC?`, `precipLast48h` (none / light / heavy — wet ground shifts readings), `terrain`, `purpose`, `summary`, `qualityFlag` (`good` \| `noisy` \| `repeat-needed`), `finalizedAt?` (locks the survey; later edits create a new revision with a reason).

### 4.5 Line
| Field | Note |
|---|---|
| `label` | "L1" |
| `deviceLineNumber` + `deviceSessionDate` | **Both** — the instrument's L-numbering resets per session, so the L-number alone is not a join key (§7.4). |
| `deviceStartPointIndex?` | operator-set device N at point 1 (varies per line, chosen on the device). Populated at import (§7); preserved verbatim per §7.5. |
| `pointCount` | default 17, range 5–999 |
| `pointSpacingM` | dot spacing, typically 1–2 m |
| `electrodeSpacingM` | typically 5–10 m. **Hard guard: must be > `pointSpacingM`**, otherwise the two were swapped and the whole x-axis is wrong. |
| `mode` | single / triple / multi-frequency |
| `channelSetSnapshot` | **copied by value, frozen** — not a reference (§4.9) |
| `geometry` | **an ordered polyline of surveyed vertices**, not just two endpoints (§5.3) |
| `vertices[]` | each {lat, lon, elevM?, elevSource, hAccM, hAccMethod, sampleCount, fixedAt, atPointIndex} |
| `azimuthDeg`, `azimuthSource` | derived-from-vertices \| compass \| manual |
| `lengthM` | derived along the polyline |
| `point1Anchor` | **required**: a photo taken standing at point 1 looking along the line, with device bearing stamped (§5.4) |
| `dipoleOrientation` | `inline` \| `broadside`; `polarityConvention` free text |
| `groundSlopePct`, `reliefM` | |
| `repeatOfLineId?` | links a second pass to the first |
| `transformLog[]` | **any flip/reversal applied to imported data is recorded here with timestamp and reason.** Data is never silently mirrored (§7.5). |

### 4.6 Point
`index` (1..N), `offsetM` — **measured along the actual polyline, not `(index−1)×spacing`** once a detour exists — `lat`, `lon`, `elevM?`, `elevSource`, `coordSource` (`interpolated` \| `measured` \| `manual`), `readings[]`, `flags[]` (`suspect`, `obstacle`, `noise`, `pending-data`), `note`.

### 4.7 Reading (new — repeats are the only quality control a solo operator has)
`pass` (1, 2, …), `recordedAt` (**per-point clock time** — the natural field drifts through the day and a pump starting shows up as a spike), `values[]` (one per channel, nullable), `groundingOk` (bool), `electrodeTreatment` (none / watered / salted), `note`. The app can draw a repeat-vs-original difference curve; a large divergence is the honest signal that a line needs re-shooting.

### 4.8 NoiseZone (new)
`kind` (power line / buried cable / pipeline / electric fence / rail / pump / other), `geometry` (point or line), `bearingFromLineDeg?`, `distanceM?`, `affectsPointsFrom`, `affectsPointsTo`, `note`. Rendered as a shaded band on the profile and carried into export. Survey-level free tags cannot dismiss a specific anomaly; this can.

### 4.9 ChannelSet — frozen once used
`name`, `deviceModel`, `kind` (`frequency` \| `index`), `units` (`mV` \| `relative`), `depthModel`, `assumedResistivityOhmM?`, `provenanceNote`, `channels[]` of {label, frequencyHz?, pseudoDepthM?, order}, `frozenAt`.

Once a Line references a ChannelSet, the set is **copied into the line and frozen**. Editing a channel's pseudo-depth later creates a new version and never silently rewrites the meaning of past interpretations. This single rule is what makes S6 achievable.

### 4.10 LineIntersection (new)
`lineAId`, `lineBId`, `lat`, `lon`, `pointIndexOnA`, `pointIndexOnB`, `staked` (bool + photo). Computed automatically whenever two lines in a survey cross. **The drill target is normally the intersection of two corroborating anomalies, not a point on one line** — v1 encoded the wrong geometry here.

### 4.11 Interpretation
`anomalies[]` {lineId, fromPoint, toPoint, fromChannel, toChannel, `pseudoDepthFromM`, `pseudoDepthToM`, `type` (§R6), `confidence` 1–5, note}
`correlations[]` {anomalyIds[], `intersectionId?`, `agreementNote`} — this is what makes a multi-line survey defensible
`recommendedDrill` {lat, lon, `sourceKind` (`intersection` \| `single-line-point` \| `manual`), `sourceId`, `pseudoDepthTargetFromM/ToM`, `confidence`, **`physicalAnchor`** {landmarkDescription, bearingDeg, distanceM, photoId, staked: bool}}
`alternateDrill[]`, `verdict` (`drill-recommended` \| `not-recommended` \| `inconclusive`), `reportText`, `disclaimerVersion`, `author`, `createdAt`, `revisedAt`.

The `physicalAnchor` — "14.2 m at 218° from the NE corner of the concrete fence post, photo attached, stake painted orange" — is what gets a driller within 1 m. GPS gets him within 10. S4 depends on this field, not on the coordinates.

### 4.12 DrillOutcome
`drilledAt`, `driller`, `finalDepthM`, `waterStruckAtM[]`, `staticLevelM`, `yieldLps`, `yieldMethod` (baler / air-lift / pump test), `casingNotes`, `distanceFromRecommendedM` (auto — this one *is* comparable), `assessment` (`hit` \| `partial` \| `miss` \| `not-drilled`), `assessmentNote`, `costBGN?`, `photos[]`, `interpretationId?`.

Per **R5**: no auto depth-delta. The dashboard shows predicted pseudo-depth band beside actual metres and lets you see, over dozens of holes, what your own instrument's numbers correspond to in your own geology. That is calibration, and it is genuinely valuable — it is just not accuracy.

### 4.13 MediaAsset
`kind` (`site-photo` \| `device-screen` \| `point1-anchor` \| `drill-point` \| `sketch` \| `document` \| **`voice-note`**), `capturedAt`, `lat/lon` (stamped by the app at capture, **not read from EXIF**), `bearingDeg` (DeviceOrientation), `linkedTo`, `blob`, `thumb`, `caption`, `isOriginal`.

A 15-second voice note is the fastest possible field input when both hands are holding an instrument and two electrode rods. Transcribe later on the laptop.

**Device-screen captures are stored at full resolution and never downscaled** — you may need to read numbers off them. Everything else downscales to 2048 px long edge, decoded with `createImageBitmap(blob, {imageOrientation:'from-image'})` so Android photos are not stored sideways.

---

## 5. Field workflow

### 5.1 Screens
1. **Home** — big buttons: *New survey*, *Continue*, search box, worklist of surveys flagged `data pending`, and a prominent **"last backup: N hours ago"** state.
2. **Search / list** — name, village, client, date range, tag, status. Was missing in v1, and S2 depends on it.
3. **New survey** — site picker or new site; operator and device remembered as defaults.
4. **Line setup** — vertex fixing, anchor photo, parameters.
5. **Data entry** — import / grid / paste / photo-placeholder / voice note.
6. **Profile** — the matrix, if one exists.
7. **Interpretation** — anomalies, correlations, drill point, anchor.
8. **Map** — sites, lines with direction arrows, drill points, outcomes coloured by assessment.
9. **Navigate back** — bearing + distance, plus the anchor description and photo. Works with no map at all.
10. **Edit / merge / delete** — rename, move a survey to another site, merge duplicate sites, soft-delete with undo. Field data entry is roughly half correction; v1 had no path for any of it.
11. **Backup & export**.

### 5.2 GPS fixing — the rules that make the numbers honest
- `enableHighAccuracy: true`, `maximumAge: 0`, **discard the first 3–5 fixes** (cached/network-derived, they drag the mean).
- Sample 20–60 s, show a live counter and accuracy circle, hold a wake lock, re-acquire it on `visibilitychange`.
- Store the **mean position**, the **sample count**, and `hAccM` = the **median reported accuracy — never the standard deviation of the samples**. Consecutive fused-provider fixes share satellite geometry and multipath bias, so σ shrinks toward zero while true error stays at 4–8 m. Publishing σ would be the most flattering lie in the system.
- **Soft gate, not a hard block:** above 15 m the app warns clearly and records `hAccM` and an `acceptedDespiteWarning` flag. It does not stand between you and a waiting client. (v1's hard block was correctly identified as the moment the app gets abandoned.)

### 5.3 Line geometry — polyline, not two endpoints
Fix a vertex at point 1 and at point N. If the line was walked around an obstacle, add a vertex at the detour with its point index; points interpolate **along the polyline** and `offsetM` becomes true distance walked. v1 interpolated straight between endpoints and flagged only the one overridden point, leaving the other fifteen quietly wrong.

Cross-check on save: `|polylineLength − (pointCount − 1) × pointSpacingM|` > tolerance → warn. **Note the `− 1`**: 17 points at 2 m spacing is 32 m, not 34. The v1 formula would have warned on every correctly measured line; this was confirmed by test.

Interpolation uses a local ENU tangent-plane projection. Tested over a 32 m line at 42.32°N: agreement with the declared length to **4 mm**, inter-point spacing constant to **7 mm** — a thousand times below GPS error. Vincenty is not needed and is dropped.

### 5.4 Line direction — the blunder this spec is built to prevent
A reversed 17-point line produces a valid LineString, a valid GPX, a correct-looking profile, passes the length cross-check, and puts the drill point **20.0 m from truth** for an anomaly at point 4 (measured, §14 T4). It is the classic error of this method and it is silent.

Defences, all three required:
1. `point1Anchor` — a **mandatory** photo taken at point 1 looking along the line, with compass bearing stamped. Blocks survey finalisation if missing.
2. `walkDirection` is a structured enum with the anchor bearing cross-checked against `azimuthDeg`; a mismatch > 30° raises a hard warning.
3. **v1's "flip it if the profile looks mirrored" is removed.** Deciding line direction by whether the anomaly appears where you expected it is confirmation bias written into the data model. Any flip is an explicit, logged transform in `Line.transformLog` with a stated reason, visible in the export.

### 5.5 Profile view
X = point index with a true metres axis; Y = pseudo-depth **when the channel set has a known depth model**, otherwise channel index (R3); colour = mV.

The app **does not claim to reproduce the instrument's colour map** — that mapping is unpublished. It renders its own scale, labels it as such, and shows the instrument's own screenshot side by side. The device screenshot is a **required** first-class field on Line, not an optional attachment: the most defensible artefact in the whole archive is the instrument's unmodified output.

Colour scale: sequential by default (a device-relative mV quantity has no meaningful zero midpoint), with an optional diverging scale around a user-set reference value.

Anomaly entry: **numeric steppers are the primary path** (from-point / to-point / from-channel / to-channel). Drag-to-box is the desktop convenience. A precision two-point drag on a glossy screen in sunlight with gloves is the worst available field gesture.

### 5.6 Data entry paths
- **Import** (§7) — primary, once Phase 0 says it is possible.
- **Manual grid** — points as rows, channels as columns, keyboard navigation, whole-matrix paste. Realistic for a handful of picked channels; **17 × 40 = 680 cells is not something anyone types on a phone**, and the spec does not pretend otherwise.
- **Photo placeholder + voice note** — snap the instrument screen, say what you saw, move on. The survey is valid, findable and flagged `data pending`, and the Home worklist makes sure it does not rot. This is the realistic primary path on day one and possibly forever.

---

## 6. Elevation, and why it is mostly absent

Browser GPS altitude is WGS84 **ellipsoidal** and typically ±20–50 m. Bulgarian working heights (Baltic / EVRS) differ from the ellipsoid by roughly **35–40 m** in this country. An unqualified `elevM` printed in a permit annex is actively harmful.

Therefore: `elevSource` is mandatory on every elevation (`gps-ellipsoidal` \| `map-derived` \| `surveyed-orthometric` \| `manual` \| `none`), the default is **`none`**, and no export prints an elevation without its source and datum. Drill depths are stated **below collar**, explicitly, in both the interpretation and the outcome, so the two are comparable.

---

## 7. Import from the instrument — conditional on Phase 0

### 7.1 Scope discipline
This is a parser for **one file layout, from one instrument, for one user**. v1 specified a universal data-integration engine — encoding sniffing, delimiter inference, header detection, orientation mapping, named profiles, signature matching — which the adversarial critic correctly identified as the feature that eats 60% of the build time for 5% of the value.

**Build the 40–100 line parser for the format that is actually on the card.** When the firmware changes, write another one.

### 7.2 Pipeline
Pick files (multi-select or folder) → decode (`TextDecoder('gbk')` where needed) → parse with the known format → **explicit line assignment** (§7.4) → validate → commit.

### 7.3 Always preserved
The raw file is stored verbatim as a blob, forever, alongside the parsed values, with its SHA-256. Re-parsing later with a corrected reader is always possible. This was the best decision in v1 and is unchanged.

### 7.4 Line assignment is never automatic
v1 auto-applied a saved mapping to "every later file matching the same shape/signature". Every line ever shot with the same instrument in the same mode has an **identical** 17×40 signature, so the signature identifies nothing — and the instrument's L-numbering resets per session, so Tuesday's `L1` at Site A and Wednesday's `L1` at Site B are both "L1". The one-tap happy path would have attached the wrong data to the wrong line with a green checkmark, exported perfectly, and been completely wrong.

**Rule:** the user always confirms which line a file belongs to. The app pre-selects a candidate by `deviceLineNumber` + file mtime + the survey's date window, shows the file's own name and timestamp, and requires one tap to accept. Duplicate detection is by SHA-256 **and** by (line, deviceLineNumber, session date).

### 7.5 Shape mismatch, and never a silent flip
More points in the file than the line declares → the user picks a range. Fewer → nulls, flagged. Orientation differs from expectation → an explicit, logged transform (§5.4), never a convenience toggle.

### 7.6 If the card holds only images
Store the image at full resolution as a `device-screen` asset, mark the line `data pending`, and offer a **manual transcription screen** for the handful of channel values you actually use. Optional later: OCR on the laptop, never on the phone.

---

## 8. Export

| Format | Contents | Where it goes |
|---|---|---|
| **GeoJSON** | site polygon, line polylines, points (index, offsetM, values, flags), noise zones, intersections, drill point, outcome | QGIS |
| **KMZ** | the same, styled, photos embedded, balloons carrying the profile PNG | Google Earth, client |
| **GPX** | waypoints (line ends, drill point, anchor landmark) + track per line. **Carries geometry only — GPX has no place for 40 channel values per point, and the spec says so rather than implying otherwise.** | Handheld GPS |
| **CSV long** | `site,survey,line,point,offset_m,lat,lon,elev_m,elev_source,channel,freq_hz,pseudo_depth_m,depth_model,units,pass,recorded_at,value` | Excel, analysis |
| **CSV wide** | points × channels, one file per line, for a quick look | Excel |
| **PDF — client** | **one page**: verdict, indicative depth band, map, one photo, coordinates with stated uncertainty, versioned disclaimer, signature block | The agency / the buyer |
| **PDF — technical annex** | profiles, values, metadata, noise zones, correlations, full method notes | The хидрогеолог writing the обосновка |
| **Backup bundle** | whole database + media + schema version | Restore |

Two PDFs, not one: v1 shipped a single document to two audiences, giving the client an intimidating technical annex and the hydrogeologist a marketing page.

**Every export embeds** app version, schema version, export timestamp, CRS + realisation + epoch, the endpoint `hAccM`, the `depthModel`, and the disclaimer version. A file found in 2031 explains itself.

**Coordinates.** Internal storage is always WGS84 decimal degrees, written at 7 decimal places (RFC 7946) — tested at 1.4 cm ground quantisation, which is three orders of magnitude below the real uncertainty and therefore never the limiting factor. Export offers:
- **WGS84 lat/lon** — default
- **BGS2005 / CCS2005 — EPSG:7801** — the Bulgarian cadastral system, for anything that touches a cadastral or permitting context

Both via proj4js with explicitly supplied definitions, and **verified once against a known control point before the first client deliverable** — proj4js does not ship these built in, and a wrong transformation is metres-wrong in the one context where metres are legally meaningful. UTM variants and the legacy "1970" zone system are added only when a real document demands one. Note also that BGS2005 is ETRS89-realised while the phone reports ITRF/WGS84 — about 0.6 m of plate motion by 2026, irrelevant against 8 m GPS error but stated in the metadata so nobody later mistakes the output for cadastral-grade.

### 8.1 The disclaimer is a versioned object, not free text
The product is sold through estate agencies to people making a purchase decision. The client PDF carries mandatory Bulgarian text, stored with a version number, recording: what the method resolves and what it does not; that the depth is **ориентировъчна**; that no debit, quality or potability is implied; that водовземането изисква разрешително; that this is not a substitute for a хидрогеоложко проучване by a чл. 126-registered entity; and that the recommended point **подлежи на геодезическо заснемане преди изграждане**.

`Interpretation.disclaimerVersion` and the SHA-256 of the exported PDF are stored, so in three years you can prove exactly what the client was told.

---

## 9. Map

MapLibre GL JS with a **PMTiles** basemap: one Protomaps extract for Bulgaria (or just your working regions) as a single file in **OPFS**, registered via the `pmtiles://` protocol. Vector, styleable, legal, and roughly half a day of work with the existing npm package.

**⚠ CHANGED FROM v1.** Bounding-box tile prefetching into IndexedDB is removed. The OSM Foundation tile policy explicitly prohibits pre-emptive fetching, pre-seeding areas and offline-use features on `tile.openstreetmap.org`, and building it properly is a 3–5 day sub-project (tile index, z/x/y enumeration, throttled resumable queue, eviction, region-picker UI). PMTiles is better, cheaper and permitted.

---

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

---

## 11. Technical notes

- **Stack:** React + TS + Vite, Workbox, Dexie.
- **Service worker:** never `skipWaiting` automatically — prompt "update ready, restart?", and suppress the prompt entirely while a survey is open. Dexie migrations are additive-only with explicit `upgrade()` functions; **a backup zip is written automatically before any schema upgrade runs**. Test the update path on desktop before each field trip.
- **Geodesy:** local ENU tangent-plane, ~30 lines. Vincenty dropped (§5.3).
- **Projections:** proj4js, WGS84 + EPSG:7801 only in v1.
- **Profile:** custom canvas, ~150 lines for a 17×40 matrix. No charting library.
- **PDF:** jsPDF + canvas snapshots.
- **Dropped from v1 as over-engineering:** `syncLog` table, Vincenty, UTM CRS variants, SheetJS/xlsx import, the universal import engine, the tile prefetcher, the Drive OAuth subsystem. Roughly three weeks returned, none of it touching what makes the archive valuable.

---

## 12. Phases — reordered

v1 put the money feature last and the infrastructure first. Inverted:

**Phase 0 — read the SD card.** Half a day. Everything downstream is contingent on it. *(§0)*

**Phase 1 — the register.** Sites, surveys, lines, GPS vertex fixing with wake lock, point-1 anchor photo, photos, voice notes, search, edit/merge/delete, verdict + drill point + physical anchor, **drill outcomes**, backup via share sheet, GeoJSON + KMZ export.
This is usable alone and it is where the commercial value sits: a geo-referenced register with a growing prediction-vs-outcome track record. Note that outcomes — one form and two computed fields — are here, not in Phase 3.

**Phase 2 — the instrument.** The real parser, profile rendering, anomalies with numeric entry, correlations and intersections, client PDF + technical annex, CSV exports, BGS2005.

**Phase 3 — the polish.** PMTiles offline basemap, navigate-back, calibration dashboard, repeat-pass difference curves, noise-zone rendering, GPX.

**Phase 4 — if ever.** Drive API button, multi-device sync, external GNSS over Web Bluetooth, cadastral boundary import.

### Effort — honest numbers
v1 claimed 4–6 weeks part-time. Two independent estimates put it at **4–6 months part-time (12–15 h/week), or 6–9 weeks full-time**, and that was for the *larger* v1 scope. With v2's cuts and an AI coding agent doing the typing, expect roughly:

| Phase | Part-time | Notes |
|---|---|---|
| 0 | 0.5 day | Blocking prerequisite |
| 1 | 5–7 weeks | 11 screens' worth of CRUD, GPS, media, two exports, backup |
| 2 | 3–5 weeks | Unbounded until Phase 0 lands |
| 3 | 2–3 weeks | PMTiles is half a day; the dashboard is a week |
| Field iteration | 2–3 weeks | Glove use, sunlight, one-handed reach — only learnable at 35 °C on a slope |

An AI agent compresses the typing, not the deciding, the field-testing, or the unknown file format. Call it a 1.5–2× speedup on Phase 1 and close to none on Phase 0 and 2.

---

## 13. The baseline this app must beat

Before building anything, the honest alternative, stated so the decision is deliberate:

> One synced folder per survey on the phone (`2026-09-13_Dolna-Banya_Ivanov/`) holding device files and photos, mirrored by Drive or Syncthing. One spreadsheet, one row per line: site, village, client, date, device, start/end coordinates, L-number, verdict, drill coordinates, depth band, and later the drill outcome. Endpoint fixes taken with an existing GNSS-averaging app that already does 60-sample means. A QGIS project on the laptop reading that sheet, with ~10 lines of Python to interpolate points and place the drill marker, exporting GeoJSON/KML/GPX and printing the PDF layout. **Effort: a weekend.**

What that loses: in-field structured validation (typos reach the archive), the profile redraw and interpretation UI, navigate-back without a second app, and a track record that is a pivot table someone has to maintain by hand.

**That is genuinely about 15% of the value — but it is precisely the Phase 2 and 3 slice.** The strong version of the recommendation is therefore: **run the spreadsheet baseline for the next 5–10 sites while Phase 0 and Phase 1 are built.** If the spreadsheet turns out to be enough, you have lost a weekend instead of a quarter, and you will know exactly which fields matter because you will have filled them in on real sites.

---

## 14. Acceptance tests

Geometry tests marked ✅ have already been executed against this model.

| # | Test | Result |
|---|---|---|
| T1 | 17 points at 2 m, endpoints 32 m apart: reconstructed length matches to < 1 cm; the `(n−1)` cross-check does not false-warn | ✅ 4 mm error; `n × spacing` would have false-warned by 2 m |
| T2 | 7-decimal GeoJSON coordinates quantise below measurement noise | ✅ 1.4 cm |
| T3 | Inter-point spacing constant along an interpolated line | ✅ 7 mm max deviation — local ENU is sufficient, Vincenty unnecessary |
| T4 | A reversed line is caught, not silently accepted | ✅ error quantified at **20.0 m** for an anomaly at point 4; §5.4 defences are mandatory |
| T5 | CSV long export emits exactly `pointCount × channelCount` rows | ✅ 680/680 |
| T6 | GeoJSON → reimport → identical positions | ✅ 0 m drift |
| T7 | Storage at 200 sites × 2 surveys | ✅ data ~9 MB, **photos ~1.4 GB** → §10 offload rule |
| T8 | Airplane mode: full survey created, photographed and exported | to run |
| T9 | Exports load unmodified in QGIS, Google Earth, a handheld GPS | to run |
| T10 | EPSG:7801 output verified against a known Bulgarian control point | to run — **before the first client deliverable** |
| T11 | Same device file imported twice → refused as duplicate; a different file with the same L-number from another session → refused as ambiguous, not silently joined | to run |
| T12 | Survey cannot be finalised without a point-1 anchor photo | to run |
| T13 | Reinstall + restore from backup → dataset identical by canonical-JSON hash and per-blob SHA-256 | to run |
| T14 | Restore of an *older* backup over a newer database does not overwrite newer records | to run |
| T15 | `persist()` returning false is handled: app still works, nag escalates | to run |
| T16 | Survey cannot be finalised while the last backup predates it | to run |
| T17 | Endpoint fix above 15 m accuracy warns and records the flag, but never blocks | to run |
| T18 | 200 sites / 600 lines: map and list render under 1 s | to run |
| T19 | Wake lock survives a `visibilitychange` during a 60 s GPS average | to run |
| T20 | Schema upgrade writes a backup zip before running | to run |
| T21 | Delete IndexedDB cache; app rebuilds identical index from folder within 3 s on target hardware | to run |
| T22 | Crash mid-write (kill the process during a survey save); on relaunch the survey is either fully at the old state or fully at the new state, never partial | to run |
| T23 | Two-device merge with one file edited on each side: resolver presents a diff, does not silently pick | to run |

---

## 15. Open questions for you

1. **Phase 0** — can you pull an `L1` folder off the instrument this week? Everything about Phase 2's cost depends on it.
2. **Backup mechanism** — happy with share-sheet-to-Drive (one tap) plus an optional sync-folder, instead of the app authenticating to Drive itself?
3. **Channel depth mapping** — does your instrument or its manual give you a frequency→depth table, or is it the nominal linear split? This decides whether the profile has a metres axis at all.
4. **Electrode and dot spacing** — what do you actually use in the field? It sets the defaults and the sanity guards.
5. **The client deliverable** — should the one-page PDF carry a price/next-step block (drilling cost band, who to call), or stay purely technical?
6. **UI language** — Bulgarian interface with English field names in exports, or Bulgarian throughout?
7. **The baseline** — will you run the spreadsheet version on the next few sites in parallel? It is the cheapest way to find out which fields you really fill in.

---

# 16. Cadastral map module (added, v2.1)

Putting survey lines and drill points on the Bulgarian cadastral map. Drafted, critiqued by three reviewers (licensing 4.0, geospatial feasibility 4.5, adversarial 5.5), then cut by about three quarters.

## 16.1 Where the geometry comes from

| Route | What | Conditions | Verdict |
|---|---|---|---|
| **A · Open data** | `kais.cadastre.bg/bg/OpenData` — parcels, buildings, independent objects as SHP, whole country, released Dec 2024, ≈5–6 GB national | **No published licence.** Page carries „© Всички права запазени", no „Условия за повторно използване". КАИС Общи условия II.3 forbids commercial use and provision to third parties. | **Chosen — after the legal step below** |
| **B · WMS 8002** | АГКК paid subscription | €40.90/month or €409.03/year **per layer, per access point**; КЕП; **fixed registered IP** | Rejected — IP lock kills it for a phone |
| **C · Public viewer** | kais.cadastre.bg/bg/Map | Unambiguously a „услуга, получена чрез КАИС портал" — II.3 bites hardest | Manual browser cross-check only |
| **D · Aggregators** | papagal.bg etc. | Redistribution rights unverified | Rejected |

**The counterweight, and the step before any code.** Commission Implementing Regulation (EU) 2023/138 lists cadastral parcels as a **high-value dataset**: Art. 3 requires them free, machine-readable and in bulk; **Art. 4(3) requires CC BY 4.0, CC0 or less restrictive**. Applicable since June 2024 — before the КАИС release — and carried into Bulgarian law by ЗДОИ чл. 41а². АГКК is obliged to license this openly and appears not to have.

That is an obligation on the State, not a grant in your hands. **Send АГКК a written re-use enquiry citing 2023/138 Art. 4(3) and ЗДОИ чл. 41а², asking for the licence and the required attribution string.** Either you get a grant or a dated, evidenced good-faith position. Archive a screenshot of the download page as it stood on download day.

Note the trap in route B: paying makes you a registered „Клиент" bound by II.3, so **the paid route has strictly worse redistribution rights than the free one**. And the OSM Bulgaria community ran this analysis before an import attempt, found no licence terms anywhere, and did not proceed.

## 16.2 What the module does — and what was cut

It renders parcel outlines and the identifier. **It never prints a distance in metres.** Error budget:

| Source | 1σ | Note |
|---|---|---|
| Phone GPS under canopy / on a slope | ≥ 10 m | `hAccM` is a 68% radius, not a bound; 2σ ≈ 20 m |
| Rural КККР converted from КВС | 1–3 m | Systematic. Urban surveyed КККР is ±0.1–0.3 m; rural conversion is not — and rural is where water surveys happen |
| Snapshot age | unbounded | A split or merge since the snapshot moves the boundary entirely |
| Vector-tile quantisation at z14 | 0.44 m | 0.11 m at z16 |

Combined ≈ **10–16 m**. „12,4 м от границата" claims decimetre knowledge of a quantity known to ±13 m. So the output is **three bands, never a number**: `в имота` · `близо до граница` · `неизвестно`, where *близо* = any boundary within 3 × `hAccM`, and the only copy is **„не мога да определя имота с тази точност — трасиране от правоспособен геодезист преди сондаж."**

Cut for cause:

- **СОЗ checking.** Санитарно-охранителни зони are **not in КККР and not in this data** — they live in БД/МОСВ acts under Наредба 3/2000 and cross parcel boundaries. A clean parcel view must never read as "no СОЗ conflict".
- **Площ по КККР on the client PDF.** It routinely differs from площ по нотариален акт; printing it hands a buyer a document contradicting the area he is paying for.
- **`confirmed-by-user`.** What gets confirmed is an identifier matching a deed — never that the polygon is current or coincident with the fence. In a dispute, `spatial-guess` reads as "the machine estimated" and `confirmed-by-user` reads as "the professional attested."
- **`Line.parcelHits[]`.** Clipping work plus GDPR exposure on neighbours' identifiers, for a number that changes no decision.

## 16.3 Pipeline, hardened

1. **Enumerate.** No API, no per-ЕКАТТЕ URL. POST tree walk: `/bg/OpenData/Read` through област → община → населено място → files, then `GET /bg/OpenData/Download?path=` with URL-encoded Cyrillic path. Script once, cache an ЕКАТТЕ→path map, expect breakage on portal redeploys.
2. **Discover the schema first.** `ogrinfo -al -so` on three землища from different области. Field names are unpublished and DBF caps them at 10 chars.
3. **Settle encoding.** Check `.cpg`, then DBF byte 29; else `SHAPE_ENCODING=CP1251`, and assert strings round-trip to valid Cyrillic.
4. **Read the `.prj`. Never force blindly.** See the CRS trap below.
5. **Validate geometry:** `-makevalid -nlt PROMOTE_TO_MULTI`, log repairs. Invalid rings give *wrong point-in-polygon answers*.
6. **Strip personal data from the archive, not just the DBF.** The ZIPs also contain XLSX ownership registers (~24 M national records, hashed ЕГН). An unsalted hash of a small-keyspace structured identifier is pseudonymised, not anonymised. Allow-list with `-select` **and** delete the register files before packaging.
7. **Tiles:** `tippecanoe -z16 -Z10 -pS -pt -ab -pf -pk` on `felt/tippecanoe`. Defaults are wrong here — DP runs at maxzoom, tiny-polygon reduction squares off small parcels, adjacent parcels simplify independently and open slivers.
8. **Ship two artefacts per землище:** PMTiles for display, exact GeoJSON/FlatGeobuf for measurement.

Sizes: rural землище ~4 000 parcels ≈ 2.3 MB GeoJSON ≈ 0.29 MB tiles at z16; twenty ≈ 6 MB. Urban (a Sofia район) is 10–50× — quote separately.

### The CRS trap (tested)

Forcing `-s_srs EPSG:7801` on a землище actually in BGS2005 / UTM 34N or 35N produces a **~125 km longitude shift with latitude almost unchanged**, because CCS2005's false northing (4 725 824.3591 m) sits close to the meridional arc at its latitude of origin. A Bulgaria bbox gate **passes the error for 74% of the country** (UTM 35N) and 29% (34N). The first draft tested only the swapped-axis case the bbox does catch.

**The guard that works:** transform, then assert the layer centroid falls inside that ЕКАТТЕ's землище polygon, or within 3 km of the NSI settlement centroid. Plus the cheap check: EPSG:7801's official axis order is **northing first** while shapefiles store easting first — if |X| > 4 000 000 the file is N-E and needs a swap first.

Verified control: 42.32160 N / 23.78500 E → N 4 688 795.27, E 358 645.30, round-trip exact. But a round-trip proves only invertibility — every wrong transform round-trips too.

## 16.4 Runtime — render and measure are different paths

`queryRenderedFeatures` returns tile-derived geometry: **simplified, clipped at tile boundaries, duplicated across tiles, viewport-limited**. A parcel straddling a tile edge returns as two partial polygons whose cut edges are fake boundaries, so distance-to-boundary can return the distance to a tile seam. `querySourceFeatures` does not fix it.

Tiles render; a separate exact-geometry store measures. Rendered hit → candidate identifier → load the true ring from the store keyed by ЕКАТТЕ (~2.3 MB, on map idle). Review assertion: **no measurement path ever touches a MapLibre feature object.**

**Measure in EPSG:7801 metres, never degrees.** At 42.5° N a degree of longitude is 82.1 km vs 111.1 km of latitude — 1.356× anisotropy — so a true 5.00 m east–west setback computes as 6.78 m and the nearest edge can be the wrong edge.

Silent failures: **glyphs and sprites are not covered by the pmtiles protocol handler** — bundle them locally or labels vanish offline. OPFS buckets are evictable, so `navigator.storage.persist()` is load-bearing.

## 16.5 Data model (reduced)

- `CadastralLayer` — `regionName, ekatteList[], sourceUrl, sourceDate, downloadedAt, sourceChecksum, featureCount, previousFeatureCount, crsResolvedAs, repairedGeometries, staleAfter, pmtilesRef, geometryRef`
- `Site.parcelId` — `identifier, ekatte, linkMethod` (`from-document` | `spatial-hit` | `none`)`, sourceLayerId`. No confirm button, no `confirmedAt`.
- `recommendedDrill.parcelState` — `inside` | `near-boundary` | `unknown`.

Gone: `parcelHits[]`, `boundaryConfidence` (undefined units and scale — unimplementable), `distanceToBoundaryM`, `areaM2`.

## 16.6 Staleness acted on

`staleAfter` = 180 days; past it the layer desaturates behind a banner and the export stops printing the identifier. Each re-run diffs `featureCount` and the identifier set against the previous run — a renamed source column makes `ogr2ogr` silently emit empty identifiers and nothing else would notice.

Coverage gaps: ~380 settlements (7.2%) and whole municipalities (Varna, Lovech reported) absent. The app says **„няма кадастрален слой за това землище"**, never "no parcel here" — on the PDF as well as the screen.

## 16.7 GDPR

Stripping owner columns protects the client, not the neighbours. A cadastral identifier resolves to an owner through a public register, so a stored neighbouring identifier is third-party personal data. Dropping `parcelHits[]` removes most of it by design. Remaining, to write down once: lawful basis Art. 6(1)(f) with a one-page LIA; Art. 14(5)(b) disproportionate-effort reasoning recorded not assumed; a retention limit on parcel links; minimisation on export.

## 16.8 Liability framing

**Чл. 94 ЗЗД voids advance exclusion of liability for умисъл or груба небрежност**, with consumer-contract review on top — a disclaimer is one fact a court weighs, not a shield. **Определяне и трасиране на граници на място is reserved to правоспособни лица по ЗКИР**: displaying published cadastral data is not a regulated activity, but a client-facing document carrying a boundary measurement edges toward one. That is the strongest practical reason the module prints a band, not a number.

## 16.9 Effort

As drafted: **3–4 weeks part-time**, not one week. As converged: **~3 days**. Phase 2. The QGIS-only pipeline is genuinely one day and useful immediately with no app — which is what made the one-week estimate feel right when it wasn't.
