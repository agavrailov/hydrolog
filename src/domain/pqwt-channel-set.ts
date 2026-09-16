import type { ChannelSetSnapshot } from './types';

const FROZEN_AT = new Date('2026-01-01T00:00:00Z');

export interface BuildPqwtChannelSetInput {
  channelLabels: string[];
  depthRangeM: number;
  deviceModel: string;
}

export function buildPqwtChannelSet(input: BuildPqwtChannelSetInput): ChannelSetSnapshot {
  if (input.channelLabels.length === 0) {
    throw new Error('buildPqwtChannelSet: channelLabels must not be empty');
  }
  if (input.depthRangeM <= 0) {
    throw new Error(`buildPqwtChannelSet: depthRangeM must be positive; got ${input.depthRangeM}`);
  }

  const n = input.channelLabels.length;
  const stepM = input.depthRangeM / n;

  const channels = input.channelLabels.map((label, i) => ({
    label,
    order: i,
    pseudoDepthM: (i + 1) * stepM,
  }));

  return {
    name: `${input.deviceModel} ${input.depthRangeM}m ${n}-channel snapshot`,
    deviceModel: input.deviceModel,
    kind: 'frequency',
    units: 'mV',
    depthModel: 'linear-nominal',
    provenanceNote: `Built from PQWT CSV header at import; ${input.depthRangeM} m / ${n} channels = ${stepM.toFixed(3)} m per step per §2 R3 nominal linear split.`,
    channels,
    frozenAt: FROZEN_AT,
  };
}
