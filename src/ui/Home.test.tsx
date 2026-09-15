import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Home } from './Home';
import { setFsAdapter, clearPersistedRoot } from '../storage/fs';
import { createMockRoot } from '../test/mock-fs';
import { resetDb } from '../cache/db';
import { buildFixtureRoot, stubChannelSet } from '../test/fixtures';

beforeEach(async () => {
  await clearPersistedRoot();
  await resetDb();
});

describe('<Home />', () => {
  it('shows a Pick folder button when no folder is persisted', async () => {
    render(<Home />);
    expect(await screen.findByRole('button', { name: /избери папка/i })).toBeInTheDocument();
  });

  it('after picking a folder with a site, lists the site', async () => {
    const now = new Date('2026-09-13T10:00:00Z');
    const root = await buildFixtureRoot({
      sites: [{
        folderName: 'BG-SOF-0043_x',
        site: {
          id: 'S1', code: 'BG-SOF-0043',
          createdAt: now, updatedAt: now, revision: 1,
          name: 'Ivanov', settlement: 'Долна Баня',
          municipality: 'Долна Баня', region: 'Софийска',
          centroid: { lat: 42.3, lon: 23.7 }, accessNotes: '', landUse: '',
          status: 'surveyed', tags: [],
        },
        surveys: [{
          folderName: 's01',
          survey: {
            id: 'V1', siteId: 'S1', createdAt: now, updatedAt: now, revision: 1,
            startedAt: now, timezone: 'Europe/Sofia', operator: 'Anton',
            deviceModel: 'PQWT-TC300', deviceSerial: 'x',
            precipLast48h: 'none', qualityFlag: 'good',
          },
          lines: [{
            folderName: 'L1',
            line: {
              id: 'L1', createdAt: now, updatedAt: now, revision: 1,
              label: 'L1', pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
              mode: 'multi-frequency', channelSetSnapshot: stubChannelSet(),
              vertices: [], dipoleOrientation: 'inline', transformLog: [],
              points: [], noiseZones: [], status: 'draft',
            },
          }],
        }],
      }],
    });
    setFsAdapter({ showDirectoryPicker: async () => root });

    render(<Home />);
    const pick = await screen.findByRole('button', { name: /избери папка/i });
    await userEvent.click(pick);

    await waitFor(() => {
      expect(screen.getByText('BG-SOF-0043')).toBeInTheDocument();
    });
  });

  it('renders the sync indicator with a nag level', async () => {
    const root = createMockRoot();
    setFsAdapter({ showDirectoryPicker: async () => root });
    render(<Home />);
    const pick = await screen.findByRole('button', { name: /избери папка/i });
    await userEvent.click(pick);
    await waitFor(() => {
      expect(screen.getByTestId('sync-indicator')).toHaveAttribute('data-nag', 'red');
    });
  });
});
