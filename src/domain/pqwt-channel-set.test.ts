import { describe, it, expect } from 'vitest';
import { buildPqwtChannelSet } from './pqwt-channel-set';

describe('buildPqwtChannelSet', () => {
  const labels36 = Array.from({ length: 36 }, (_, i) => `freq${String(i + 1).padStart(2, '0')}`);

  it('embeds 36 channels for 150 m / 36 depth-range mode', () => {
    const cs = buildPqwtChannelSet({
      channelLabels: labels36,
      depthRangeM: 150,
      deviceModel: 'PQWT-150M',
    });
    expect(cs.channels).toHaveLength(36);
    expect(cs.channels[0].label).toBe('freq01');
    expect(cs.channels[35].label).toBe('freq36');
  });

  it('assigns linear-nominal pseudo-depth per §2 R3', () => {
    const cs = buildPqwtChannelSet({
      channelLabels: labels36, depthRangeM: 150, deviceModel: 'PQWT',
    });
    // 150 / 36 = 4.1666..., so ch1 ≈ 4.17 m, ch36 = 150 m
    expect(cs.channels[0].pseudoDepthM).toBeCloseTo(4.167, 2);
    expect(cs.channels[35].pseudoDepthM).toBeCloseTo(150, 2);
    expect(cs.depthModel).toBe('linear-nominal');
  });

  it('sets units to "mV" (§2 R1)', () => {
    const cs = buildPqwtChannelSet({
      channelLabels: labels36, depthRangeM: 150, deviceModel: 'PQWT',
    });
    expect(cs.units).toBe('mV');
  });

  it('sets frozenAt to a stable constant', () => {
    const a = buildPqwtChannelSet({ channelLabels: labels36, depthRangeM: 150, deviceModel: 'PQWT' });
    const b = buildPqwtChannelSet({ channelLabels: labels36, depthRangeM: 150, deviceModel: 'PQWT' });
    expect(a.frozenAt.getTime()).toBe(b.frozenAt.getTime());
  });

  it('includes provenance mentioning §2 R3 nominal linear split', () => {
    const cs = buildPqwtChannelSet({ channelLabels: labels36, depthRangeM: 150, deviceModel: 'PQWT' });
    expect(cs.provenanceNote).toMatch(/§2 R3/);
    expect(cs.provenanceNote).toMatch(/linear/);
  });

  it('assigns channel order matching label sequence', () => {
    const cs = buildPqwtChannelSet({ channelLabels: labels36, depthRangeM: 150, deviceModel: 'PQWT' });
    for (let i = 0; i < 36; i++) {
      expect(cs.channels[i].order).toBe(i);
    }
  });

  it('handles a different channel count (e.g. 40)', () => {
    const labels40 = Array.from({ length: 40 }, (_, i) => `freq${String(i + 1).padStart(2, '0')}`);
    const cs = buildPqwtChannelSet({ channelLabels: labels40, depthRangeM: 300, deviceModel: 'PQWT-TC300' });
    expect(cs.channels).toHaveLength(40);
    expect(cs.channels[0].pseudoDepthM).toBeCloseTo(7.5, 2);
    expect(cs.channels[39].pseudoDepthM).toBeCloseTo(300, 2);
  });

  it('throws when channelLabels is empty', () => {
    expect(() => buildPqwtChannelSet({ channelLabels: [], depthRangeM: 150, deviceModel: 'PQWT' })).toThrow(/empty/i);
  });

  it('throws when depthRangeM is <= 0', () => {
    expect(() => buildPqwtChannelSet({ channelLabels: labels36, depthRangeM: 0, deviceModel: 'PQWT' })).toThrow(/depth/i);
    expect(() => buildPqwtChannelSet({ channelLabels: labels36, depthRangeM: -1, deviceModel: 'PQWT' })).toThrow(/depth/i);
  });
});
