import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { resetDb, getDb } from '../cache/db';
import { SiteForm } from './SiteForm';
import { createSite } from '../domain/site-service';

beforeEach(async () => {
  await resetDb();
  clearRoot();
  setRoot(createMockRoot());
});

describe('<SiteForm mode="create">', () => {
  it('submits and calls onSaved with the new Site', async () => {
    const onSaved = vi.fn();
    render(<SiteForm mode="create" onSaved={onSaved} onCancel={() => {}} />);

    await userEvent.type(screen.getByLabelText(/име/i), 'Ivanov');
    await userEvent.type(screen.getByLabelText(/населено място/i), 'Долна Баня');
    await userEvent.type(screen.getByLabelText(/община/i), 'Долна Баня');
    await userEvent.type(screen.getByLabelText(/област/i), 'Софийска');
    await userEvent.type(screen.getByLabelText(/ширина/i), '42.32');
    await userEvent.type(screen.getByLabelText(/дължина/i), '23.78');

    await userEvent.click(screen.getByRole('button', { name: /запази/i }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const site = onSaved.mock.calls[0][0];
    expect(site.code).toBe('BG-SOF-0001');
    expect(site.name).toBe('Ivanov');
    expect(await getDb().sites.count()).toBe(1);
  });

  it('surfaces service errors in a role=alert region', async () => {
    // Force an error by not setting root
    clearRoot();
    render(<SiteForm mode="create" onSaved={() => {}} onCancel={() => {}} />);

    await userEvent.type(screen.getByLabelText(/име/i), 'X');
    await userEvent.type(screen.getByLabelText(/населено място/i), 'Долна Баня');
    await userEvent.type(screen.getByLabelText(/община/i), 'Долна Баня');
    await userEvent.type(screen.getByLabelText(/област/i), 'Софийска');
    await userEvent.type(screen.getByLabelText(/ширина/i), '0');
    await userEvent.type(screen.getByLabelText(/дължина/i), '0');
    await userEvent.click(screen.getByRole('button', { name: /запази/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/root folder/i);
  });
});

describe('<SiteForm mode="edit">', () => {
  it('pre-fills fields and updates on save', async () => {
    const site = await createSite({
      name: 'Ivanov', settlement: 'Долна Баня', municipality: 'Долна Баня',
      region: 'Софийска', centroid: { lat: 42.32, lon: 23.78 },
      accessNotes: '', landUse: '', status: 'surveyed', tags: [],
    });
    const row = (await getDb().sites.get(site.id))!;
    const onSaved = vi.fn();
    render(<SiteForm mode="edit" siteRow={row} onSaved={onSaved} onCancel={() => {}} />);

    const notes = screen.getByLabelText(/достъп/i);
    await userEvent.type(notes, 'портата е от север');
    await userEvent.click(screen.getByRole('button', { name: /запази/i }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const updated = onSaved.mock.calls[0][0];
    expect(updated.revision).toBe(2);
    expect(updated.accessNotes).toBe('портата е от север');
  });
});
