import { useEffect, useState, useCallback } from 'react';
import { labels } from './labels';
import {
  pickRootFolder, persistRoot, getPersistedRoot, verifyPermission, setRoot,
} from '../storage/fs';
import { scanRoot } from '../storage/scanner';
import { rebuildCache } from '../cache/rebuild';
import { hoursSinceLastSync } from '../storage/sync';
import { Router } from './Router';
import { SyncIndicator } from './SyncIndicator';

export function Home() {
  const [ready, setReady] = useState(false);
  const [hours, setHours] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const loadRoot = useCallback(async (root: FileSystemDirectoryHandle) => {
    setLoading(true);
    try {
      if (!(await verifyPermission(root))) throw new Error('permission denied');
      setRoot(root);
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
      <div className="app-shell">
        <header className="app-header">
          <span className="app-header__title">HydroLog</span>
        </header>
        <main className="app-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-5)' }}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>HydroLog</h1>
            <p style={{ color: 'var(--text-muted)', maxWidth: 280 }}>Изберете работната папка за да продължите</p>
          </div>
          <button className="btn-primary" onClick={onPick} disabled={loading} style={{ maxWidth: 280, width: '100%' }}>
            {loading ? `⟳ ${labels.home.scanning}` : `📂 ${labels.home.pickFolder}`}
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">HydroLog</span>
        <SyncIndicator hoursSinceSync={hours} />
      </header>
      <main className="app-content">
        <Router />
      </main>
    </div>
  );
}
