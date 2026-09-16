import { describe, it, expect } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import { getOrCreatePath } from '../storage/paths';
import { writeBlob } from '../storage/atomic';
import { PQWT_L1_MINIMAL_CSV, PQWT_L2_MINIMAL_CSV } from '../test/fixtures-pqwt';
import { scanPqwtImportRoot } from './pqwt-import-scanner';

async function writeText(dir: FileSystemDirectoryHandle, name: string, text: string) {
  await writeBlob(dir, name, new TextEncoder().encode(text));
}

async function writeBmp(dir: FileSystemDirectoryHandle, name: string) {
  // Minimal 2-byte "BMP" — the scanner doesn't validate BMP internals, only presence
  await writeBlob(dir, name, new Uint8Array([0x42, 0x4d]));
}

describe('scanPqwtImportRoot', () => {
  it('discovers the two-level shape: <mode>/<line>/{csv,bmps}', async () => {
    const root = createMockRoot();
    const mode = await getOrCreatePath(root, ['150M']);
    const l1 = await getOrCreatePath(mode, ['L1']);
    await writeText(l1, '150M_L1.csv', PQWT_L1_MINIMAL_CSV);
    await writeBmp(l1, '150M_Profile_L1.bmp');
    await writeBmp(l1, '150M_Profile_L1_Processed.bmp');

    const l2 = await getOrCreatePath(mode, ['L2']);
    await writeText(l2, '150M_L2.csv', PQWT_L2_MINIMAL_CSV);
    // no BMPs for L2

    const scan = await scanPqwtImportRoot(root);
    expect(scan.candidates).toHaveLength(2);
    expect(scan.candidates.map((c) => c.folderName).sort()).toEqual(['L1', 'L2']);

    const c1 = scan.candidates.find((c) => c.folderName === 'L1')!;
    expect(c1.depthRangeM).toBe(150);
    expect(c1.deviceLineLabel).toBe('1');
    expect(c1.csvText.length).toBeGreaterThan(0);
    expect(c1.rawBmp).toBeDefined();
    expect(c1.processedBmp).toBeDefined();

    const c2 = scan.candidates.find((c) => c.folderName === 'L2')!;
    expect(c2.deviceLineLabel).toBe('2');
    expect(c2.rawBmp).toBeUndefined();
    expect(c2.processedBmp).toBeUndefined();
  });

  it('skips folders with no CSV', async () => {
    const root = createMockRoot();
    const mode = await getOrCreatePath(root, ['150M']);
    const empty = await getOrCreatePath(mode, ['L5']);
    void empty;

    const scan = await scanPqwtImportRoot(root);
    expect(scan.candidates).toHaveLength(0);
    expect(scan.skipped).toHaveLength(1);
    expect(scan.skipped[0].folderName).toBe('L5');
    expect(scan.skipped[0].reason).toMatch(/csv/i);
  });

  it('skips mode folders whose name is not `<n>M`', async () => {
    const root = createMockRoot();
    const bogus = await getOrCreatePath(root, ['not-a-mode']);
    const l1 = await getOrCreatePath(bogus, ['L1']);
    await writeText(l1, 'x.csv', PQWT_L1_MINIMAL_CSV);

    const scan = await scanPqwtImportRoot(root);
    expect(scan.candidates).toHaveLength(0);
    expect(scan.skipped.some((s) => /mode/i.test(s.reason))).toBe(true);
  });

  it('accepts multiple mode folders in one scan', async () => {
    const root = createMockRoot();
    const m1 = await getOrCreatePath(root, ['150M']);
    const l1 = await getOrCreatePath(m1, ['L1']);
    await writeText(l1, '150M_L1.csv', PQWT_L1_MINIMAL_CSV);
    const m2 = await getOrCreatePath(root, ['300M']);
    const l2 = await getOrCreatePath(m2, ['L2']);
    await writeText(l2, '300M_L2.csv', PQWT_L2_MINIMAL_CSV);

    const scan = await scanPqwtImportRoot(root);
    expect(scan.candidates).toHaveLength(2);
    expect(scan.candidates.find((c) => c.folderName === 'L1')?.depthRangeM).toBe(150);
    expect(scan.candidates.find((c) => c.folderName === 'L2')?.depthRangeM).toBe(300);
  });

  it('ignores desktop.ini and other non-relevant files in a line folder', async () => {
    const root = createMockRoot();
    const mode = await getOrCreatePath(root, ['150M']);
    const l1 = await getOrCreatePath(mode, ['L1']);
    await writeText(l1, '150M_L1.csv', PQWT_L1_MINIMAL_CSV);
    await writeText(l1, 'desktop.ini', '[.ShellClassInfo]');

    const scan = await scanPqwtImportRoot(root);
    expect(scan.candidates).toHaveLength(1);
    expect(scan.skipped).toHaveLength(0);
  });
});
