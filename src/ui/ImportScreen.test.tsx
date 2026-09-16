import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot, setFsAdapter } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { getOrCreatePath } from '../storage/paths';
import { writeBlob } from '../storage/atomic';
import { PQWT_L1_MINIMAL_CSV } from '../test/fixtures-pqwt';
import { createSite } from '../domain/site-service';
import { createSurvey } from '../domain/survey-service';
import { ImportScreen } from './ImportScreen';

let mainRoot: FileSystemDirectoryHandle;
let pickedRoot: FileSystemDirectoryHandle;

beforeEach(async () => {
  await resetDb();
  clearRoot();
  mainRoot = createMockRoot('Main');
  setRoot(mainRoot);
  pickedRoot = createMockRoot('DevicePick');
  setFsAdapter({ showDirectoryPicker: async () => pickedRoot });

  // Seed a picked-folder shape: 150M/L1/{csv,bmp}
  const mode = await getOrCreatePath(pickedRoot, ['150M']);
  const l1 = await getOrCreatePath(mode, ['L1']);
  await writeBlob(l1, '150M_L1.csv', new TextEncoder().encode(PQWT_L1_MINIMAL_CSV));
  await writeBlob(l1, '150M_Profile_L1.bmp', new Uint8Array([0x42, 0x4d]));
});

async function seedSurvey() {
  const site = await createSite({
    name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
  const sv = await createSurvey(site.id, {
    startedAt: new Date(), timezone: 'Europe/Sofia', operator: 'Anton',
    deviceModel: 'PQWT-150M', deviceSerial: 'x',
    precipLast48h: 'none', qualityFlag: 'good',
  });
  return { site, sv };
}

describe('<ImportScreen />', () => {
  it('renders pick-folder button initially', async () => {
    const { sv } = await seedSurvey();
    render(<ImportScreen surveyId={sv.id} onDone={() => {}} onCancel={() => {}} />);
    expect(await screen.findByRole('button', { name: /избери папка/i })).toBeInTheDocument();
  });

  it('shows candidates table after scanning', async () => {
    const { sv } = await seedSurvey();
    render(<ImportScreen surveyId={sv.id} onDone={() => {}} onCancel={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /избери папка/i }));
    await waitFor(() => expect(screen.getByText(/намерени профили/i)).toBeInTheDocument());
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('L1')).toBeInTheDocument();
  });

  it('creates a new line on import', async () => {
    const { sv } = await seedSurvey();
    render(<ImportScreen surveyId={sv.id} onDone={() => {}} onCancel={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /избери папка/i }));
    await waitFor(() => screen.getByText(/намерени профили/i));

    await userEvent.click(screen.getByRole('button', { name: /стартирай импорт/i }));
    await waitFor(() => expect(screen.getByText(/импортирано/i)).toBeInTheDocument());

    const lines = await getDb().lines.where('surveyId').equals(sv.id).toArray();
    expect(lines).toHaveLength(1);
    expect(lines[0].json.label).toBe('L1');
    expect(lines[0].json.deviceStartPointIndex).toBe(80);
    expect(lines[0].json.status).toBe('complete');
  });

  it('rejects a second import of the same line', async () => {
    const { sv } = await seedSurvey();
    const { importPqwtAsNewLine } = await import('../domain/pqwt-import-service');
    const { scanPqwtImportRoot } = await import('../domain/pqwt-import-scanner');

    const scan = await scanPqwtImportRoot(pickedRoot);
    const candidate = scan.candidates[0];

    await importPqwtAsNewLine({ surveyId: sv.id, candidate });
    await expect(importPqwtAsNewLine({ surveyId: sv.id, candidate }))
      .rejects.toThrow(/вече е импортирана/i);

    const lines = await getDb().lines.where('surveyId').equals(sv.id).toArray();
    expect(lines).toHaveLength(1);
  });

  it('shows the "no candidates" empty state when the picked folder has nothing', async () => {
    const { sv } = await seedSurvey();
    setFsAdapter({ showDirectoryPicker: async () => createMockRoot('Empty') });

    render(<ImportScreen surveyId={sv.id} onDone={() => {}} onCancel={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /избери папка/i }));
    expect(await screen.findByText(/не са намерени данни/i)).toBeInTheDocument();
  });
});
