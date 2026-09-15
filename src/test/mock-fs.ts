// Minimal in-memory implementation of the parts of the File System Access API
// we use. Enough for tests; not a general-purpose polyfill.

class MockFile {
  constructor(public data: Uint8Array = new Uint8Array()) {}
}

class MockWritable {
  private chunks: Uint8Array[] = [];
  constructor(private file: MockFile) {}

  async write(chunk: BufferSource | string): Promise<void> {
    if (typeof chunk === 'string') {
      this.chunks.push(new TextEncoder().encode(chunk));
    } else if (chunk instanceof Uint8Array) {
      this.chunks.push(chunk);
    } else if (chunk instanceof ArrayBuffer) {
      this.chunks.push(new Uint8Array(chunk));
    } else {
      this.chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
  }

  async close(): Promise<void> {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) { buf.set(c, off); off += c.length; }
    this.file.data = buf;
  }

  async abort(): Promise<void> { this.chunks = []; }
}

class MockFileHandle {
  kind = 'file' as const;
  constructor(public name: string, private file: MockFile) {}

  async getFile(): Promise<File> {
    return new File([this.file.data], this.name);
  }

  async createWritable(_opts?: { keepExistingData?: boolean }): Promise<MockWritable> {
    return new MockWritable(this.file);
  }
}

class MockDirectoryHandle {
  kind = 'directory' as const;
  private entriesMap = new Map<string, MockFileHandle | MockDirectoryHandle>();
  constructor(public name: string) {}

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MockFileHandle> {
    const existing = this.entriesMap.get(name);
    if (existing) {
      if (existing.kind !== 'file') throw new Error(`entry ${name} is a directory`);
      return existing;
    }
    if (!opts?.create) throw new Error(`file not found: ${name}`);
    const h = new MockFileHandle(name, new MockFile());
    this.entriesMap.set(name, h);
    return h;
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MockDirectoryHandle> {
    const existing = this.entriesMap.get(name);
    if (existing) {
      if (existing.kind !== 'directory') throw new Error(`entry ${name} is a file`);
      return existing;
    }
    if (!opts?.create) throw new Error(`directory not found: ${name}`);
    const h = new MockDirectoryHandle(name);
    this.entriesMap.set(name, h);
    return h;
  }

  async removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> {
    const existing = this.entriesMap.get(name);
    if (!existing) throw new Error(`not found: ${name}`);
    if (existing.kind === 'directory' && existing.entriesMap.size > 0 && !opts?.recursive) {
      throw new Error(`directory not empty: ${name}`);
    }
    this.entriesMap.delete(name);
  }

  async *entries(): AsyncGenerator<[string, MockFileHandle | MockDirectoryHandle]> {
    for (const [name, handle] of this.entriesMap) yield [name, handle];
  }

  async *keys(): AsyncGenerator<string> {
    for (const [name] of this.entriesMap) yield name;
  }

  async *values(): AsyncGenerator<MockFileHandle | MockDirectoryHandle> {
    for (const [, handle] of this.entriesMap) yield handle;
  }

  async queryPermission(_desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState> {
    return 'granted';
  }

  async requestPermission(_desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState> {
    return 'granted';
  }
}

export function createMockRoot(name = 'MockRoot'): FileSystemDirectoryHandle {
  // Cast: mock implements the subset of the API we use.
  return new MockDirectoryHandle(name) as unknown as FileSystemDirectoryHandle;
}
