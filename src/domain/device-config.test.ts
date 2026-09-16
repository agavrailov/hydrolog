import { describe, it, expect } from 'vitest';
import { ELECTRODE_LAYOUT, totalElectrodes, activePointFractions } from './device-config';

describe('GT-150 electrode layout', () => {
  const layout = ELECTRODE_LAYOUT['GT-150'];

  it('is defined', () => {
    expect(layout).toBeDefined();
  });

  it('has correct S-A-S counts', () => {
    expect(layout.serviceStart).toBe(2);
    expect(layout.active).toBe(18);
    expect(layout.serviceEnd).toBe(2);
  });

  it('totalElectrodes = 22', () => {
    expect(totalElectrodes(layout)).toBe(22);
  });
});

describe('activePointFractions (GT-150)', () => {
  const layout = ELECTRODE_LAYOUT['GT-150'];
  const fractions = activePointFractions(layout);

  it('returns exactly active (18) fractions', () => {
    expect(fractions).toHaveLength(18);
  });

  it('point 1 is at electrode 3 — fraction 2/21', () => {
    // electrode 3 is 2 spacings from electrode 1 → fraction 2/21 along cable
    expect(fractions[0]).toBeCloseTo(2 / 21, 10);
  });

  it('point 18 is at electrode 20 — fraction 19/21', () => {
    // electrode 20 is 19 spacings from electrode 1 → fraction 19/21
    expect(fractions[17]).toBeCloseTo(19 / 21, 10);
  });

  it('consecutive fractions are evenly spaced (step = 1/21)', () => {
    const step = 1 / 21;
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i] - fractions[i - 1]).toBeCloseTo(step, 10);
    }
  });

  it('all fractions are strictly between 0 and 1 (service electrodes excluded)', () => {
    for (const f of fractions) {
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThan(1);
    }
  });
});
