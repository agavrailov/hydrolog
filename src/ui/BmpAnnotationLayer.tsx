import { useState, useRef } from 'react';
import type { Anomaly, BmpCalibration } from '../domain/types';
import type { AnomalySelection } from './AnomalyForm';
import { labels } from './labels';

interface Props {
  bmpItems: { url: string; name: string }[];
  calibration: BmpCalibration | undefined;
  onCalibrate: (cal: BmpCalibration) => void;
  anomalies: Anomaly[];
  selection: AnomalySelection | null;
  pointCount: number;
  maxDepthM: number;
  onTap?: (sel: Partial<AnomalySelection>) => void;
}

interface Rect { left: number; top: number; width: number; height: number }

function toRect(
  cal: BmpCalibration,
  fromPoint: number, toPoint: number,
  fromDepthM: number, toDepthM: number,
  pointCount: number, maxDepthM: number,
): Rect {
  const { dataX1, dataY1, dataX2, dataY2 } = cal;
  const pFrom = (fromPoint - 1) / Math.max(1, pointCount - 1);
  const pTo   = (toPoint   - 1) / Math.max(1, pointCount - 1);
  const dFrom = fromDepthM / maxDepthM;
  const dTo   = toDepthM   / maxDepthM;
  const left  = (dataX1 + pFrom * (dataX2 - dataX1)) * 100;
  const right = (dataX1 + pTo   * (dataX2 - dataX1)) * 100;
  const top   = (dataY1 + dFrom * (dataY2 - dataY1)) * 100;
  const bot   = (dataY1 + dTo   * (dataY2 - dataY1)) * 100;
  return { left, top, width: right - left, height: bot - top };
}

type CalStep = 'idle' | 'corner1' | 'corner2';

export function BmpAnnotationLayer({
  bmpItems, calibration, onCalibrate,
  anomalies, selection, pointCount, maxDepthM, onTap,
}: Props) {
  const [calStep, setCalStep] = useState<CalStep>('idle');
  const [corner1, setCorner1] = useState<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const al = labels.anomaly;

  if (bmpItems.length === 0) return null;

  // We annotate on the last (processed) image
  const primaryItem = bmpItems[bmpItems.length - 1];
  const otherItems  = bmpItems.slice(0, -1);

  function handleImgClick(e: React.MouseEvent<HTMLDivElement>) {
    const div = e.currentTarget;
    const rect = div.getBoundingClientRect();
    const xFrac = (e.clientX - rect.left) / rect.width;
    const yFrac = (e.clientY - rect.top)  / rect.height;

    if (calStep === 'corner1') {
      setCorner1({ x: xFrac, y: yFrac });
      setCalStep('corner2');
      return;
    }
    if (calStep === 'corner2' && corner1) {
      onCalibrate({
        dataX1: Math.min(corner1.x, xFrac),
        dataY1: Math.min(corner1.y, yFrac),
        dataX2: Math.max(corner1.x, xFrac),
        dataY2: Math.max(corner1.y, yFrac),
      });
      setCalStep('idle');
      setCorner1(null);
      return;
    }

    // Normal tap → approximate selection from calibration
    if (calibration && onTap) {
      const { dataX1, dataY1, dataX2, dataY2 } = calibration;
      const px = (xFrac - dataX1) / (dataX2 - dataX1);
      const py = (yFrac - dataY1) / (dataY2 - dataY1);
      const point = Math.max(1, Math.min(pointCount, Math.round(1 + px * (pointCount - 1))));
      const depthM = Math.max(0, Math.min(maxDepthM, py * maxDepthM));
      onTap({ fromPoint: Math.max(1, point - 1), toPoint: Math.min(pointCount, point + 1), fromDepthM: depthM });
    }
  }

  const calActive = calStep !== 'idle';

  return (
    <div>
      {/* Secondary images (raw) shown without overlay */}
      {otherItems.map((item) => (
        <div key={item.url} style={{ marginBottom: 'var(--space-3)' }}>
          <img src={item.url} alt={item.name}
            style={{ display: 'block', width: '100%', borderRadius: 'var(--r-sm)' }} />
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, textAlign: 'center' }}>
            {item.name}
          </div>
        </div>
      ))}

      {/* Primary (processed) image with overlay */}
      <div style={{ marginBottom: 'var(--space-2)' }}>
        <div
          ref={imgRef as any}
          onClick={handleImgClick}
          style={{
            position: 'relative',
            cursor: calActive ? 'crosshair' : calibration ? 'pointer' : 'default',
            borderRadius: 'var(--r-sm)',
            overflow: 'hidden',
            lineHeight: 0,
          }}
        >
          <img
            src={primaryItem.url}
            alt={primaryItem.name}
            style={{ display: 'block', width: '100%' }}
          />

          {/* Calibration corner indicator */}
          {calStep === 'corner2' && corner1 && (
            <div style={{
              position: 'absolute',
              left: `${corner1.x * 100}%`, top: `${corner1.y * 100}%`,
              width: 10, height: 10,
              background: 'var(--color-primary)',
              borderRadius: '50%',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }} />
          )}

          {/* Existing anomaly overlays */}
          {calibration && anomalies.map((a) => {
            const fromD = (a as any).pseudoDepthFromM ?? 0;
            const toD   = (a as any).pseudoDepthToM   ?? maxDepthM;
            const r = toRect(calibration, a.fromPoint, a.toPoint, fromD, toD, pointCount, maxDepthM);
            return (
              <div key={a.id} style={{
                position: 'absolute',
                left: `${r.left}%`, top: `${r.top}%`,
                width: `${r.width}%`, height: `${r.height}%`,
                border: '2px solid rgba(251,146,60,0.9)',
                background: 'rgba(251,146,60,0.15)',
                pointerEvents: 'none',
                boxSizing: 'border-box',
              }}>
                <span style={{
                  position: 'absolute', top: 2, left: 4,
                  fontSize: '0.65rem', color: '#fb923c',
                  fontFamily: 'var(--font-mono)', lineHeight: 1,
                }}>
                  {a.confidence}★
                </span>
              </div>
            );
          })}

          {/* Live selection overlay */}
          {calibration && selection && (() => {
            const r = toRect(calibration, selection.fromPoint, selection.toPoint,
              selection.fromDepthM, selection.toDepthM, pointCount, maxDepthM);
            return (
              <div style={{
                position: 'absolute',
                left: `${r.left}%`, top: `${r.top}%`,
                width: `${r.width}%`, height: `${r.height}%`,
                border: '2px dashed rgba(248,113,113,0.95)',
                background: 'rgba(248,113,113,0.12)',
                pointerEvents: 'none',
                boxSizing: 'border-box',
              }} />
            );
          })()}
        </div>

        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, textAlign: 'center' }}>
          {primaryItem.name}
        </div>
      </div>

      {/* Calibration controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
        {calStep === 'idle' && !calibration && (
          <button className="btn-secondary" style={{ fontSize: '0.8rem' }}
            onClick={() => setCalStep('corner1')}>
            {al.calibrate}
          </button>
        )}
        {calStep === 'idle' && calibration && (
          <>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-success)' }}>✓ {al.calibrateDone}</span>
            <button className="btn-ghost" style={{ fontSize: '0.75rem' }}
              onClick={() => setCalStep('corner1')}>
              {al.calibrateReset}
            </button>
          </>
        )}
        {calStep === 'corner1' && (
          <span style={{ fontSize: '0.8rem', color: 'var(--color-primary)' }}>{al.calibrateStep1}</span>
        )}
        {calStep === 'corner2' && (
          <span style={{ fontSize: '0.8rem', color: 'var(--color-primary)' }}>{al.calibrateStep2}</span>
        )}
      </div>
    </div>
  );
}
