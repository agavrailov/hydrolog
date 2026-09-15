import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { resetDb } from '../cache/db';
import { createSite } from '../domain/site-service';
import { SiteList } from './SiteList';

beforeEach(async () => {
  await resetDb();
  clearRoot();
  setRoot(createMockRoot());
});

describe('<SiteList />', () => {
  it('renders all sites and calls onOpen when clicked', async () => {
    const a = await createSite({
      name: 'Ivanov', settlement: 'Долна Баня', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    await createSite({
      name: 'Petrov', settlement: 'Костенец', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });

    const onOpen = vi.fn();
    render(<SiteList onOpen={onOpen} />);

    expect(await screen.findByText(/Ivanov/)).toBeInTheDocument();
    expect(screen.getByText(/Petrov/)).toBeInTheDocument();

    await userEvent.click(screen.getByText(/Ivanov/));
    expect(onOpen).toHaveBeenCalledWith(a.id);
  });

  it('filters by search query (case-insensitive)', async () => {
    await createSite({
      name: 'Ivanov', settlement: 'Долна Баня', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    await createSite({
      name: 'Petrov', settlement: 'Костенец', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });

    render(<SiteList onOpen={() => {}} />);
    await screen.findByText(/Ivanov/);

    await userEvent.type(screen.getByRole('searchbox'), 'костен');
    expect(await screen.findByText(/Petrov/)).toBeInTheDocument();
    expect(screen.queryByText(/Ivanov/)).not.toBeInTheDocument();
  });

  it('shows empty state when no sites match', async () => {
    render(<SiteList onOpen={() => {}} />);
    expect(await screen.findByText(/няма обекти/i)).toBeInTheDocument();
  });
});
