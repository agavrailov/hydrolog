import { useState, type ChangeEvent } from 'react';
import { labels } from './labels';
import type { Vertex, Line } from '../domain/types';
import { sampleVertex } from '../domain/gps-sampling';
import { createLine, type LineCreateInput, updateLine } from '../domain/line-service';
import { captureAnchorPhoto } from '../domain/anchor-photo';

type Stage = 'params' | 'p1' | 'anchor' | 'pn' | 'save';

interface Params {
  pointCount: number;
  pointSpacingM: number;
  electrodeSpacingM: number;
  mode: Line['mode'];
  dipoleOrientation: Line['dipoleOrientation'];
}

const DEFAULT_PARAMS: Params = {
  pointCount: 17,
  pointSpacingM: 2,
  electrodeSpacingM: 5,
  mode: 'multi-frequency',
  dipoleOrientation: 'inline',
};

interface Props {
  surveyId: string;
  onSaved: (lineId: string) => void;
  onCancel: () => void;
}

export function LineCaptureScreen({ surveyId, onSaved, onCancel }: Props) {
  const [stage, setStage] = useState<Stage>('params');
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [error, setError] = useState<string | null>(null);
  const [v1, setV1] = useState<Vertex | null>(null);
  const [vN, setVN] = useState<Vertex | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<File | null>(null);
  const [sampling, setSampling] = useState(false);
  const [samplingProgress, setSamplingProgress] = useState<{ n: number; acc: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const l = labels.capture;
  const ll = labels.line;

  const setP = <K extends keyof Params>(k: K, v: Params[K]) =>
    setParams((p) => ({ ...p, [k]: v }));

  // ─── Stage helper: sample a vertex ────────────────
  const startSampling = async (atPointIndex: number) => {
    setError(null);
    setSampling(true);
    setSamplingProgress({ n: 0, acc: 0 });
    try {
      const result = await sampleVertex(atPointIndex, {
        targetSamples: 5,
        discardFirst: 3,
        timeoutMs: 60_000,
        onProgress: (n, acc) => setSamplingProgress({ n, acc }),
      });
      if (atPointIndex === 1) setV1(result.vertex);
      else setVN(result.vertex);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSampling(false);
    }
  };

  // ─── Stage 1: params ───────────────────────────────
  if (stage === 'params') {
    const onContinue = () => {
      setError(null);
      if (!(params.electrodeSpacingM > params.pointSpacingM)) {
        setError(l.spacingSwapError);
        return;
      }
      setStage('p1');
    };
    return (
      <form onSubmit={(e) => { e.preventDefault(); onContinue(); }} style={{ padding: 16, display: 'grid', gap: 8, maxWidth: 480 }}>
        <h2>{l.step1Title}</h2>
        {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}
        <label>
          {ll.fields.pointCount}
          <input
            type="number"
            min={5}
            max={999}
            value={params.pointCount}
            onChange={(e) => setP('pointCount', Number(e.target.value))}
          />
        </label>
        <label>
          {ll.fields.pointSpacingM}
          <input
            type="number"
            step="0.1"
            value={params.pointSpacingM}
            onChange={(e) => setP('pointSpacingM', Number(e.target.value))}
          />
        </label>
        <label>
          {ll.fields.electrodeSpacingM}
          <input
            type="number"
            step="0.1"
            value={params.electrodeSpacingM}
            onChange={(e) => setP('electrodeSpacingM', Number(e.target.value))}
          />
        </label>
        <label>
          {ll.fields.mode}
          <select value={params.mode} onChange={(e) => setP('mode', e.target.value as Params['mode'])}>
            {(Object.keys(ll.modeOptions) as (keyof typeof ll.modeOptions)[]).map((k) => (
              <option key={k} value={k}>{ll.modeOptions[k]}</option>
            ))}
          </select>
        </label>
        <label>
          {ll.fields.dipoleOrientation}
          <select
            value={params.dipoleOrientation}
            onChange={(e) => setP('dipoleOrientation', e.target.value as Params['dipoleOrientation'])}
          >
            {(Object.keys(ll.dipoleOptions) as (keyof typeof ll.dipoleOptions)[]).map((k) => (
              <option key={k} value={k}>{ll.dipoleOptions[k]}</option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onContinue}>{labels.common.continue}</button>
          <button type="button" onClick={onCancel}>{labels.common.cancel}</button>
        </div>
      </form>
    );
  }

  // ─── Stage 2 & 4: GPS point 1 or N ────────────────
  if (stage === 'p1' || stage === 'pn') {
    const atPointIndex = stage === 'p1' ? 1 : params.pointCount;
    const currentVertex = stage === 'p1' ? v1 : vN;
    const stepTitle = stage === 'p1' ? l.step2Title : l.step4Title;
    return (
      <section style={{ padding: 16, display: 'grid', gap: 8, maxWidth: 480 }}>
        <h2>{stepTitle}</h2>
        {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}
        {!currentVertex && (
          <button type="button" onClick={() => startSampling(atPointIndex)} disabled={sampling}>
            {l.gpsStart}
          </button>
        )}
        {sampling && samplingProgress && (
          <p>
            {l.gpsSampling} {samplingProgress.n} {l.gpsSampleCount} · {l.gpsAccuracy}{' '}
            {samplingProgress.acc.toFixed(1)} {l.gpsMeters}
            <br />
            <small>{l.keepScreenOn}</small>
          </p>
        )}
        {currentVertex && (
          <>
            <p>
              Lat {currentVertex.lat.toFixed(6)} · Lon {currentVertex.lon.toFixed(6)}
              <br />
              hAccM {currentVertex.hAccM.toFixed(1)} {l.gpsMeters} · {currentVertex.sampleCount}{' '}
              {l.gpsSampleCount}
            </p>
            {currentVertex.hAccM > 15 && (
              <div role="alert" style={{ color: 'orange' }}>{l.gpsWarnAccuracy}</div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setStage(stage === 'p1' ? 'anchor' : 'save')}
              >
                {labels.common.continue}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (stage === 'p1') setV1(null);
                  else setVN(null);
                }}
              >
                {l.gpsStop}
              </button>
            </div>
          </>
        )}
      </section>
    );
  }

  // ─── Stage 3: anchor photo ─────────────────────────
  if (stage === 'anchor') {
    const onFile = (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !v1) return;
      setError(null);
      setPendingAnchor(file);
    };
    return (
      <section style={{ padding: 16, display: 'grid', gap: 8, maxWidth: 480 }}>
        <h2>{l.step3Title}</h2>
        {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}
        <p>{l.guideBearing}</p>
        <label>
          {l.anchorTake}
          <input type="file" accept="image/*" capture="environment" onChange={onFile} />
        </label>
        {pendingAnchor && <p>✓ {pendingAnchor.name}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setStage('pn')}
            disabled={!pendingAnchor || busy}
          >
            {labels.common.continue}
          </button>
        </div>
      </section>
    );
  }

  // ─── Stage 5: save ─────────────────────────────────
  if (stage === 'save') {
    const onSave = async () => {
      if (!v1 || !vN || !pendingAnchor) {
        setError(l.anchorMissing);
        return;
      }
      setError(null);
      setBusy(true);
      try {
        const line = await createLine(surveyId, {
          pointCount: params.pointCount,
          pointSpacingM: params.pointSpacingM,
          electrodeSpacingM: params.electrodeSpacingM,
          mode: params.mode,
          dipoleOrientation: params.dipoleOrientation,
          vertices: [v1, vN],
        } satisfies LineCreateInput);
        const media = await captureAnchorPhoto({
          file: pendingAnchor,
          lineId: line.id,
          capturedAt: new Date(),
          lat: v1.lat,
          lon: v1.lon,
        });
        await updateLine(line.id, { point1AnchorMediaId: media.id });
        onSaved(line.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    };
    return (
      <section style={{ padding: 16, display: 'grid', gap: 8, maxWidth: 480 }}>
        <h2>{l.step5Title}</h2>
        {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}
        <button type="button" onClick={onSave} disabled={busy}>
          {busy ? l.saving : l.save}
        </button>
      </section>
    );
  }

  return null;
}
