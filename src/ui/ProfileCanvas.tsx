import { useRef, useEffect } from 'react';
import type { Point, ChannelSetSnapshot } from '../domain/types';
import { labels } from './labels';

export function valueToColor(v: number | null, min: number, max: number): string {
  if (v === null || v === undefined) return '#888';
  const range = max - min;
  const norm = range === 0 ? 0 : (v - min) / range;
  const hue = Math.round((1 - norm) * 240);
  return `hsl(${hue}, 100%, 45%)`;
}

interface ProfileCanvasProps {
  points: Point[];
  channelSet: ChannelSetSnapshot;
  cellW?: number;
  cellH?: number;
}

export function ProfileCanvas({ points, channelSet, cellW = 20, cellH = 8 }: ProfileCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;

    const nPoints = points.length;
    const nChannels = channelSet.channels.length;

    if (nPoints === 0 || nChannels === 0) return;

    let min = Infinity;
    let max = -Infinity;
    for (const pt of points) {
      for (const r of pt.readings) {
        for (const v of r.values) {
          if (v !== null && v !== undefined) {
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
      }
    }
    if (min === Infinity) return;

    canvas.width = nPoints * cellW;
    canvas.height = nChannels * cellH;

    for (let p = 0; p < nPoints; p++) {
      const values = points[p].readings[0]?.values ?? [];
      for (let c = 0; c < nChannels; c++) {
        ctx.fillStyle = valueToColor(values[c] ?? null, min, max);
        ctx.fillRect(p * cellW, c * cellH, cellW, cellH);
      }
    }
  }, [points, channelSet, cellW, cellH]);

  return (
    <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', imageRendering: 'pixelated' }}
        aria-label={labels.profile.canvasAriaLabel}
      />
    </div>
  );
}
