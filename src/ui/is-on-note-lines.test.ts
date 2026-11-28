import { describe } from 'vitest';

import { isOnNoteLines } from './is-on-note-lines.ts';
import { test } from './testing/test.ts';

describe('isOnNoteLines', () => {
  test('holds for the path and lines the note is anchored on', ({ expect }) => {
    const lines = { path: 'src/a.ts', startLine: 2, endLine: 3 };
    expect(isOnNoteLines(lines, { kind: 'lines', ...lines })).toBe(true);
  });

  test('fails when the path or either line differs', ({ expect }) => {
    const anchor = { kind: 'lines', path: 'src/a.ts', startLine: 2, endLine: 3 } as const;
    expect(isOnNoteLines({ path: 'src/b.ts', startLine: 2, endLine: 3 }, anchor)).toBe(false);
    expect(isOnNoteLines({ path: 'src/a.ts', startLine: 1, endLine: 3 }, anchor)).toBe(false);
    expect(isOnNoteLines({ path: 'src/a.ts', startLine: 2, endLine: 4 }, anchor)).toBe(false);
  });

  test('fails for a file or whole-change note, and without an anchor', ({ expect }) => {
    const lines = { path: 'src/a.ts', startLine: 2, endLine: 3 };
    expect(isOnNoteLines(lines, { kind: 'file', path: 'src/a.ts' })).toBe(false);
    expect(isOnNoteLines(lines, { kind: 'change' })).toBe(false);
    expect(isOnNoteLines(lines, undefined)).toBe(false);
  });
});
