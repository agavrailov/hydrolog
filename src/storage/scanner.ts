import type {
  Site, Survey, Line, RegulatoryContext, Interpretation, DrillOutcome, MediaAsset,
} from '../domain/types';
import { readJson } from './atomic';
import { getPath } from './paths';

export interface LineScan {
  line: Line;
  folderName: string;
  hasDeviceFiles: boolean;
  mediaFiles: string[];
  deviceMedia: MediaAsset[];
}

export interface SurveyScan {
  survey: Survey;
  folderName: string;
  interpretation?: Interpretation;
  lines: LineScan[];
  outcomes: DrillOutcome[];
}

export interface SiteScan {
  site: Site;
  folderName: string;
  regulatory?: RegulatoryContext;
  surveys: SurveyScan[];
}

export interface ScanResult {
  schemaVersion: string;
  sites: SiteScan[];
}

const IGNORE_PREFIXES = ['_tombstones', '_sync_probe', '_backup_pre_migration_'];

function shouldIgnore(name: string): boolean {
  return IGNORE_PREFIXES.some((p) => name === p || name.startsWith(`${p}_`));
}

async function listDirs(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const out: string[] = [];
  for await (const [name, h] of (dir as any).entries()) {
    if (h.kind === 'directory' && !shouldIgnore(name)) out.push(name);
  }
  return out;
}

async function listFiles(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const out: string[] = [];
  for await (const [name, h] of (dir as any).entries()) {
    if (h.kind === 'file' && !name.endsWith('.tmp')) out.push(name);
  }
  return out;
}

async function optionalJson<T>(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<T | undefined> {
  try {
    return await readJson<T>(dir, name);
  } catch {
    return undefined;
  }
}

export async function scanRoot(root: FileSystemDirectoryHandle): Promise<ScanResult> {
  const schemaFile = await optionalJson<{ version: string }>(root, '_schema.json');
  const schemaVersion = schemaFile?.version ?? 'unknown';

  const sitesRoot = await getPath(root, ['sites']);
  if (!sitesRoot) return { schemaVersion, sites: [] };

  const siteDirs = await listDirs(sitesRoot);
  const sites: SiteScan[] = [];

  for (const siteFolderName of siteDirs) {
    const siteDir = await sitesRoot.getDirectoryHandle(siteFolderName);
    let site: Site;
    try {
      site = await readJson<Site>(siteDir, 'site.json');
    } catch (e) {
      console.warn(`Skipping ${siteFolderName}: missing or invalid site.json —`, e);
      continue;
    }
    const regulatory = await optionalJson<RegulatoryContext>(siteDir, 'regulatory.json');

    const surveys: SurveyScan[] = [];
    const surveysRoot = await getPath(siteDir, ['surveys']);
    if (surveysRoot) {
      const surveyDirs = await listDirs(surveysRoot);
      for (const svFolderName of surveyDirs) {
        const svDir = await surveysRoot.getDirectoryHandle(svFolderName);
        let survey: Survey;
        try {
          survey = await readJson<Survey>(svDir, 'survey.json');
        } catch (e) {
          console.warn(`Skipping ${svFolderName}: missing or invalid survey.json —`, e);
          continue;
        }
        const interpretation = await optionalJson<Interpretation>(svDir, 'interpretation.json');

        const lines: LineScan[] = [];
        const linesRoot = await getPath(svDir, ['lines']);
        if (linesRoot) {
          const lineDirs = await listDirs(linesRoot);
          for (const lnFolderName of lineDirs) {
            const lnDir = await linesRoot.getDirectoryHandle(lnFolderName);
            let line: Line;
            try {
              const raw = await readJson<Line & { pointSpacingM?: number; electrodeSpacingM?: number }>(lnDir, 'line.json');
              if (raw.spacingM == null) {
                raw.spacingM = raw.pointSpacingM ?? raw.electrodeSpacingM ?? 2;
              }
              line = raw;
            } catch (e) {
              console.warn(`Skipping ${lnFolderName}: missing or invalid line.json —`, e);
              continue;
            }

            const deviceFilesDir = await getPath(lnDir, ['device-files']);
            const hasDeviceFiles = deviceFilesDir
              ? (await listFiles(deviceFilesDir)).length > 0
              : false;

            const mediaDir = await getPath(lnDir, ['media']);
            const mediaFiles = mediaDir ? await listFiles(mediaDir) : [];

            const deviceMedia: MediaAsset[] = [];
            const allLineFiles = await listFiles(lnDir);
            for (const f of allLineFiles.filter((n) => /^device-media-\d+\.json$/.test(n))) {
              const m = await optionalJson<MediaAsset>(lnDir, f);
              if (m) deviceMedia.push(m);
            }

            lines.push({ line, folderName: lnFolderName, hasDeviceFiles, mediaFiles, deviceMedia });
          }
        }

        surveys.push({ survey, folderName: svFolderName, interpretation, lines, outcomes: [] });
      }
    }

    const outcomes: DrillOutcome[] = [];
    const outcomesDir = await getPath(siteDir, ['outcomes']);
    if (outcomesDir) {
      const files = await listFiles(outcomesDir);
      for (const f of files.filter((n) => n.endsWith('.json'))) {
        const o = await readJson<DrillOutcome>(outcomesDir, f);
        outcomes.push(o);
      }
    }
    // Distribute outcomes to whichever survey they reference (via interpretationId → survey via linkage).
    // For now, outcomes are attached to the first survey; refinement in the outcomes-management task.
    if (surveys.length > 0) surveys[0].outcomes.push(...outcomes);

    sites.push({ site, folderName: siteFolderName, regulatory, surveys });
  }

  return { schemaVersion, sites };
}
