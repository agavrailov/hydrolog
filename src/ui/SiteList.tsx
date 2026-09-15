import { useEffect, useState } from 'react';
import { getDb, SiteRow } from '../cache/db';

export function SiteList() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  useEffect(() => {
    getDb().sites.orderBy('code').toArray().then(setSites);
  }, []);
  return (
    <ul>
      {sites.map((s) => (
        <li key={s.id}>
          <strong>{s.code}</strong> — {s.folderName}
        </li>
      ))}
    </ul>
  );
}
