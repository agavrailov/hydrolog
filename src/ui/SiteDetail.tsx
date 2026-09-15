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

  if (!site) return <p>{labels.common.loading}</p>;

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
    <section style={{ padding: 16, maxWidth: 720 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{s.name}</h1>
        <code>{s.code}</code>
      </header>

      {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}

      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px' }}>
        <dt>{l.fields.settlement}</dt><dd>{s.settlement}</dd>
        <dt>{l.fields.municipality}</dt><dd>{s.municipality}</dd>
        <dt>{l.fields.region}</dt><dd>{s.region}</dd>
        <dt>{l.fields.centroidLat}</dt><dd>{s.centroid.lat}</dd>
        <dt>{l.fields.centroidLon}</dt><dd>{s.centroid.lon}</dd>
        {s.ekatte && (<><dt>{l.fields.ekatte}</dt><dd>{s.ekatte}</dd></>)}
        {s.cadastralParcelId && (<><dt>{l.fields.cadastralParcelId}</dt><dd>{s.cadastralParcelId}</dd></>)}
        {s.accessNotes && (<><dt>{l.fields.accessNotes}</dt><dd>{s.accessNotes}</dd></>)}
        {s.landUse && (<><dt>{l.fields.landUse}</dt><dd>{s.landUse}</dd></>)}
        {s.tags?.length ? (<><dt>{l.fields.tags}</dt><dd>{s.tags.join(', ')}</dd></>) : null}
        <dt>{l.fields.status}</dt><dd>{l.statusOptions[s.status]}</dd>
      </dl>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={props.onEdit} disabled={busy}>{labels.common.edit}</button>
        <button onClick={onDelete} disabled={busy}>{labels.common.delete}</button>
        <button onClick={props.onNewSurvey} disabled={busy}>{l.newSurvey}</button>
      </div>

      <h2>{l.surveysHeading}</h2>
      {surveys === undefined ? (
        <p>{labels.common.loading}</p>
      ) : surveys.length === 0 ? (
        <p>{l.noSurveys}</p>
      ) : (
        <ul>
          {surveys.map((sv) => (
            <li key={sv.id}>
              <button
                style={{ background: 'none', border: 'none', padding: 0, color: 'steelblue', cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => props.onOpenSurvey(sv.id)}
              >
                {sv.folderName} · {sv.json.operator}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
