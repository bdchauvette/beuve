import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { buildSuggestedPatch } from './build-suggested-patch.ts';

function head(): string {
  return ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((line) => `${line}\n`).join('');
}

describe('buildSuggestedPatch', () => {
  test('replaces exactly the edited range, with context around it', ({ expect }) => {
    const edited = head().replace('d\ne\n', 'D\nE\nE2\n');
    expect(
      buildSuggestedPatch({
        path: 'src/x.ts',
        head: head(),
        edited,
        range: { startLine: 4, endLine: 5 },
      }),
    ).toStrictEqual({
      kind: 'patch',
      text: [
        '--- a/src/x.ts',
        '+++ b/src/x.ts',
        '@@ -1,8 +1,9 @@',
        ' a',
        ' b',
        ' c',
        '-d',
        '-e',
        '+D',
        '+E',
        '+E2',
        ' f',
        ' g',
        ' h',
        '',
      ].join('\n'),
    });
  });

  test('removes every anchored line even when only one changed', ({ expect }) => {
    const edited = head().replace('e\n', 'E\n');
    const plan = buildSuggestedPatch({
      path: 'x',
      head: head(),
      edited,
      range: { startLine: 4, endLine: 6 },
      contextLines: 0,
    });
    expect(plan).toStrictEqual({
      kind: 'patch',
      text: '--- a/x\n+++ b/x\n@@ -4,3 +4,3 @@\n-d\n-e\n-f\n+d\n+E\n+f\n',
    });
  });

  test('deletes the range, clipping context at the start of the file', ({ expect }) => {
    const edited = head().replace('a\nb\n', '');
    expect(
      buildSuggestedPatch({
        path: 'x',
        head: head(),
        edited,
        range: { startLine: 1, endLine: 2 },
        contextLines: 1,
      }),
    ).toStrictEqual({
      kind: 'patch',
      text: '--- a/x\n+++ b/x\n@@ -1,3 +1,1 @@\n-a\n-b\n c\n',
    });
    const all = buildSuggestedPatch({
      path: 'x',
      head: 'only\n',
      edited: '',
      range: { startLine: 1, endLine: 1 },
    });
    expect(all).toStrictEqual({
      kind: 'patch',
      text: '--- a/x\n+++ b/x\n@@ -1,1 +0,0 @@\n-only\n',
    });
  });

  test('refuses edits outside the range, and reports no edit', ({ expect }) => {
    const outside = buildSuggestedPatch({
      path: 'x',
      head: head(),
      edited: head().replace('a\n', 'A\n'),
      range: {
        startLine: 4,
        endLine: 5,
      },
    });
    expect(outside).toStrictEqual({
      kind: 'outside',
      message: 'Edits must stay within lines 4–5.',
    });
    expect(
      buildSuggestedPatch({
        path: 'x',
        head: head(),
        edited: head().replace('i\n', 'i'),
        range: { startLine: 4, endLine: 5 },
      }).kind,
    ).toBe('outside');
    expect(
      buildSuggestedPatch({
        path: 'x',
        head: head(),
        edited: head(),
        range: { startLine: 4, endLine: 5 },
      }),
    ).toStrictEqual({
      kind: 'unchanged',
    });
  });

  test('marks a missing final newline and keeps carriage returns', ({ expect }) => {
    const plan = buildSuggestedPatch({
      path: 'x',
      head: 'a\r\nb',
      edited: 'a\r\nB',
      range: { startLine: 2, endLine: 2 },
    });
    expect(plan).toStrictEqual({
      kind: 'patch',
      text: [
        '--- a/x',
        '+++ b/x',
        '@@ -1,2 +1,2 @@',
        ' a\r',
        '-b',
        '\\ No newline at end of file',
        '+B',
        '\\ No newline at end of file',
        '',
      ].join('\n'),
    });
    const context = buildSuggestedPatch({
      path: 'x',
      head: 'a\nb\nc',
      edited: 'A\nb\nc',
      range: { startLine: 1, endLine: 1 },
    });
    expect(context.kind === 'patch' && context.text).toContain(' c\n\\ No newline');
  });
});
