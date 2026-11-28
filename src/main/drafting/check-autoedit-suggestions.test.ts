import { describe } from 'vitest';

import type { AutoeditSuggestionDraftView } from '#contract/ipc-contract.ts';
import { test } from '#testing/test.ts';

import { checkAutoeditSuggestions } from './check-autoedit-suggestions.ts';
import type { AutoeditSuggestionContext } from './check-autoedit-suggestions.ts';
import type { ProposedSuggestion } from './parse-autoedit-answer.ts';

function head(): string {
  return 'a'.repeat(40);
}

function fileOf(lineCount: number): string {
  return Array.from({ length: lineCount }, (_line, index) => `line ${String(index + 1)}`).join(
    '\n',
  );
}

function existing(): AutoeditSuggestionDraftView[] {
  return [
    { key: 'f1', path: 'src/a.ts', startLine: 10, endLine: 11, replacement: 'one' },
    { key: 'f2', path: 'src/b.ts', startLine: 3, endLine: 3, replacement: 'two' },
  ];
}

function context(overrides: Partial<AutoeditSuggestionContext> = {}): AutoeditSuggestionContext {
  return {
    existing: existing(),
    shownLines: [
      { path: 'src/a.ts', start: 5, end: 15 },
      { path: 'src/a.ts', start: 40, end: 42 },
      { path: 'src/b.ts', start: 3, end: 3 },
    ],
    headSha: head(),
    texts: new Map([
      [
        head(),
        new Map([
          ['src/a.ts', `${fileOf(42)}\n`],
          ['src/b.ts', fileOf(3)],
        ]),
      ],
    ]),
    ...overrides,
  };
}

/** The head's text of `src/a.ts` alone, 42 lines without a final newline. */
function onlyFileA(): AutoeditSuggestionContext['texts'] {
  return new Map([[head(), new Map([['src/a.ts', fileOf(42)]])]]);
}

function proposed(overrides: Partial<ProposedSuggestion> = {}): ProposedSuggestion {
  return { path: 'src/a.ts', startLine: 6, endLine: 6, replacement: 'new', ...overrides };
}

describe('checkAutoeditSuggestions', () => {
  test('keeps revisions by id and new suggestions on shown lines', ({ expect }) => {
    const checked = checkAutoeditSuggestions(
      [
        { id: 's2', path: 'src/b.ts', startLine: 3, endLine: 3, replacement: 'TWO' },
        proposed(),
        proposed({ startLine: 41, endLine: 40, replacement: 'inserted' }),
        proposed({ startLine: 43, endLine: 42, replacement: 'at the end' }),
      ],
      context(),
    );
    expect(checked).toStrictEqual({
      suggestions: [
        { key: 'f2', path: 'src/b.ts', startLine: 3, endLine: 3, replacement: 'TWO' },
        { path: 'src/a.ts', startLine: 6, endLine: 6, replacement: 'new' },
        { path: 'src/a.ts', startLine: 41, endLine: 40, replacement: 'inserted' },
        { path: 'src/a.ts', startLine: 43, endLine: 42, replacement: 'at the end' },
      ],
      dropped: 0,
    });
  });

  test('drops unknown and repeated ids; an unchanged revision is no change', ({ expect }) => {
    const checked = checkAutoeditSuggestions(
      [
        proposed({ id: 's9' }),
        { id: 's1', path: 'src/a.ts', startLine: 10, endLine: 11, replacement: 'one' },
        { id: 's1', path: 'src/a.ts', startLine: 10, endLine: 11, replacement: 'again' },
      ],
      context(),
    );
    expect(checked).toStrictEqual({ suggestions: [], dropped: 2 });
  });

  test('drops suggestions outside the shown lines, the file or the head', ({ expect }) => {
    const checked = checkAutoeditSuggestions(
      [
        proposed({ startLine: 14, endLine: 16 }),
        proposed({ startLine: 20, endLine: 20 }),
        proposed({ path: 'src/c.ts', startLine: 6, endLine: 6 }),
        proposed({ path: 'src/b.ts', startLine: 3, endLine: 2 }),
        proposed({ startLine: 5, endLine: 5 }),
      ],
      context({
        shownLines: [
          { path: 'src/a.ts', start: 5, end: 15 },
          { path: 'src/b.ts', start: 3, end: 4 },
          { path: 'src/c.ts', start: 1, end: 10 },
        ],
        texts: onlyFileA(),
      }),
    );
    expect(checked).toStrictEqual({
      suggestions: [{ path: 'src/a.ts', startLine: 5, endLine: 5, replacement: 'new' }],
      dropped: 4,
    });
  });

  test('drops what overlaps the note’s other suggestions; omitted ones stay as they are', ({
    expect,
  }) => {
    const checked = checkAutoeditSuggestions(
      [
        proposed({ startLine: 11, endLine: 12 }),
        proposed({ startLine: 11, endLine: 10 }),
        proposed({ startLine: 10, endLine: 9 }),
        proposed({ startLine: 7, endLine: 8 }),
        proposed({ startLine: 8, endLine: 8, replacement: 'second' }),
      ],
      context(),
    );
    expect(checked).toStrictEqual({
      suggestions: [
        { path: 'src/a.ts', startLine: 10, endLine: 9, replacement: 'new' },
        { path: 'src/a.ts', startLine: 7, endLine: 8, replacement: 'new' },
      ],
      dropped: 3,
    });
  });

  test('places revisions first: a moved suggestion frees its old lines for a new one', ({
    expect,
  }) => {
    const checked = checkAutoeditSuggestions(
      [
        proposed({ startLine: 10, endLine: 11, replacement: 'takes the old lines' }),
        { id: 's1', path: 'src/a.ts', startLine: 7, endLine: 7, replacement: 'moved' },
        { id: 's2', path: 'src/b.ts', startLine: 3, endLine: 3, replacement: 'TWO' },
        proposed({ path: 'src/b.ts', startLine: 3, endLine: 3, replacement: 'clash' }),
      ],
      context(),
    );
    expect(checked).toStrictEqual({
      suggestions: [
        { key: 'f1', path: 'src/a.ts', startLine: 7, endLine: 7, replacement: 'moved' },
        { key: 'f2', path: 'src/b.ts', startLine: 3, endLine: 3, replacement: 'TWO' },
        { path: 'src/a.ts', startLine: 10, endLine: 11, replacement: 'takes the old lines' },
      ],
      dropped: 1,
    });
  });

  test('drops what is over the limits: an empty insertion, 64 KiB, 500 suggestions', ({
    expect,
  }) => {
    const many = Array.from({ length: 497 }, (_entry, index): AutoeditSuggestionDraftView => {
      return {
        key: `k${String(index)}`,
        path: 'src/z.ts',
        startLine: index + 1,
        endLine: index + 1,
        replacement: '',
      };
    });
    const checked = checkAutoeditSuggestions(
      [
        proposed({ startLine: 6, endLine: 5, replacement: '' }),
        proposed({ replacement: 'é'.repeat(32 * 1024 + 1) }),
        proposed({ startLine: 6, endLine: 6 }),
        proposed({ startLine: 7, endLine: 7 }),
      ],
      context({ existing: [...existing(), ...many] }),
    );
    expect(checked).toStrictEqual({
      suggestions: [{ path: 'src/a.ts', startLine: 6, endLine: 6, replacement: 'new' }],
      dropped: 3,
    });
  });
});
