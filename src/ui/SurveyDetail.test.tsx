import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { resetDb } from '../cache/db';
import { createSite } from '../domain/site-service';
import { createSurvey } from '../domain/survey-service';
import { writeSyncProbe } from '../storage/sync';
import { SurveyDetail } from './SurveyDetail';
import { importPqwtAsNewLine } from '../domain/pqwt-import-service';
import { PQWT_L1_MINIMAL_CSV } from '../test/fixtures-pqwt';

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
    render(<SurveyDetail surveyId={sv.id} onEdit={() => {}} onImport={() => {}} onOpenLine={() => {}} />);
    expect(await screen.findByText('Anton')).toBeInTheDocument();
    expect(screen.getByText(/профили/i)).toBeInTheDocument();
  });

  it('points to import when there are no lines', async () => {
    const { sv } = await seed();
    render(<SurveyDetail surveyId={sv.id} onEdit={() => {}} onImport={() => {}} onOpenLine={() => {}} />);
    expect(await screen.findByText('Няма профили. Импортирай ги от устройството.')).toBeInTheDocument();
  });

  it('reads only the thumbnail for a line card, the rest when it is enlarged', async () => {
    const { sv } = await seed();
    await importPqwtAsNewLine({ surveyId: sv.id, candidate: {
      folderName: 'L1', depthRangeM: 150, deviceLineLabel: '1',
      csvText: PQWT_L1_MINIMAL_CSV, csvFile: new File([PQWT_L1_MINIMAL_CSV], '150M_L1.csv'),
      rawBmp: new File([new Uint8Array([1])], '150M_Profile_L1.png'),
      processedBmp: new File([new Uint8Array([2])], '150M_Profile_L1_Processed.png'),
    } });
    const proto = Object.getPrototypeOf(root);
    const orig = proto.getFileHandle;
    const read: string[] = [];
    proto.getFileHandle = function (name: string, ...rest: any[]) { read.push(name); return orig.call(this, name, ...rest); };
    try {
      const { container } = render(
        <SurveyDetail surveyId={sv.id} onEdit={() => {}} onImport={() => {}} onOpenLine={() => {}} />,
      );
      await waitFor(() => expect(container.querySelector('.line-card img')).not.toBeNull());
      await new Promise((r) => setTimeout(r, 50));
      expect(read.filter((n) => n.endsWith('.png'))).toEqual(['150M_Profile_L1.png']);

      await userEvent.click(screen.getByTitle('Виж на цял екран'));
      expect(await screen.findByAltText('L1 – снимка 1')).toBeInTheDocument();
    } finally { proto.getFileHandle = orig; }
  });

  it('finalize button succeeds when the sync probe is fresh', async () => {
    const { sv } = await seed();
    await writeSyncProbe(root, new Date());

    render(<SurveyDetail surveyId={sv.id} onEdit={() => {}} onImport={() => {}} onOpenLine={() => {}} />);
    await screen.findByText('Anton');
    await userEvent.click(screen.getByRole('button', { name: /заключи/i }));

    await screen.findByText(/заключено/i);
  });

  it('finalize surfaces the §10.9 backup error when the probe is missing', async () => {
    const { sv } = await seed();
    // No probe written
    render(<SurveyDetail surveyId={sv.id} onEdit={() => {}} onImport={() => {}} onOpenLine={() => {}} />);
    await screen.findByText('Anton');
    await userEvent.click(screen.getByRole('button', { name: /заключи/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/backup|синхрон/i);
  });
});
