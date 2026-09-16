import { useState } from 'react';
import type { AnomalyInput } from '../domain/interpretation-service';
import type { AnomalyType } from '../domain/types';
import { labels } from './labels';

interface Props {
  pointCount: number;
  channelCount: number;
  onSubmit: (input: AnomalyInput) => void;
}

const ANOMALY_TYPES: AnomalyType[] = [
  'fracture-signature', 'conductive-zone', 'contact',
  'clay-lens-signature', 'noise-artefact', 'no-anomaly',
];

function NumStepper({
  ariaLabel, value, onChange, min, max,
}: {
  ariaLabel: string; value: number; onChange: (v: number) => void; min: number; max: number;
}) {
  return (
    <div className="stepper">
      <button type="button" className="stepper__btn"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}>−</button>
      <input
        aria-label={ariaLabel}
        type="number" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <button type="button" className="stepper__btn"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}>+</button>
    </div>
  );
}

export function AnomalyForm({ pointCount, channelCount, onSubmit }: Props) {
  const [fromPoint, setFromPoint] = useState(1);
  const [toPoint, setToPoint] = useState(Math.min(5, pointCount));
  const [fromChannel, setFromChannel] = useState(1);
  const [toChannel, setToChannel] = useState(Math.min(5, channelCount));
  const [type, setType] = useState<AnomalyType>('fracture-signature');
  const [confidence, setConfidence] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [note, setNote] = useState('');
  const al = labels.anomaly;
  const fl = al.fields;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      fromPoint: Math.min(fromPoint, toPoint),
      toPoint: Math.max(fromPoint, toPoint),
      fromChannel: Math.min(fromChannel, toChannel),
      toChannel: Math.max(fromChannel, toChannel),
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
          <span className="field__label">{fl.fromChannel}</span>
          <NumStepper ariaLabel={fl.fromChannel} value={fromChannel} onChange={setFromChannel} min={1} max={channelCount} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <span className="field__label">{fl.toChannel}</span>
          <NumStepper ariaLabel={fl.toChannel} value={toChannel} onChange={setToChannel} min={1} max={channelCount} />
        </div>
      </div>

      <div className="field" style={{ marginTop: 'var(--space-3)' }}>
        <span className="field__label">{fl.type}</span>
        <div className="tap-group">
          {ANOMALY_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`tap-btn${type === t ? ' tap-btn--active' : ''}`}
              onClick={() => setType(t)}
            >
              {al.typeOptions[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">{fl.confidence}</span>
        <div className="tap-group">
          {([1, 2, 3, 4, 5] as const).map((c) => (
            <button
              key={c}
              type="button"
              className={`tap-btn${confidence === c ? ' tap-btn--active' : ''}`}
              onClick={() => setConfidence(c)}
              style={{ minWidth: 44 }}
            >
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
