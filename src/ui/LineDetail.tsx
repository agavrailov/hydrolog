import { useState, useMemo } from 'react';
import { labels } from './labels';
import { useLine, useLineMedia, useInterpretation } from '../cache/hooks';
import { AnomalyForm } from './AnomalyForm';
import type { AnomalySelection } from './AnomalyForm';
import { BmpAnnotationLayer } from './BmpAnnotationLayer';
import { addAnomaly, removeAnomaly } from '../domain/interpretation-service';
import type { AnomalyInput } from '../domain/interpretation-service';
import { updateLine, softDeleteLine } from '../domain/line-service';
import type { Line } from '../domain/types';
import { useBmpUrls } from './util/useBmpUrls';
import { LineMap } from './LineMap';
import { ELECTRODE_LAYOUT, activePointFractions } from '../domain/device-config';
import { interpolatePointsAtFractions } from '../domain/enu';
import { ImageLightbox } from './ImageLightbox';
import type { LightboxItem } from './ImageLightbox';

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
  const [selection, setSelection] = useState<AnomalySelection | null>(null);
  const [initialSel, setInitialSel] = useState<Partial<AnomalySelection> | undefined>(undefined);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const activeEnds = useMemo(() => {
    if (!row) return undefined;
    const l = row.json;
    const layout = ELECTRODE_LAYOUT[l.channelSetSnapshot.deviceModel];
    if (!layout || l.vertices.length < 2) return undefined;
    const fractions = activePointFractions(layout);
    const pts = interpolatePointsAtFractions(l.vertices, [fractions[0], fractions[fractions.length - 1]]);
    return { start: pts[0], end: pts[1] };
  }, [row]);

  const deviceScreenMedia = (media ?? []).filter((m) => m.json.kind === 'device-screen');
  const deviceScreenPaths = deviceScreenMedia.map((m) => m.storagePath);
  const bmpUrls = useBmpUrls(deviceScreenPaths);
  const deviceScreenItems = bmpUrls.map((url, i) => ({
    url,
    name: deviceScreenMedia[i]?.storagePath.split('/').pop() ?? `снимка ${i + 1}`,
  }));
  const anomalies = interpretation?.json.anomalies ?? [];

  const hasMap = (row?.json.vertices.length ?? 0) > 0;
  const mapOffset = hasMap ? 1 : 0;

  const galleryItems = useMemo<LightboxItem[]>(() => {
    if (!row) return [];
    const items: LightboxItem[] = [];
    if (row.json.vertices.length > 0) {
      items.push({ kind: 'map', vertices: row.json.vertices });
    }
    for (const item of deviceScreenItems) {
      items.push({ kind: 'image', url: item.url, alt: item.name });
    }
    return items;
  }, [row, deviceScreenItems]);

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

  async function handleCalibrate(cal: Line['bmpCalibration']) {
    await updateLine(lineId, { bmpCalibration: cal });
  }

  if (!row) return <p className="loading-text">{labels.common.loading}</p>;
  const l = row.json;
  const ll = labels.line;
  const al = labels.anomaly;

  const maxDepthM = l.channelSetSnapshot.channels.at(-1)?.pseudoDepthM ?? 0;
  const hasDeviceData = l.points.length > 0;

  return (
    <section>
      {lightboxIndex !== null && galleryItems.length > 0 && (
        <ImageLightbox
          items={galleryItems}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      <header style={{ margin: 'var(--space-3) 0 var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          <h1 style={{ margin: 0 }}>{l.label}</h1>
          <span className={`chip chip--${l.status}`}>{ll.statusOptions[l.status]}</span>
          <div style={{ marginLeft: 'auto' }}>
            {!confirmDelete ? (
              <button className="btn-danger" onClick={() => setConfirmDelete(true)}
                style={{ fontSize: '0.8rem', padding: '4px 12px' }}>
                {labels.common.delete}
              </button>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-danger)' }}>{labels.line.confirmDelete}</span>
                <button className="btn-danger" onClick={handleDelete} disabled={deleteBusy}
                  style={{ fontSize: '0.8rem', padding: '4px 12px' }}>
                  {labels.common.delete}
                </button>
                <button className="btn-ghost" onClick={() => setConfirmDelete(false)}
                  style={{ fontSize: '0.8rem', padding: '4px 12px' }}>
                  {labels.common.cancel}
                </button>
              </span>
            )}
          </div>
        </div>
        <div className="tap-group">
          {LINE_STATUSES.map((s) => (
            <button key={s} type="button"
              className={`tap-btn${l.status === s ? ' tap-btn--active' : ''}`}
              onClick={() => handleSetStatus(s)}
              disabled={statusBusy || l.status === s}>
              {ll.statusOptions[s]}
            </button>
          ))}
        </div>
      </header>

      <dl className="detail-grid">
        <dt>{ll.fields.pointCount}</dt><dd>{l.pointCount}</dd>
        <dt>{ll.fields.spacingM}</dt><dd style={{ fontFamily: 'var(--font-mono)' }}>{l.spacingM} m</dd>
        <dt>{ll.fields.mode}</dt><dd>{ll.modeOptions[l.mode]}</dd>
        {l.lengthM != null && (<><dt>{ll.lengthM}</dt><dd style={{ fontFamily: 'var(--font-mono)' }}>{l.lengthM.toFixed(2)} m</dd></>)}
        {hasDeviceData && maxDepthM > 0 && (
          <><dt>{ll.depthRangeM}</dt><dd style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(maxDepthM)} m</dd></>
        )}
      </dl>

      {l.vertices.length > 0 && (
        <>
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>{ll.verticesFixed}</h2>
          </div>
          <LineMap
            vertices={l.vertices}
            activeStart={activeEnds?.start}
            activeEnd={activeEnds?.end}
            onExpand={() => setLightboxIndex(0)}
          />
          <ul style={{ padding: 0, listStyle: 'none' }}>
            {l.vertices.map((v, i) => (
              <li key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-muted)', padding: '4px 0' }}>
                Електрод {v.electrodeIndex} · {v.lat.toFixed(6)}, {v.lon.toFixed(6)} · hAccM {v.hAccM.toFixed(1)} m · {v.sampleCount} проби
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Device screen images */}
      {deviceScreenItems.length > 0 && (
        <>
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>{labels.profile.deviceScreens}</h2>
          </div>
          <BmpAnnotationLayer
            bmpItems={deviceScreenItems}
            calibration={l.bmpCalibration}
            onCalibrate={handleCalibrate}
            anomalies={anomalies}
            selection={selection}
            pointCount={l.pointCount}
            maxDepthM={maxDepthM || 150}
            onTap={(partial) => setInitialSel(partial)}
            onExpand={(localIndex) => setLightboxIndex(mapOffset + localIndex)}
          />
        </>
      )}

      {/* Anomaly workflow — shown whenever there is device data */}
      {hasDeviceData ? (
        <>
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>{al.heading}</h2>
          </div>

          {anomalies.length > 0 && (
            <ul style={{ padding: 0, listStyle: 'none', marginBottom: 'var(--space-3)' }}>
              {anomalies.map((a) => (
                <li key={a.id} className="anomaly-item">
                  <div>
                    <div className="anomaly-item__type">{a.type}</div>
                    <div className="anomaly-item__meta">
                      т.{a.fromPoint}–{a.toPoint}
                      {(a as any).pseudoDepthFromM != null
                        ? ` · ${Math.round((a as any).pseudoDepthFromM)}–${Math.round((a as any).pseudoDepthToM)} m`
                        : ` · к.${a.fromChannel}–${a.toChannel}`}
                      {' · '}{a.confidence}★
                      {a.note && ` — ${a.note}`}
                    </div>
                  </div>
                  <button className="btn-danger"
                    onClick={() => handleRemoveAnomaly(a.id)}
                    style={{ minHeight: 36, padding: '0 12px', fontSize: '0.8rem' }}>
                    {al.deleteButton}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <AnomalyForm
            pointCount={l.pointCount}
            channelSet={l.channelSetSnapshot}
            onSubmit={handleAddAnomaly}
            onSelectionChange={setSelection}
            initialSelection={initialSel}
          />
        </>
      ) : (
        <>
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>{labels.profile.heading}</h2>
          </div>
          <p className="loading-text">{labels.profile.noData}</p>
        </>
      )}
    </section>
  );
}
