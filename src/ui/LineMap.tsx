import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Vertex } from '../domain/types';

interface LatLon { lat: number; lon: number; }

interface Props {
  vertices: Vertex[];
  activeStart?: LatLon;
  activeEnd?: LatLon;
  heightPx?: number;
  onExpand?: () => void;
}

export function LineMap({ vertices, activeStart, activeEnd, heightPx = 260, onExpand }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || vertices.length === 0) return;

    const map = L.map(el, { zoomControl: true });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const latlngs: L.LatLngTuple[] = vertices.map((v) => [v.lat, v.lon]);

    if (latlngs.length >= 2) {
      L.polyline(latlngs, { color: '#3b82f6', weight: 3, opacity: 0.85 }).addTo(map);
    }

    const startLL: L.LatLngTuple = activeStart ? [activeStart.lat, activeStart.lon] : latlngs[0];
    const endLL: L.LatLngTuple | null = activeEnd
      ? [activeEnd.lat, activeEnd.lon]
      : latlngs.length >= 2 ? latlngs[latlngs.length - 1] : null;

    L.circleMarker(startLL, {
      radius: 6, fillColor: '#22c55e', color: '#fff', weight: 1.5, fillOpacity: 1,
    }).addTo(map);

    if (endLL) {
      L.circleMarker(endLL, {
        radius: 6, fillColor: '#ef4444', color: '#fff', weight: 1.5, fillOpacity: 1,
      }).addTo(map);
    }

    if (latlngs.length === 1) {
      map.setView(latlngs[0], 16);
    } else {
      map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
    }

    return () => { map.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (vertices.length === 0) return null;

  return (
    <div style={{ position: 'relative', marginBottom: 'var(--space-3)', isolation: 'isolate' }}>
      <div
        ref={containerRef}
        style={{
          height: heightPx,
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid var(--border)',
        }}
      />
      {onExpand && (
        <button
          onClick={onExpand}
          title="Виж на цял екран"
          style={{
            position: 'absolute', top: 8, right: 8,
            width: 32, height: 32,
            background: 'rgba(255,255,255,0.85)', border: 'none',
            borderRadius: 6, cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#333', zIndex: 400,
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9"/>
            <polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/>
            <line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        </button>
      )}
    </div>
  );
}
