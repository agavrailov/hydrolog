import { useEffect, useState, useCallback } from 'react';
import {
  pickRootFolder, persistRoot, getPersistedRoot, verifyPermission,
} from '../storage/fs';
import { scanRoot } from '../storage/scanner';
import { rebuildCache } from '../cache/rebuild';
import { hoursSinceLastSync } from '../storage/sync';
import { SiteList } from './SiteList';
import { SyncIndicator } from './SyncIndicator';

export function Home() {
  const [ready, setReady] = useState(false);
  const [hours, setHours] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const loadRoot = useCallback(async (root: FileSystemDirectoryHandle) => {
    setLoading(true);
    try {
      if (!(await verifyPermission(root))) throw new Error('permission denied');
      const scan = await scanRoot(root);
      await rebuildCache(scan);
      setHours(await hoursSinceLastSync(root, new Date()));
      setReady(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const persisted = await getPersistedRoot();
      if (persisted) await loadRoot(persisted);
    })();
  }, [loadRoot]);

  const onPick = async () => {
    const root = await pickRootFolder();
    await persistRoot(root);
    await loadRoot(root);
  };

  if (!ready) {
    return (
      <main style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
        <h1>HydroLog</h1>
        <button onClick={onPick} disabled={loading}>
          {loading ? 'Scanning…' : 'Pick folder'}
        </button>
      </main>
    );
  }

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>HydroLog</h1>
        <SyncIndicator hoursSinceSync={hours} />
      </header>
      <section>
        <h2>Sites</h2>
        <SiteList onOpen={() => {}} />
      </section>
    </main>
  );
}
