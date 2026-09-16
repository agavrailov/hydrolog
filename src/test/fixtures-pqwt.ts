// Minimal representative slice of the real 150M_L1.csv format.
// Real files have 18 point rows × 36 channels; the fixture uses 3 × 36 for speed.
export const PQWT_L1_HEADER = 'L,N,freq01,freq02,freq03,freq04,freq05,freq06,freq07,freq08,freq09,freq10,freq11,freq12,freq13,freq14,freq15,freq16,freq17,freq18,freq19,freq20,freq21,freq22,freq23,freq24,freq25,freq26,freq27,freq28,freq29,freq30,freq31,freq32,freq33,freq34,freq35,freq36,';

// Row values chosen so each row's mean differs — easy to spot cross-row bugs.
function makeRow(L: number, N: number, base: number): string {
  const values = Array.from({ length: 36 }, (_, i) => (base + i * 0.01).toFixed(3));
  return [String(L), String(N), ...values, ''].join(',');
}

export const PQWT_L1_MINIMAL_CSV = [
  PQWT_L1_HEADER,
  makeRow(1, 80, 0.040),
  makeRow(1, 81, 0.065),
  makeRow(1, 82, 0.055),
].join('\r\n') + '\r\n';

// L2 fixture — different label + operator-set startN
export const PQWT_L2_MINIMAL_CSV = [
  PQWT_L1_HEADER,
  makeRow(2, 100, 0.070),
  makeRow(2, 101, 0.080),
].join('\r\n') + '\r\n';

// L10 fixture — multi-digit label
export const PQWT_L10_MINIMAL_CSV = [
  PQWT_L1_HEADER,
  makeRow(10, 50, 0.100),
  makeRow(10, 51, 0.110),
].join('\r\n') + '\r\n';
