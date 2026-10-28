import { describe, expect, it } from 'vitest';

import { normalizeUri } from './normalize-uri.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';
import { toFileReference } from './to-file-reference.ts';

const root = '/work/repo' as WorkspaceRoot;

describe('toFileReference', () => {
  it('makes workspace files root-relative and leaves everything else as a URI', () => {
    expect(toFileReference(root, 'file:///work/repo/src/a%20b.ts')).toEqual({
      kind: 'workspace',
      path: 'src/a b.ts',
    });
    expect(toFileReference(root, 'file:///work/repo-other/x.ts')).toEqual({
      kind: 'external',
      uri: 'file:///work/repo-other/x.ts',
    });
    expect(toFileReference(root, 'file:///work/repo')).toMatchObject({ kind: 'external' });
    expect(toFileReference(root, 'zipfile:///x.zip::a.ts')).toMatchObject({ kind: 'external' });
  });
});

describe('normalizeUri', () => {
  it('spells equivalent file URIs the same way', () => {
    expect(normalizeUri('file:///work/a%20b.ts')).toBe(normalizeUri('file:///work/a b.ts'));
    expect(normalizeUri('untitled:1')).toBe('untitled:1');
  });
});
