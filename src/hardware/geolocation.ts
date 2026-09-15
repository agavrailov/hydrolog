export interface GeoFix {
  lat: number;
  lon: number;
  accuracyM: number;
  timestamp: number;
}

export interface GeolocationAdapter {
  watchPosition(
    onFix: (fix: GeoFix) => void,
    onError: (err: Error) => void,
    opts?: PositionOptions,
  ): number;
  clearWatch(watchId: number): void;
}

export const defaultGeolocationAdapter: GeolocationAdapter = {
  watchPosition(onFix, onError, opts) {
    const geo = (globalThis as unknown as { navigator?: { geolocation?: Geolocation } }).navigator?.geolocation;
    if (!geo) {
      onError(new Error('Geolocation API not available. Use Chrome on a device with GPS.'));
      return -1;
    }
    return geo.watchPosition(
      (pos) => onFix({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
        timestamp: pos.timestamp,
      }),
      (err) => onError(new Error(err.message)),
      opts ?? { enableHighAccuracy: true, maximumAge: 0 },
    );
  },
  clearWatch(id) {
    const geo = (globalThis as unknown as { navigator?: { geolocation?: Geolocation } }).navigator?.geolocation;
    if (geo && id >= 0) geo.clearWatch(id);
  },
};

let adapter: GeolocationAdapter = defaultGeolocationAdapter;

export function setGeolocationAdapter(a: GeolocationAdapter): void { adapter = a; }
export function getGeolocationAdapter(): GeolocationAdapter { return adapter; }
