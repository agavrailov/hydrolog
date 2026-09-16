import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProfileCanvas, valueToColor } from './ProfileCanvas';
import type { ChannelSetSnapshot, Point } from '../domain/types';

const TWO_CH: ChannelSetSnapshot = {
  name: 'test', deviceModel: 'PQWT-150M', kind: 'frequency',
  units: 'mV', depthModel: 'linear-nominal', provenanceNote: 'test',
  frozenAt: new Date('2026-01-01'),
  channels: [
    { label: 'freq01', order: 0, pseudoDepthM: 75 },
    { label: 'freq02', order: 1, pseudoDepthM: 150 },
  ],
};

function makePoint(index: number, values: (number | null)[]): Point {
  return {
    index, offsetM: (index - 1) * 2, lat: 42.0, lon: 23.0,
    elevSource: 'none', coordSource: 'interpolated',
    readings: [{ pass: 1, recordedAt: new Date(), values, groundingOk: true, electrodeTreatment: 'none' }],
    flags: [],
  };
}

describe('valueToColor', () => {
  it('returns blue-family hsl for min value', () => {
    const color = valueToColor(0, 0, 1);
    expect(color).toMatch(/hsl\(240/);
  });

  it('returns red-family hsl for max value', () => {
    const color = valueToColor(1, 0, 1);
    expect(color).toMatch(/hsl\(0[,)]/);
  });

  it('returns mid hsl for midpoint value', () => {
    const color = valueToColor(0.5, 0, 1);
    expect(color).toMatch(/hsl\(120/);
  });

  it('returns grey (#888) for null', () => {
    expect(valueToColor(null, 0, 1)).toBe('#888');
  });

  it('returns blue when min equals max (degenerate range)', () => {
    const color = valueToColor(5, 5, 5);
    expect(color).toMatch(/hsl\(240/);
  });
});

describe('ProfileCanvas', () => {
  it('renders a canvas element', () => {
    const { container } = render(
      <ProfileCanvas
        points={[makePoint(1, [0.1, 0.2]), makePoint(2, [0.3, 0.4])]}
        channelSet={TWO_CH}
      />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('renders without crashing when points is empty', () => {
    const { container } = render(
      <ProfileCanvas points={[]} channelSet={TWO_CH} />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('canvas has aria-label', () => {
    const { container } = render(
      <ProfileCanvas points={[makePoint(1, [0.1, 0.2])]} channelSet={TWO_CH} />
    );
    const canvas = container.querySelector('canvas');
    expect(canvas?.getAttribute('aria-label')).toBeTruthy();
  });
});
