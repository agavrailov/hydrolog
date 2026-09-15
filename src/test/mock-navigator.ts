import type { WakeLockAdapter, WakeLockSentinel } from '../hardware/wake-lock';

export function mockWakeLockAdapter(): { adapter: WakeLockAdapter; sentinels: WakeLockSentinel[] } {
  const sentinels: WakeLockSentinel[] = [];
  const adapter: WakeLockAdapter = {
    async request(_type) {
      let released = false;
      const s: WakeLockSentinel = {
        released: false,
        async release() {
          released = true;
          s.released = true;
        },
      };
      // Expose the closure's flag so tests can inspect
      Object.defineProperty(s, '_released', { get: () => released });
      sentinels.push(s);
      return s;
    },
  };
  return { adapter, sentinels };
}
