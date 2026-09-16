import { describe, it, expect } from 'vitest';
import { regionCode, generateSiteCode } from './site-code';

describe('regionCode', () => {
  it('transliterates Cyrillic first 3 letters to Latin uppercase', () => {
    expect(regionCode('Софийска')).toBe('SOF');
    expect(regionCode('Пловдив')).toBe('PLO');
    expect(regionCode('Варна')).toBe('VAR');
    expect(regionCode('Бургас')).toBe('BUR');
  });

  it('handles mixed-case input', () => {
    expect(regionCode('софийска')).toBe('SOF');
  });

  it('handles ASCII input pass-through', () => {
    expect(regionCode('Sofia')).toBe('SOF');
    expect(regionCode('London')).toBe('LON');
  });

  it('returns XXX for input with fewer than 3 letters', () => {
    expect(regionCode('')).toBe('XXX');
    expect(regionCode('ab')).toBe('XXX');
    expect(regionCode('А')).toBe('XXX');
  });

  it('ignores non-letter characters when taking first 3', () => {
    expect(regionCode('  Софийска  ')).toBe('SOF');
    expect(regionCode('С-о-ф')).toBe('SOF');
  });
});

describe('generateSiteCode', () => {
  it('returns 0001 for the first site in a region', () => {
    expect(generateSiteCode('Софийска', [])).toBe('BG-SOF-0001');
  });

  it('increments the sequence for the same region', () => {
    expect(generateSiteCode('Софийска', ['BG-SOF-0001', 'BG-SOF-0002'])).toBe('BG-SOF-0003');
  });

  it('ignores codes from other regions when computing sequence', () => {
    expect(generateSiteCode('Пловдив', ['BG-SOF-0042', 'BG-PLO-0001'])).toBe('BG-PLO-0002');
  });

  it('zero-pads sequence to 4 digits', () => {
    expect(generateSiteCode('Софийска', ['BG-SOF-0099'])).toBe('BG-SOF-0100');
  });

  it('handles gaps in the sequence by using max+1', () => {
    expect(generateSiteCode('Софийска', ['BG-SOF-0001', 'BG-SOF-0003'])).toBe('BG-SOF-0004');
  });

  it('ignores malformed codes', () => {
    expect(generateSiteCode('Софийска', ['not-a-code', 'BG-SOF-XX', 'BG-SOF-0005'])).toBe('BG-SOF-0006');
  });

  it('uses suggestedNumber when provided and not taken', () => {
    expect(generateSiteCode('Софийска', [], 1150)).toBe('BG-SOF-1150');
    expect(generateSiteCode('Софийска', ['BG-SOF-0001'], 1151)).toBe('BG-SOF-1151');
  });

  it('falls back to max+1 when suggestedNumber is already taken', () => {
    expect(generateSiteCode('Софийска', ['BG-SOF-1150'], 1150)).toBe('BG-SOF-1151');
  });
});
