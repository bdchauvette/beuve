import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { normalizeUri } from './normalize-uri.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';
import { toFileReference } from './to-file-reference.ts';

function root(): WorkspaceRoot {
  return '/work/repo' as WorkspaceRoot;
}

describe('toFileReference', () => {
  test('makes workspace files root-relative and leaves everything else as a URI', ({ expect }) => {
    expect(toFileReference(root(), 'file:///work/repo/src/a%20b.ts')).toStrictEqual({
      kind: 'workspace',
      path: 'src/a b.ts',
    });
    expect(toFileReference(root(), 'file:///work/repo-other/x.ts')).toStrictEqual({
      kind: 'external',
      uri: 'file:///work/repo-other/x.ts',
    });
    expect(toFileReference(root(), 'file:///work/repo')).toMatchObject({ kind: 'external' });
    expect(toFileReference(root(), 'zipfile:///x.zip::a.ts')).toMatchObject({ kind: 'external' });
  });
});

describe('normalizeUri', () => {
  test('spells equivalent file URIs the same way', ({ expect }) => {
    expect(normalizeUri('file:///work/a%20b.ts')).toBe(normalizeUri('file:///work/a b.ts'));
    expect(normalizeUri('untitled:1')).toBe('untitled:1');
  });
});
