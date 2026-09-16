import { useState } from 'react';

export interface GeoResult {
  lat: number;
  lon: number;
  accuracyM: number;
}

export function useGeoLocation() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grab = (onResult: (r: GeoResult) => void) => {
    if (!navigator.geolocation) {
      setError('GPS не се поддържа от браузъра.');
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoading(false);
        onResult({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        });
      },
      (err) => {
        setLoading(false);
        setError(`GPS грешка: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return { loading, error, grab };
}
