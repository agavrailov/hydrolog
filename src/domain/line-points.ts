import type { LatLon, Point, ChannelSetSnapshot } from './types';
import { interpolatePointsAlongPolyline, interpolatePointsAtFractions, polylineLengthM } from './enu';
import type { ElectrodeLayout } from './device-config';
import { activePointFractions } from './device-config';

// The last vertex's electrodeIndex says how much cable the polyline covers.
type CableVertex = LatLon & { electrodeIndex?: number };

export interface BuildLinePointsInput {
  vertices: CableVertex[];
  pointCount: number;
  channelSet: ChannelSetSnapshot;
  parsedReadings: (number | null)[][];  // [pointIndex][channelIndex], 0-based
  recordedAt: Date;
  electrodeLayout?: ElectrodeLayout;   // when set, points are placed at active-zone fractions of the cable
}

function placePoints(
  vertices: CableVertex[],
  pointCount: number,
  electrodeLayout?: ElectrodeLayout,
): (LatLon & { offsetM: number })[] {
  const totalLengthM = vertices.length >= 2 ? polylineLengthM(vertices) : 0;

  // Active-zone placement: the measured points sit on the active electrodes, which are
  // inset from the cable ends by the service electrodes. Falls back to a uniform spread
  // when there is no layout for the device, when GPS vertices are missing, or when more
  // points were measured than the active zone can hold (activePointFractions → []).
  const fractions = electrodeLayout && vertices.length >= 2
    ? activePointFractions(electrodeLayout, pointCount, vertices[vertices.length - 1].electrodeIndex)
    : [];
  const useLayout = fractions.length === pointCount && pointCount > 0;

  const interpolated = useLayout
    ? interpolatePointsAtFractions(vertices, fractions)
    : interpolatePointsAlongPolyline(vertices, pointCount);
  // When no GPS vertices are provided (e.g. import-as-new-line flow), fall back to
  // placeholder positions so readings data is stored and the profile canvas can render.
  const latLons: LatLon[] = interpolated.length > 0
    ? interpolated
    : Array.from({ length: pointCount }, () => ({ lat: 0, lon: 0 }));

  // offsetM is measured along the polyline from point 1, so point 1 is always 0 —
  // in the layout case that is the first ACTIVE electrode, not the cable start.
  const offsets: number[] = useLayout
    ? fractions.map((f) => (f - fractions[0]) * totalLengthM)
    : Array.from({ length: pointCount }, (_, i) =>
        pointCount > 1 ? (i * totalLengthM) / (pointCount - 1) : 0);

  return latLons.map((ll, i) => ({
    lat: ll.lat,
    lon: ll.lon,
    offsetM: parseFloat((offsets[i] ?? 0).toFixed(4)),
  }));
}

// For geometry that arrives after import: moves interpolated points and leaves
// readings, flags, notes and any measured or manual position untouched.
export function repositionPoints(
  points: Point[],
  vertices: CableVertex[],
  electrodeLayout?: ElectrodeLayout,
): Point[] {
  const placed = placePoints(vertices, points.length, electrodeLayout);
  return points.map((p, i) => (p.coordSource === 'interpolated' ? { ...p, ...placed[i] } : p));
}

export function buildLinePoints(input: BuildLinePointsInput): Point[] {
  const { vertices, pointCount, channelSet, parsedReadings, recordedAt, electrodeLayout } = input;
  const nChannels = channelSet.channels.length;

  return placePoints(vertices, pointCount, electrodeLayout).map((placed, i) => {
    const row = parsedReadings[i];
    const values: (number | null)[] = row
      ? [...row]
      : new Array(nChannels).fill(null);

    return {
      index: i + 1,
      ...placed,
      elevSource: 'none' as const,
      coordSource: 'interpolated' as const,
      readings: [{
        pass: 1,
        recordedAt,
        values,
        groundingOk: true,
        electrodeTreatment: 'none' as const,
      }],
      flags: [],
    };
  });
}
