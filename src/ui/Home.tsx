import { useEffect, useState, useCallback, useRef } from 'react';
import { labels } from './labels';
import {
  pickRootFolder, persistRoot, getPersistedRoot, verifyPermission, hasPermission,
  setRoot, clearPersistedRoot, clearRoot,
} from '../storage/fs';
import { scanRoot } from '../storage/scanner';
import { rebuildCache, hasWarmCache } from '../cache/rebuild';
import { hoursSinceLastSync, writeSyncProbe } from '../storage/sync';
import { useLocation } from 'wouter';
import { Router } from './Router';
import { AppDrawer } from './AppDrawer';

const HamburgerIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
    <rect y="2" width="18" height="2" rx="1"/>
    <rect y="8" width="18" height="2" rx="1"/>
    <rect y="14" width="18" height="2" rx="1"/>
  </svg>
);

export function Home() {
  const [booting, setBooting] = useState(true);
  const [ready, setReady] = useState(false);
  const [hours, setHours] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savedHandle, setSavedHandle] = useState<FileSystemDirectoryHandle | null>(null);
  // Cache-first mode: UI is shown from IndexedDB while the folder is
  // re-scanned in the background (or waits for the user to grant access).
  const [syncing, setSyncing] = useState(false);
  const [needsAccess, setNeedsAccess] = useState<FileSystemDirectoryHandle | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const booted = useRef(false);
  const [, setLocation] = useLocation();

  /** Scan folder → refresh cache → sync probe. Assumes permission is granted. */
  const syncFolder = useCallback(async (root: FileSystemDirectoryHandle) => {
    setRoot(root);
    const scan = await scanRoot(root);
    await rebuildCache(scan);
    const now = new Date();
    await writeSyncProbe(root, now);
    setHours(await hoursSinceLastSync(root, now));
  }, []);

  /** Blocking load — first run / no cache yet. */
  const loadRoot = useCallback(async (root: FileSystemDirectoryHandle) => {
    setLoading(true);
    setError(null);
    try {
      if (!(await verifyPermission(root))) throw new Error('Достъпът до папката е отказан');
      await syncFolder(root);
      setSavedHandle(null);
      setNeedsAccess(null);
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [syncFolder]);

  /** Non-blocking refresh — UI already rendered from cache. */
  const backgroundSync = useCallback(async (root: FileSystemDirectoryHandle) => {
    setSyncing(true);
    setSyncError(null);
    try {
      await syncFolder(root);
      setNeedsAccess(null);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [syncFolder]);

  useEffect(() => {
    if (booted.current) return;  // StrictMode runs effects twice in dev
    booted.current = true;
    (async () => {
      const persisted = await getPersistedRoot();
      if (!persisted) { setBooting(false); return; }

      const warm = await hasWarmCache();
      if (warm) {
        // Show the app immediately from the local cache.
        setReady(true);
        setBooting(false);
        if (await hasPermission(persisted)) {
          void backgroundSync(persisted);
          return;
        }
        // Chrome Android M132+ may allow the prompt without a gesture.
        try {
          // @ts-expect-error requestPermission exists on real handles
          const r = await persisted.requestPermission?.({ mode: 'readwrite' });
          if (r === 'granted') { void backgroundSync(persisted); return; }
        } catch { /* needs user gesture — fall through to the banner */ }
        setNeedsAccess(persisted);
        return;
      }

      // No cache yet — original blocking flow.
      setBooting(false);
      if (await hasPermission(persisted)) {
        await loadRoot(persisted);
        return;
      }
      try {
        // @ts-expect-error requestPermission exists on real handles
        const result = await persisted.requestPermission?.({ mode: 'readwrite' });
        if (result === 'granted') await loadRoot(persisted);
        else setSavedHandle(persisted);
      } catch {
        setSavedHandle(persisted);
      }
    })();
  }, [loadRoot, backgroundSync]);

  const onGrantAccess = async () => {
    if (!needsAccess) return;
    if (await verifyPermission(needsAccess)) await backgroundSync(needsAccess);
    else setSyncError('Достъпът до папката е отказан');
  };

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

  if (booting) {
    return <div className="app-shell" />;
  }

  if (!ready) {
    return (
      <div className="app-shell">
        <header className="app-header">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-primary)' }}>HydroLog</span>
          <button className="btn-ghost" onClick={() => setDrawerOpen(true)} aria-label="Меню" style={{ padding: '4px 6px' }}>
            <HamburgerIcon />
          </button>
        </header>
        <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} hoursSinceSync={hours} onChangeFolder={() => {}} onNavigateHome={() => setLocation('/')} />
        <main className="app-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-5)' }}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>HydroLog</h1>
            <p style={{ color: 'var(--text-muted)', maxWidth: 280 }}>
              {savedHandle ? savedHandle.name : 'Изберете работната папка за да продължите'}
            </p>
            {error && (
              <p style={{ color: 'var(--color-error, #f87171)', maxWidth: 280, marginTop: 8, fontSize: '0.85rem' }}>
                ⚠ {error}
              </p>
            )}
          </div>
          {savedHandle ? (
            <>
              <button className="btn-primary" onClick={onResume} disabled={loading} style={{ maxWidth: 280, width: '100%' }}>
                {loading ? `⟳ ${labels.home.scanning}` : `▶ Продължи`}
              </button>
              <button className="btn-secondary" onClick={onPick} disabled={loading} style={{ maxWidth: 280, width: '100%', opacity: 0.7 }}>
                📂 Избери друга папка
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
    setNeedsAccess(null);
    setSyncError(null);
    setReady(false);
    setError(null);
    setHours(null);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          onClick={() => setLocation('/')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-mono)', fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-primary)' }}
        >
          HydroLog
        </button>
        <span style={{ marginLeft: 'auto', marginRight: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
          {syncing && (
            <span data-testid="bg-sync" style={{ color: 'var(--text-muted)' }}>⟳ {labels.home.scanning}</span>
          )}
          {!syncing && needsAccess && (
            <button className="btn-secondary" onClick={onGrantAccess} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
              🔓 Разреши достъп
            </button>
          )}
          {!syncing && syncError && (
            <span title={syncError} style={{ color: 'var(--color-error, #f87171)' }}>⚠</span>
          )}
        </span>
        <button className="btn-ghost" onClick={() => setDrawerOpen(true)} aria-label="Меню" style={{ padding: '4px 6px' }}>
          <HamburgerIcon />
        </button>
      </header>
      <main className="app-content">
        <Router />
      </main>
      <AppDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        hoursSinceSync={hours}
        onChangeFolder={onChangeFolder}
        onNavigateHome={() => setLocation('/')}
      />
    </div>
  );
}
