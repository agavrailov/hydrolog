import { useState, FormEvent } from 'react';
import { labels } from './labels';
import type { Survey } from '../domain/types';
import type { SurveyRow } from '../cache/db';
import { createSurvey, updateSurvey, type SurveyCreateInput } from '../domain/survey-service';

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
  startedAt: string;        // datetime-local value: "YYYY-MM-DDTHH:mm"
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
  timezone: 'Europe/Sofia',
  operator: '',
  deviceModel: 'PQWT-TC300',
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

export function SurveyForm(props: Props) {
  const initial = props.mode === 'edit' ? initialFromRow(props.surveyRow) : EMPTY;
  const [state, setState] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editReason, setEditReason] = useState('');

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
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
      <h2>{props.mode === 'create' ? l.createTitle : l.editTitle}</h2>

      {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}

      <label>{l.fields.startedAt}
        <input type="datetime-local" value={state.startedAt}
               onChange={(e) => set('startedAt', e.target.value)} required />
      </label>
      <label>{l.fields.endedAt}
        <input type="datetime-local" value={state.endedAt}
               onChange={(e) => set('endedAt', e.target.value)} />
      </label>
      <label>{l.fields.timezone}
        <input value={state.timezone} onChange={(e) => set('timezone', e.target.value)} required />
      </label>
      <label>{l.fields.operator}
        <input value={state.operator} onChange={(e) => set('operator', e.target.value)} required />
      </label>
      <label>{l.fields.deviceModel}
        <input value={state.deviceModel} onChange={(e) => set('deviceModel', e.target.value)} required />
      </label>
      <label>{l.fields.deviceSerial}
        <input value={state.deviceSerial} onChange={(e) => set('deviceSerial', e.target.value)} required />
      </label>
      <label>{l.fields.firmware}
        <input value={state.firmware} onChange={(e) => set('firmware', e.target.value)} />
      </label>
      <label>{l.fields.weather}
        <input value={state.weather} onChange={(e) => set('weather', e.target.value)} />
      </label>
      <label>{l.fields.airTempC}
        <input type="number" step="any" value={state.airTempC}
               onChange={(e) => set('airTempC', e.target.value)} />
      </label>
      <label>{l.fields.precipLast48h}
        <select value={state.precipLast48h}
                onChange={(e) => set('precipLast48h', e.target.value as Survey['precipLast48h'])}>
          {(Object.keys(l.precipOptions) as (keyof typeof l.precipOptions)[]).map((k) => (
            <option key={k} value={k}>{l.precipOptions[k]}</option>
          ))}
        </select>
      </label>
      <label>{l.fields.terrain}
        <input value={state.terrain} onChange={(e) => set('terrain', e.target.value)} />
      </label>
      <label>{l.fields.purpose}
        <input value={state.purpose} onChange={(e) => set('purpose', e.target.value)} />
      </label>
      <label>{l.fields.summary}
        <textarea value={state.summary} onChange={(e) => set('summary', e.target.value)} />
      </label>
      <label>{l.fields.qualityFlag}
        <select value={state.qualityFlag}
                onChange={(e) => set('qualityFlag', e.target.value as Survey['qualityFlag'])}>
          {(Object.keys(l.qualityOptions) as (keyof typeof l.qualityOptions)[]).map((k) => (
            <option key={k} value={k}>{l.qualityOptions[k]}</option>
          ))}
        </select>
      </label>

      {isFinalized && (
        <label>{l.editReasonLabel}
          <textarea value={editReason} onChange={(e) => setEditReason(e.target.value)}
                    aria-required="true" />
        </label>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving}>{labels.common.save}</button>
        <button type="button" onClick={props.onCancel} disabled={saving}>{labels.common.cancel}</button>
      </div>
    </form>
  );
}
