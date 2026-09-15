import { formatFolderTimestamp } from '../util/time';

const UNSAFE = /[\\/:*?"<>|]/g;

export function sanitizeFolderName(name: string): string {
  return name
    .replace(UNSAFE, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
}

export function siteFolderName(code: string, name: string): string {
  return `${code}_${sanitizeFolderName(name)}`;
}

export function surveyFolderName(startedAt: Date, seq: number): string {
  const ts = formatFolderTimestamp(startedAt);
  const s = String(seq).padStart(2, '0');
  return `${ts}_s${s}`;
}

export function lineFolderName(label: string): string {
  return sanitizeFolderName(label);
}

export async function getOrCreatePath(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<FileSystemDirectoryHandle> {
  let cur = root;
  for (const seg of segments) {
    cur = await cur.getDirectoryHandle(seg, { create: true });
  }
  return cur;
}

export async function getPath(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<FileSystemDirectoryHandle | null> {
  let cur = root;
  for (const seg of segments) {
    try {
      cur = await cur.getDirectoryHandle(seg);
    } catch {
      return null;
    }
  }
  return cur;
}
