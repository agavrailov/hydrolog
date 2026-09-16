import { useState } from 'react';

export function useLastUsed<T>(key: string, defaultValue: T): [T, (v: T) => void] {
  const storageKey = `hydrolog.lastUsed.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw !== null ? (JSON.parse(raw) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const set = (v: T) => {
    setValue(v);
    try { localStorage.setItem(storageKey, JSON.stringify(v)); } catch {}
  };

  return [value, set];
}
