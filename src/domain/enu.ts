import type { LatLon } from './types';

const R_EARTH = 6378137; // WGS84 equatorial radius, metres
const DEG = Math.PI / 180;

export function enuOf(
  refLat: number, refLon: number,
  lat: number, lon: number,
): { e: number; n: number } {
  const cosRefLat = Math.cos(refLat * DEG);
  const dLat = (lat - refLat) * DEG;
  const dLon = (lon - refLon) * DEG;
  return {
    e: R_EARTH * cosRefLat * dLon,
    n: R_EARTH * dLat,
  };
}

export function llFromEnu(
  refLat: number, refLon: number,
  e: number, n: number,
): { lat: number; lon: number } {
  const cosRefLat = Math.cos(refLat * DEG);
  const dLat = n / R_EARTH;
  const dLon = e / (R_EARTH * cosRefLat);
  return {
    lat: refLat + dLat / DEG,
    lon: refLon + dLon / DEG,
  };
}

export function polylineLengthM(vertices: LatLon[]): number {
  if (vertices.length < 2) return 0;
  const ref = vertices[0];
  let total = 0;
  let prev = enuOf(ref.lat, ref.lon, vertices[0].lat, vertices[0].lon);
  for (let i = 1; i < vertices.length; i++) {
    const cur = enuOf(ref.lat, ref.lon, vertices[i].lat, vertices[i].lon);
    const de = cur.e - prev.e;
    const dn = cur.n - prev.n;
    total += Math.sqrt(de * de + dn * dn);
    prev = cur;
  }
  return total;
}

export function interpolatePointsAlongPolyline(
  vertices: LatLon[],
  pointCount: number,
): LatLon[] {
  if (pointCount < 1) return [];
  if (vertices.length === 0) return [];
  if (vertices.length === 1) return Array(pointCount).fill(vertices[0]);

  const ref = vertices[0];
  const enu = vertices.map((v) => enuOf(ref.lat, ref.lon, v.lat, v.lon));
  const segLens: number[] = [];
  let total = 0;
  for (let i = 1; i < enu.length; i++) {
    const de = enu[i].e - enu[i - 1].e;
    const dn = enu[i].n - enu[i - 1].n;
    const s = Math.sqrt(de * de + dn * dn);
    segLens.push(s);
    total += s;
  }

  if (pointCount === 1) return [vertices[0]];
  const step = total / (pointCount - 1);
  const points: LatLon[] = [];

  for (let i = 0; i < pointCount; i++) {
    const target = i * step;
    let acc = 0;
    let seg = 0;
    while (seg < segLens.length && acc + segLens[seg] < target) {
      acc += segLens[seg];
      seg++;
    }
    if (seg >= segLens.length) {
      // At or beyond end
      const last = enu[enu.length - 1];
      points.push(llFromEnu(ref.lat, ref.lon, last.e, last.n));
      continue;
    }
    const t = segLens[seg] === 0 ? 0 : (target - acc) / segLens[seg];
    const a = enu[seg];
    const b = enu[seg + 1];
    const e = a.e + t * (b.e - a.e);
    const n = a.n + t * (b.n - a.n);
    points.push(llFromEnu(ref.lat, ref.lon, e, n));
  }
  return points;
}
