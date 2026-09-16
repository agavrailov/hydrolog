import { describe, it, expect } from 'vitest';
import { enuOf, llFromEnu, polylineLengthM, interpolatePointsAlongPolyline, interpolatePointsAtFractions } from './enu';

const REF_LAT = 42.32;
const REF_LON = 23.78;

describe('enuOf / llFromEnu', () => {
  it('is a round-trip identity at sub-cm precision at 42.32N', () => {
    const cases = [
      { lat: 42.32,     lon: 23.78     },
      { lat: 42.320001, lon: 23.780001 },
      { lat: 42.320100, lon: 23.780050 },
      { lat: 42.319500, lon: 23.780200 },
    ];
    for (const c of cases) {
      const { e, n } = enuOf(REF_LAT, REF_LON, c.lat, c.lon);
      const back = llFromEnu(REF_LAT, REF_LON, e, n);
      // 1e-8 deg ~ 1.1 mm — that's the round-trip tolerance
      expect(back.lat).toBeCloseTo(c.lat, 8);
      expect(back.lon).toBeCloseTo(c.lon, 8);
    }
  });

  it('reference point maps to (0,0)', () => {
    expect(enuOf(REF_LAT, REF_LON, REF_LAT, REF_LON)).toEqual({ e: 0, n: 0 });
  });
});

describe('polylineLengthM', () => {
  it('returns 0 for a single vertex', () => {
    expect(polylineLengthM([{ lat: REF_LAT, lon: REF_LON }])).toBe(0);
  });

  it('matches expected metric distance for a straight 32 m line east-west', () => {
    // 32 m east at REF_LAT: dLon in radians = 32 / (R * cos(lat))
    const R = 6378137;
    const dLon = 32 / (R * Math.cos((REF_LAT * Math.PI) / 180)); // radians
    const endLon = REF_LON + (dLon * 180) / Math.PI;
    const len = polylineLengthM([
      { lat: REF_LAT, lon: REF_LON },
      { lat: REF_LAT, lon: endLon },
    ]);
    expect(len).toBeCloseTo(32, 3); // < 1 mm
  });
});

describe('interpolatePointsAlongPolyline (§14 T1, T3)', () => {
  it('returns exactly pointCount points, first = first vertex, last = last vertex', () => {
    const R = 6378137;
    const dLon = 32 / (R * Math.cos((REF_LAT * Math.PI) / 180));
    const endLon = REF_LON + (dLon * 180) / Math.PI;
    const pts = interpolatePointsAlongPolyline(
      [{ lat: REF_LAT, lon: REF_LON }, { lat: REF_LAT, lon: endLon }],
      17,
    );
    expect(pts).toHaveLength(17);
    expect(pts[0].lat).toBeCloseTo(REF_LAT, 10);
    expect(pts[0].lon).toBeCloseTo(REF_LON, 10);
    expect(pts[16].lat).toBeCloseTo(REF_LAT, 8);
    expect(pts[16].lon).toBeCloseTo(endLon, 8);
  });

  it('inter-point spacing is constant to <= 10 mm along a straight 32 m line (§14 T3)', () => {
    const R = 6378137;
    const dLon = 32 / (R * Math.cos((REF_LAT * Math.PI) / 180));
    const endLon = REF_LON + (dLon * 180) / Math.PI;
    const pts = interpolatePointsAlongPolyline(
      [{ lat: REF_LAT, lon: REF_LON }, { lat: REF_LAT, lon: endLon }],
      17,
    );
    const spacings: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      spacings.push(polylineLengthM([pts[i - 1], pts[i]]));
    }
    const expected = 32 / 16; // 17 points ⇒ 16 intervals
    for (const s of spacings) {
      expect(Math.abs(s - expected)).toBeLessThan(0.01); // 10 mm
    }
  });

  it('honours detour vertices — points interpolate along the polyline, not the endpoint chord', () => {
    // L-shape: 20 m east, then 20 m north. Reconstructed length ~40 m.
    const R = 6378137;
    const cosLat = Math.cos((REF_LAT * Math.PI) / 180);
    const dLonEast = ((20 / (R * cosLat)) * 180) / Math.PI;
    const dLatNorth = ((20 / R) * 180) / Math.PI;
    const vertices = [
      { lat: REF_LAT, lon: REF_LON },
      { lat: REF_LAT, lon: REF_LON + dLonEast },
      { lat: REF_LAT + dLatNorth, lon: REF_LON + dLonEast },
    ];
    expect(polylineLengthM(vertices)).toBeCloseTo(40, 2);
    const pts = interpolatePointsAlongPolyline(vertices, 5); // 4 intervals of 10 m
    // Midpoint (index 2) should sit exactly at the corner
    expect(pts[2].lat).toBeCloseTo(REF_LAT, 5);
    expect(pts[2].lon).toBeCloseTo(REF_LON + dLonEast, 8);
  });
});

describe('interpolatePointsAtFractions', () => {
  const R = 6378137;
  const cosLat = Math.cos(REF_LAT * Math.PI / 180);

  function eastLon(metres: number): number {
    return REF_LON + (metres / (R * cosLat)) * (180 / Math.PI);
  }

  it('fraction 0 → first vertex; fraction 1 → last vertex', () => {
    const endLon = eastLon(52.5);
    const V1 = { lat: REF_LAT, lon: REF_LON };
    const V2 = { lat: REF_LAT, lon: endLon };
    const pts = interpolatePointsAtFractions([V1, V2], [0, 1]);
    expect(pts[0].lat).toBeCloseTo(REF_LAT, 8);
    expect(pts[0].lon).toBeCloseTo(REF_LON, 8);
    expect(pts[1].lat).toBeCloseTo(REF_LAT, 8);
    expect(pts[1].lon).toBeCloseTo(endLon, 8);
  });

  it('fraction 0.5 → midpoint of a two-vertex straight line', () => {
    const endLon = eastLon(52.5);
    const V1 = { lat: REF_LAT, lon: REF_LON };
    const V2 = { lat: REF_LAT, lon: endLon };
    const pts = interpolatePointsAtFractions([V1, V2], [0.5]);
    expect(pts[0].lon).toBeCloseTo((REF_LON + endLon) / 2, 6);
  });

  it('GT-150 fractions 2/21 and 19/21 land at the correct electrode positions on a 52.5 m cable', () => {
    // Cable: 21 electrode spacings × 2.5 m = 52.5 m, straight east-west.
    // Electrode 1 at REF_LON (fraction 0), electrode 22 at endLon (fraction 1).
    // Point 1 (electrode 3) at fraction 2/21 → 5 m from start.
    // Point 18 (electrode 20) at fraction 19/21 → 47.5 m from start.
    const endLon = eastLon(52.5);
    const V1 = { lat: REF_LAT, lon: REF_LON };
    const V2 = { lat: REF_LAT, lon: endLon };
    const pts = interpolatePointsAtFractions([V1, V2], [2 / 21, 19 / 21]);

    const expectedP1Lon  = eastLon(5.0);   // 2 spacings × 2.5 m
    const expectedP18Lon = eastLon(47.5);  // 19 spacings × 2.5 m
    expect(pts[0].lon).toBeCloseTo(expectedP1Lon, 4);
    expect(pts[1].lon).toBeCloseTo(expectedP18Lon, 4);

    // Neither point is at the cable endpoints (service electrodes).
    expect(pts[0].lon).not.toBeCloseTo(REF_LON, 4);
    expect(pts[1].lon).not.toBeCloseTo(endLon, 4);
  });

  it('returns empty array for empty fractions', () => {
    expect(interpolatePointsAtFractions([{ lat: REF_LAT, lon: REF_LON }], [])).toEqual([]);
  });

  it('returns empty array for empty vertices', () => {
    expect(interpolatePointsAtFractions([], [0.5])).toEqual([]);
  });
});
