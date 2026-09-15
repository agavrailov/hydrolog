import Dexie, { Table } from 'dexie';
import type {
  Site, Survey, Line, MediaAsset, DrillOutcome,
} from '../domain/types';

// Cache rows carry a `folderName` for direct navigation back to the folder,
// plus the parsed JSON blob for cheap in-app reads.

export interface SiteRow {
  id: string;
  code: string;
  folderName: string;
  json: Site;
}

export interface SurveyRow {
  id: string;
  siteId: string;
  folderName: string;
  json: Survey;
}

export interface LineRow {
  id: string;
  surveyId: string;
  folderName: string;
  hasDeviceFiles: boolean;
  json: Line;
}

export interface MediaRow {
  id: string;
  linkedKind: string;
  linkedId: string;
  storagePath: string;
  sha256: string;
  json: MediaAsset;
}

export interface OutcomeRow {
  id: string;
  interpretationId?: string;
  json: DrillOutcome;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export class HydroLogDb extends Dexie {
  sites!: Table<SiteRow, string>;
  surveys!: Table<SurveyRow, string>;
  lines!: Table<LineRow, string>;
  media!: Table<MediaRow, string>;
  outcomes!: Table<OutcomeRow, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('hydrolog');
    this.version(1).stores({
      sites: '&id, code, folderName',
      surveys: '&id, siteId, folderName',
      lines: '&id, surveyId, folderName',
      media: '&id, linkedId, storagePath',
      outcomes: '&id, interpretationId',
      meta: '&key',
    });
  }
}

let instance: HydroLogDb | null = null;

export function getDb(): HydroLogDb {
  if (!instance) instance = new HydroLogDb();
  return instance;
}

export async function resetDb(): Promise<void> {
  if (instance) {
    await instance.delete();
    instance = null;
  } else {
    await Dexie.delete('hydrolog');
  }
}
