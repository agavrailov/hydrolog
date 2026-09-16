import { describe, it, expect } from 'vitest';
import { buildLinePoints } from './line-points';
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
