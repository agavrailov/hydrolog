import { useState, useRef, useEffect } from 'react';
import { LineMap } from './LineMap';
import type { Vertex } from '../domain/types';

export type LightboxItem =
  | { kind: 'image'; url: string; alt: string }
  | { kind: 'map'; vertices: Vertex[] };

interface Props {
  items: LightboxItem[];
  startIndex?: number;
  onClose: () => void;
}

export function ImageLightbox({ items, startIndex = 0, onClose }: Props) {
  const [index, setIndex] = useState(startIndex);
  const touchStartX = useRef<number | null>(null);
  const item = items[index];
  const isMap = item.kind === 'map';

  const prev = () => setIndex((i) => Math.max(0, i - 1));
  const next = () => setIndex((i) => Math.min(items.length - 1, i + 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleTouchStart(e: React.TouchEvent) {
    if (isMap) return;
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (isMap || touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 55) return;
    if (delta < 0) next(); else prev();
  }

  const navBtn: React.CSSProperties = {
    position: 'absolute',
    background: 'rgba(255,255,255,0.14)',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={isMap ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.94)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: isMap ? 'default' : 'zoom-out',
      }}
    >
      {/* Close */}
      <button
        onClick={onClose}
        style={{ ...navBtn, top: 10, right: 10, width: 36, height: 36, fontSize: '1rem' }}
      >✕</button>

      {/* Prev */}
      {index > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); prev(); }}
          style={{ ...navBtn, left: 8, top: '50%', transform: 'translateY(-50%)', width: 40, height: 56, fontSize: '1.8rem' }}
        >‹</button>
      )}

      {/* Next */}
      {index < items.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); next(); }}
          style={{ ...navBtn, right: 8, top: '50%', transform: 'translateY(-50%)', width: 40, height: 56, fontSize: '1.8rem' }}
        >›</button>
      )}

      {/* Dot indicators */}
      {items.length > 1 && (
        <div style={{
          position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: 6, zIndex: 10,
        }}>
          {items.map((_, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); setIndex(i); }}
              style={{
                width: 8, height: 8, borderRadius: '50%',
                padding: 0, border: 'none',
                background: i === index ? '#fff' : 'rgba(255,255,255,0.35)',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      )}

      {/* Content */}
      {item.kind === 'image' ? (
        <img
          src={item.url}
          alt={item.alt}
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: '100dvw', maxHeight: '100dvh',
            objectFit: 'contain', display: 'block',
            userSelect: 'none', cursor: 'default',
          }}
        />
      ) : (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ width: '100dvw', height: '100dvh' }}
        >
          <LineMap vertices={item.vertices} heightPx={window.innerHeight} />
        </div>
      )}
    </div>
  );
}
