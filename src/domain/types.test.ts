import { describe, it, expectTypeOf } from 'vitest';
import type {
  Site, Survey, Line, ChannelSet, ChannelSetSnapshot,
  Units, DepthModel, AnomalyType, Verdict,
  AuditFields, Reading, Vertex, Anomaly,
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

  it('Survey is a valid type with timezone', () => {
    const surv: Survey = {
      id: '01J...',
      siteId: 'site1',
      createdAt: new Date(),
      updatedAt: new Date(),
      revision: 1,
      startedAt: new Date(),
      timezone: 'Europe/Sofia',
      operator: 'John',
      deviceModel: 'TC300',
      deviceSerial: 'SN123',
      precipLast48h: 'none',
      qualityFlag: 'good',
    };
    void surv;
  });

  it('ChannelSet is a valid type', () => {
    const cs: ChannelSet = {
      id: '01J...',
      createdAt: new Date(),
      updatedAt: new Date(),
      revision: 1,
      name: 'TC300',
      deviceModel: 'PQWT-TC300',
      kind: 'frequency',
      units: 'mV',
      depthModel: 'linear-nominal',
      provenanceNote: '',
      channels: [],
      frozenAt: new Date(),
    };
    void cs;
  });

  it('Verdict values are all valid', () => {
    const v1: Verdict = 'drill-recommended';
    const v2: Verdict = 'not-recommended';
    const v3: Verdict = 'inconclusive';
    void v1; void v2; void v3;
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

  it('R2: Anomaly literals with depth_m fail to typecheck', () => {
    const bad: Anomaly = {
      lineId: 'x', fromPoint: 1, toPoint: 2,
      fromChannel: 0, toChannel: 1,
      // @ts-expect-error R2: pseudo-depth field is pseudoDepthFromM, never depth_m
      depth_m: 42,
      type: 'fracture-signature', confidence: 3,
      pseudoDepthFromM: 0, pseudoDepthToM: 0,
    };
    void bad;
  });

  it('R3: DepthModel forbids arbitrary strings', () => {
    // @ts-expect-error R3: DepthModel is a strict four-value union
    const bad: DepthModel = 'made-up-model';
    void bad;
  });
});

// re-import at bottom because vitest needs the value
import type { TransformLogEntry } from './types';
