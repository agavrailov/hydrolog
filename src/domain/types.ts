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
  deviceStartPointIndex?: number;    // §7: operator-set device N at point 1 (varies per line); preserve verbatim per §7.5
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
