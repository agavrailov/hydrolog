import { useState } from 'react';
import { labels } from './labels';
import { useSurvey, useLines } from '../cache/hooks';
import { finalizeSurvey } from '../domain/survey-service';

interface Props {
  surveyId: string;
  onEdit: () => void;
  onBack: () => void;
  onNewLine: () => void;
}

export function SurveyDetail({ surveyId, onEdit, onBack, onNewLine }: Props) {
  const row = useSurvey(surveyId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!row) return <p>{labels.common.loading}</p>;
  const s = row.json;
  const l = labels.survey;

  const onFinalize = async () => {
    setError(null);
    setBusy(true);
    try {
      await finalizeSurvey(surveyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ padding: 16, maxWidth: 720 }}>
      <button onClick={onBack}>{labels.common.back}</button>

      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{l.title}</h1>
        <code>{row.folderName}</code>
      </header>

      {s.finalizedAt && (
        <p>{l.finalized}: {new Date(s.finalizedAt).toLocaleString('bg-BG')}</p>
      )}

      {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}

      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px' }}>
        <dt>{l.fields.startedAt}</dt><dd>{new Date(s.startedAt).toLocaleString('bg-BG')}</dd>
        {s.endedAt && (<><dt>{l.fields.endedAt}</dt><dd>{new Date(s.endedAt).toLocaleString('bg-BG')}</dd></>)}
        <dt>{l.fields.timezone}</dt><dd>{s.timezone}</dd>
        <dt>{l.fields.operator}</dt><dd>{s.operator}</dd>
        <dt>{l.fields.deviceModel}</dt><dd>{s.deviceModel}</dd>
        <dt>{l.fields.deviceSerial}</dt><dd>{s.deviceSerial}</dd>
        {s.firmware && (<><dt>{l.fields.firmware}</dt><dd>{s.firmware}</dd></>)}
        {s.weather && (<><dt>{l.fields.weather}</dt><dd>{s.weather}</dd></>)}
        {s.airTempC != null && (<><dt>{l.fields.airTempC}</dt><dd>{s.airTempC}</dd></>)}
        <dt>{l.fields.precipLast48h}</dt><dd>{l.precipOptions[s.precipLast48h]}</dd>
        {s.terrain && (<><dt>{l.fields.terrain}</dt><dd>{s.terrain}</dd></>)}
        {s.purpose && (<><dt>{l.fields.purpose}</dt><dd>{s.purpose}</dd></>)}
        {s.summary && (<><dt>{l.fields.summary}</dt><dd>{s.summary}</dd></>)}
        <dt>{l.fields.qualityFlag}</dt><dd>{l.qualityOptions[s.qualityFlag]}</dd>
      </dl>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={onEdit} disabled={busy}>{labels.common.edit}</button>
        {!s.finalizedAt && (
          <button onClick={onFinalize} disabled={busy}>{l.finalize}</button>
        )}
        <button onClick={onNewLine} disabled={busy}>{labels.line.newLine}</button>
      </div>

      <h2>{l.linesHeading}</h2>
      <LinesList surveyId={surveyId} />
    </section>
  );
}

function LinesList({ surveyId }: { surveyId: string }) {
  const lines = useLines(surveyId);
  if (lines === undefined) return <p>{labels.common.loading}</p>;
  if (lines.length === 0) return <p>{labels.line.noLines}</p>;
  return (
    <ul>
      {lines.map((r) => (
        <li key={r.id}>
          <strong>{r.json.label}</strong> · {r.json.pointCount} точки, {r.json.pointSpacingM} m spacing
        </li>
      ))}
    </ul>
  );
}
