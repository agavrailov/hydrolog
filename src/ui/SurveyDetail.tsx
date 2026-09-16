import { useState } from 'react';
import { labels } from './labels';
import { useSurvey, useLines } from '../cache/hooks';
import { finalizeSurvey } from '../domain/survey-service';
import { ProfileCanvas } from './ProfileCanvas';

interface Props {
  surveyId: string;
  onEdit: () => void;
  onImport: () => void;
  onNewLine: () => void;
  onOpenLine: (lineId: string) => void;
}

export function SurveyDetail({ surveyId, onEdit, onImport, onNewLine, onOpenLine }: Props) {
  const row = useSurvey(surveyId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!row) return <p className="loading-text">{labels.common.loading}</p>;
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
    <section>
      <header style={{ margin: 'var(--space-3) 0 var(--space-4)' }}>
        <h1 style={{ marginBottom: 4 }}>{l.title}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <code>{row.folderName}</code>
          {s.finalizedAt && (
            <span className="chip chip--complete">{l.finalized}</span>
          )}
        </div>
      </header>

      {error && <div role="alert" className="alert alert--error">{error}</div>}

      <dl className="detail-grid">
        <dt>{l.fields.startedAt}</dt><dd>{new Date(s.startedAt).toLocaleString('bg-BG')}</dd>
        {s.endedAt && (<><dt>{l.fields.endedAt}</dt><dd>{new Date(s.endedAt).toLocaleString('bg-BG')}</dd></>)}
        <dt>{l.fields.timezone}</dt><dd>{s.timezone}</dd>
        <dt>{l.fields.operator}</dt><dd>{s.operator}</dd>
        <dt>{l.fields.deviceModel}</dt><dd style={{ fontFamily: 'var(--font-mono)' }}>{s.deviceModel}</dd>
        {s.deviceSerial && (<><dt>{l.fields.deviceSerial}</dt><dd style={{ fontFamily: 'var(--font-mono)' }}>{s.deviceSerial}</dd></>)}
        {s.firmware && (<><dt>{l.fields.firmware}</dt><dd>{s.firmware}</dd></>)}
        {s.weather && (<><dt>{l.fields.weather}</dt><dd>{s.weather}</dd></>)}
        {s.airTempC != null && (<><dt>{l.fields.airTempC}</dt><dd>{s.airTempC}</dd></>)}
        <dt>{l.fields.precipLast48h}</dt><dd>{l.precipOptions[s.precipLast48h]}</dd>
        {s.terrain && (<><dt>{l.fields.terrain}</dt><dd>{s.terrain}</dd></>)}
        {s.purpose && (<><dt>{l.fields.purpose}</dt><dd>{s.purpose}</dd></>)}
        {s.summary && (<><dt>{l.fields.summary}</dt><dd>{s.summary}</dd></>)}
        <dt>{l.fields.qualityFlag}</dt><dd>{l.qualityOptions[s.qualityFlag]}</dd>
        {s.noiseSources && s.noiseSources.length > 0 && (
          <>
            <dt>{l.fields.noiseSources}</dt>
            <dd>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginTop: 2 }}>
                {s.noiseSources.map((id) => (
                  <span key={id} className="chip chip--draft">
                    {l.noiseSourceOptions[id as keyof typeof l.noiseSourceOptions] ?? id}
                  </span>
                ))}
              </div>
            </dd>
          </>
        )}
      </dl>

      <div className="btn-row">
        <button className="btn-secondary" onClick={onEdit} disabled={busy}>{labels.common.edit}</button>
        {!s.finalizedAt && (
          <button className="btn-secondary" onClick={onFinalize} disabled={busy}>{l.finalize}</button>
        )}
        <button className="btn-primary" onClick={onImport} disabled={busy}>{labels.import.surveyDetailButton}</button>
      </div>

      <div className="section-heading">
        <h2 style={{ margin: 0 }}>{l.linesHeading}</h2>
        <button
          className="btn-primary"
          onClick={onNewLine}
          disabled={busy}
          style={{ fontSize: '0.9rem', padding: '0 var(--space-4)', height: 40, minHeight: 'unset' }}
        >
          + {labels.line.new}
        </button>
      </div>
      <LinesList surveyId={surveyId} onOpen={onOpenLine} />
    </section>
  );
}

function LinesList({ surveyId, onOpen }: { surveyId: string; onOpen: (id: string) => void }) {
  const lines = useLines(surveyId);
  if (lines === undefined) return <p className="loading-text">{labels.common.loading}</p>;
  if (lines.length === 0) return <p className="loading-text">{labels.line.noLines}</p>;
  return (
    <>
      {lines.map((r) => (
        <button
          key={r.id}
          className={`card card--interactive line-card line-card--${r.json.status}`}
          onClick={() => onOpen(r.id)}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: r.json.points.length > 0 ? 8 : 6 }}>
            <span className="line-card__label">{r.json.label}</span>
            <span className={`chip chip--${r.json.status}`}>{labels.line.statusOptions[r.json.status as keyof typeof labels.line.statusOptions] ?? r.json.status}</span>
          </div>
          {r.json.points.length > 0 && (
            <div style={{ marginBottom: 8, borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
              <ProfileCanvas
                points={r.json.points}
                channelSet={r.json.channelSetSnapshot}
                cellW={3}
                cellH={5}
                thumbnail
              />
            </div>
          )}
          <div className="line-card__meta">
            <span>{r.json.pointCount} {labels.line.points}</span>
            <span className="line-card__dot">·</span>
            <span>{r.json.pointSpacingM} m</span>
          </div>
        </button>
      ))}
    </>
  );
}
