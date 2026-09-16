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
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
      <h3 style={{ margin: 0 }}>{al.formHeading}</h3>
      <label>
        {fl.fromPoint}
        <input
          aria-label={fl.fromPoint}
          type="number" min={1} max={pointCount} value={fromPoint}
          onChange={(e) => setFromPoint(Number(e.target.value))}
        />
      </label>
      <label>
        {fl.toPoint}
        <input
          aria-label={fl.toPoint}
          type="number" min={1} max={pointCount} value={toPoint}
          onChange={(e) => setToPoint(Number(e.target.value))}
        />
      </label>
      <label>
        {fl.fromChannel}
        <input
          aria-label={fl.fromChannel}
          type="number" min={1} max={channelCount} value={fromChannel}
          onChange={(e) => setFromChannel(Number(e.target.value))}
        />
      </label>
      <label>
        {fl.toChannel}
        <input
          aria-label={fl.toChannel}
          type="number" min={1} max={channelCount} value={toChannel}
          onChange={(e) => setToChannel(Number(e.target.value))}
        />
      </label>
      <label>
        {fl.type}
        <select value={type} onChange={(e) => setType(e.target.value as AnomalyType)}>
          {ANOMALY_TYPES.map((t) => (
            <option key={t} value={t}>{al.typeOptions[t]}</option>
          ))}
        </select>
      </label>
      <label>
        {fl.confidence}
        <select
          value={confidence}
          onChange={(e) => setConfidence(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
        >
          {([1, 2, 3, 4, 5] as const).map((c) => (
            <option key={c} value={c}>{al.confidenceOptions[c]}</option>
          ))}
        </select>
      </label>
      <label>
        {fl.note}
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="submit">{al.addButton}</button>
    </form>
  );
}
