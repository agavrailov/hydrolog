import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { createSite } from '../domain/site-service';
import { createSurvey } from '../domain/survey-service';
import { SiteDetail } from './SiteDetail';

beforeEach(async () => {
  await resetDb();
  clearRoot();
  setRoot(createMockRoot());
});

describe('<SiteDetail />', () => {
  it('renders the site fields and its surveys', async () => {
    const site = await createSite({
      name: 'Ivanov', settlement: 'Долна Баня', municipality: 'Долна Баня',
      region: 'Софийска', centroid: { lat: 42.32, lon: 23.78 },
      accessNotes: '', landUse: '', status: 'surveyed', tags: [],
    });
    await createSurvey(site.id, {
      startedAt: new Date('2026-09-15T10:00:00Z'),
      timezone: 'Europe/Sofia', operator: 'Anton',
      deviceModel: 'PQWT-TC300', deviceSerial: 'x',
      precipLast48h: 'none', qualityFlag: 'good',
    });

    render(<SiteDetail
      siteId={site.id}
      onBack={() => {}}
      onEdit={() => {}}
      onDeleted={() => {}}
      onNewSurvey={() => {}}
      onOpenSurvey={() => {}}
    />);

    expect(await screen.findByText('Ivanov')).toBeInTheDocument();
    expect(screen.getByText('BG-SOF-0001')).toBeInTheDocument();
    // The survey list shows the surveyed operator
    expect(await screen.findByText(/Anton/)).toBeInTheDocument();
  });

  it('soft-deletes and calls onDeleted', async () => {
    const site = await createSite({
      name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    const onDeleted = vi.fn();
    render(<SiteDetail
      siteId={site.id}
      onBack={() => {}}
      onEdit={() => {}}
      onDeleted={onDeleted}
      onNewSurvey={() => {}}
      onOpenSurvey={() => {}}
    />);

    // Confirm dialog via window.confirm — stub it to true
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await screen.findByText('X');
    await userEvent.click(screen.getByRole('button', { name: /изтрий/i }));
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(await getDb().sites.count()).toBe(0);
  });

  it('shows "no surveys" empty state when there are none', async () => {
    const site = await createSite({
      name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    render(<SiteDetail
      siteId={site.id}
      onBack={() => {}}
      onEdit={() => {}}
      onDeleted={() => {}}
      onNewSurvey={() => {}}
      onOpenSurvey={() => {}}
    />);
    expect(await screen.findByText(/няма проучвания/i)).toBeInTheDocument();
  });
});
