import { describe } from 'vitest';

import { createDiffFileView } from './testing/create-diff-file-view.ts';
import { test } from './testing/test.ts';

import { permalinkPlaceFrom } from './permalink-place-from.ts';

function file(): ReturnType<typeof createDiffFileView> {
  return createDiffFileView('src/new.ts', [' a', '-b', '+c'], {
    overrides: { oldPath: 'src/old.ts' },
  });
}

describe('permalinkPlaceFrom', () => {
  test('links selections on their side, hunks, lines and whole files', ({ expect }) => {
    const view = file();
    const head = { start: 2, end: 2 };
    expect(
      permalinkPlaceFrom({ kind: 'selection', file: view, side: 'head', start: 2, end: 4, head }),
    ).toStrictEqual({ side: 'head', path: 'src/new.ts', startLine: 2, endLine: 4 });
    expect(
      permalinkPlaceFrom({ kind: 'selection', file: view, side: 'base', start: 2, end: 2, head }),
    ).toStrictEqual({ side: 'base', path: 'src/old.ts', startLine: 2, endLine: 2 });
    expect(
      permalinkPlaceFrom({ kind: 'hunk', file: view, index: 0, head, base: head, line: 2 }),
    ).toStrictEqual({ side: 'head', path: 'src/new.ts', startLine: 2, endLine: 2 });
    expect(
      permalinkPlaceFrom({
        kind: 'hunk',
        file: view,
        index: 0,
        head: undefined,
        base: head,
        line: 2,
      }),
    ).toStrictEqual({ side: 'base', path: 'src/old.ts', startLine: 2, endLine: 2 });
    expect(permalinkPlaceFrom({ kind: 'line', file: view, line: 7 })).toStrictEqual({
      side: 'head',
      path: 'src/new.ts',
      startLine: 7,
      endLine: 7,
    });
    expect(permalinkPlaceFrom({ kind: 'file', file: view, line: 2 })).toStrictEqual({
      side: 'head',
      path: 'src/new.ts',
    });
    expect(permalinkPlaceFrom({ kind: 'change' })).toBeUndefined();
  });

  test('links a deleted file on its base side', ({ expect }) => {
    const deleted = createDiffFileView('src/new.ts', ['-a'], { overrides: { status: 'deleted' } });
    expect(permalinkPlaceFrom({ kind: 'file', file: deleted, line: undefined })).toStrictEqual({
      side: 'base',
      path: 'src/new.ts',
    });
  });
});
