import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDb } from '../cache/db';
import { rebuildCache } from '../cache/rebuild';
import { scanRoot } from '../storage/scanner';
import { buildFixtureRoot, stubChannelSet } from '../test/fixtures';

// A persisted handle survives restarts in IndexedDB, but structured clone
// strips the mock's methods — so inject it directly.
let persisted: FileSystemDirectoryHandle | null = null;
vi.mock('../storage/fs', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../storage/fs')>();
  return { ...orig, getPersistedRoot: async () => persisted };
});

const { Home } = await import('./Home');

async function fixtureRoot() {
  const now = new Date('2026-09-13T10:00:00Z');
  return buildFixtureRoot({
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
            label: 'L1', pointCount: 17, spacingM: 2,
            mode: 'multi-frequency', channelSetSnapshot: stubChannelSet(),
            vertices: [], dipoleOrientation: 'inline', transformLog: [],
            points: [], noiseZones: [], status: 'draft',
          },
        }],
      }],
    }],
  });
}

beforeEach(async () => {
  persisted = null;
  await resetDb();
});

describe('<Home /> cache-first startup', () => {
  it('shows cached sites immediately and offers a grant button when permission needs a gesture', async () => {
    const root = await fixtureRoot();
    await rebuildCache(await scanRoot(root));  // previous session's cache

    let granted = false;
    const r = root as any;
    r.queryPermission = async () => (granted ? 'granted' : 'prompt');
    let gesture = false;
    r.requestPermission = async () => {
      if (!gesture) throw new DOMException('needs user activation', 'SecurityError');
      granted = true;
      return 'granted';
    };
    persisted = root;

    render(<Home />);
    // No picker, no blocking scan — the list renders from cache.
    expect(await screen.findByText('BG-SOF-0043')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /избери папка/i })).not.toBeInTheDocument();

    const grant = await screen.findByRole('button', { name: /разреши достъп/i });
    gesture = true;
    await userEvent.click(grant);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /разреши достъп/i })).not.toBeInTheDocument();
      expect(screen.queryByTestId('bg-sync')).not.toBeInTheDocument();
    });
    expect(screen.getByText('BG-SOF-0043')).toBeInTheDocument();
  });

  it('with permission already granted, renders from cache and refreshes in the background', async () => {
    const root = await fixtureRoot();
    await rebuildCache({ schemaVersion: 'x', startedAt: new Date(), sites: [] });  // stale but warm cache
    persisted = root;

    render(<Home />);
    // Background scan picks up the site that the stale cache did not have.
    expect(await screen.findByText('BG-SOF-0043')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /разреши достъп/i })).not.toBeInTheDocument();
  });
});
