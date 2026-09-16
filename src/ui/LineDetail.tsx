import { useEffect, useState } from 'react';
import { labels } from './labels';
import { useLine, useLineMedia, useInterpretation } from '../cache/hooks';
import { ProfileCanvas } from './ProfileCanvas';
import { AnomalyForm } from './AnomalyForm';
import { addAnomaly, removeAnomaly } from '../domain/interpretation-service';
import type { AnomalyInput } from '../domain/interpretation-service';
import { getPath } from '../storage/paths';
import { readBlob } from '../storage/atomic';
import { getRoot } from '../storage/fs';

interface Props {
  lineId: string;
  onBack: () => void;
}

function useBmpUrls(storagePaths: string[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  const key = storagePaths.join('|');

  useEffect(() => {
    if (storagePaths.length === 0) {
      setUrls([]);
      return;
    }
    let revoked = false;
    const created: string[] = [];

    (async () => {
      try {
        const root = getRoot();
        const loaded: string[] = [];
        for (const sp of storagePaths) {
          const parts = sp.split('/');
          const fileName = parts.pop()!;
          const dir = await getPath(root, parts);
          if (!dir) continue;
          const blob = await readBlob(dir, fileName);
          const url = URL.createObjectURL(blob);
          created.push(url);
          loaded.push(url);
        }
        if (!revoked) setUrls(loaded);
      } catch {
        // root not set or file missing — show nothing silently
      }
    })();

    return () => {
      revoked = true;
      for (const u of created) URL.revokeObjectURL(u);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return urls;
}

export function LineDetail({ lineId, onBack }: Props) {
  const row = useLine(lineId);
  const media = useLineMedia(lineId);
  const interpretation = useInterpretation(lineId);

  const deviceScreenPaths = (media ?? [])
    .filter((m) => m.json.kind === 'device-screen')
    .map((m) => m.storagePath);

  const bmpUrls = useBmpUrls(deviceScreenPaths);
  const anomalies = interpretation?.json.anomalies ?? [];

  async function handleAddAnomaly(input: AnomalyInput) {
    await addAnomaly(lineId, input);
  }

  async function handleRemoveAnomaly(anomalyId: string) {
    await removeAnomaly(lineId, anomalyId);
  }

  if (!row) return <p className="loading-text">{labels.common.loading}</p>;
  const l = row.json;
  const ll = labels.line;
  const pl = labels.profile;
  const al = labels.anomaly;

  return (
    <section>
      <button className="btn-ghost" onClick={onBack}>{labels.common.back}</button>

      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', margin: 'var(--space-3) 0 var(--space-4)' }}>
        <h1 style={{ margin: 0 }}>{l.label}</h1>
        <code>{ll.title}</code>
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

      {bmpUrls.length > 0 && (
        <>
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>{pl.deviceScreens}</h2>
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 'var(--space-3)' }}>
            {bmpUrls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`${pl.deviceScreens} ${i + 1}`}
                style={{ maxHeight: 300, objectFit: 'contain', borderRadius: 'var(--r-sm)' }}
              />
            ))}
          </div>
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
