import { createMockRoot } from './mock-fs';
import { writeJson } from '../storage/atomic';
import { getOrCreatePath } from '../storage/paths';
import type {
  Site, Survey, Line, RegulatoryContext, Interpretation, DrillOutcome,
  ChannelSetSnapshot,
} from '../domain/types';

export interface FixtureSpec {
  schemaVersion?: string;
  sites: {
    folderName: string;
    site: Site;
    regulatory?: RegulatoryContext;
    surveys: {
      folderName: string;
      survey: Survey;
      interpretation?: Interpretation;
      outcomes?: DrillOutcome[];
      lines: {
        folderName: string;
        line: Line;
        deviceFiles?: string[];  // file names to place under device-files/
        mediaFiles?: string[];   // file names to place under media/
      }[];
    }[];
  }[];
}

export async function buildFixtureRoot(spec: FixtureSpec): Promise<FileSystemDirectoryHandle> {
  const root = createMockRoot();
  await writeJson(root, '_schema.json', { version: spec.schemaVersion ?? 'hydrolog-v1' });

  for (const s of spec.sites) {
    const siteDir = await getOrCreatePath(root, ['sites', s.folderName]);
    await writeJson(siteDir, 'site.json', s.site);
    if (s.regulatory) await writeJson(siteDir, 'regulatory.json', s.regulatory);

    for (const sv of s.surveys) {
      const svDir = await getOrCreatePath(siteDir, ['surveys', sv.folderName]);
      await writeJson(svDir, 'survey.json', sv.survey);
      if (sv.interpretation) await writeJson(svDir, 'interpretation.json', sv.interpretation);

      for (const ln of sv.lines) {
        const lnDir = await getOrCreatePath(svDir, ['lines', ln.folderName]);
        await writeJson(lnDir, 'line.json', ln.line);

        if (ln.deviceFiles?.length) {
          const df = await getOrCreatePath(lnDir, ['device-files']);
          for (const name of ln.deviceFiles) {
            const h = await df.getFileHandle(name, { create: true });
            const w = await h.createWritable();
            await w.write(new Uint8Array([0]));
            await w.close();
          }
        }
        if (ln.mediaFiles?.length) {
          const md = await getOrCreatePath(lnDir, ['media']);
          for (const name of ln.mediaFiles) {
            const h = await md.getFileHandle(name, { create: true });
            const w = await h.createWritable();
            await w.write(new Uint8Array([0]));
            await w.close();
          }
        }
      }

      if (sv.outcomes?.length) {
        const outDir = await getOrCreatePath(siteDir, ['outcomes']);
        for (let i = 0; i < sv.outcomes.length; i++) {
          await writeJson(outDir, `outcome_${i}.json`, sv.outcomes[i]);
        }
      }
    }
  }

  return root;
}

// Minimal valid stubs so tests don't repeat 30 lines each.
export function stubChannelSet(): ChannelSetSnapshot {
  return {
    name: 'TC300 linear',
    deviceModel: 'PQWT-TC300',
    kind: 'frequency',
    units: 'mV',
    depthModel: 'linear-nominal',
    provenanceNote: 'stub for tests',
    channels: Array.from({ length: 40 }, (_, i) => ({
      label: `ch${i + 1}`,
      order: i,
      pseudoDepthM: (i + 1) * 4.5,
    })),
    frozenAt: new Date('2026-09-01T00:00:00Z'),
  };
}
