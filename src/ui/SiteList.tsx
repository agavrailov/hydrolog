import { useState } from 'react';
import { labels } from './labels';
import { useSites } from '../cache/hooks';

interface Props {
  onOpen: (siteId: string) => void;
}

export function SiteList({ onOpen }: Props) {
  const [query, setQuery] = useState('');
  const sites = useSites({ query });

  if (sites === undefined) return <p>{labels.common.loading}</p>;

  return (
    <div>
      <input
        type="search"
        placeholder={labels.common.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%', padding: 8, marginBottom: 8 }}
      />
      {sites.length === 0 ? (
        <p>{labels.home.noSites}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {sites.map((s) => (
            <li key={s.id} style={{ padding: '4px 0' }}>
              <button
                onClick={() => onOpen(s.id)}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  color: 'steelblue', cursor: 'pointer', textDecoration: 'underline',
                  fontSize: 'inherit', fontFamily: 'inherit',
                }}
              >
                <strong>{s.code}</strong> — {s.json.name} ({s.json.settlement})
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
