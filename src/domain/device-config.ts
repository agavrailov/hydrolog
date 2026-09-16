// Per-device electrode layout — service electrodes at each end of the cable.
// Devices with no entry here use the old default: fix at point 1 / point N.
export interface ElectrodeLayout {
  serviceStart: number;  // service electrodes before the active measurement zone
  active: number;        // active (measurement) electrodes
  serviceEnd: number;    // service electrodes after the active measurement zone
}

// GPS fix at electrode 1 (first service) and electrode (total) (last service).
export const ELECTRODE_LAYOUT: Record<string, ElectrodeLayout> = {
  'GT-150': { serviceStart: 2, active: 18, serviceEnd: 2 },
};

export function totalElectrodes(layout: ElectrodeLayout): number {
  return layout.serviceStart + layout.active + layout.serviceEnd;
}

// Fractions along the cable [0..1] for each active measurement point.
// Fraction 0 = electrode 1 position, fraction 1 = last electrode position.
export function activePointFractions(layout: ElectrodeLayout): number[] {
  const total = totalElectrodes(layout);
  const totalSpacings = total - 1;
  return Array.from({ length: layout.active }, (_, i) => {
    // Active point j (1-based) = i+1 sits at physical electrode (serviceStart + j).
    // 0-indexed electrode = serviceStart + i.
    // fraction = (serviceStart + i) / totalSpacings
    return (layout.serviceStart + i) / totalSpacings;
  });
}
