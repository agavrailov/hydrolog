import { useState, useEffect, FormEvent } from 'react';
import { labels } from './labels';
import type { Survey } from '../domain/types';
import type { SurveyRow } from '../cache/db';
import { createSurvey, updateSurvey, type SurveyCreateInput } from '../domain/survey-service';
import { useLastUsed } from './util/useLastUsed';

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

interface FormState {
  startedAt: string;
  endedAt: string;
  timezone: string;
  operator: string;
  deviceModel: string;
  deviceSerial: string;
  firmware: string;
  weather: string;
  airTempC: string;
  precipLast48h: Survey['precipLast48h'];
  terrain: string;
  purpose: string;
  summary: string;
  qualityFlag: Survey['qualityFlag'];
}

function detectTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'Europe/Sofia'; }
}

function toLocalInput(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

function initialFromRow(row: SurveyRow): FormState {
  const s = row.json;
  return {
    startedAt: toLocalInput(new Date(s.startedAt)),
    endedAt: s.endedAt ? toLocalInput(new Date(s.endedAt)) : '',
    timezone: s.timezone,
    operator: s.operator,
    deviceModel: s.deviceModel,
    deviceSerial: s.deviceSerial,
    firmware: s.firmware ?? '',
    weather: s.weather ?? '',
    airTempC: s.airTempC != null ? String(s.airTempC) : '',
    precipLast48h: s.precipLast48h,
    terrain: s.terrain ?? '',
    purpose: s.purpose ?? '',
    summary: s.summary ?? '',
    qualityFlag: s.qualityFlag,
  };
}

const EMPTY: FormState = {
  startedAt: toLocalInput(new Date()),
  endedAt: '',
  timezone: detectTimezone(),
  operator: '',
  deviceModel: 'GT-150',
  deviceSerial: '',
  firmware: '',
  weather: '',
  airTempC: '',
  precipLast48h: 'none',
  terrain: '',
  purpose: '',
  summary: '',
  qualityFlag: 'good',
};

const DEVICE_MODELS = ['GT-150', 'PQWT-TC150', 'PQWT-TC300', 'PQWT-TC500'];

export function SurveyForm(props: Props) {
  const initial = props.mode === 'edit' ? initialFromRow(props.surveyRow) : EMPTY;
  const [state, setState] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editReason, setEditReason] = useState('');

  const [lastOperator, setLastOperator] = useLastUsed('operator', '');
  const [lastDeviceModel, setLastDeviceModel] = useLastUsed('deviceModel', 'GT-150');
  const [lastDeviceSerial, setLastDeviceSerial] = useLastUsed('deviceSerial', '');

  useEffect(() => {
    if (props.mode === 'create') {
      setState((s) => ({
        ...s,
        operator: lastOperator || s.operator,
        deviceModel: lastDeviceModel || s.deviceModel,
        deviceSerial: lastDeviceSerial || s.deviceSerial,
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFinalized = props.mode === 'edit' && !!props.surveyRow.json.finalizedAt;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

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
        startedAt: new Date(state.startedAt),
        endedAt: state.endedAt ? new Date(state.endedAt) : undefined,
        timezone: state.timezone,
        operator: state.operator,
        deviceModel: state.deviceModel,
        deviceSerial: state.deviceSerial,
        firmware: state.firmware || undefined,
        weather: state.weather || undefined,
        airTempC: state.airTempC ? Number(state.airTempC) : undefined,
        precipLast48h: state.precipLast48h,
        terrain: state.terrain || undefined,
        purpose: state.purpose || undefined,
        summary: state.summary || undefined,
        qualityFlag: state.qualityFlag,
      };
      if (props.mode === 'create') {
        const sv = await createSurvey(props.siteId, base);
        setLastOperator(state.operator);
        setLastDeviceModel(state.deviceModel);
        setLastDeviceSerial(state.deviceSerial);
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
      <h2>{props.mode === 'create' ? l.createTitle : l.editTitle}</h2>

      {error && <div role="alert" className="alert alert--error">{error}</div>}

      <label className="field">
        <span className="field__label field__label--required">{l.fields.startedAt}</span>
        <input type="datetime-local" value={state.startedAt}
               onChange={(e) => set('startedAt', e.target.value)} required />
      </label>

      <label className="field">
        <span className="field__label">{l.fields.endedAt}</span>
        <input type="datetime-local" value={state.endedAt}
               onChange={(e) => set('endedAt', e.target.value)} />
      </label>

      <label className="field">
        <span className="field__label field__label--required">{l.fields.timezone}</span>
        <input value={state.timezone} onChange={(e) => set('timezone', e.target.value)} required />
      </label>

      <label className="field">
        <span className="field__label field__label--required">{l.fields.operator}</span>
        <input value={state.operator} onChange={(e) => set('operator', e.target.value)} required />
      </label>

      <div className="field">
        <span className="field__label field__label--required">{l.fields.deviceModel}</span>
        <div className="tap-group" style={{ marginBottom: 'var(--space-2)' }}>
          {DEVICE_MODELS.map((m) => (
            <button
              key={m}
              type="button"
              className={`tap-btn${state.deviceModel === m ? ' tap-btn--active' : ''}`}
              onClick={() => set('deviceModel', m)}
            >
              {m}
            </button>
          ))}
        </div>
        <input
          id="survey-deviceModel"
          value={state.deviceModel}
          onChange={(e) => set('deviceModel', e.target.value)}
          required
          aria-label={l.fields.deviceModel}
        />
      </div>

      <label className="field">
        <span className="field__label field__label--required">{l.fields.deviceSerial}</span>
        <input value={state.deviceSerial} onChange={(e) => set('deviceSerial', e.target.value)} required />
      </label>

      <label className="field">
        <span className="field__label">{l.fields.firmware}</span>
        <input value={state.firmware} onChange={(e) => set('firmware', e.target.value)} />
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

      <label className="field">
        <span className="field__label">{l.fields.weather}</span>
        <input value={state.weather} onChange={(e) => set('weather', e.target.value)} />
      </label>

      <label className="field">
        <span className="field__label">{l.fields.airTempC}</span>
        <input type="number" step="any" value={state.airTempC}
               onChange={(e) => set('airTempC', e.target.value)} />
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
