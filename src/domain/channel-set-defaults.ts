import type { ChannelSetSnapshot, Channel } from './types';

const FROZEN_AT = new Date('2026-01-01T00:00:00Z');

function tc300Channels(): Channel[] {
  return Array.from({ length: 40 }, (_, i) => ({
    label: `ch${i + 1}`,
    order: i,
    pseudoDepthM: (i + 1) * 4.5,
  }));
}

export function defaultChannelSetSnapshot(): ChannelSetSnapshot {
  return {
    name: 'TC300 linear-nominal v1 (default)',
    deviceModel: 'PQWT-TC300',
    kind: 'frequency',
    units: 'mV',
    depthModel: 'linear-nominal',
    provenanceNote: 'Phase 1c default snapshot; replace via ChannelSet service in a later phase.',
    channels: tc300Channels(),
    frozenAt: FROZEN_AT,
  };
}
