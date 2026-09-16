import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { resetDb } from '../cache/db';
import { createSite } from '../domain/site-service';
import { createSurvey } from '../domain/survey-service';
import { writeSyncProbe } from '../storage/sync';
import { SurveyDetail } from './SurveyDetail';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

async function seed() {
  const site = await createSite({
    name: 'S', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
  const sv = await createSurvey(site.id, {
    startedAt: new Date(Date.now() - 3600_000),
    timezone: 'Europe/Sofia', operator: 'Anton',
    deviceModel: 'PQWT-TC300', deviceSerial: 'x',
    precipLast48h: 'none', qualityFlag: 'good',
  });
  return { site, sv };
}

describe('<SurveyDetail />', () => {
  it('renders survey fields and the lines heading', async () => {
    const { sv } = await seed();
    render(<SurveyDetail surveyId={sv.id} onEdit={() => {}} onBack={() => {}} onNewLine={() => {}} onImport={() => {}} />);
    expect(await screen.findByText('Anton')).toBeInTheDocument();
    expect(screen.getByText(/профили/i)).toBeInTheDocument();
  });

  it('finalize button succeeds when the sync probe is fresh', async () => {
    const { sv } = await seed();
    await writeSyncProbe(root, new Date());

    render(<SurveyDetail surveyId={sv.id} onEdit={() => {}} onBack={() => {}} onNewLine={() => {}} onImport={() => {}} />);
    await screen.findByText('Anton');
    await userEvent.click(screen.getByRole('button', { name: /заключи/i }));

    await screen.findByText(/заключено/i);
  });

  it('finalize surfaces the §10.9 backup error when the probe is missing', async () => {
    const { sv } = await seed();
    // No probe written
    render(<SurveyDetail surveyId={sv.id} onEdit={() => {}} onBack={() => {}} onNewLine={() => {}} onImport={() => {}} />);
    await screen.findByText('Anton');
    await userEvent.click(screen.getByRole('button', { name: /заключи/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/backup|синхрон/i);
  });
});
