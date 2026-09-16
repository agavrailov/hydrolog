export interface ParsedPqwtCsv {
  deviceLineLabel: string;         // "1", "2", "10" — from the L column, matches folder name
  startN: number;                  // operator-set device N at row 0 (§7.5 preserve verbatim)
  pointCount: number;              // number of body rows
  channelCount: number;            // number of freq columns
  channelLabels: string[];         // ["freq01", "freq02", ...]
  readings: (number | null)[][];   // readings[pointIndex][channelIndex]
}

// The device writes:
//   Header: "L,N,freq01,freq02,...,freqNN,"  (trailing comma → last field is empty)
//   Body:   "1,80,0.040,0.034,...,0.476,"
// One file per line. L is constant within a file (matches folder name).
// N is operator-set and increments by 1 per row.
export function parsePqwtCsv(text: string): ParsedPqwtCsv {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Error('parsePqwtCsv: missing header line');
  }

  // ─── header ─────────────────────────────────────────────
  const headerCols = splitCsvRow(lines[0]);
  if (headerCols.length < 3 || headerCols[0] !== 'L' || headerCols[1] !== 'N') {
    throw new Error(`parsePqwtCsv: header must start with "L,N,..."; got "${headerCols.slice(0, 3).join(',')}"`);
  }
  // Trailing empty column from the terminating comma
  const trailingEmpty = headerCols[headerCols.length - 1] === '';
  const usedHeader = trailingEmpty ? headerCols.slice(0, -1) : headerCols;
  const channelLabels = usedHeader.slice(2);
  const channelCount = channelLabels.length;
  if (channelCount === 0) {
    throw new Error('parsePqwtCsv: header declares zero channels');
  }
  const expectedRowFieldCount = headerCols.length; // includes trailing empty when present

  // ─── body ───────────────────────────────────────────────
  const readings: (number | null)[][] = [];
  let deviceLineLabel = '';
  let startN = 0;
  let prevN = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvRow(lines[i]);
    if (cols.length !== expectedRowFieldCount) {
      throw new Error(`parsePqwtCsv: row ${i} column count ${cols.length} != header ${expectedRowFieldCount}`);
    }

    const L = cols[0];
    const N = parseInt(cols[1], 10);
    if (Number.isNaN(N)) {
      throw new Error(`parsePqwtCsv: row ${i} has non-numeric N "${cols[1]}"`);
    }

    if (i === 1) {
      deviceLineLabel = L;
      startN = N;
      prevN = N;
    } else {
      if (L !== deviceLineLabel) {
        throw new Error(`parsePqwtCsv: L column varies within file (row 1: "${deviceLineLabel}", row ${i}: "${L}")`);
      }
      if (N !== prevN + 1) {
        throw new Error(`parsePqwtCsv: N values not consecutive at row ${i} (expected ${prevN + 1}, got ${N})`);
      }
      prevN = N;
    }

    const values: (number | null)[] = new Array(channelCount);
    for (let c = 0; c < channelCount; c++) {
      const raw = cols[2 + c];
      if (raw === '' || raw.toLowerCase() === 'null') {
        values[c] = null;
        continue;
      }
      const n = Number(raw);
      if (Number.isNaN(n)) {
        throw new Error(`parsePqwtCsv: row ${i} channel ${c + 1} has non-numeric value "${raw}"`);
      }
      values[c] = n;
    }
    readings.push(values);
  }

  return {
    deviceLineLabel,
    startN,
    pointCount: readings.length,
    channelCount,
    channelLabels,
    readings,
  };
}

// Splits a comma-separated line. This device's CSV does NOT quote fields;
// values are plain numbers or the L/N integers. Keep the splitter minimal.
function splitCsvRow(line: string): string[] {
  return line.split(',');
}
