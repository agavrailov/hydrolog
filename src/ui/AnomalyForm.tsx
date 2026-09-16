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
        type="number" min={min} max={max} step={step} value={value}
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

  useEffect(() => {
    onSelectionChange?.({ fromPoint, toPoint, fromDepthM, toDepthM });
  }, [fromPoint, toPoint, fromDepthM, toDepthM]);

  const al = labels.anomaly;
  const fl = al.fields;

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
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ marginTop: 'var(--space-4)' }}>
      <h3 style={{ margin: '0 0 var(--space-4)' }}>{al.formHeading}</h3>

      <div className="form-row-2">
        <div className="field" style={{ marginBottom: 0 }}>
          <span className="field__label">{fl.fromPoint}</span>
          <NumStepper ariaLabel={fl.fromPoint} value={fromPoint} onChange={setFromPoint} min={1} max={pointCount} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <span className="field__label">{fl.toPoint}</span>
          <NumStepper ariaLabel={fl.toPoint} value={toPoint} onChange={setToPoint} min={1} max={pointCount} />
        </div>
      </div>

      <div className="form-row-2" style={{ marginTop: 'var(--space-3)' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <span className="field__label">{fl.fromDepth}</span>
          <NumStepper ariaLabel={fl.fromDepth} value={fromDepthM} onChange={setFromDepthM} min={stepM} max={maxDepthM} step={stepM} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <span className="field__label">{fl.toDepth}</span>
          <NumStepper ariaLabel={fl.toDepth} value={toDepthM} onChange={setToDepthM} min={stepM} max={maxDepthM} step={stepM} />
        </div>
      </div>

      <div className="field" style={{ marginTop: 'var(--space-3)' }}>
        <span className="field__label">{fl.type}</span>
        <div className="tap-group">
          {ANOMALY_TYPES.map((t) => (
            <button key={t} type="button"
              className={`tap-btn${type === t ? ' tap-btn--active' : ''}`}
              onClick={() => setType(t)}>
              {al.typeOptions[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">{fl.confidence}</span>
        <div className="tap-group">
          {([1, 2, 3, 4, 5] as const).map((c) => (
            <button key={c} type="button"
              className={`tap-btn${confidence === c ? ' tap-btn--active' : ''}`}
              onClick={() => setConfidence(c)}
              style={{ minWidth: 44 }}>
              {'★'.repeat(c)}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="field__label">{fl.note}</span>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      <button type="submit" className="btn-primary btn-full">{al.addButton}</button>
    </form>
  );
}
