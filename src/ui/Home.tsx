import { useEffect, useState, useCallback } from 'react';
import { labels } from './labels';
import {
  pickRootFolder, persistRoot, getPersistedRoot, verifyPermission, setRoot, clearPersistedRoot, clearRoot,
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
  const [error, setError] = useState<string | null>(null);
  const [savedHandle, setSavedHandle] = useState<FileSystemDirectoryHandle | null>(null);

  const loadRoot = useCallback(async (root: FileSystemDirectoryHandle) => {
    setLoading(true);
    setError(null);
    try {
      if (!(await verifyPermission(root))) throw new Error('Достъпът до папката е отказан');
      setRoot(root);
      const scan = await scanRoot(root);
      await rebuildCache(scan);
      setHours(await hoursSinceLastSync(root, new Date()));
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const persisted = await getPersistedRoot();
      if (!persisted) return;
      // @ts-expect-error queryPermission exists on real handles
      const perm = await persisted.queryPermission?.({ mode: 'readwrite' });
      if (perm === 'granted') {
        await loadRoot(persisted);
      } else {
        setSavedHandle(persisted);
      }
    })();
  }, [loadRoot]);

  const onResume = async () => {
    if (!savedHandle) return;
    await loadRoot(savedHandle);
  };

  const onPick = async () => {
    const root = await pickRootFolder();
    await persistRoot(root);
    setSavedHandle(null);
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
            {savedHandle ? (
              <p style={{ color: 'var(--text-muted)', maxWidth: 280 }}>
                {savedHandle.name}
              </p>
            ) : (
              <p style={{ color: 'var(--text-muted)', maxWidth: 280 }}>Изберете работната папка за да продължите</p>
            )}
            {error && (
              <p style={{ color: 'var(--color-error, #f87171)', maxWidth: 280, marginTop: 8, fontSize: '0.85rem' }}>
                ⚠ {error}
              </p>
            )}
          </div>
          {savedHandle ? (
            <>
              <button className="btn-primary" onClick={onResume} disabled={loading} style={{ maxWidth: 280, width: '100%' }}>
                {loading ? `⟳ ${labels.home.scanning}` : `📂 Продължи`}
              </button>
              <button className="btn-secondary" onClick={onPick} disabled={loading} style={{ maxWidth: 280, width: '100%', opacity: 0.7 }}>
                Избери друга папка
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={onPick} disabled={loading} style={{ maxWidth: 280, width: '100%' }}>
              {loading ? `⟳ ${labels.home.scanning}` : `📂 ${labels.home.pickFolder}`}
            </button>
          )}
        </main>
      </div>
    );
  }

  const onChangeFolder = async () => {
    await clearPersistedRoot();
    clearRoot();
    setReady(false);
    setSavedHandle(null);
    setError(null);
    setHours(null);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">HydroLog</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <SyncIndicator hoursSinceSync={hours} />
          <button
            className="btn-ghost"
            onClick={onChangeFolder}
            style={{ fontSize: '0.8rem', padding: '2px 8px' }}
            title="Смяна на работна папка"
          >
            📂 Смяна
          </button>
        </div>
      </header>
      <main className="app-content">
        <Router />
      </main>
    </div>
  );
}
