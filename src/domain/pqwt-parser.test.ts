import { describe, it, expect } from 'vitest';
import { parsePqwtCsv } from './pqwt-parser';
import { PQWT_L1_MINIMAL_CSV, PQWT_L2_MINIMAL_CSV, PQWT_L10_MINIMAL_CSV } from '../test/fixtures-pqwt';

describe('parsePqwtCsv', () => {
  it('parses the minimal L1 fixture', () => {
    const p = parsePqwtCsv(PQWT_L1_MINIMAL_CSV);
    expect(p.deviceLineLabel).toBe('1');
    expect(p.startN).toBe(80);
    expect(p.pointCount).toBe(3);
    expect(p.channelCount).toBe(36);
    expect(p.channelLabels[0]).toBe('freq01');
    expect(p.channelLabels[35]).toBe('freq36');
    // First row, first channel
    expect(p.readings[0][0]).toBe(0.040);
    // Second row, second channel
    expect(p.readings[1][1]).toBeCloseTo(0.075, 3);
  });

  it('handles multi-digit device line labels', () => {
    const p = parsePqwtCsv(PQWT_L10_MINIMAL_CSV);
    expect(p.deviceLineLabel).toBe('10');
    expect(p.startN).toBe(50);
    expect(p.pointCount).toBe(2);
  });

  it('captures operator-set startN verbatim (§7.5)', () => {
    const p = parsePqwtCsv(PQWT_L2_MINIMAL_CSV);
    expect(p.startN).toBe(100);
    // Verify no re-indexing happened
    expect(p.readings).toHaveLength(2);
  });

  it('throws with a specific message on missing header', () => {
    expect(() => parsePqwtCsv('')).toThrow(/header/i);
    expect(() => parsePqwtCsv('\r\n')).toThrow(/header/i);
  });

  it('throws when header does not start with L,N', () => {
    expect(() => parsePqwtCsv('X,Y,freq01,\r\n1,80,0.040,\r\n')).toThrow(/header.*L,N/i);
  });

  it('throws when body rows have inconsistent column counts', () => {
    const bad = [
      'L,N,freq01,freq02,',
      '1,80,0.040,0.050,',
      '1,81,0.060,',        // one column short
    ].join('\r\n') + '\r\n';
    expect(() => parsePqwtCsv(bad)).toThrow(/column count/i);
  });

  it('throws when a body row has a non-numeric value in a channel column', () => {
    const bad = [
      'L,N,freq01,',
      '1,80,notanumber,',
    ].join('\r\n') + '\r\n';
    expect(() => parsePqwtCsv(bad)).toThrow(/numeric/i);
  });

  it('tolerates LF-only line endings (not just CRLF)', () => {
    const lfOnly = PQWT_L1_MINIMAL_CSV.replace(/\r\n/g, '\n');
    const p = parsePqwtCsv(lfOnly);
    expect(p.pointCount).toBe(3);
    expect(p.startN).toBe(80);
  });

  it('tolerates a trailing blank line', () => {
    const p = parsePqwtCsv(PQWT_L1_MINIMAL_CSV + '\r\n\r\n');
    expect(p.pointCount).toBe(3);
  });

  it('throws when L varies within one file (§7.5 sanity check)', () => {
    const mixed = [
      'L,N,freq01,',
      '1,80,0.040,',
      '2,81,0.050,',
    ].join('\r\n') + '\r\n';
    expect(() => parsePqwtCsv(mixed)).toThrow(/L column varies/i);
  });

  it('throws when N is not monotonically increasing by 1', () => {
    const gap = [
      'L,N,freq01,',
      '1,80,0.040,',
      '1,82,0.050,',   // skipped 81
    ].join('\r\n') + '\r\n';
    expect(() => parsePqwtCsv(gap)).toThrow(/N.*not.*consecutive/i);
  });
});
