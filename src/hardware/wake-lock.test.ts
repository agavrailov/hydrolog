import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setWakeLockAdapter, getWakeLockAdapter, holdWakeLock } from './wake-lock';
import { mockWakeLockAdapter } from '../test/mock-navigator';

let mock: ReturnType<typeof mockWakeLockAdapter>;

beforeEach(() => {
  mock = mockWakeLockAdapter();
  setWakeLockAdapter(mock.adapter);
});

afterEach(() => {
  // Reset visibility state so tests don't pollute each other
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('holdWakeLock', () => {
  it('acquires a sentinel and returns a release function', async () => {
    const release = await holdWakeLock();
    expect(mock.sentinels).toHaveLength(1);
    await release();
    expect(mock.sentinels[0].released).toBe(true);
  });

  it('re-acquires on visibilitychange after being auto-released', async () => {
    const release = await holdWakeLock();
    expect(mock.sentinels).toHaveLength(1);

    // Simulate Android hiding the document then showing again
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    // Simulate the OS auto-releasing the first sentinel
    mock.sentinels[0].released = true;

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // Give the microtask queue a tick for the async re-acquire
    await new Promise((r) => setTimeout(r, 0));
    expect(mock.sentinels.length).toBeGreaterThanOrEqual(2);

    await release();
  });

  it('release stops the re-acquire loop', async () => {
    const release = await holdWakeLock();
    await release();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 0));

    // Only the initial sentinel exists — no re-acquire after release
    expect(mock.sentinels).toHaveLength(1);
  });
});

describe('adapter injection', () => {
  it('getWakeLockAdapter returns whatever was set', () => {
    const a = mockWakeLockAdapter().adapter;
    setWakeLockAdapter(a);
    expect(getWakeLockAdapter()).toBe(a);
  });
});
