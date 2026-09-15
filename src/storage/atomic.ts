export async function fileExists(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function writeBytes(
  dir: FileSystemDirectoryHandle,
  name: string,
  bytes: BufferSource,
): Promise<void> {
  const h = await dir.getFileHandle(name, { create: true });
  // @ts-expect-error createWritable exists on FileSystemFileHandle in browsers
  const w = await h.createWritable({ keepExistingData: false });
  await w.write(bytes);
  await w.close();
}

async function readBytes(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<Blob> {
  const h = await dir.getFileHandle(name);
  return h.getFile();
}

async function atomicWrite(
  dir: FileSystemDirectoryHandle,
  name: string,
  bytes: BufferSource,
): Promise<void> {
  const tmpName = `${name}.tmp`;
  await writeBytes(dir, tmpName, bytes);
  try {
    // "rename": copy tmp bytes over the final file, then delete tmp.
    const tmp = await readBytes(dir, tmpName);
    const buf = await tmp.arrayBuffer();
    await writeBytes(dir, name, buf);
  } finally {
    try { await dir.removeEntry(tmpName); } catch { /* ignore */ }
  }
}

export async function writeJson<T>(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: T,
): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  await atomicWrite(dir, name, new TextEncoder().encode(json));
}

export async function readJson<T>(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<T> {
  const blob = await readBytes(dir, name);
  const text = await blob.text();
  return JSON.parse(text) as T;
}

export async function writeBlob(
  dir: FileSystemDirectoryHandle,
  name: string,
  blob: Blob | BufferSource,
): Promise<void> {
  const bytes = blob instanceof Blob
    ? new Uint8Array(await blob.arrayBuffer())
    : blob;
  await atomicWrite(dir, name, bytes);
}

export async function readBlob(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<Blob> {
  return readBytes(dir, name);
}
