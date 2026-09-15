import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRoot } from '../test/mock-fs';
import {
  sanitizeFolderName, siteFolderName, surveyFolderName, lineFolderName,
  getOrCreatePath, getPath,
} from './paths';

describe('sanitizeFolderName', () => {
  it('keeps Cyrillic letters', () => {
    expect(sanitizeFolderName('Долна Баня')).toBe('Долна-Баня');
  });

  it('replaces path separators and reserved chars', () => {
    expect(sanitizeFolderName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeFolderName('  hello   world  ')).toBe('hello-world');
  });

  it('throws on empty string', () => {
    expect(() => sanitizeFolderName('')).toThrow('folder name cannot be empty after sanitization');
  });

  it('throws on dot', () => {
    expect(() => sanitizeFolderName('.')).toThrow('folder name cannot be empty after sanitization');
  });

  it('throws on double-dot', () => {
    expect(() => sanitizeFolderName('..')).toThrow('folder name cannot be empty after sanitization');
  });

  it('throws on whitespace-only string', () => {
    expect(() => sanitizeFolderName('   ')).toThrow('folder name cannot be empty after sanitization');
  });

  it('throws on Windows reserved name NUL', () => {
    expect(() => sanitizeFolderName('NUL')).toThrow('folder name matches a Windows reserved name: NUL');
  });

  it('throws on Windows reserved name con (case-insensitive)', () => {
    expect(() => sanitizeFolderName('con')).toThrow('folder name matches a Windows reserved name: con');
  });

  it('throws on Windows reserved name com3', () => {
    expect(() => sanitizeFolderName('com3')).toThrow('folder name matches a Windows reserved name: com3');
  });
});

describe('siteFolderName', () => {
  it('composes code + sanitized name', () => {
    expect(siteFolderName('BG-SOF-0043', 'Dolna Banya Ivanov'))
      .toBe('BG-SOF-0043_Dolna-Banya-Ivanov');
  });
});

describe('surveyFolderName', () => {
  it('uses UTC timestamp and zero-padded sequence', () => {
    const d = new Date(Date.UTC(2026, 8, 13, 10, 20, 0));
    expect(surveyFolderName(d, 1)).toBe('2026-09-13T10-20_s01');
    expect(surveyFolderName(d, 42)).toBe('2026-09-13T10-20_s42');
  });
});

describe('lineFolderName', () => {
  it('passes through labels like L1, L2', () => {
    expect(lineFolderName('L1')).toBe('L1');
  });
});

describe('getOrCreatePath / getPath', () => {
  let root: FileSystemDirectoryHandle;
  beforeEach(() => { root = createMockRoot(); });

  it('creates nested subdirs and returns the leaf handle', async () => {
    const leaf = await getOrCreatePath(root, ['sites', 'BG-SOF-0043', 'surveys', 's01']);
    expect(leaf.kind).toBe('directory');
    const check = await getPath(root, ['sites', 'BG-SOF-0043', 'surveys', 's01']);
    expect(check).not.toBeNull();
  });

  it('getPath returns null when a segment is missing', async () => {
    expect(await getPath(root, ['sites', 'missing'])).toBeNull();
  });
});
