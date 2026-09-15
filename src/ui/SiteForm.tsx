import { useState, FormEvent } from 'react';
import { labels } from './labels';
import type { Site } from '../domain/types';
import type { SiteRow } from '../cache/db';
import { createSite, updateSite, type SiteCreateInput, type SiteUpdateInput } from '../domain/site-service';

type CreateProps = {
  mode: 'create';
  onSaved: (site: Site) => void;
  onCancel: () => void;
};

type EditProps = {
  mode: 'edit';
  siteRow: SiteRow;
  onSaved: (site: Site) => void;
  onCancel: () => void;
};

type Props = CreateProps | EditProps;

interface FormState {
  name: string;
  settlement: string;
  ekatte: string;
  cadastralParcelId: string;
  municipality: string;
  region: string;
  centroidLat: string;
  centroidLon: string;
  accessNotes: string;
  landUse: string;
  tags: string;
  status: Site['status'];
}

function initialFromRow(row: SiteRow): FormState {
  const s = row.json;
  return {
    name: s.name,
    settlement: s.settlement,
    ekatte: s.ekatte ?? '',
    cadastralParcelId: s.cadastralParcelId ?? '',
    municipality: s.municipality,
    region: s.region,
    centroidLat: String(s.centroid.lat),
    centroidLon: String(s.centroid.lon),
    accessNotes: s.accessNotes,
    landUse: s.landUse,
    tags: (s.tags ?? []).join(', '),
    status: s.status,
  };
}

const EMPTY: FormState = {
  name: '',
  settlement: '',
  ekatte: '',
  cadastralParcelId: '',
  municipality: '',
  region: '',
  centroidLat: '',
  centroidLon: '',
  accessNotes: '',
  landUse: '',
  tags: '',
  status: 'surveyed',
};

export function SiteForm(props: Props) {
  const initial = props.mode === 'edit' ? initialFromRow(props.siteRow) : EMPTY;
  const [state, setState] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const centroid = {
        lat: Number(state.centroidLat),
        lon: Number(state.centroidLon),
      };
      const tags = state.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (props.mode === 'create') {
        const base: SiteCreateInput = {
          name: state.name,
          settlement: state.settlement,
          ekatte: state.ekatte || undefined,
          cadastralParcelId: state.cadastralParcelId || undefined,
          municipality: state.municipality,
          region: state.region,
          centroid,
          accessNotes: state.accessNotes,
          landUse: state.landUse,
          tags,
          status: state.status,
        };
        const site = await createSite(base);
        props.onSaved(site);
      } else {
        const patch: SiteUpdateInput = {
          settlement: state.settlement,
          ekatte: state.ekatte || undefined,
          cadastralParcelId: state.cadastralParcelId || undefined,
          municipality: state.municipality,
          region: state.region,
          centroid,
          accessNotes: state.accessNotes,
          landUse: state.landUse,
          tags,
          status: state.status,
        };
        const site = await updateSite(props.siteRow.id, patch);
        props.onSaved(site);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const l = labels.site;
  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
      <h2>{props.mode === 'create' ? l.createTitle : l.editTitle}</h2>

      {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}

      {props.mode === 'edit'
        ? <h3 style={{ marginTop: 0 }}>{state.name}</h3>
        : (
          <label>{l.fields.name}
            <input value={state.name} onChange={(e) => set('name', e.target.value)} required />
          </label>
        )
      }
      <label>{l.fields.settlement}
        <input value={state.settlement} onChange={(e) => set('settlement', e.target.value)} required />
      </label>
      <label>{l.fields.ekatte}
        <input value={state.ekatte} onChange={(e) => set('ekatte', e.target.value)} />
      </label>
      <label>{l.fields.cadastralParcelId}
        <input value={state.cadastralParcelId} onChange={(e) => set('cadastralParcelId', e.target.value)} />
      </label>
      <label>{l.fields.municipality}
        <input value={state.municipality} onChange={(e) => set('municipality', e.target.value)} required />
      </label>
      <label>{l.fields.region}
        <input value={state.region} onChange={(e) => set('region', e.target.value)} required />
      </label>
      <label>{l.fields.centroidLat}
        <input type="number" step="any" value={state.centroidLat}
               onChange={(e) => set('centroidLat', e.target.value)} required />
      </label>
      <label>{l.fields.centroidLon}
        <input type="number" step="any" value={state.centroidLon}
               onChange={(e) => set('centroidLon', e.target.value)} required />
      </label>
      <label>{l.fields.accessNotes}
        <textarea value={state.accessNotes} onChange={(e) => set('accessNotes', e.target.value)} />
      </label>
      <label>{l.fields.landUse}
        <input value={state.landUse} onChange={(e) => set('landUse', e.target.value)} />
      </label>
      <label>{l.fields.tags}
        <input value={state.tags} onChange={(e) => set('tags', e.target.value)} />
      </label>
      <label>{l.fields.status}
        <select value={state.status} onChange={(e) => set('status', e.target.value as Site['status'])}>
          {(Object.keys(l.statusOptions) as (keyof typeof l.statusOptions)[]).map((k) => (
            <option key={k} value={k}>{l.statusOptions[k]}</option>
          ))}
        </select>
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving}>{labels.common.save}</button>
        <button type="button" onClick={props.onCancel} disabled={saving}>{labels.common.cancel}</button>
      </div>
    </form>
  );
}
