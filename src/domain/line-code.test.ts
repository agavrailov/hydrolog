import { describe, it, expect } from 'vitest';
import { generateLineLabel } from './line-code';

describe('generateLineLabel', () => {
  it('returns L1 for an empty list', () => {
    expect(generateLineLabel([])).toBe('L1');
  });

  it('increments the max', () => {
    expect(generateLineLabel(['L1', 'L2'])).toBe('L3');
  });

  it('ignores non-matching labels', () => {
    expect(generateLineLabel(['not-a-label', 'L2'])).toBe('L3');
  });

  it('handles gaps by using max+1', () => {
    expect(generateLineLabel(['L1', 'L4'])).toBe('L5');
  });

  it('handles multi-digit numbers', () => {
    expect(generateLineLabel(['L9', 'L10'])).toBe('L11');
  });
});
