import { useState } from 'react';
import { labels } from './labels';
import { useSite, useSurveys } from '../cache/hooks';
import { softDeleteSite } from '../domain/site-service';

interface Props {
  siteId: string;
  onEdit: () => void;
  onDeleted: () => void;
  onNewSurvey: () => void;
  onOpenSurvey: (surveyId: string) => void;
}

export function SiteDetail(props: Props) {
  const site = useSite(props.siteId);
  const surveys = useSurveys(props.siteId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!site) return <p className="loading-text">{labels.common.loading}</p>;

  const onDelete = async () => {
    if (!window.confirm(labels.site.deleteConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      await softDeleteSite(props.siteId);
      props.onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const s = site.json;
  const l = labels.site;

  return (
    <section>
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 4 }}>
          <h1 style={{ margin: 0 }}>{s.name}</h1>
          <span className={`chip chip--${s.status}`}>{l.statusOptions[s.status]}</span>
        </div>
        <code>{s.code}</code>
      </header>

      {error && <div role="alert" className="alert alert--error">{error}</div>}

      <dl className="detail-grid">
        <dt>{l.fields.settlement}</dt><dd>{s.settlement}</dd>
        <dt>{l.fields.municipality}</dt><dd>{s.municipality}</dd>
        <dt>{l.fields.region}</dt><dd>{s.region}</dd>
        <dt>{l.fields.centroidLat}</dt><dd style={{ fontFamily: 'var(--font-mono)' }}>{s.centroid.lat}</dd>
        <dt>{l.fields.centroidLon}</dt><dd style={{ fontFamily: 'var(--font-mono)' }}>{s.centroid.lon}</dd>
        {s.ekatte && (<><dt>{l.fields.ekatte}</dt><dd>{s.ekatte}</dd></>)}
        {s.cadastralParcelId && (<><dt>{l.fields.cadastralParcelId}</dt><dd>{s.cadastralParcelId}</dd></>)}
        {s.accessNotes && (<><dt>{l.fields.accessNotes}</dt><dd>{s.accessNotes}</dd></>)}
        {s.landUse && (<><dt>{l.fields.landUse}</dt><dd>{s.landUse}</dd></>)}
        {s.tags?.length ? (<><dt>{l.fields.tags}</dt><dd>{s.tags.join(', ')}</dd></>) : null}
      </dl>

      <div className="btn-row">
        <button className="btn-secondary" onClick={props.onEdit} disabled={busy}>{labels.common.edit}</button>
        <button className="btn-danger" onClick={onDelete} disabled={busy}>{labels.common.delete}</button>
        <button className="btn-primary" onClick={props.onNewSurvey} disabled={busy}>{l.newSurvey}</button>
      </div>

      <div className="section-heading">
        <h2 style={{ margin: 0 }}>{l.surveysHeading}</h2>
      </div>

      {surveys === undefined ? (
        <p className="loading-text">{labels.common.loading}</p>
      ) : surveys.length === 0 ? (
        <p className="loading-text">{l.noSurveys}</p>
      ) : (
        <>
          {surveys.map((sv) => (
            <button
              key={sv.id}
              className="card card--interactive"
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: 'var(--space-4)', minHeight: 'unset' }}
              onClick={() => props.onOpenSurvey(sv.id)}
            >
              <div className="survey-card__date">{sv.folderName}</div>
              <div className="survey-card__meta">{sv.json.operator} · {sv.json.deviceModel}</div>
            </button>
          ))}
        </>
      )}
    </section>
  );
}
