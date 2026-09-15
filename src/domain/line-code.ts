export function generateLineLabel(existingLabels: string[]): string {
  let max = 0;
  for (const l of existingLabels) {
    const m = /^L(\d+)$/.exec(l);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `L${max + 1}`;
}
