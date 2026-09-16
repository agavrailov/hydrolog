import { BG_REGIONS } from '../BG_REGIONS';

export interface AddressResult {
  settlement: string;
  municipality: string;
  region: string;
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

export async function reverseGeocode(lat: number, lon: number): Promise<AddressResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=bg`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'bg' } });
    if (!res.ok) return null;
    const data = await res.json() as { address?: Record<string, string> };
    const addr = data.address ?? {};

    const settlement =
      addr.village ?? addr.town ?? addr.city ?? addr.suburb ?? '';
    const municipality =
      addr.municipality ?? addr.county ?? addr.state_district ?? '';
    const rawRegion = addr.county ?? addr.state ?? '';
    const region = normalizeRegion(rawRegion);

    return { settlement, municipality, region };
  } catch {
    return null;
  }
}
