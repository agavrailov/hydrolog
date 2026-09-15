import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { createSite } from '../domain/site-service';
import { createSurvey, finalizeSurvey } from '../domain/survey-service';
import { writeSyncProbe } from '../storage/sync';
import { SurveyForm } from './SurveyForm';

let root: FileSystemDirectoryHandle;
beforeEach(async () => {
  await resetDb();
  clearRoot();
  root = createMockRoot();
  setRoot(root);
});

async function makeSite() {
  return createSite({
    name: 'S', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
}

describe('<SurveyForm mode="create">', () => {
  it('creates a survey under the given site', async () => {
    const site = await makeSite();
    const onSaved = vi.fn();
    render(<SurveyForm mode="create" siteId={site.id} onSaved={onSaved} onCancel={() => {}} />);

    await userEvent.clear(screen.getByLabelText(/начало/i));
    await userEvent.type(screen.getByLabelText(/начало/i), '2026-09-15T10:00');
    await userEvent.type(screen.getByLabelText(/оператор/i), 'Anton');
    await userEvent.type(screen.getByLabelText(/уред \(модел\)/i), 'PQWT-TC300');
    await userEvent.type(screen.getByLabelText(/сериен номер/i), 'SN1');
    await userEvent.click(screen.getByRole('button', { name: /запази/i }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const sv = onSaved.mock.calls[0][0];
    expect(sv.operator).toBe('Anton');
    expect(await getDb().surveys.count()).toBe(1);
  });
});

describe('<SurveyForm mode="edit">', () => {
  it('requires an edit reason when the survey is finalized', async () => {
    const site = await makeSite();
    const sv = await createSurvey(site.id, {
      startedAt: new Date(Date.now() - 3600_000),
      timezone: 'Europe/Sofia', operator: 'Anton',
      deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });
    await writeSyncProbe(root, new Date());
    await finalizeSurvey(sv.id);
    const row = (await getDb().surveys.get(sv.id))!;

    const onSaved = vi.fn();
    render(<SurveyForm mode="edit" surveyRow={row} onSaved={onSaved} onCancel={() => {}} />);

    // Reason textarea must be visible for a finalized survey
    expect(screen.getByLabelText(/причина за промяната/i)).toBeInTheDocument();

    // Submit without reason: expect a client-side alert
    await userEvent.click(screen.getByRole('button', { name: /запази/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/посочи причина/i);
    expect(onSaved).not.toHaveBeenCalled();

    // Fill reason and submit
    await userEvent.type(screen.getByLabelText(/причина за промяната/i), 'typo fix');
    await userEvent.click(screen.getByRole('button', { name: /запази/i }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
