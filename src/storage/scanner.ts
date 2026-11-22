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
  interpretation?: Interpretation;   // lines/<line>/interpretation.json
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
  startedAt: Date;
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

function notNull<T>(x: T | null): x is T {
  return x !== null;
}

// All directory levels are walked in parallel (Promise.all keeps order).
// File System Access calls are async I/O — on Android each one round-trips
// through a content provider, so sequential awaits dominated startup time.

async function scanLine(
  linesRoot: FileSystemDirectoryHandle,
  lnFolderName: string,
): Promise<LineScan | null> {
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
    return null;
  }

  const [deviceFilesDir, mediaDir, allLineFiles] = await Promise.all([
    getPath(lnDir, ['device-files']),
    getPath(lnDir, ['media']),
    listFiles(lnDir),
  ]);

  const [hasDeviceFiles, mediaFiles, deviceMediaRaw] = await Promise.all([
    deviceFilesDir ? listFiles(deviceFilesDir).then((f) => f.length > 0) : Promise.resolve(false),
    mediaDir ? listFiles(mediaDir) : Promise.resolve([] as string[]),
    Promise.all(
      allLineFiles
        .filter((n) => /^device-media-\d+\.json$/.test(n))
        .map((f) => optionalJson<MediaAsset>(lnDir, f)),
    ),
  ]);
  const deviceMedia = deviceMediaRaw.filter((m): m is MediaAsset => !!m);
  const interpretation = allLineFiles.includes('interpretation.json')
    ? await optionalJson<Interpretation>(lnDir, 'interpretation.json')
    : undefined;

  return { line, folderName: lnFolderName, hasDeviceFiles, mediaFiles, deviceMedia, interpretation };
}

async function scanSurvey(
  surveysRoot: FileSystemDirectoryHandle,
  svFolderName: string,
): Promise<SurveyScan | null> {
  const svDir = await surveysRoot.getDirectoryHandle(svFolderName);
  let survey: Survey;
  try {
    survey = await readJson<Survey>(svDir, 'survey.json');
  } catch (e) {
    console.warn(`Skipping ${svFolderName}: missing or invalid survey.json —`, e);
    return null;
  }
  const [interpretation, linesRoot] = await Promise.all([
    optionalJson<Interpretation>(svDir, 'interpretation.json'),
    getPath(svDir, ['lines']),
  ]);

  let lines: LineScan[] = [];
  if (linesRoot) {
    const lineDirs = await listDirs(linesRoot);
    lines = (await Promise.all(lineDirs.map((n) => scanLine(linesRoot, n)))).filter(notNull);
  }

  return { survey, folderName: svFolderName, interpretation, lines, outcomes: [] };
}

async function scanSite(
  sitesRoot: FileSystemDirectoryHandle,
  siteFolderName: string,
): Promise<SiteScan | null> {
  const siteDir = await sitesRoot.getDirectoryHandle(siteFolderName);
  let site: Site;
  try {
    site = await readJson<Site>(siteDir, 'site.json');
  } catch (e) {
    console.warn(`Skipping ${siteFolderName}: missing or invalid site.json —`, e);
    return null;
  }

  const [regulatory, surveysRoot, outcomesDir] = await Promise.all([
    optionalJson<RegulatoryContext>(siteDir, 'regulatory.json'),
    getPath(siteDir, ['surveys']),
    getPath(siteDir, ['outcomes']),
  ]);

  const surveysP: Promise<SurveyScan[]> = surveysRoot
    ? listDirs(surveysRoot).then((dirs) =>
        Promise.all(dirs.map((n) => scanSurvey(surveysRoot, n))).then((r) => r.filter(notNull)))
    : Promise.resolve([]);

  const outcomesP: Promise<DrillOutcome[]> = outcomesDir
    ? listFiles(outcomesDir).then((files) =>
        Promise.all(files.filter((n) => n.endsWith('.json')).map((f) => readJson<DrillOutcome>(outcomesDir, f))))
    : Promise.resolve([]);

  const [surveys, outcomes] = await Promise.all([surveysP, outcomesP]);

  // Distribute outcomes to whichever survey they reference (via interpretationId → survey via linkage).
  // For now, outcomes are attached to the first survey; refinement in the outcomes-management task.
  if (surveys.length > 0) surveys[0].outcomes.push(...outcomes);

  return { site, folderName: siteFolderName, regulatory, surveys };
}

export async function scanRoot(root: FileSystemDirectoryHandle): Promise<ScanResult> {
  const startedAt = new Date();
  const [schemaFile, sitesRoot] = await Promise.all([
    optionalJson<{ version: string }>(root, '_schema.json'),
    getPath(root, ['sites']),
  ]);
  const schemaVersion = schemaFile?.version ?? 'unknown';
  if (!sitesRoot) return { schemaVersion, startedAt, sites: [] };

  const siteDirs = await listDirs(sitesRoot);
  const sites = (await Promise.all(siteDirs.map((n) => scanSite(sitesRoot, n)))).filter(notNull);

  return { schemaVersion, startedAt, sites };
}
