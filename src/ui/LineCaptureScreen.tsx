import { useState, type ChangeEvent } from 'react';
import { labels } from './labels';
import type { Vertex, Line } from '../domain/types';
import { sampleVertex } from '../domain/gps-sampling';
import { createLine, type LineCreateInput, updateLine } from '../domain/line-service';
import { captureAnchorPhoto } from '../domain/anchor-photo';
import { useLastUsed } from './util/useLastUsed';

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

interface StepperProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}

function Stepper({ label, value, onChange, min, max, step = 1 }: StepperProps) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="stepper">
        <button
          type="button"
          className="stepper__btn"
          onClick={() => onChange(Math.max(min, parseFloat((value - step).toFixed(4))))}
          disabled={value <= min}
        >−</button>
        <input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <button
          type="button"
          className="stepper__btn"
          onClick={() => onChange(Math.min(max, parseFloat((value + step).toFixed(4))))}
          disabled={value >= max}
        >+</button>
      </div>
    </div>
  );
}

export function LineCaptureScreen({ surveyId, onSaved, onCancel }: Props) {
  const [lastParams, setLastParams] = useLastUsed<Params>('lineParams', DEFAULT_PARAMS);

  const [stage, setStage] = useState<Stage>('params');
  const [params, setParams] = useState<Params>({ ...DEFAULT_PARAMS, ...lastParams });
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
      setLastParams(params);
      setStage('p1');
    };

    return (
      <form
        onSubmit={(e) => { e.preventDefault(); onContinue(); }}
        className="form-page"
        style={{ padding: 'var(--space-4)' }}
      >
        <h2>{l.step1Title}</h2>
        {error && <div role="alert" className="alert alert--error">{error}</div>}

        <Stepper
          label={ll.fields.pointCount}
          value={params.pointCount}
          onChange={(v) => setP('pointCount', v)}
          min={5}
          max={999}
        />

        <Stepper
          label={ll.fields.pointSpacingM}
          value={params.pointSpacingM}
          onChange={(v) => setP('pointSpacingM', v)}
          min={0.5}
          max={50}
          step={0.5}
        />

        <Stepper
          label={ll.fields.electrodeSpacingM}
          value={params.electrodeSpacingM}
          onChange={(v) => setP('electrodeSpacingM', v)}
          min={1}
          max={100}
          step={0.5}
        />

        <div className="field">
          <span className="field__label">{ll.fields.mode}</span>
          <div className="tap-group">
            {(Object.keys(ll.modeOptions) as (keyof typeof ll.modeOptions)[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`tap-btn${params.mode === k ? ' tap-btn--active' : ''}`}
                onClick={() => setP('mode', k)}
              >
                {ll.modeOptions[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">{ll.fields.dipoleOrientation}</span>
          <div className="tap-group">
            {(Object.keys(ll.dipoleOptions) as (keyof typeof ll.dipoleOptions)[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`tap-btn${params.dipoleOrientation === k ? ' tap-btn--active' : ''}`}
                onClick={() => setP('dipoleOrientation', k)}
              >
                {ll.dipoleOptions[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="btn-row">
          <button type="button" className="btn-primary" onClick={onContinue}>{labels.common.continue}</button>
          <button type="button" className="btn-secondary" onClick={onCancel}>{labels.common.cancel}</button>
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
      <section style={{ padding: 'var(--space-4)', maxWidth: 480 }}>
        <h2>{stepTitle}</h2>
        {error && <div role="alert" className="alert alert--error">{error}</div>}

        {!currentVertex && (
          <button type="button" className="btn-primary btn-full" onClick={() => startSampling(atPointIndex)} disabled={sampling}>
            {l.gpsStart}
          </button>
        )}

        {sampling && samplingProgress && (
          <div className="gps-progress">
            <div className="gps-ring" />
            <p style={{ textAlign: 'center' }}>
              <strong>{samplingProgress.n}</strong> {l.gpsSampleCount}<br />
              <span style={{ color: 'var(--text-muted)' }}>
                {l.gpsAccuracy} {samplingProgress.acc.toFixed(1)} {l.gpsMeters}
              </span>
            </p>
            <small className="alert alert--info">{l.keepScreenOn}</small>
          </div>
        )}

        {currentVertex && (
          <>
            <div className="coord-display">
              <div className="coord-display__row">
                <span className="coord-display__label">Lat</span>
                <span className="coord-display__value">{currentVertex.lat.toFixed(6)}</span>
              </div>
              <div className="coord-display__row">
                <span className="coord-display__label">Lon</span>
                <span className="coord-display__value">{currentVertex.lon.toFixed(6)}</span>
              </div>
              <div className="coord-display__row">
                <span className="coord-display__label">Точност</span>
                <span
                  className="coord-display__value"
                  style={{ color: currentVertex.hAccM > 15 ? 'var(--color-warn)' : 'var(--color-success)' }}
                >
                  ±{currentVertex.hAccM.toFixed(1)} м
                </span>
              </div>
            </div>

            {currentVertex.hAccM > 15 && (
              <div role="alert" className="alert alert--warn">{l.gpsWarnAccuracy}</div>
            )}

            <div className="btn-row">
              <button
                type="button"
                className="btn-primary"
                onClick={() => setStage(stage === 'p1' ? 'anchor' : 'save')}
              >
                {labels.common.continue}
              </button>
              <button
                type="button"
                className="btn-secondary"
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
      <section style={{ padding: 'var(--space-4)', maxWidth: 480 }}>
        <h2>{l.step3Title}</h2>
        {error && <div role="alert" className="alert alert--error">{error}</div>}
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>{l.guideBearing}</p>
        <label className="field">
          <span className="field__label">{l.anchorTake}</span>
          <input type="file" accept="image/*" capture="environment" onChange={onFile} />
        </label>
        {pendingAnchor && (
          <p style={{ color: 'var(--color-success)', marginBottom: 'var(--space-3)' }}>✓ {pendingAnchor.name}</p>
        )}
        <div className="btn-row">
          <button
            type="button"
            className="btn-primary"
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
      <section style={{ padding: 'var(--space-4)', maxWidth: 480 }}>
        <h2>{l.step5Title}</h2>
        {error && <div role="alert" className="alert alert--error">{error}</div>}
        <button type="button" className="btn-primary btn-full" onClick={onSave} disabled={busy}>
          {busy ? l.saving : l.save}
        </button>
      </section>
    );
  }

  return null;
}
