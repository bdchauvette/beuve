import { describe } from 'vitest';

import type { ChatFile } from './chat-question.ts';
import { selectNoteHunks } from './select-note-hunks.ts';
import type { NoteDiffBudget } from './select-note-hunks.ts';
import { test } from './testing/test.ts';

/** A file whose hunks start at the given head lines, each adding two lines after one of context. */
function fileWithHunks(path: string, starts: readonly number[]): ChatFile {
  const hunks = starts.map((start) => {
    return `@@ -${String(start)},1 +${String(start)},3 @@\n ctx ${String(start)}\n+a\n+b\n`;
  });
  return {
    path,
    status: 'modified',
    binary: false,
    patch: `--- a/${path}\n+++ b/${path}\n${hunks.join('')}`,
  };
}

function binaryFile(): ChatFile {
  return { path: 'x.png', status: 'added', binary: true, patch: 'Binary files differ\n' };
}

function roomy(): NoteDiffBudget {
  return { maxChars: 100_000, maxFileChars: 50_000 };
}

describe('selectNoteHunks', () => {
  test('a line note gets the hunks that touch or neighbor its lines, in diff order', ({
    expect,
  }) => {
    const files = [fileWithHunks('a.ts', [1, 30, 50, 200]), fileWithHunks('b.ts', [40])];
    const selection = selectNoteHunks(
      files,
      { kind: 'lines', path: 'a.ts', startLine: 40, endLine: 41 },
      roomy(),
    );
    expect(selection.omittedPaths).toStrictEqual([]);
    expect(selection.sections).toStrictEqual([
      {
        path: 'a.ts',
        status: 'modified',
        patch:
          '--- a/a.ts\n+++ b/a.ts\n@@ -30,1 +30,3 @@\n ctx 30\n+a\n+b\n' +
          '@@ -50,1 +50,3 @@\n ctx 50\n+a\n+b\n',
        shownHunks: 2,
        totalHunks: 4,
        isCut: false,
      },
    ]);
  });

  test('a line note far from every hunk gets the nearest one', ({ expect }) => {
    const selection = selectNoteHunks(
      [fileWithHunks('a.ts', [1, 300])],
      { kind: 'lines', path: 'a.ts', startLine: 250, endLine: 250 },
      roomy(),
    );
    expect(selection.sections[0]?.patch).toContain('@@ -300,1');
    expect(selection.sections[0]?.patch).not.toContain('@@ -1,1');
  });

  test('the nearest hunks win when not all fit, and a lone oversized hunk is cut', ({ expect }) => {
    const file = fileWithHunks('a.ts', [10, 25]);
    const anchor = { kind: 'lines', path: 'a.ts', startLine: 26, endLine: 26 } as const;
    const near = selectNoteHunks([file], anchor, { maxChars: 60, maxFileChars: 60 });
    expect(near.sections[0]).toMatchObject({ shownHunks: 1, totalHunks: 2, isCut: false });
    expect(near.sections[0]?.patch).toContain('@@ -25,1');
    const cut = selectNoteHunks([file], anchor, { maxChars: 40, maxFileChars: 40 });
    expect(cut.sections[0]).toMatchObject({ shownHunks: 1, isCut: true });
    expect(cut.sections[0]?.patch).toBe('--- a/a.ts\n+++ b/a.ts\n@@ -25,1 +25,3 @@\n');
  });

  test('a file note gets its own file’s hunks; a binary or missing file gets none', ({
    expect,
  }) => {
    const files = [fileWithHunks('a.ts', [1, 30]), fileWithHunks('b.ts', [5]), binaryFile()];
    const file = selectNoteHunks(files, { kind: 'file', path: 'b.ts' }, roomy());
    expect(file.sections.map((section) => section.path)).toStrictEqual(['b.ts']);
    expect(file.sections[0]).toMatchObject({ shownHunks: 1, totalHunks: 1 });
    const none = { sections: [], omittedPaths: [] };
    expect(selectNoteHunks(files, { kind: 'file', path: 'x.png' }, roomy())).toStrictEqual(none);
    expect(selectNoteHunks(files, { kind: 'file', path: 'gone.ts' }, roomy())).toStrictEqual(none);
  });

  test('a whole-change note gets each file’s leading hunks while they fit', ({ expect }) => {
    const files = [
      fileWithHunks('a.ts', [1, 30]),
      binaryFile(),
      fileWithHunks('b.ts', [5]),
      fileWithHunks('c.ts', [5]),
    ];
    const selection = selectNoteHunks(
      files,
      { kind: 'change' },
      { maxChars: 120, maxFileChars: 60 },
    );
    expect(
      selection.sections.map((section) => {
        return [section.path, section.shownHunks, section.totalHunks];
      }),
    ).toStrictEqual([
      ['a.ts', 1, 2],
      ['b.ts', 1, 1],
    ]);
    expect(selection.omittedPaths).toStrictEqual(['x.png', 'c.ts']);
  });
});
