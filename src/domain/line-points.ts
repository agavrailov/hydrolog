import type { LatLon, Point, ChannelSetSnapshot } from './types';
import { interpolatePointsAlongPolyline, polylineLengthM } from './enu';

export interface BuildLinePointsInput {
  vertices: LatLon[];
  pointCount: number;
  channelSet: ChannelSetSnapshot;
  parsedReadings: (number | null)[][];  // [pointIndex][channelIndex], 0-based
  recordedAt: Date;
}

export function buildLinePoints(input: BuildLinePointsInput): Point[] {
  const { vertices, pointCount, channelSet, parsedReadings, recordedAt } = input;
  const latLons = interpolatePointsAlongPolyline(vertices, pointCount);
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
