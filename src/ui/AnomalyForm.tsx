import { useState, useEffect } from 'react';
import type { AnomalyInput } from '../domain/interpretation-service';
import type { AnomalyType, ChannelSetSnapshot } from '../domain/types';
import { labels } from './labels';

export interface AnomalySelection {
  fromPoint: number;
  toPoint: number;
  fromDepthM: number;
  toDepthM: number;
}

interface Props {
  pointCount: number;
  channelSet: ChannelSetSnapshot;
  onSubmit: (input: AnomalyInput) => void;
  onSelectionChange?: (sel: AnomalySelection) => void;
  initialSelection?: Partial<AnomalySelection>;
}

const ANOMALY_TYPES: AnomalyType[] = [
  'fracture-signature', 'conductive-zone', 'contact',
  'clay-lens-signature', 'noise-artefact', 'no-anomaly',
];

function depthToChannel(depthM: number, channels: ChannelSetSnapshot['channels']): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < channels.length; i++) {
    const d = Math.abs((channels[i].pseudoDepthM ?? 0) - depthM);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best + 1;
}

function NumStepper({
  ariaLabel, value, onChange, min, max, step = 1,
}: {
  ariaLabel: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number;
}) {
  return (
    <div className="stepper">
      <button type="button" className="stepper__btn"
        onClick={() => onChange(Math.max(min, parseFloat((value - step).toFixed(2))))}
        disabled={value <= min}>−</button>
      <input
        aria-label={ariaLabel}
        type="number" min={min} max={max} step="any" value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <button type="button" className="stepper__btn"
        onClick={() => onChange(Math.min(max, parseFloat((value + step).toFixed(2))))}
        disabled={value >= max}>+</button>
    </div>
  );
}

export function AnomalyForm({ pointCount, channelSet, onSubmit, onSelectionChange, initialSelection }: Props) {
  const channels = channelSet.channels;
  const maxDepthM = channels.at(-1)?.pseudoDepthM ?? 10;
  const stepM = channels.length > 1
    ? parseFloat(((channels[1].pseudoDepthM ?? 0) - (channels[0].pseudoDepthM ?? 0)).toFixed(2))
    : 1;

  const [fromPoint, setFromPoint] = useState(initialSelection?.fromPoint ?? 1);
  const [toPoint, setToPoint] = useState(initialSelection?.toPoint ?? Math.min(5, pointCount));
  const [fromDepthM, setFromDepthM] = useState(initialSelection?.fromDepthM ?? stepM);
  const [toDepthM, setToDepthM] = useState(initialSelection?.toDepthM ?? Math.min(5 * stepM, maxDepthM));
  const [type, setType] = useState<AnomalyType>('fracture-signature');
  const [confidence, setConfidence] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState(false);

  // Sync location when user taps a new point on the image
  useEffect(() => {
    if (initialSelection?.fromPoint != null) setFromPoint(initialSelection.fromPoint);
    if (initialSelection?.toPoint != null) setToPoint(initialSelection.toPoint);
    if (initialSelection?.fromDepthM != null) {
      setFromDepthM(Math.round(initialSelection.fromDepthM));
      if (initialSelection.toDepthM == null)
        setToDepthM(Math.min(Math.round(maxDepthM), Math.round(initialSelection.fromDepthM) + 2));
    }
    if (initialSelection?.toDepthM != null) setToDepthM(Math.round(initialSelection.toDepthM));
  }, [initialSelection]);

  useEffect(() => {
    onSelectionChange?.({ fromPoint, toPoint, fromDepthM, toDepthM });
  }, [fromPoint, toPoint, fromDepthM, toDepthM]);

  const al = labels.anomaly;
  const fl = al.fields;
  const hasSelection = initialSelection != null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fp = Math.min(fromPoint, toPoint);
    const tp = Math.max(fromPoint, toPoint);
    const fd = Math.min(fromDepthM, toDepthM);
    const td = Math.max(fromDepthM, toDepthM);
    onSubmit({
      fromPoint: fp, toPoint: tp,
      fromChannel: depthToChannel(fd, channels),
      toChannel: depthToChannel(td, channels),
      type, confidence,
      note: note.trim() || undefined,
    });
    setNote('');
    setExpanded(false);
  }

  const pillStyle: React.CSSProperties = {
    background: 'var(--bg-input)',
    border: '1px solid var(--border-input)',
    borderRadius: 'var(--r-sm)',
    padding: '0 10px',
    height: 36,
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    cursor: hasSelection ? 'pointer' : 'default',
    color: hasSelection ? 'var(--text-base)' : 'var(--text-muted)',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
  };

  return (
    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
      {/* Fine-tune steppers — hidden until user taps the location pill */}
      {expanded && (
        <div style={{ marginBottom: 'var(--space-3)', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="form-row-2" style={{ marginBottom: 'var(--space-2)' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <span className="field__label">{fl.fromPoint}</span>
              <NumStepper ariaLabel={fl.fromPoint} value={fromPoint} onChange={setFromPoint} min={1} max={pointCount} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <span className="field__label">{fl.toPoint}</span>
              <NumStepper ariaLabel={fl.toPoint} value={toPoint} onChange={setToPoint} min={1} max={pointCount} />
            </div>
          </div>
          <div className="form-row-2" style={{ marginBottom: 'var(--space-2)' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <span className="field__label">{fl.fromDepth}</span>
              <NumStepper ariaLabel={fl.fromDepth} value={fromDepthM} onChange={setFromDepthM} min={0} max={Math.round(maxDepthM)} step={1} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <span className="field__label">{fl.toDepth}</span>
              <NumStepper ariaLabel={fl.toDepth} value={toDepthM} onChange={setToDepthM} min={0} max={Math.round(maxDepthM)} step={1} />
            </div>
          </div>
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="field__label">{fl.note}</span>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      )}

      {/* Compact row: location · type · confidence · submit */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {/* Location pill — tappable to reveal steppers */}
        <button type="button" style={pillStyle} onClick={() => hasSelection && setExpanded(x => !x)}>
          {hasSelection
            ? `т.${fromPoint}–${toPoint} · ${Math.round(fromDepthM)}–${Math.round(toDepthM)}м ${expanded ? '▲' : '✎'}`
            : '↑ тапни снимката'}
        </button>

        {/* Type */}
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AnomalyType)}
          style={{
            flex: 1,
            minWidth: 0,
            height: 36,
            background: 'var(--bg-input)',
            border: '1px solid var(--border-input)',
            borderRadius: 'var(--r-sm)',
            color: 'var(--text-base)',
            fontFamily: 'var(--font-body)',
            fontSize: '0.8rem',
            padding: '0 6px',
          }}
        >
          {ANOMALY_TYPES.map((t) => (
            <option key={t} value={t}>{al.typeOptions[t]}</option>
          ))}
        </select>

        {/* Confidence stars */}
        <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
          {([1, 2, 3, 4, 5] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setConfidence(c)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '1.1rem',
                padding: '0 1px',
                lineHeight: 1,
                color: c <= confidence ? '#f59e0b' : 'var(--border-input)',
              }}
            >★</button>
          ))}
        </div>

        {/* Submit */}
        <button
          type="submit"
          className="btn-primary"
          style={{ height: 36, padding: '0 14px', fontSize: '0.85rem', flexShrink: 0, minHeight: 'unset' }}
          disabled={!hasSelection}
        >
          +
        </button>
      </div>
    </form>
  );
}
