import { describe, it, expect } from 'vitest';
import { buildLinePoints } from './line-points';
import { polylineLengthM } from './enu';
import { ELECTRODE_LAYOUT } from './device-config';
import type { ChannelSetSnapshot, LatLon } from './types';

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

  it('first point has offsetM=0; last point has offsetM>middle', () => {
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
      parsedReadings: [[0.1, 0.2]],
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

// ─── GT-150 S-A-S electrode layout mapping ────────────────────────────────────
// The GPS fix is taken at the physical cable endpoints:
//   electrode 1 (service start) and electrode 22 (service end).
// The 18 active measurement points sit at electrodes 3–20, i.e. fractions 2/21–19/21.
// This test block verifies that buildLinePoints with electrodeLayout places
// each point at the correct physical position — not uniformly across the full cable.
describe('buildLinePoints — GT-150 electrodeLayout', () => {
  const GT150 = ELECTRODE_LAYOUT['GT-150']!; // {serviceStart:2, active:18, serviceEnd:2}
  const POINT_SPACING_M = 2.5;
  const TOTAL_SPACINGS = 21;                 // 22 electrodes − 1
  const CABLE_M = TOTAL_SPACINGS * POINT_SPACING_M; // 52.5 m

  // Straight east-west cable at REF_LAT.
  const R = 6378137;
  const REF_LAT = 42.32;
  const cosLat = Math.cos(REF_LAT * Math.PI / 180);
  function eastLon(metres: number) {
    return 23.0 + (metres / (R * cosLat)) * (180 / Math.PI);
  }
  const V_START: LatLon = { lat: REF_LAT, lon: eastLon(0) };         // electrode 1
  const V_END: LatLon   = { lat: REF_LAT, lon: eastLon(CABLE_M) };  // electrode 22

  const emptyReadings = Array.from({ length: 18 }, () => [0.0]);
  const ONE_CH: ChannelSetSnapshot = {
    name: 'test', deviceModel: 'GT-150', kind: 'frequency',
    units: 'mV', depthModel: 'linear-nominal', provenanceNote: '',
    frozenAt: new Date('2026-01-01'),
    channels: [{ label: 'ch1', order: 0, pseudoDepthM: 10 }],
  };

  function build() {
    return buildLinePoints({
      vertices: [V_START, V_END],
      pointCount: GT150.active,
      channelSet: ONE_CH,
      parsedReadings: emptyReadings,
      recordedAt: new Date(),
      electrodeLayout: GT150,
    });
  }

  it('returns exactly 18 points (active electrode count)', () => {
    expect(build()).toHaveLength(18);
  });

  it('point 1 is at electrode 3 — 5 m from cable start, NOT at the start vertex', () => {
    const pts = build();
    const expectedLon = eastLon(2 * POINT_SPACING_M); // 2 spacings from electrode 1
    expect(pts[0].lon).toBeCloseTo(expectedLon, 4);
    expect(pts[0].lon).not.toBeCloseTo(V_START.lon, 4);
  });

  it('point 18 is at electrode 20 — 47.5 m from cable start, NOT at the end vertex', () => {
    const pts = build();
    const expectedLon = eastLon(19 * POINT_SPACING_M); // 19 spacings from electrode 1
    expect(pts[17].lon).toBeCloseTo(expectedLon, 4);
    expect(pts[17].lon).not.toBeCloseTo(V_END.lon, 4);
  });

  it('consecutive points are spaced exactly pointSpacingM (2.5 m) apart', () => {
    const pts = build();
    for (let i = 1; i < pts.length; i++) {
      const d = polylineLengthM([pts[i - 1], pts[i]]);
      expect(d).toBeCloseTo(POINT_SPACING_M, 1); // 0.1 m tolerance
    }
  });

  it('no point lands on either service-electrode endpoint', () => {
    const pts = build();
    const totalCable = polylineLengthM([V_START, V_END]);
    for (const pt of pts) {
      const distFromStart = polylineLengthM([V_START, pt]);
      const distFromEnd   = polylineLengthM([pt, V_END]);
      expect(distFromStart).toBeGreaterThan(0.1);
      expect(distFromEnd).toBeGreaterThan(0.1);
      expect(distFromStart).toBeLessThan(totalCable - 0.1);
    }
  });

  it('without electrodeLayout points are uniformly distributed (cable start to end)', () => {
    // Verify that removing the layout changes point 1's position — confirms the layout is load-bearing.
    const withLayout    = build();
    const withoutLayout = buildLinePoints({
      vertices: [V_START, V_END],
      pointCount: 18,
      channelSet: ONE_CH,
      parsedReadings: emptyReadings,
      recordedAt: new Date(),
      // no electrodeLayout
    });
    // With layout: point 1 at 2/21 of cable (~5 m from start)
    // Without layout: point 1 at 0/17 of cable = start vertex (0 m)
    expect(withLayout[0].lon).not.toBeCloseTo(withoutLayout[0].lon, 4);
    // Without layout: first point is at the start vertex
    expect(withoutLayout[0].lon).toBeCloseTo(V_START.lon, 6);
    // Without layout: last point is at the end vertex
    expect(withoutLayout[17].lon).toBeCloseTo(V_END.lon, 6);
  });
});
