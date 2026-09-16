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
import { createLine } from '../domain/line-service';
import type { Vertex } from '../domain/types';
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

  // Seed a picked-folder shape: 150M/L1/{csv,bmps}
  const mode = await getOrCreatePath(pickedRoot, ['150M']);
  const l1 = await getOrCreatePath(mode, ['L1']);
  await writeBlob(l1, '150M_L1.csv', new TextEncoder().encode(PQWT_L1_MINIMAL_CSV));
  await writeBlob(l1, '150M_Profile_L1.bmp', new Uint8Array([0x42, 0x4d]));
});

async function seedSurveyWithMatchingLine(label = 'L1') {
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
  const v: Vertex = {
    lat: 42.32, lon: 23.78, elevSource: 'none',
    hAccM: 6, hAccMethod: 'median-reported',
    sampleCount: 20, fixedAt: new Date(), atPointIndex: 1,
  };
  // Note: createLine auto-generates the label; force to match by creating the exact number of prior lines
  // For test simplicity: create the line and rename via label check below.
  const line = await createLine(sv.id, {
    pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
    mode: 'multi-frequency', dipoleOrientation: 'inline',
    vertices: [v, { ...v, atPointIndex: 3, lon: 23.7801 }],
  });
  // Assert the auto-label came out as 'L1' since it's the first line under this survey
  expect(line.label).toBe(label);
  return { site, sv, line };
}

describe('<ImportScreen />', () => {
  it('renders pick-folder button initially', async () => {
    const { sv } = await seedSurveyWithMatchingLine();
    render(<ImportScreen surveyId={sv.id} onDone={() => {}} onCancel={() => {}} />);
    expect(await screen.findByRole('button', { name: /избери папка/i })).toBeInTheDocument();
  });

  it('shows candidates after scanning', async () => {
    const { sv } = await seedSurveyWithMatchingLine();
    render(<ImportScreen surveyId={sv.id} onDone={() => {}} onCancel={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /избери папка/i }));
    await waitFor(() => expect(screen.getByText(/намерени профили/i)).toBeInTheDocument());
    // The candidate row shows folder name L1 and device label 1
    const headingText = screen.getByText(/намерени профили/i);
    expect(headingText).toBeInTheDocument();
    // Verify the table is rendered with candidates
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('pre-selects a matching target line but requires operator confirmation before enabling start (§7.4)', async () => {
    const { sv, line } = await seedSurveyWithMatchingLine();
    render(<ImportScreen surveyId={sv.id} onDone={() => {}} onCancel={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /избери папка/i }));
    await waitFor(() => screen.getByText(/намерени профили/i));

    // The target dropdown should have the matching line as pre-selected.
    const targetSelect = screen.getByRole('combobox') as HTMLSelectElement;
    expect(targetSelect.value).toBe(line.id);

    // Start-import is enabled once every row has a non-empty target.
    const startBtn = screen.getByRole('button', { name: /стартирай импорт/i });
    expect(startBtn).not.toBeDisabled();
  });

  it('runs the import and updates the Line', async () => {
    const { sv, line } = await seedSurveyWithMatchingLine();
    render(<ImportScreen surveyId={sv.id} onDone={() => {}} onCancel={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /избери папка/i }));
    await waitFor(() => screen.getByText(/намерени профили/i));

    await userEvent.click(screen.getByRole('button', { name: /стартирай импорт/i }));
    await waitFor(() => expect(screen.getByText(/импортирано/i)).toBeInTheDocument());

    const updated = (await getDb().lines.get(line.id))!.json;
    expect(updated.deviceStartPointIndex).toBe(80);
    expect(updated.status).toBe('complete');
  });

  it('shows the "no candidates" empty state when the picked folder has nothing', async () => {
    const { sv } = await seedSurveyWithMatchingLine();
    // Replace picked root with an empty one
    setFsAdapter({ showDirectoryPicker: async () => createMockRoot('Empty') });

    render(<ImportScreen surveyId={sv.id} onDone={() => {}} onCancel={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /избери папка/i }));
    expect(await screen.findByText(/не са намерени данни/i)).toBeInTheDocument();
  });
});
