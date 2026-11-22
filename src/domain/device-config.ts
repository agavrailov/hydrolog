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

// Physical spacing between adjacent electrodes on the cable (m) — a property of
// the device's cable, not something the operator sets per profile.
export const DEVICE_SPACING_M: Record<string, number> = {
  'GT-150': 2.5,
};

export function deviceSpacingM(deviceModel: string): number | null {
  return DEVICE_SPACING_M[deviceModel] ?? null;
}

export function totalElectrodes(layout: ElectrodeLayout): number {
  return layout.serviceStart + layout.active + layout.serviceEnd;
}

// Fractions along the cable [0..1] for each active measurement point.
// Fraction 0 = electrode 1 position, fraction 1 = last electrode position.
//
// `count` is how many points were actually measured (device CSV row count). A short
// run is assumed to START at the first active electrode and advance one electrode per
// point, matching the device's N column, which increments by 1 per row. So 12 points
// on a GT-150 occupy electrodes 3..14 and the far end of the cable stays unmeasured.
// Returns [] when count exceeds the active-zone size — the caller then has no layout
// information it can trust and should fall back to a uniform spread.
//
// `lastElectrode` is the electrode at fraction 1: 22 for a fix at the end of the full
// cable, points + 4 for track-derived geometry (track-geometry-design §7.5). A value
// that cannot hold `count` points is ignored in favour of the full cable.
export function activePointFractions(
  layout: ElectrodeLayout,
  count: number = layout.active,
  lastElectrode: number = totalElectrodes(layout),
): number[] {
  if (count < 1 || count > layout.active) return [];
  const full = totalElectrodes(layout);
  const shortest = layout.serviceStart + count + layout.serviceEnd;
  const fits = lastElectrode >= shortest && lastElectrode <= full;
  const totalSpacings = (fits ? lastElectrode : full) - 1;
  return Array.from({ length: count }, (_, i) => {
    // Active point j (1-based) = i+1 sits at physical electrode (serviceStart + j).
    // 0-indexed electrode = serviceStart + i.
    // fraction = (serviceStart + i) / totalSpacings
    return (layout.serviceStart + i) / totalSpacings;
  });
}
