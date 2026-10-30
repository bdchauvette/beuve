import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { normalizeUri } from './normalize-uri.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';
import { fileReferenceFrom } from './file-reference-from.ts';

function root(): WorkspaceRoot {
  return '/work/repo' as WorkspaceRoot;
}

describe('fileReferenceFrom', () => {
  test('makes workspace files root-relative and leaves everything else as a URI', ({ expect }) => {
    expect(fileReferenceFrom(root(), 'file:///work/repo/src/a%20b.ts')).toStrictEqual({
      kind: 'workspace',
      path: 'src/a b.ts',
    });
    expect(fileReferenceFrom(root(), 'file:///work/repo-other/x.ts')).toStrictEqual({
      kind: 'external',
      uri: 'file:///work/repo-other/x.ts',
    });
    expect(fileReferenceFrom(root(), 'file:///work/repo')).toMatchObject({ kind: 'external' });
    expect(fileReferenceFrom(root(), 'zipfile:///x.zip::a.ts')).toMatchObject({ kind: 'external' });
  });
});

describe('normalizeUri', () => {
  test('spells equivalent file URIs the same way', ({ expect }) => {
    expect(normalizeUri('file:///work/a%20b.ts')).toBe(normalizeUri('file:///work/a b.ts'));
    expect(normalizeUri('untitled:1')).toBe('untitled:1');
  });
});
