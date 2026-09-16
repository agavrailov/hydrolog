import { useState } from 'react';
import { labels } from './labels';
import { useSites } from '../cache/hooks';

interface Props {
  onOpen: (siteId: string) => void;
  onNew?: () => void;
}

export function SiteList({ onOpen, onNew }: Props) {
  const [query, setQuery] = useState('');
  const sites = useSites({ query });
  const l = labels.site;

  return (
    <div>
      <div className="section-heading">
        <h2 style={{ margin: 0 }}>{labels.home.sitesHeading}</h2>
      </div>

      <div className="search-bar">
        <input
          type="search"
          placeholder={labels.common.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {sites === undefined && <p className="loading-text">{labels.common.loading}</p>}
      {sites?.length === 0 && <p className="loading-text">{labels.home.noSites}</p>}

      {sites?.map((s) => (
        <button
          key={s.id}
          className="card card--interactive"
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: 'var(--space-4)', minHeight: 'unset' }}
          onClick={() => onOpen(s.id)}
        >
          <div className="site-card__row">
            <span className="site-card__code">{s.code}</span>
            <span className={`chip chip--${s.json.status}`}>{l.statusOptions[s.json.status]}</span>
          </div>
          <div className="site-card__name">{s.json.name}</div>
          <div className="site-card__meta">{s.json.settlement} · {s.json.municipality}</div>
        </button>
      ))}

      {onNew && (
        <button className="fab" onClick={onNew} aria-label={labels.home.newSite}>+</button>
      )}
    </div>
  );
}
