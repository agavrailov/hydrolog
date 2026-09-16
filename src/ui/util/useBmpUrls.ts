import { useState, useEffect } from 'react';
import { getPath } from '../../storage/paths';
import { readBlob } from '../../storage/atomic';
import { getRoot } from '../../storage/fs';

export function useBmpUrls(storagePaths: string[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  const key = storagePaths.join('|');

  useEffect(() => {
    if (storagePaths.length === 0) {
      setUrls([]);
      return;
    }
    let revoked = false;
    const created: string[] = [];

    (async () => {
      try {
        const root = getRoot();
        const loaded: string[] = [];
        for (const sp of storagePaths) {
          const parts = sp.split('/');
          const fileName = parts.pop()!;
          const dir = await getPath(root, parts);
          if (!dir) continue;
          const blob = await readBlob(dir, fileName);
          const url = URL.createObjectURL(blob);
          created.push(url);
          loaded.push(url);
        }
        if (!revoked) setUrls(loaded);
      } catch {
        // root not set or file missing — show nothing
      }
    })();

    return () => {
      revoked = true;
      for (const u of created) URL.revokeObjectURL(u);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return urls;
}
