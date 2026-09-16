import { useState, useEffect, FormEvent } from 'react';
import { labels } from './labels';
import type { Survey } from '../domain/types';
import type { SurveyRow } from '../cache/db';
import { createSurvey, updateSurvey, type SurveyCreateInput } from '../domain/survey-service';
import { useLastUsed } from './util/useLastUsed';
import { useSite } from '../cache/hooks';
import { fetchWeather } from './util/fetchWeather';

type CreateProps = {
  mode: 'create';
  siteId: string;
  onSaved: (sv: Survey) => void;
  onCancel: () => void;
};

type EditProps = {
  mode: 'edit';
  surveyRow: SurveyRow;
  onSaved: (sv: Survey) => void;
  onCancel: () => void;
};

type Props = CreateProps | EditProps;

const DEFAULT_OPERATOR = 'Антон Гавраилов';
const DEFAULT_DEVICE   = 'GT-150';
const DEFAULT_TZ       = 'Europe/Sofia';

interface FormState {
  startedAt: string;
  endedAt: string;
  timezone: string;
  operator: string;
  deviceModel: string;
  weather: string;
  airTempC: string;
  precipLast48h: Survey['precipLast48h'];
  terrain: string;
  purpose: string;
  summary: string;
  qualityFlag: Survey['qualityFlag'];
  noiseSources: string[];
}

function toLocalInput(d: Date): string {
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h  = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

function initialFromRow(row: SurveyRow): FormState {
  const s = row.json;
  return {
    startedAt:    toLocalInput(new Date(s.startedAt)),
    endedAt:      s.endedAt ? toLocalInput(new Date(s.endedAt)) : '',
    timezone:     s.timezone,
    operator:     s.operator,
    deviceModel:  s.deviceModel,
    weather:      s.weather ?? '',
    airTempC:     s.airTempC != null ? String(s.airTempC) : '',
    precipLast48h: s.precipLast48h,
    terrain:      s.terrain ?? '',
    purpose:      s.purpose ?? '',
    summary:      s.summary ?? '',
    qualityFlag:  s.qualityFlag,
    noiseSources: s.noiseSources ?? [],
  };
}

const EMPTY: FormState = {
  startedAt:    toLocalInput(new Date()),
  endedAt:      '',
  timezone:     DEFAULT_TZ,
  operator:     DEFAULT_OPERATOR,
  deviceModel:  DEFAULT_DEVICE,
  weather:      '',
  airTempC:     '',
  precipLast48h: 'none',
  terrain:      '',
  purpose:      '',
  summary:      '',
  qualityFlag:  'good',
  noiseSources: [],
};

export function SurveyForm(props: Props) {
  const siteRow = useSite(props.mode === 'create' ? props.siteId : undefined);

  const initial = props.mode === 'edit' ? initialFromRow(props.surveyRow) : EMPTY;
  const [state, setState] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editReason, setEditReason] = useState('');
  const [weatherLoading, setWeatherLoading] = useState(false);

  const [lastOperator, setLastOperator] = useLastUsed('operator', DEFAULT_OPERATOR);
  const [lastDeviceModel, setLastDeviceModel] = useLastUsed('deviceModel', DEFAULT_DEVICE);

  useEffect(() => {
    if (props.mode === 'create') {
      setState((s) => ({
        ...s,
        operator:    lastOperator || DEFAULT_OPERATOR,
        deviceModel: lastDeviceModel || DEFAULT_DEVICE,
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-fetch weather once site centroid is available
  useEffect(() => {
    if (props.mode !== 'create' || !siteRow) return;
    const { lat, lon } = siteRow.json.centroid;
    if (!lat || !lon) return;
    setWeatherLoading(true);
    fetchWeather(lat, lon).then((w) => {
      if (w) {
        setState((s) => ({
          ...s,
          weather:  s.weather  || w.description,
          airTempC: s.airTempC || String(Math.round(w.tempC)),
        }));
      }
    }).finally(() => setWeatherLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteRow?.id]);

  const isFinalized = props.mode === 'edit' && !!props.surveyRow.json.finalizedAt;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const toggleNoise = (id: string) =>
    setState((s) => ({
      ...s,
      noiseSources: s.noiseSources.includes(id)
        ? s.noiseSources.filter((x) => x !== id)
        : [...s.noiseSources, id],
    }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isFinalized && !editReason.trim()) {
      setError(labels.survey.editReasonRequired);
      return;
    }

    setSaving(true);
    try {
      const base: SurveyCreateInput = {
        startedAt:    new Date(state.startedAt),
        endedAt:      state.endedAt ? new Date(state.endedAt) : undefined,
        timezone:     state.timezone,
        operator:     state.operator,
        deviceModel:  state.deviceModel,
        weather:      state.weather || undefined,
        airTempC:     state.airTempC ? Number(state.airTempC) : undefined,
        precipLast48h: state.precipLast48h,
        terrain:      state.terrain || undefined,
        purpose:      state.purpose || undefined,
        summary:      state.summary || undefined,
        qualityFlag:  state.qualityFlag,
        noiseSources: state.noiseSources.length > 0 ? state.noiseSources : undefined,
      };
      if (props.mode === 'create') {
        const sv = await createSurvey(props.siteId, base);
        setLastOperator(state.operator);
        setLastDeviceModel(state.deviceModel);
        props.onSaved(sv);
      } else {
        const sv = await updateSurvey(props.surveyRow.id, base, {
          editReason: isFinalized ? editReason.trim() : undefined,
        });
        props.onSaved(sv);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const l = labels.survey;

  return (
    <form onSubmit={onSubmit} className="form-page">
      <button type="button" className="btn-ghost" onClick={props.onCancel} style={{ alignSelf: 'flex-start' }}>{labels.common.back}</button>
      <h2>{props.mode === 'create' ? l.createTitle : l.editTitle}</h2>

      {error && <div role="alert" className="alert alert--error">{error}</div>}

      <label className="field">
        <span className="field__label field__label--required">{l.fields.startedAt}</span>
        <input type="datetime-local" value={state.startedAt}
               onChange={(e) => set('startedAt', e.target.value)} required />
      </label>

      <div className="field">
        <span className="field__label">{l.fields.precipLast48h}</span>
        <div className="tap-group">
          {(Object.keys(l.precipOptions) as (keyof typeof l.precipOptions)[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`tap-btn${state.precipLast48h === k ? ' tap-btn--active' : ''}`}
              onClick={() => set('precipLast48h', k)}
            >
              {l.precipOptions[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">{l.fields.qualityFlag}</span>
        <div className="tap-group">
          {(Object.keys(l.qualityOptions) as (keyof typeof l.qualityOptions)[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`tap-btn${state.qualityFlag === k ? ' tap-btn--active' : ''}`}
              onClick={() => set('qualityFlag', k)}
            >
              {l.qualityOptions[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">{l.fields.noiseSources}</span>
        <div className="tap-group">
          {(Object.entries(l.noiseSourceOptions)).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`tap-btn${state.noiseSources.includes(id) ? ' tap-btn--active' : ''}`}
              onClick={() => toggleNoise(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="field__label">
          {l.fields.weather}
          {weatherLoading && <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontWeight: 400 }}>⟳</span>}
        </span>
        <input value={state.weather} onChange={(e) => set('weather', e.target.value)}
               placeholder={weatherLoading ? 'зарежда…' : ''} />
      </label>

      <label className="field">
        <span className="field__label">{l.fields.airTempC}</span>
        <input type="number" step="any" value={state.airTempC}
               onChange={(e) => set('airTempC', e.target.value)}
               placeholder={weatherLoading ? 'зарежда…' : ''} />
      </label>

      <label className="field">
        <span className="field__label">{l.fields.terrain}</span>
        <input value={state.terrain} onChange={(e) => set('terrain', e.target.value)} />
      </label>

      <label className="field">
        <span className="field__label">{l.fields.purpose}</span>
        <input value={state.purpose} onChange={(e) => set('purpose', e.target.value)} />
      </label>

      <label className="field">
        <span className="field__label">{l.fields.summary}</span>
        <textarea value={state.summary} onChange={(e) => set('summary', e.target.value)} />
      </label>

      {isFinalized && (
        <label className="field">
          <span className="field__label field__label--required">{l.editReasonLabel}</span>
          <textarea value={editReason} onChange={(e) => setEditReason(e.target.value)}
                    aria-required="true" aria-label={l.editReasonLabel} />
        </label>
      )}

      <div className="btn-row">
        <button type="submit" className="btn-primary" disabled={saving}>{labels.common.save}</button>
        <button type="button" className="btn-secondary" onClick={props.onCancel} disabled={saving}>{labels.common.cancel}</button>
      </div>
    </form>
  );
}
