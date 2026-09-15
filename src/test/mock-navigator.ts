import type { WakeLockAdapter, WakeLockSentinel } from '../hardware/wake-lock';
import type { GeolocationAdapter, GeoFix } from '../hardware/geolocation';

export function mockWakeLockAdapter(): { adapter: WakeLockAdapter; sentinels: WakeLockSentinel[] } {
  const sentinels: WakeLockSentinel[] = [];
  const adapter: WakeLockAdapter = {
    async request(_type) {
      let released = false;
      const s: WakeLockSentinel = {
        released: false,
        async release() {
          released = true;
          s.released = true;
        },
      };
      // Expose the closure's flag so tests can inspect
      Object.defineProperty(s, '_released', { get: () => released });
      sentinels.push(s);
      return s;
    },
  };
  return { adapter, sentinels };
}

export function mockGeolocationAdapter(): {
  adapter: GeolocationAdapter;
  pushFix: (fix: Partial<GeoFix>) => void;
  pushError: (msg: string) => void;
} {
  let nextWatchId = 1;
  const watchers = new Map<number, { onFix: (f: GeoFix) => void; onError: (e: Error) => void }>();

  const adapter: GeolocationAdapter = {
    watchPosition(onFix, onError) {
      const id = nextWatchId++;
      watchers.set(id, { onFix, onError });
      return id;
    },
    clearWatch(id) {
      watchers.delete(id);
    },
  };

  const pushFix = (fix: Partial<GeoFix>) => {
    const full: GeoFix = {
      lat: fix.lat ?? 0,
      lon: fix.lon ?? 0,
      accuracyM: fix.accuracyM ?? 5,
      timestamp: fix.timestamp ?? Date.now(),
    };
    for (const w of watchers.values()) w.onFix(full);
  };

  const pushError = (msg: string) => {
    for (const w of watchers.values()) w.onError(new Error(msg));
  };

  return { adapter, pushFix, pushError };
}
