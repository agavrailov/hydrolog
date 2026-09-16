import type { LatLon, Point, ChannelSetSnapshot } from './types';
import { interpolatePointsAlongPolyline, interpolatePointsAtFractions, polylineLengthM } from './enu';
import type { ElectrodeLayout } from './device-config';
import { activePointFractions } from './device-config';

export interface BuildLinePointsInput {
  vertices: LatLon[];
  pointCount: number;
  channelSet: ChannelSetSnapshot;
  parsedReadings: (number | null)[][];  // [pointIndex][channelIndex], 0-based
  recordedAt: Date;
  electrodeLayout?: ElectrodeLayout;   // when set, points are placed at active-zone fractions of the cable
}

export function buildLinePoints(input: BuildLinePointsInput): Point[] {
  const { vertices, pointCount, channelSet, parsedReadings, recordedAt, electrodeLayout } = input;
  const interpolated = electrodeLayout && vertices.length >= 2
    ? interpolatePointsAtFractions(vertices, activePointFractions(electrodeLayout))
    : interpolatePointsAlongPolyline(vertices, pointCount);
  // When no GPS vertices are provided (e.g. import-as-new-line flow), fall back to
  // placeholder positions so readings data is stored and the profile canvas can render.
  const latLons: LatLon[] = interpolated.length > 0
    ? interpolated
    : Array.from({ length: pointCount }, () => ({ lat: 0, lon: 0 }));
  const totalLengthM = vertices.length >= 2 ? polylineLengthM(vertices) : 0;
  const step = pointCount > 1 ? totalLengthM / (pointCount - 1) : 0;
  const nChannels = channelSet.channels.length;

  return latLons.map((ll, i) => {
    const row = parsedReadings[i];
    const values: (number | null)[] = row
      ? [...row]
      : new Array(nChannels).fill(null);

    return {
      index: i + 1,
      offsetM: parseFloat((i * step).toFixed(4)),
      lat: ll.lat,
      lon: ll.lon,
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
