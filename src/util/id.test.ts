import { describe, it, expect } from 'vitest';
import { newId } from './id';

describe('newId', () => {
  it('returns a 26-char ULID', () => {
    const id = newId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('is monotonic within a millisecond', () => {
    const a = newId();
    const b = newId();
    expect(b > a).toBe(true);
  });

  it('produces unique values across 1000 calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(newId());
    expect(seen.size).toBe(1000);
  });
});
