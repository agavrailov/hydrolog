import { describe, it, expect } from 'vitest';
import { isoNow, parseIso, formatFolderTimestamp } from './time';

describe('isoNow', () => {
  it('returns ISO 8601 UTC ending in Z', () => {
    const s = isoNow();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
  });
});

describe('parseIso', () => {
  it('round-trips isoNow()', () => {
    const s = isoNow();
    expect(parseIso(s).toISOString()).toBe(new Date(s).toISOString());
  });
});

describe('formatFolderTimestamp', () => {
  it('formats YYYY-MM-DDTHH-mm safe for folder names', () => {
    const d = new Date(Date.UTC(2026, 8, 13, 10, 20, 0));
    expect(formatFolderTimestamp(d)).toBe('2026-09-13T10-20');
  });
});
