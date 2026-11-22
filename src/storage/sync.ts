import { writeJson, readJson } from './atomic';
import { getOrCreatePath, getPath } from './paths';
import { formatFolderTimestamp } from '../util/time';

const PROBE_DIR = '_sync_probe';

interface ProbeRecord {
  writtenAt: string;   // ISO 8601
}

export async function writeSyncProbe(
  root: FileSystemDirectoryHandle,
  now: Date,
): Promise<string> {
  const dir = await getOrCreatePath(root, [PROBE_DIR]);
  const name = `${formatFolderTimestamp(now)}.json`;
  await writeJson(dir, name, { writtenAt: now.toISOString() } satisfies ProbeRecord);
  return name;
}

export async function readLatestSyncedProbe(
  root: FileSystemDirectoryHandle,
): Promise<Date | null> {
  const dir = await getPath(root, [PROBE_DIR]);
  if (!dir) return null;

  // Probe names are sortable timestamps (YYYY-MM-DDTHH-mm.json). List names
  // only and read newest-first until one parses — avoids reading every probe
  // ever written (one accumulates per app start).
  const names: string[] = [];
  for await (const [name, h] of (dir as any).entries()) {
    if (h.kind === 'file' && name.endsWith('.json')) names.push(name);
  }
  names.sort().reverse();
  for (const name of names) {
    try {
      const rec = await readJson<ProbeRecord>(dir, name);
      const t = new Date(rec.writtenAt);
      if (!Number.isNaN(t.getTime())) return t;
    } catch {
      // skip corrupt probes
    }
  }
  return null;
}

export async function hoursSinceLastSync(
  root: FileSystemDirectoryHandle,
  now: Date,
): Promise<number | null> {
  const last = await readLatestSyncedProbe(root);
  if (!last) return null;
  return (now.getTime() - last.getTime()) / 3_600_000;
}

// §10.9 thresholds. Unknown → red (worst case).
// TODO(sync-integration-task): current signal is "when we last wrote a probe",
// not "when Drive last mirrored it upstream". Real round-trip verification
// requires a companion handle on the mirrored side. Deferred to the sync-
// integration task in the Phase 1 backup-nag plan.
export function nagLevel(hoursSinceSync: number | null): 'ok' | 'amber' | 'red' {
  if (hoursSinceSync === null) return 'red';
  if (hoursSinceSync >= 24) return 'red';
  if (hoursSinceSync >= 12) return 'amber';
  return 'ok';
}
