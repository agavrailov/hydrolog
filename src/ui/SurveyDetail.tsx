import { useState } from 'react';
import { labels } from './labels';
import { useSurvey, useLines, useLineMedia } from '../cache/hooks';
import { finalizeSurvey } from '../domain/survey-service';
import { useBmpUrls } from './util/useBmpUrls';
import { ImageLightbox } from './ImageLightbox';
import type { LightboxItem } from './ImageLightbox';
import type { LineRow } from '../cache/db';

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

const expandIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9"/>
    <polyline points="9 21 3 21 3 15"/>
    <line x1="21" y1="3" x2="14" y2="10"/>
    <line x1="3" y1="21" x2="10" y2="14"/>
  </svg>
);

function LineCard({ row, onClick }: { row: LineRow; onClick: () => void }) {
  const media = useLineMedia(row.id);
  const screenPaths = (media ?? [])
    .filter((m) => m.json.kind === 'device-screen')
    .map((m) => m.storagePath);
  const bmpUrls = useBmpUrls(screenPaths);
  const [lightboxStart, setLightboxStart] = useState<number | null>(null);

  // Only originals — all except the last (processed) image, or all if only one
  const originalUrls = bmpUrls.length > 1 ? bmpUrls.slice(0, -1) : bmpUrls;
  const lightboxItems: LightboxItem[] = originalUrls.map((url, i) => ({
    kind: 'image',
    url,
    alt: `${row.json.label} – снимка ${i + 1}`,
  }));
  const thumbUrl = originalUrls[0];

  const l = row.json;
  const statusLabel = labels.line.statusOptions[l.status as keyof typeof labels.line.statusOptions] ?? l.status;

  return (
    <>
      {lightboxStart !== null && lightboxItems.length > 0 && (
        <ImageLightbox
          items={lightboxItems}
          startIndex={lightboxStart}
          onClose={() => setLightboxStart(null)}
        />
      )}
      <div
        className={`card card--interactive line-card line-card--${l.status}`}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: thumbUrl ? 10 : 6 }}>
          <span className="line-card__label">{l.label}</span>
          <span className={`chip chip--${l.status}`}>{statusLabel}</span>
        </div>
        {thumbUrl && (
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <img
              src={thumbUrl}
              alt={l.label}
              style={{ display: 'block', width: '100%', borderRadius: 'var(--r-sm)', objectFit: 'cover' }}
            />
            {lightboxItems.length > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxStart(0); }}
                title="Виж на цял екран"
                style={{
                  position: 'absolute', top: 6, right: 6,
                  width: 32, height: 32,
                  background: 'rgba(0,0,0,0.55)', border: 'none',
                  borderRadius: 6, cursor: 'pointer', padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', opacity: 0.85,
                }}
              >
                {expandIcon}
              </button>
            )}
          </div>
        )}
        <div className="line-card__meta">
          <span>{l.pointCount} {labels.line.points}</span>
          <span className="line-card__dot">·</span>
          <span>{l.spacingM} m</span>
        </div>
      </div>
    </>
  );
}

function LinesList({ surveyId, onOpen }: { surveyId: string; onOpen: (id: string) => void }) {
  const lines = useLines(surveyId);
  if (lines === undefined) return <p className="loading-text">{labels.common.loading}</p>;
  if (lines.length === 0) return <p className="loading-text">{labels.line.noLines}</p>;
  return (
    <>
      {lines.map((r) => (
        <LineCard key={r.id} row={r} onClick={() => onOpen(r.id)} />
      ))}
    </>
  );
}
