import { BG_REGIONS } from '../BG_REGIONS';

export interface AddressResult {
  settlement: string;
  municipality: string;
  region: string;
  ekatte?: string;
}

function normalizeRegion(raw: string): string {
  const cleaned = raw
    .replace(/\s*(oblast|обл\.?|област)\s*/gi, '')
    .trim();
  const match = BG_REGIONS.find(
    (r) => r.toLowerCase().startsWith(cleaned.toLowerCase().slice(0, 4)),
  );
  return match ?? cleaned;
}

type NominatimReverse = { address?: Record<string, string>; extratags?: Record<string, string> };
type NominatimSearchResult = { extratags?: Record<string, string> };

async function lookupEkatte(settlementName: string, headers: Record<string, string>): Promise<string | undefined> {
  try {
    // featuretype=settlement restricts to village/town/city nodes — these carry ref:EKATTE in OSM BG data
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(settlementName)}&countrycodes=bg&featuretype=settlement&format=json&extratags=1&limit=5`;
    const res = await fetch(url, { headers });
    if (!res.ok) return undefined;
    const results = await res.json() as NominatimSearchResult[];
    for (const r of results) {
      const et = r.extratags ?? {};
      const code = et['ref:EKATTE'] ?? et['ref:ekatte'];
      if (code) return code;
    }
  } catch { /* ignore */ }
  return undefined;
}

export async function reverseGeocode(lat: number, lon: number): Promise<AddressResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=bg`;
    const headers = { 'Accept-Language': 'bg' };

    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const data = await res.json() as NominatimReverse;
    const addr = data.address ?? {};

    // BG Nominatim: village/town/city/hamlet = settlement; county = oblast; municipality = "Община X"
    const settlement =
      addr.village ?? addr.hamlet ?? addr.town ?? addr.city ?? addr.suburb ?? addr.quarter ?? '';

    const rawMunicipality = addr.municipality ?? addr.state_district ?? '';
    const municipality = rawMunicipality
      .replace(/^Община\s+/i, '')
      .replace(/^Municipality of\s+/i, '')
      .trim();

    // county is the oblast (admin_level 6) in Bulgaria — do NOT use it as municipality fallback
    const rawRegion = addr.county ?? addr.state ?? '';
    const region = normalizeRegion(rawRegion);

    // Search for settlement node separately — ref:EKATTE is on place nodes, not roads/buildings
    const ekatte = settlement ? await lookupEkatte(settlement, headers) : undefined;

    return { settlement, municipality, region, ekatte };
  } catch {
    return null;
  }
}
