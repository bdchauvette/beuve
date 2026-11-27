import { describe } from 'vitest';

import type { FileLineMapping } from './line-mapping.ts';
import { reanchorUraSuggestion } from './reanchor-ura-suggestion.ts';
import type { UraSuggestion } from './ura-item.ts';
import { test } from './testing/test.ts';

function suggestion(start: number, end: number): UraSuggestion {
  return { path: 'src/a.ts', startLine: start, endLine: end, replacement: 'x' };
}

/** Two lines inserted after line 4, and line 8 rewritten, in a file renamed to `src/b.ts`. */
function files(): FileLineMapping[] {
  return [
    {
      kind: 'renamed',
      oldPath: 'src/a.ts',
      newPath: 'src/b.ts',
      hunks: [
        { oldStart: 4, oldCount: 0, newStart: 5, newCount: 2 },
        { oldStart: 8, oldCount: 1, newStart: 10, newCount: 1 },
      ],
    },
  ];
}

describe('reanchorUraSuggestion', () => {
  test('moves a suggestion’s lines with its file and the edits above them', ({ expect }) => {
    expect(reanchorUraSuggestion(suggestion(5, 6), files())).toStrictEqual({
      kind: 'current',
      suggestion: { path: 'src/b.ts', startLine: 7, endLine: 8, replacement: 'x' },
    });
    expect(reanchorUraSuggestion(suggestion(2, 3), files())).toStrictEqual({
      kind: 'current',
      suggestion: { path: 'src/b.ts', startLine: 2, endLine: 3, replacement: 'x' },
    });
  });

  test('keeps a suggestion whose lines changed, outdated', ({ expect }) => {
    expect(reanchorUraSuggestion(suggestion(7, 8), files())).toStrictEqual({
      kind: 'outdated',
      reason: 'lines-changed',
    });
    expect(
      reanchorUraSuggestion(suggestion(1, 1), [{ kind: 'deleted', path: 'src/a.ts' }]),
    ).toStrictEqual({ kind: 'outdated', reason: 'file-deleted' });
  });

  test('moves an insertion with the line before it', ({ expect }) => {
    expect(reanchorUraSuggestion(suggestion(6, 5), files())).toStrictEqual({
      kind: 'current',
      suggestion: { path: 'src/b.ts', startLine: 8, endLine: 7, replacement: 'x' },
    });
    expect(reanchorUraSuggestion(suggestion(5, 4), files())).toStrictEqual({
      kind: 'current',
      suggestion: { path: 'src/b.ts', startLine: 5, endLine: 4, replacement: 'x' },
    });
    expect(reanchorUraSuggestion(suggestion(9, 8), files())).toStrictEqual({
      kind: 'outdated',
      reason: 'lines-changed',
    });
    expect(reanchorUraSuggestion(suggestion(1, 0), files())).toStrictEqual({
      kind: 'current',
      suggestion: { path: 'src/b.ts', startLine: 1, endLine: 0, replacement: 'x' },
    });
  });
});
