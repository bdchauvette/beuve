import { describe, expect, it } from 'vitest';

import { buildSuggestedPatch } from './build-suggested-patch.ts';

const head = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((line) => `${line}\n`).join('');

describe('buildSuggestedPatch', () => {
  it('replaces exactly the edited range, with context around it', () => {
    const edited = head.replace('d\ne\n', 'D\nE\nE2\n');
    expect(buildSuggestedPatch('src/x.ts', head, edited, { startLine: 4, endLine: 5 })).toEqual({
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

  it('removes every anchored line even when only one changed', () => {
    const edited = head.replace('e\n', 'E\n');
    const plan = buildSuggestedPatch('x', head, edited, { startLine: 4, endLine: 6 }, 0);
    expect(plan).toEqual({
      kind: 'patch',
      text: '--- a/x\n+++ b/x\n@@ -4,3 +4,3 @@\n-d\n-e\n-f\n+d\n+E\n+f\n',
    });
  });

  it('deletes the range, clipping context at the start of the file', () => {
    const edited = head.replace('a\nb\n', '');
    expect(buildSuggestedPatch('x', head, edited, { startLine: 1, endLine: 2 }, 1)).toEqual({
      kind: 'patch',
      text: '--- a/x\n+++ b/x\n@@ -1,3 +1,1 @@\n-a\n-b\n c\n',
    });
    const all = buildSuggestedPatch('x', 'only\n', '', { startLine: 1, endLine: 1 });
    expect(all).toEqual({ kind: 'patch', text: '--- a/x\n+++ b/x\n@@ -1,1 +0,0 @@\n-only\n' });
  });

  it('refuses edits outside the range, and reports no edit', () => {
    const outside = buildSuggestedPatch('x', head, head.replace('a\n', 'A\n'), {
      startLine: 4,
      endLine: 5,
    });
    expect(outside).toEqual({ kind: 'outside', message: 'Edits must stay within lines 4–5.' });
    expect(
      buildSuggestedPatch('x', head, head.replace('i\n', 'i'), { startLine: 4, endLine: 5 }).kind,
    ).toBe('outside');
    expect(buildSuggestedPatch('x', head, head, { startLine: 4, endLine: 5 })).toEqual({
      kind: 'unchanged',
    });
  });

  it('marks a missing final newline and keeps carriage returns', () => {
    const plan = buildSuggestedPatch('x', 'a\r\nb', 'a\r\nB', { startLine: 2, endLine: 2 });
    expect(plan).toEqual({
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
    const context = buildSuggestedPatch('x', 'a\nb\nc', 'A\nb\nc', { startLine: 1, endLine: 1 });
    expect(context.kind === 'patch' && context.text).toContain(' c\n\\ No newline');
  });
});
