export interface WakeLockSentinel {
  release(): Promise<void>;
  released: boolean;
}

export interface WakeLockAdapter {
  request(type: 'screen'): Promise<WakeLockSentinel>;
}

export const defaultWakeLockAdapter: WakeLockAdapter = {
  async request(type) {
    const wl = (globalThis as unknown as { navigator?: { wakeLock?: { request: (t: string) => Promise<WakeLockSentinel> } } }).navigator?.wakeLock;
    if (!wl) {
      throw new Error('Wake Lock API not available. Use Chrome desktop or Android M132+.');
    }
    return wl.request(type);
  },
};

let adapter: WakeLockAdapter = defaultWakeLockAdapter;

export function setWakeLockAdapter(a: WakeLockAdapter): void {
  adapter = a;
}

export function getWakeLockAdapter(): WakeLockAdapter {
  return adapter;
}

// Acquires a screen wake lock and re-acquires it on visibilitychange (Android
// auto-releases when the document hides). Returns a release function that
// stops the re-acquire loop and releases the current sentinel.
export async function holdWakeLock(): Promise<() => Promise<void>> {
  let stopped = false;
  let current: WakeLockSentinel | null = await adapter.request('screen');

  const reacquire = async () => {
    if (stopped) return;
    if (document.visibilityState !== 'visible') return;
    if (current && !current.released) return;
    try {
      current = await adapter.request('screen');
    } catch {
      // Best-effort; UI shows a "keep screen on" message elsewhere.
    }
  };

  const onVisibility = () => { void reacquire(); };
  document.addEventListener('visibilitychange', onVisibility);

  return async () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisibility);
    if (current && !current.released) {
      try { await current.release(); } catch { /* ignore */ }
    }
  };
}
