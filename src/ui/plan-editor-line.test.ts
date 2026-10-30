import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { DiffFileView } from '#contract/ipc-contract.ts';

import { planEditorLine } from './plan-editor-line.ts';

function patch(): string {
  return [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,3 +1,3 @@',
    ' one',
    '-two',
    '+TWO',
    ' three',
    '@@ -10,3 +10,2 @@',
    ' ten',
    '-eleven',
    ' twelve',
    '',
  ].join('\n');
}

function file(): DiffFileView {
  return {
    status: 'modified',
    path: 'a.ts',
    additions: 1,
    deletions: 2,
    binary: false,
    patch: patch(),
    hunks: [
      { oldStart: 1, oldCount: 3, newStart: 1, newCount: 3, header: '@@ -1,3 +1,3 @@' },
      { oldStart: 10, oldCount: 3, newStart: 10, newCount: 2, header: '@@ -10,3 +10,2 @@' },
    ],
  };
}

describe('planEditorLine', () => {
  test('uses the start of selected head lines', ({ expect }) => {
    expect(planEditorLine(file(), 1, { start: 3, end: 2, side: 'additions' })).toBe(2);
    expect(planEditorLine(file(), -1, { start: 5, end: 5 })).toBe(5);
  });

  test('maps selected deleted lines to their hunk’s first head change', ({ expect }) => {
    expect(planEditorLine(file(), -1, { start: 11, end: 11, side: 'deletions' })).toBe(10);
    expect(planEditorLine(file(), -1, { start: 2, end: 2, side: 'deletions' })).toBe(1);
  });

  test('uses the focused hunk, then the file’s first change, then line 1', ({ expect }) => {
    expect(planEditorLine(file(), 0, undefined)).toBe(1);
    expect(planEditorLine(file(), 1, undefined)).toBe(10);
    expect(planEditorLine(file(), -1, undefined)).toBe(1);
    expect(planEditorLine({ ...file(), patch: '', hunks: [] }, -1, undefined)).toBe(1);
  });
});
