import { describe, it, expect } from 'vitest';
import { sha256Hex } from './hash';

describe('sha256Hex', () => {
  it('matches known SHA-256 of "abc"', async () => {
    // Known: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    const h = await sha256Hex('abc');
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('accepts a Uint8Array', async () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]);
    const h = await sha256Hex(bytes);
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('lowercase hex, 64 chars', async () => {
    const h = await sha256Hex('anything');
    expect(h).toHaveLength(64);
    expect(h).toBe(h.toLowerCase());
  });
});
