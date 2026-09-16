import { useState } from 'react';
import { labels } from './labels';
import { useLine, useLineMedia, useInterpretation } from '../cache/hooks';
import { ProfileCanvas } from './ProfileCanvas';
import { AnomalyForm } from './AnomalyForm';
import { addAnomaly, removeAnomaly } from '../domain/interpretation-service';
import type { AnomalyInput } from '../domain/interpretation-service';
import { updateLine, softDeleteLine } from '../domain/line-service';
import type { Line } from '../domain/types';
import { useBmpUrls } from './util/useBmpUrls';

interface Props {
  lineId: string;
  onDeleted?: () => void;
}


const LINE_STATUSES: Line['status'][] = ['draft', 'data-pending', 'complete', 'archived'];

export function LineDetail({ lineId, onDeleted }: Props) {
  const row = useLine(lineId);
  const media = useLineMedia(lineId);
  const interpretation = useInterpretation(lineId);
  const [statusBusy, setStatusBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const deviceScreenMedia = (media ?? []).filter((m) => m.json.kind === 'device-screen');
  const deviceScreenPaths = deviceScreenMedia.map((m) => m.storagePath);
  const bmpUrls = useBmpUrls(deviceScreenPaths);
  const deviceScreenItems = bmpUrls.map((url, i) => ({
    url,
    name: deviceScreenMedia[i]?.storagePath.split('/').pop() ?? `снимка ${i + 1}`,
  }));
  const anomalies = interpretation?.json.anomalies ?? [];

  async function handleAddAnomaly(input: AnomalyInput) {
    await addAnomaly(lineId, input);
  }

  async function handleRemoveAnomaly(anomalyId: string) {
    await removeAnomaly(lineId, anomalyId);
  }

  async function handleSetStatus(status: Line['status']) {
    if (statusBusy) return;
    setStatusBusy(true);
    try { await updateLine(lineId, { status }); }
    finally { setStatusBusy(false); }
  }

  async function handleDelete() {
    setDeleteBusy(true);
    try {
      await softDeleteLine(lineId);
      onDeleted?.();
    } finally {
      setDeleteBusy(false);
    }
  }

  if (!row) return <p className="loading-text">{labels.common.loading}</p>;
  const l = row.json;
  const ll = labels.line;
  const pl = labels.profile;
  const al = labels.anomaly;

  return (
    <section>
      <header style={{ margin: 'var(--space-3) 0 var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          <h1 style={{ margin: 0 }}>{l.label}</h1>
          <span className={`chip chip--${l.status}`}>{ll.statusOptions[l.status]}</span>
          <div style={{ marginLeft: 'auto' }}>
            {!confirmDelete ? (
              <button className="btn-danger" onClick={() => setConfirmDelete(true)} style={{ fontSize: '0.8rem', padding: '4px 12px' }}>
                {labels.common.delete}
              </button>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-danger)' }}>{labels.line.confirmDelete}</span>
                <button className="btn-danger" onClick={handleDelete} disabled={deleteBusy} style={{ fontSize: '0.8rem', padding: '4px 12px' }}>
                  {labels.common.delete}
                </button>
                <button className="btn-ghost" onClick={() => setConfirmDelete(false)} style={{ fontSize: '0.8rem', padding: '4px 12px' }}>
                  {labels.common.cancel}
                </button>
              </span>
            )}
          </div>
        </div>
        <div className="tap-group">
          {LINE_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={`tap-btn${l.status === s ? ' tap-btn--active' : ''}`}
              onClick={() => handleSetStatus(s)}
              disabled={statusBusy || l.status === s}
            >
              {ll.statusOptions[s]}
            </button>
          ))}
        </div>
      </header>

      <dl className="detail-grid">
        <dt>{ll.fields.pointCount}</dt><dd>{l.pointCount}</dd>
        <dt>{ll.fields.pointSpacingM}</dt><dd style={{ fontFamily: 'var(--font-mono)' }}>{l.pointSpacingM} m</dd>
        <dt>{ll.fields.electrodeSpacingM}</dt><dd style={{ fontFamily: 'var(--font-mono)' }}>{l.electrodeSpacingM} m</dd>
        <dt>{ll.fields.mode}</dt><dd>{ll.modeOptions[l.mode]}</dd>
        <dt>{ll.fields.dipoleOrientation}</dt><dd>{ll.dipoleOptions[l.dipoleOrientation]}</dd>
        {l.lengthM != null && (<><dt>{ll.lengthM}</dt><dd style={{ fontFamily: 'var(--font-mono)' }}>{l.lengthM.toFixed(2)} m</dd></>)}
      </dl>

      {l.vertices.length > 0 && (
        <>
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>{ll.verticesFixed}</h2>
          </div>
          <ul style={{ padding: 0, listStyle: 'none' }}>
            {l.vertices.map((v, i) => (
              <li key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-muted)', padding: '4px 0' }}>
                точка {v.atPointIndex} · {v.lat.toFixed(6)}, {v.lon.toFixed(6)} · hAccM {v.hAccM.toFixed(1)} m · {v.sampleCount} проби
              </li>
            ))}
          </ul>
        </>
      )}

      {deviceScreenItems.length > 0 && (
        <>
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>{pl.deviceScreens}</h2>
          </div>
          {deviceScreenItems.map((item) => (
            <div key={item.url} style={{ marginBottom: 'var(--space-3)' }}>
              <img
                src={item.url}
                alt={item.name}
                style={{ display: 'block', width: '100%', borderRadius: 'var(--r-sm)' }}
              />
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, textAlign: 'center' }}>
                {item.name}
              </div>
            </div>
          ))}
        </>
      )}

      <div className="section-heading">
        <h2 style={{ margin: 0 }}>{pl.heading}</h2>
      </div>

      {l.points.length === 0 ? (
        <p className="loading-text">{pl.noData}</p>
      ) : (
        <>
          <div className="canvas-wrapper">
            <ProfileCanvas points={l.points} channelSet={l.channelSetSnapshot} anomalies={anomalies} />
          </div>

          <div className="section-heading">
            <h2 style={{ margin: 0 }}>{al.heading}</h2>
          </div>

          {anomalies.length === 0 ? (
            <p className="loading-text">{al.noAnomalies}</p>
          ) : (
            <ul style={{ padding: 0, listStyle: 'none' }}>
              {anomalies.map((a) => (
                <li key={a.id} className="anomaly-item">
                  <div>
                    <div className="anomaly-item__type">{a.type}</div>
                    <div className="anomaly-item__meta">
                      т.{a.fromPoint}–{a.toPoint} · к.{a.fromChannel}–{a.toChannel} · {a.confidence}★
                      {a.note && ` — ${a.note}`}
                    </div>
                  </div>
                  <button
                    className="btn-danger"
                    onClick={() => handleRemoveAnomaly(a.id)}
                    style={{ minHeight: 36, padding: '0 12px', fontSize: '0.8rem' }}
                  >
                    {al.deleteButton}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <AnomalyForm
            pointCount={l.pointCount}
            channelCount={l.channelSetSnapshot.channels.length}
            onSubmit={handleAddAnomaly}
          />
        </>
      )}
    </section>
  );
}
