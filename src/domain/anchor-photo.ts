import type { MediaAsset } from './types';
import { newId } from '../util/id';
import { sha256Hex } from '../util/hash';
import { writeJson, writeBlob } from '../storage/atomic';
import { getOrCreatePath } from '../storage/paths';
import { getRoot } from '../storage/fs';
import { getDb } from '../cache/db';

type Downscaler = (blob: Blob) => Promise<Blob>;

async function defaultDownscale(blob: Blob): Promise<Blob> {
  const g = globalThis as unknown as {
    createImageBitmap?: (b: Blob, o?: { imageOrientation?: string }) => Promise<{ width: number; height: number; close?: () => void }>;
    document?: Document;
  };
  if (!g.createImageBitmap || !g.document) return blob;
  const bitmap = await g.createImageBitmap(blob, { imageOrientation: 'from-image' });
  const maxEdge = 2048;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = g.document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, w, h);
  bitmap.close?.();
  return new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b ?? blob), 'image/webp', 0.85);
  });
}

let downscaler: Downscaler = defaultDownscale;
export function setDownscaleAdapter(fn: Downscaler): void { downscaler = fn; }

export interface AnchorCaptureInput {
  file: File;
  lineId: string;
  capturedAt: Date;
  lat: number;
  lon: number;
  bearingDeg?: number;
  caption?: string;
}

export async function captureAnchorPhoto(input: AnchorCaptureInput): Promise<MediaAsset> {
  const root = getRoot();
  const db = getDb();

  const lineRow = await db.lines.get(input.lineId);
  if (!lineRow) throw new Error(`line not found: ${input.lineId}`);
  const svRow = await db.surveys.get(lineRow.surveyId);
  if (!svRow) throw new Error(`orphan line — survey missing: ${lineRow.surveyId}`);
  const siteRow = await db.sites.get(svRow.siteId);
  if (!siteRow) throw new Error(`orphan line — site missing: ${svRow.siteId}`);

  const processed = await downscaler(input.file);
  const bytes = new Uint8Array(await processed.arrayBuffer());
  const sha256 = await sha256Hex(bytes);

  const lineDir = await getOrCreatePath(root, [
    'sites', siteRow.folderName, 'surveys', svRow.folderName, 'lines', lineRow.folderName,
  ]);
  await writeBlob(lineDir, 'anchor.jpg', processed);

  const now = new Date();
  const media: MediaAsset = {
    id: newId(),
    createdAt: now, updatedAt: now, revision: 1,
    kind: 'point1-anchor',
    capturedAt: input.capturedAt,
    lat: input.lat,
    lon: input.lon,
    bearingDeg: input.bearingDeg,
    linkedTo: { kind: 'line', id: input.lineId },
    storagePath: `sites/${siteRow.folderName}/surveys/${svRow.folderName}/lines/${lineRow.folderName}/anchor.jpg`,
    sha256,
    caption: input.caption,
    isOriginal: false, // downscaled per §4.13
  };
  await writeJson(lineDir, 'anchor-media.json', media);
  return media;
}
