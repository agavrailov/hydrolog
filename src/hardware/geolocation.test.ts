import { describe, it, expect } from 'vitest';
import { setGeolocationAdapter, getGeolocationAdapter } from './geolocation';
import { mockGeolocationAdapter } from '../test/mock-navigator';

describe('geolocation adapter', () => {
  it('delivers pushed fixes to registered watchers', () => {
    const { adapter, pushFix } = mockGeolocationAdapter();
    setGeolocationAdapter(adapter);
    const fixes: unknown[] = [];
    const id = getGeolocationAdapter().watchPosition(
      (f) => fixes.push(f),
      () => {},
    );
    pushFix({ lat: 42.32, lon: 23.78, accuracyM: 6.2 });
    pushFix({ lat: 42.32001, lon: 23.78001, accuracyM: 5.9 });
    expect(fixes).toHaveLength(2);
    getGeolocationAdapter().clearWatch(id);
  });

  it('clearWatch stops delivering fixes', () => {
    const { adapter, pushFix } = mockGeolocationAdapter();
    setGeolocationAdapter(adapter);
    let count = 0;
    const id = getGeolocationAdapter().watchPosition(() => count++, () => {});
    pushFix({});
    getGeolocationAdapter().clearWatch(id);
    pushFix({});
    expect(count).toBe(1);
  });

  it('errors are delivered to onError', () => {
    const { adapter, pushError } = mockGeolocationAdapter();
    setGeolocationAdapter(adapter);
    let errMsg = '';
    getGeolocationAdapter().watchPosition(
      () => {},
      (e) => { errMsg = e.message; },
    );
    pushError('permission denied');
    expect(errMsg).toBe('permission denied');
  });
});
