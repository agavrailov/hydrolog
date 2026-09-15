import { labels } from './labels';
import { useLine } from '../cache/hooks';

interface Props {
  lineId: string;
  onBack: () => void;
}

export function LineDetail({ lineId, onBack }: Props) {
  const row = useLine(lineId);
  if (!row) return <p>{labels.common.loading}</p>;
  const l = row.json;
  const ll = labels.line;
  return (
    <section style={{ padding: 16, maxWidth: 720 }}>
      <button onClick={onBack}>{labels.common.back}</button>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{l.label}</h1>
        <code>{ll.title}</code>
      </header>

      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px' }}>
        <dt>{ll.fields.pointCount}</dt><dd>{l.pointCount}</dd>
        <dt>{ll.fields.pointSpacingM}</dt><dd>{l.pointSpacingM}</dd>
        <dt>{ll.fields.electrodeSpacingM}</dt><dd>{l.electrodeSpacingM}</dd>
        <dt>{ll.fields.mode}</dt><dd>{ll.modeOptions[l.mode]}</dd>
        <dt>{ll.fields.dipoleOrientation}</dt><dd>{ll.dipoleOptions[l.dipoleOrientation]}</dd>
        {l.lengthM != null && (<><dt>{ll.lengthM}</dt><dd>{l.lengthM.toFixed(2)} m</dd></>)}
      </dl>

      <h2>{ll.verticesFixed}</h2>
      <ul>
        {l.vertices.map((v, i) => (
          <li key={i}>
            точка {v.atPointIndex} · {v.lat.toFixed(6)}, {v.lon.toFixed(6)} · hAccM {v.hAccM.toFixed(1)} m · {v.sampleCount} проби
          </li>
        ))}
      </ul>
    </section>
  );
}
