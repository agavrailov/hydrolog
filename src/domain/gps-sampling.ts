import type { Vertex } from './types';
import { holdWakeLock } from '../hardware/wake-lock';
import { getGeolocationAdapter } from '../hardware/geolocation';

export interface SamplingOptions {
  targetSamples: number;
  discardFirst: number;
  timeoutMs: number;
  onProgress?: (kept: number, latestAccuracyM: number) => void;
}

export interface SamplingResult {
  vertex: Vertex;
  sampleCount: number;
  medianAccuracyM: number;
  acceptedDespiteWarning: boolean;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export async function sampleVertex(
  electrodeIndex: number,
  opts: SamplingOptions,
): Promise<SamplingResult> {
  const release = await holdWakeLock();
  const kept: { lat: number; lon: number; acc: number }[] = [];
  let discarded = 0;

  const geo = getGeolocationAdapter();

  return new Promise<SamplingResult>((resolve, reject) => {
    let settled = false;
    const watchId = geo.watchPosition(
      (fix) => {
        if (settled) return;
        if (discarded < opts.discardFirst) {
          discarded++;
          return;
        }
        kept.push({ lat: fix.lat, lon: fix.lon, acc: fix.accuracyM });
        opts.onProgress?.(kept.length, fix.accuracyM);
        if (kept.length >= opts.targetSamples) finalize();
      },
      (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      },
    );

    const timer = setTimeout(finalize, opts.timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      geo.clearWatch(watchId);
      void release();
    }

    function finalize() {
      if (settled) return;
      settled = true;
      cleanup();
      const n = kept.length;
      if (n === 0) {
        reject(new Error('no GPS samples collected before timeout'));
        return;
      }
      const meanLat = kept.reduce((s, k) => s + k.lat, 0) / n;
      const meanLon = kept.reduce((s, k) => s + k.lon, 0) / n;
      const medianAccuracyM = median(kept.map((k) => k.acc));
      const vertex: Vertex = {
        lat: meanLat,
        lon: meanLon,
        elevSource: 'none',
        hAccM: medianAccuracyM,
        hAccMethod: 'median-reported',
        sampleCount: n,
        fixedAt: new Date(),
        electrodeIndex,
      };
      resolve({
        vertex,
        sampleCount: n,
        medianAccuracyM,
        acceptedDespiteWarning: medianAccuracyM > 15,
      });
    }
  });
}
