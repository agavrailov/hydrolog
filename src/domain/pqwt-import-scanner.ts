import { readBlob } from '../storage/atomic';

export interface PqwtLineCandidate {
  folderName: string;              // "L1", "L10", whatever the operator wrote on the device
  depthRangeM: number;             // parsed from the mode folder name ("150M" → 150)
  deviceLineLabel: string;         // "1", "10" — from the CSV's L column (matches folder without the "L" prefix by convention, but not enforced)
  csvFile: File;
  csvText: string;
  rawBmp?: File;                   // <label>_Profile_<label>.bmp when present
  processedBmp?: File;             // <label>_Profile_<label>_Processed.bmp when present
}

export interface PqwtImportScan {
  candidates: PqwtLineCandidate[];
  skipped: { folderName: string; reason: string }[];
}

const MODE_RE = /^(\d+)M$/;
const CSV_RE = /\.csv$/i;
const BMP_RE = /\.bmp$/i;
const PROCESSED_RE = /_Processed\.bmp$/i;

async function listChildren(dir: FileSystemDirectoryHandle): Promise<{ name: string; handle: FileSystemHandle }[]> {
  const out: { name: string; handle: FileSystemHandle }[] = [];
  for await (const [name, handle] of (dir as any).entries()) {
    out.push({ name, handle });
  }
  return out;
}

export async function scanPqwtImportRoot(root: FileSystemDirectoryHandle): Promise<PqwtImportScan> {
  const candidates: PqwtLineCandidate[] = [];
  const skipped: { folderName: string; reason: string }[] = [];

  for (const entry of await listChildren(root)) {
    if (entry.handle.kind !== 'directory') continue;
    const modeMatch = MODE_RE.exec(entry.name);
    if (!modeMatch) {
      skipped.push({ folderName: entry.name, reason: `mode folder name does not match <n>M pattern` });
      continue;
    }
    const depthRangeM = parseInt(modeMatch[1], 10);
    const modeDir = entry.handle as FileSystemDirectoryHandle;

    for (const lineEntry of await listChildren(modeDir)) {
      if (lineEntry.handle.kind !== 'directory') continue;
      const lineDir = lineEntry.handle as FileSystemDirectoryHandle;
      const lineFolderName = lineEntry.name;

      const files = await listChildren(lineDir);
      const csvHandle = files.find((f) => f.handle.kind === 'file' && CSV_RE.test(f.name));
      if (!csvHandle) {
        skipped.push({ folderName: lineFolderName, reason: 'no CSV file' });
        continue;
      }

      const csvBlob = await readBlob(lineDir, csvHandle.name);
      const csvFile = csvBlob instanceof File ? csvBlob : new File([csvBlob], csvHandle.name);
      const csvText = await csvBlob.text();

      // Extract L column value quickly to fill deviceLineLabel
      const firstBodyLine = csvText.split(/\r?\n/).filter((l) => l.length > 0)[1] ?? '';
      const deviceLineLabel = firstBodyLine.split(',')[0] ?? '';

      let rawBmp: File | undefined;
      let processedBmp: File | undefined;
      for (const f of files) {
        if (f.handle.kind !== 'file') continue;
        if (!BMP_RE.test(f.name)) continue;
        const blob = await readBlob(lineDir, f.name);
        const file = blob instanceof File ? blob : new File([blob], f.name);
        if (PROCESSED_RE.test(f.name)) processedBmp = file;
        else rawBmp = file;
      }

      candidates.push({
        folderName: lineFolderName,
        depthRangeM,
        deviceLineLabel,
        csvFile,
        csvText,
        rawBmp,
        processedBmp,
      });
    }
  }

  return { candidates, skipped };
}
