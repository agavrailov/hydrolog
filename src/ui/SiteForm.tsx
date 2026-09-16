import { useState, useEffect, useRef, FormEvent } from 'react';
import { labels } from './labels';
import type { Site } from '../domain/types';
import type { SiteRow } from '../cache/db';
import { createSite, updateSite, type SiteCreateInput, type SiteUpdateInput } from '../domain/site-service';
import { useGeoLocation } from './util/useGeoLocation';
import { reverseGeocode } from './util/reverseGeocode';
import { BG_REGIONS } from './BG_REGIONS';
import { useSites } from '../cache/hooks';

const NAME_BASE = 1150;
const NAME_PREFIX = 'Обект';

function nextSiteName(sites: SiteRow[]): string {
  let max = NAME_BASE - 1;
  for (const s of sites) {
    const m = s.json.name.match(new RegExp(`^${NAME_PREFIX}(\\d+)$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${NAME_PREFIX}${max + 1}`;
}

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
  region: 'Софийска',
  centroidLat: '',
  centroidLon: '',
  accessNotes: '',
  landUse: '',
  tags: '',
  status: 'planned',
};

export function SiteForm(props: Props) {
  const allSites = useSites();
  const nameAutoSet = useRef(false);

  const initial = props.mode === 'edit' ? initialFromRow(props.siteRow) : EMPTY;
  const [state, setState] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geoUpdated, setGeoUpdated] = useState(false);
  const geo = useGeoLocation();

  useEffect(() => {
    if (props.mode !== 'create') return;
    if (nameAutoSet.current) return;
    if (allSites === undefined) return;
    nameAutoSet.current = true;
    setState((s) => s.name === '' ? { ...s, name: nextSiteName(allSites) } : s);
  }, [allSites, props.mode]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const onGpsFill = () => {
    setGeoUpdated(false);
    geo.grab(async (r) => {
      set('centroidLat', r.lat.toFixed(6));
      set('centroidLon', r.lon.toFixed(6));
      setGeocoding(true);
      try {
        const addr = await reverseGeocode(r.lat, r.lon);
        if (addr) {
          set('settlement', addr.settlement);
          set('municipality', addr.municipality);
          if (addr.region && BG_REGIONS.includes(addr.region)) set('region', addr.region);
          set('ekatte', addr.ekatte ?? '');
        }
        setGeoUpdated(true);
        setTimeout(() => setGeoUpdated(false), 3000);
      } finally {
        setGeocoding(false);
      }
    });
  };

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
    <form onSubmit={onSubmit} className="form-page">
      <button type="button" className="btn-ghost" onClick={props.onCancel} style={{ alignSelf: 'flex-start' }}>{labels.common.back}</button>
      <h2>{props.mode === 'create' ? l.createTitle : l.editTitle}</h2>

      {error && <div role="alert" className="alert alert--error">{error}</div>}

      {props.mode === 'edit'
        ? <h3 style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>{state.name}</h3>
        : (
          <label className="field">
            <span className="field__label field__label--required">{l.fields.name}</span>
            <input value={state.name} onChange={(e) => set('name', e.target.value)} required />
          </label>
        )
      }

      {/* GPS prefill */}
      <div className="field">
        <span className="field__label">{l.fields.centroidLat} / {l.fields.centroidLon}</span>
        <button
          type="button"
          className="gps-btn"
          onClick={onGpsFill}
          disabled={geo.loading || geocoding}
        >
          {geo.loading ? '⟳ GPS…' : geocoding ? '⟳ Геокодиране…' : '📍 Взими текущото местоположение'}
        </button>
        {geo.error && <div className="alert alert--error">{geo.error}</div>}
        {geoUpdated && <div className="alert alert--info" style={{ padding: 'var(--space-2) var(--space-3)', fontSize: '0.85rem' }}>✓ Координатите и адресът са обновени</div>}
      </div>

      <div className="form-row-2">
        <label className="field">
          <span className="field__label field__label--required">{l.fields.centroidLat}</span>
          <input
            className="input--mono"
            type="number"
            step="any"
            value={state.centroidLat}
            onChange={(e) => set('centroidLat', e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field__label field__label--required">{l.fields.centroidLon}</span>
          <input
            className="input--mono"
            type="number"
            step="any"
            value={state.centroidLon}
            onChange={(e) => set('centroidLon', e.target.value)}
            required
          />
        </label>
      </div>

      <label className="field">
        <span className="field__label field__label--required">{l.fields.settlement}</span>
        <input value={state.settlement} onChange={(e) => set('settlement', e.target.value)} required />
      </label>

      <label className="field">
        <span className="field__label field__label--required">{l.fields.municipality}</span>
        <input value={state.municipality} onChange={(e) => set('municipality', e.target.value)} required />
      </label>

      <div className="field">
        <label htmlFor="site-region" className="field__label field__label--required">{l.fields.region}</label>
        <select
          id="site-region"
          value={state.region}
          onChange={(e) => set('region', e.target.value)}
          required
        >
          <option value="">— изберете —</option>
          {BG_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div className="field">
        <span className="field__label">{l.fields.status}</span>
        <div className="tap-group">
          {(Object.keys(l.statusOptions) as (keyof typeof l.statusOptions)[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`tap-btn${state.status === k ? ' tap-btn--active' : ''}`}
              onClick={() => set('status', k)}
            >
              {l.statusOptions[k]}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="field__label">{l.fields.ekatte}</span>
        <input value={state.ekatte} onChange={(e) => set('ekatte', e.target.value)} />
      </label>

      <div className="field">
        <span className="field__label">{l.fields.cadastralParcelId}</span>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input
            style={{ flex: 1 }}
            value={state.cadastralParcelId}
            onChange={(e) => set('cadastralParcelId', e.target.value)}
            placeholder="68134.4081.123"
          />
          {(state.centroidLat && state.centroidLon) && (<>
            <a
              href={`https://www.google.com/maps?q=${state.centroidLat},${state.centroidLon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost"
              style={{ whiteSpace: 'nowrap', fontSize: '0.85rem', padding: '0 var(--space-3)', height: 'var(--input-h)', display: 'flex', alignItems: 'center' }}
              title="Виж местоположението в Google Maps"
            >
              🗺
            </a>
            <a
              href="https://kais.cadastre.bg/bg/Map/Index"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost"
              style={{ whiteSpace: 'nowrap', fontSize: '0.85rem', padding: '0 var(--space-3)', height: 'var(--input-h)', display: 'flex', alignItems: 'center' }}
              title="Отвори КАИС"
            >
              КАИС
            </a>
          </>)}
        </div>
        {(state.centroidLat && state.centroidLon) && (
          <small style={{ color: 'var(--text-muted)', marginTop: 4 }}>
            🗺 ориентирай се в Google Maps → отвори КАИС → намери парцела → копирай идентификатора
          </small>
        )}
      </div>

      <label className="field">
        <span className="field__label">{l.fields.accessNotes}</span>
        <textarea value={state.accessNotes} onChange={(e) => set('accessNotes', e.target.value)} />
      </label>

      <label className="field">
        <span className="field__label">{l.fields.landUse}</span>
        <input value={state.landUse} onChange={(e) => set('landUse', e.target.value)} />
      </label>

      <label className="field">
        <span className="field__label">{l.fields.tags}</span>
        <input value={state.tags} onChange={(e) => set('tags', e.target.value)} />
      </label>

      <div className="btn-row">
        <button type="submit" className="btn-primary" disabled={saving}>{labels.common.save}</button>
        <button type="button" className="btn-secondary" onClick={props.onCancel} disabled={saving}>{labels.common.cancel}</button>
      </div>
    </form>
  );
}
