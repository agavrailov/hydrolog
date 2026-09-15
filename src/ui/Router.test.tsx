import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router as WRouter } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { resetDb } from '../cache/db';
import { createSite } from '../domain/site-service';
import { Router } from './Router';

beforeEach(async () => {
  await resetDb();
  clearRoot();
  setRoot(createMockRoot());
});

function renderAt(path: string) {
  const { hook } = memoryLocation({ path });
  return render(
    <WRouter hook={hook}>
      <Router />
    </WRouter>,
  );
}

describe('<Router />', () => {
  it('renders SiteList at "/"', async () => {
    renderAt('/');
    expect(await screen.findByRole('searchbox')).toBeInTheDocument();
  });

  it('renders SiteForm create at "/sites/new"', async () => {
    renderAt('/sites/new');
    expect(await screen.findByText(/нов обект/i)).toBeInTheDocument();
  });

  it('renders SiteDetail at "/sites/:id"', async () => {
    const site = await createSite({
      name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    renderAt(`/sites/${site.id}`);
    expect(await screen.findByText('X')).toBeInTheDocument();
    expect(screen.getByText(site.code)).toBeInTheDocument();
  });

  it('navigates from list to detail via click', async () => {
    const site = await createSite({
      name: 'Ivanov', settlement: 'x', municipality: 'x', region: 'Софийска',
      centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
      status: 'surveyed', tags: [],
    });
    renderAt('/');
    await screen.findByText(/Ivanov/);
    await userEvent.click(screen.getByText(/Ivanov/));
    expect(await screen.findByText('Ivanov', { selector: 'h1' })).toBeInTheDocument();
    expect(screen.getByText(site.code)).toBeInTheDocument();
  });

  it('renders a 404 for unknown paths', () => {
    renderAt('/nope');
    expect(screen.getByText(/не е намерено/i)).toBeInTheDocument();
  });
});
