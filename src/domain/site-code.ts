// Cyrillic → Latin transliteration for Bulgarian letters.
// Source: standard Bulgarian ISO 9 / Streamlined System (2006).
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
};

function transliterate(input: string): string {
  const lower = input.toLowerCase();
  let out = '';
  for (const ch of lower) {
    out += TRANSLIT[ch] ?? (/[a-z]/.test(ch) ? ch : '');
  }
  return out;
}

export function regionCode(regionName: string): string {
  const latin = transliterate(regionName);
  const lettersOnly = latin.replace(/[^a-z]/g, '');
  if (lettersOnly.length < 3) return 'XXX';
  return lettersOnly.slice(0, 3).toUpperCase();
}

export function generateSiteCode(regionName: string, existingCodes: string[]): string {
  const rc = regionCode(regionName);
  const prefix = `BG-${rc}-`;
  const pattern = new RegExp(`^${prefix}(\\d{4})$`);
  let max = 0;
  for (const code of existingCodes) {
    const m = pattern.exec(code);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  const next = max + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}
