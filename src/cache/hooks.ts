import { useLiveQuery } from 'dexie-react-hooks';
import { getDb, SiteRow, SurveyRow } from './db';

export interface SiteFilter {
  query?: string;
  tag?: string;
}

function matches(row: SiteRow, filter: SiteFilter): boolean {
  const q = filter.query?.toLowerCase().trim();
  if (q) {
    const hay = [
      row.json.name, row.json.settlement, row.json.municipality,
      ...(row.json.tags ?? []),
    ].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (filter.tag && !(row.json.tags ?? []).includes(filter.tag)) return false;
  return true;
}

export function useSites(filter: SiteFilter = {}): SiteRow[] | undefined {
  return useLiveQuery(async () => {
    const all = await getDb().sites.orderBy('code').toArray();
    const live = all.filter((r) => !r.json.deletedAt);
    return live.filter((r) => matches(r, filter));
  }, [filter.query, filter.tag]);
}

export function useSite(id: string | undefined): SiteRow | undefined {
  return useLiveQuery(async () => {
    if (!id) return undefined;
    return getDb().sites.get(id);
  }, [id]);
}

export function useSurveys(siteId: string | undefined): SurveyRow[] | undefined {
  return useLiveQuery(async () => {
    if (!siteId) return [];
    const site = await getDb().sites.get(siteId);
    if (!site) return [];  // orphan surveys hidden until site is restored
    const rows = await getDb().surveys.where('siteId').equals(siteId).toArray();
    return rows
      .filter((r) => !r.json.deletedAt)
      .sort((a, b) => b.folderName.localeCompare(a.folderName));
  }, [siteId]);
}

export function useSurvey(id: string | undefined): SurveyRow | undefined {
  return useLiveQuery(async () => {
    if (!id) return undefined;
    return getDb().surveys.get(id);
  }, [id]);
}
