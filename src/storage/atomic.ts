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

// On Chromium-family browsers (the target platform per plan §10.4),
// createWritable({ keepExistingData: false }) + close() is already atomic:
// the browser writes to a swap file and renames it on close. A separate
// .tmp indirection adds no safety and risks leaking stale files if the
// process is interrupted. Write directly to the target name.
async function writeBytes(
  dir: FileSystemDirectoryHandle,
  name: string,
  bytes: BufferSource,
): Promise<void> {
  const h = await dir.getFileHandle(name, { create: true });
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

export async function writeJson<T>(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: T,
): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  await writeBytes(dir, name, new TextEncoder().encode(json));
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
  await writeBytes(dir, name, bytes);
}

export async function readBlob(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<Blob> {
  return readBytes(dir, name);
}
