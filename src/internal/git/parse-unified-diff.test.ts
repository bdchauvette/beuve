import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import type { DiffFile } from './diff-model.ts';
import { parseUnifiedDiff } from './parse-unified-diff.ts';
import { test } from './testing/test.ts';

/** Captured from `git diff --full-index -M --src-prefix=a/ --dst-prefix=b/` with quotepath off. */

/** Submodule, binary addition, mode change with content, from the same capture setup. */

/** `--find-copies-harder`, and an empty file added without rename detection. */

describe('parseUnifiedDiff', () => {
  test('parses every file of a mixed real-world patch', ({ expect }) => {
    const files = parsed(mixedPatch());
    expect(files.map((file) => [file.status, pathOf(file)])).toStrictEqual([
      ['added', 'añadido.txt'],
      ['modified', 'blob.bin'],
      ['modified', 'crlf.txt'],
      ['deleted', 'deleted.txt'],
      ['renamed', 'empty-added.txt'],
      ['modified', 'modified.txt'],
      ['modified', 'multi.txt'],
      ['renamed', 'new name ü.txt'],
      ['modified', 'nonl.txt'],
      ['modified', 'script.sh'],
      ['added', 'tab\there.txt'],
    ]);
  });

  test('numbers context, added and removed lines on each side', ({ expect }) => {
    const [hunk] = file(mixedPatch(), 'modified.txt').hunks;
    expect(hunk).toMatchObject({ oldStart: 1, oldCount: 3, newStart: 1, newCount: 3 });
    expect(hunk?.lines).toStrictEqual([
      { kind: 'context', content: 'line1', oldLine: 1, newLine: 1, noNewline: false },
      { kind: 'removed', content: 'line2', oldLine: 2, noNewline: false },
      { kind: 'added', content: 'line2 changed', newLine: 2, noNewline: false },
      { kind: 'context', content: 'line3', oldLine: 3, newLine: 3, noNewline: false },
    ]);
  });

  test('reads multiple hunks and their section headings', ({ expect }) => {
    const multi = file(mixedPatch(), 'multi.txt');
    expect(multi.hunks.map((hunk) => [hunk.header, hunk.oldStart, hunk.newStart])).toStrictEqual([
      ['@@ -2,7 +2,7 @@', 2, 2],
      ['@@ -32,7 +32,7 @@', 32, 32],
    ]);
    expect(multi.hunks[1]?.lines[3]).toMatchObject({ kind: 'removed', content: '35', oldLine: 35 });
    const renamed = file(mixedPatch(), 'new name ü.txt');
    expect(renamed.hunks[0]?.section).toBe('rename content 17');
    expect(multi.hunks[0]?.section).toBe('');
  });

  test('describes added and deleted files with their modes', ({ expect }) => {
    expect(file(mixedPatch(), 'añadido.txt')).toMatchObject({
      status: 'added',
      mode: '100644',
      oldObject: '0000000000000000000000000000000000000000',
      newObject: '07f33c419c8df177919cdf71c670e4587f1b645f',
    });
    const deleted = file(mixedPatch(), 'deleted.txt');
    expect(deleted).toMatchObject({ status: 'deleted', mode: '100644' });
    expect(deleted.hunks[0]).toMatchObject({ oldStart: 1, oldCount: 1, newStart: 0, newCount: 0 });
  });

  test('handles renames with and without content changes, and names with spaces or unicode', ({
    expect,
  }) => {
    expect(file(mixedPatch(), 'empty-added.txt')).toMatchObject({
      status: 'renamed',
      oldPath: 'empty-deleted.txt',
      newPath: 'empty-added.txt',
      similarity: 100,
      oldMode: undefined,
      newMode: undefined,
      hunks: [],
    });
    expect(file(mixedPatch(), 'new name ü.txt')).toMatchObject({
      status: 'renamed',
      oldPath: 'old-name.txt',
      similarity: 95,
      oldMode: '100644',
      newMode: '100644',
    });
  });

  test('decodes C-quoted names', ({ expect }) => {
    expect(file(mixedPatch(), 'tab\there.txt').hunks[0]?.lines).toStrictEqual([
      { kind: 'added', content: 'x', newLine: 1, noNewline: true },
    ]);
  });

  test('flags binary files and mode-only changes', ({ expect }) => {
    expect(file(mixedPatch(), 'blob.bin')).toMatchObject({ binary: true, hunks: [] });
    expect(file(mixedPatch(), 'script.sh')).toMatchObject({
      status: 'modified',
      oldMode: '100644',
      newMode: '100755',
      binary: false,
      hunks: [],
      oldObject: undefined,
    });
  });

  test('keeps carriage returns in CRLF content', ({ expect }) => {
    const lines = file(mixedPatch(), 'crlf.txt').hunks[0]?.lines;
    expect(lines?.map((line) => line.content)).toStrictEqual(['a\r', 'b\r', 'B\r', 'c\r']);
  });

  test('attaches "no newline at end of file" to the line before it', ({ expect }) => {
    expect(file(mixedPatch(), 'nonl.txt').hunks[0]?.lines).toStrictEqual([
      { kind: 'removed', content: 'no newline', oldLine: 1, noNewline: true },
      { kind: 'added', content: 'no newline changed', newLine: 1, noNewline: true },
    ]);
  });

  test('retains each file’s exact patch text', ({ expect }) => {
    const files = parsed(mixedPatch());
    expect(files.map((each) => each.patch).join('')).toBe(mixedPatch());
    expect(file(mixedPatch(), 'blob.bin').patch).toBe(
      patch(
        'diff --git a/blob.bin b/blob.bin',
        'index 0f49c4ae77b43dff338093c78e009676e7e308ba..0468cc67cd03cfa167f0c99fe957425b8eca2617 100644',
        'Binary files a/blob.bin and b/blob.bin differ',
      ),
    );
  });

  test('recognizes submodules, binary additions and mode changes with content', ({ expect }) => {
    const files = parsed(submodulePatch());
    expect(file(submodulePatch(), 'image.png')).toMatchObject({
      status: 'added',
      binary: true,
      submodule: false,
    });
    expect(file(submodulePatch(), 'script.sh')).toMatchObject({
      status: 'modified',
      oldMode: '100755',
      newMode: '100644',
    });
    expect(file(submodulePatch(), 'sub')).toMatchObject({
      status: 'added',
      mode: '160000',
      submodule: true,
    });
    expect(files).toHaveLength(3);
  });

  test('parses copies and empty files whose names contain spaces', ({ expect }) => {
    expect(file(copyAndEmptyPatch(), 'copied.txt')).toMatchObject({
      status: 'copied',
      oldPath: 'source.txt',
      newPath: 'copied.txt',
      similarity: 97,
    });
    expect(file(copyAndEmptyPatch(), 'fresh empty.txt')).toMatchObject({
      status: 'added',
      hunks: [],
    });
    expect(file(copyAndEmptyPatch(), 'gone empty.txt')).toMatchObject({ status: 'deleted' });
  });

  test('reads hunk bodies by count, so header-like content stays content', ({ expect }) => {
    const tricky = patch(
      'diff --git a/notes.md b/notes.md',
      'index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644',
      '--- a/notes.md',
      '+++ b/notes.md',
      '@@ -1,2 +1,2 @@',
      '--- a/elsewhere',
      '+++ b/elsewhere',
      ' diff --git a/x b/x',
    );
    // A removed line "-- a/elsewhere" and an added line "++ b/elsewhere", then context.
    expect(
      parsed(tricky)[0]?.hunks[0]?.lines.map((line) => [line.kind, line.content]),
    ).toStrictEqual([
      ['removed', '-- a/elsewhere'],
      ['added', '++ b/elsewhere'],
      ['context', 'diff --git a/x b/x'],
    ]);
  });

  test('treats an empty hunk line as blank context (diff.suppressBlankEmpty)', ({ expect }) => {
    const blank = patch(
      'diff --git a/a.txt b/a.txt',
      'index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,2 +1,2 @@',
      '',
      '-x',
      '+y',
    );
    expect(parsed(blank)[0]?.hunks[0]?.lines[0]).toStrictEqual({
      kind: 'context',
      content: '',
      oldLine: 1,
      newLine: 1,
      noNewline: false,
    });
  });

  test('returns no files for empty input', ({ expect }) => {
    expect(parseUnifiedDiff('')).toStrictEqual({ ok: true, value: [] });
  });

  test('rejects truncated, combined and malformed diffs', ({ expect }) => {
    const truncated = patch(
      'diff --git a/a b/a',
      'index 1111111..2222222 100644',
      '--- a/a',
      '+++ b/a',
      '@@ -1,3 +1,3 @@',
      ' one',
    );
    expect(parseUnifiedDiff(truncated)).toMatchObject({
      ok: false,
      error: { kind: 'malformed-diff', message: 'hunk ended before its line counts were met' },
    });
    expect(parseUnifiedDiff(patch('diff --cc a', 'index 1,2..3'))).toMatchObject({
      ok: false,
      error: { line: 1, message: 'combined diffs are not supported' },
    });
    expect(parseUnifiedDiff(patch('hello'))).toMatchObject({ ok: false });
    expect(parseUnifiedDiff(patch('diff --git a/a b/a', 'weird header'))).toMatchObject({
      ok: false,
      error: { line: 2 },
    });
    expect(
      parseUnifiedDiff(patch('diff --git a/a b/a', 'index 1..2 100644', '@@ -x +1 @@')),
    ).toMatchObject({ ok: false, error: { line: 3 } });
  });
});

function patch(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

function parsed(text: string): readonly DiffFile[] {
  const result = okValueFrom(parseUnifiedDiff(text));
  return result;
}

function pathOf(diffFile: DiffFile): string {
  return 'path' in diffFile ? diffFile.path : diffFile.newPath;
}

function file(text: string, path: string): DiffFile {
  const found = parsed(text).find((candidate) => pathOf(candidate) === path);
  if (found === undefined) {
    throw new Error(`no file ${path}`);
  }
  return found;
}

function mixedPatch(): string {
  return patch(
    'diff --git a/añadido.txt b/añadido.txt',
    'new file mode 100644',
    'index 0000000000000000000000000000000000000000..07f33c419c8df177919cdf71c670e4587f1b645f',
    '--- /dev/null',
    '+++ b/añadido.txt',
    '@@ -0,0 +1,2 @@',
    '+new',
    '+file',
    'diff --git a/blob.bin b/blob.bin',
    'index 0f49c4ae77b43dff338093c78e009676e7e308ba..0468cc67cd03cfa167f0c99fe957425b8eca2617 100644',
    'Binary files a/blob.bin and b/blob.bin differ',
    'diff --git a/crlf.txt b/crlf.txt',
    'index b5eff5721aa4f9468960ecd78cd2764deab97b55..d5a6cc6abcf2268e05671de39c071470e30d5228 100644',
    '--- a/crlf.txt',
    '+++ b/crlf.txt',
    '@@ -1,3 +1,3 @@',
    ' a\r',
    '-b\r',
    '+B\r',
    ' c\r',
    'diff --git a/deleted.txt b/deleted.txt',
    'deleted file mode 100644',
    'index 2fa992c0b8b5c6acd2bdd4fa31de29d29799bdd5..0000000000000000000000000000000000000000',
    '--- a/deleted.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-keep',
    'diff --git a/empty-deleted.txt b/empty-added.txt',
    'similarity index 100%',
    'rename from empty-deleted.txt',
    'rename to empty-added.txt',
    'diff --git a/modified.txt b/modified.txt',
    'index 83db48f84ec878fbfb30b46d16630e944e34f205..8792505ed56d3abb5f0bfb5d0334c889352fe24a 100644',
    '--- a/modified.txt',
    '+++ b/modified.txt',
    '@@ -1,3 +1,3 @@',
    ' line1',
    '-line2',
    '+line2 changed',
    ' line3',
    'diff --git a/multi.txt b/multi.txt',
    'index 1c99002b20b3c0e11a95c8423601a38fff9b3675..515da3235e4e91e4ab1e960844c603f9b5d3606d 100644',
    '--- a/multi.txt',
    '+++ b/multi.txt',
    '@@ -2,7 +2,7 @@',
    ' 2',
    ' 3',
    ' 4',
    '-5',
    '+five',
    ' 6',
    ' 7',
    ' 8',
    '@@ -32,7 +32,7 @@',
    ' 32',
    ' 33',
    ' 34',
    '-35',
    '+thirty-five',
    ' 36',
    ' 37',
    ' 38',
    'diff --git a/old-name.txt b/new name ü.txt',
    'similarity index 95%',
    'rename from old-name.txt',
    'rename to new name ü.txt',
    'index d108871e327263019ffb56a78cdd1f0245a36b14..4c17564c8596f009d5da17ffa41871dc5004415a 100644',
    '--- a/old-name.txt',
    '+++ b/new name ü.txt\t',
    '@@ -18,3 +18,4 @@ rename content 17',
    ' rename content 18',
    ' rename content 19',
    ' rename content 20',
    '+rename content 21',
    'diff --git a/nonl.txt b/nonl.txt',
    'index 20cbb4d89224e1ed724b7feaf5c4f4479e25212a..0ba6e663fdac7085951e04eae3df8d08a8655d39 100644',
    '--- a/nonl.txt',
    '+++ b/nonl.txt',
    '@@ -1 +1 @@',
    '-no newline',
    String.raw`\ No newline at end of file`,
    '+no newline changed',
    String.raw`\ No newline at end of file`,
    'diff --git a/script.sh b/script.sh',
    'old mode 100644',
    'new mode 100755',
    String.raw`diff --git "a/tab\there.txt" "b/tab\there.txt"`,
    'new file mode 100644',
    'index 0000000000000000000000000000000000000000..c1b0730e0133447badcfd47fd144e254807b06e1',
    '--- /dev/null',
    String.raw`+++ "b/tab\there.txt"`,
    '@@ -0,0 +1 @@',
    '+x',
    String.raw`\ No newline at end of file`,
  );
}

function submodulePatch(): string {
  return patch(
    'diff --git a/image.png b/image.png',
    'new file mode 100644',
    'index 0000000000000000000000000000000000000000..41e3e497080ccf1095445034643223fe93286302',
    'Binary files /dev/null and b/image.png differ',
    'diff --git a/script.sh b/script.sh',
    'old mode 100755',
    'new mode 100644',
    'index 4163036efa65bd4a469e752267498f01ea36a55c..4935e13c39ce9380c7096d7ecf05e6f9d1a0d659',
    '--- a/script.sh',
    '+++ b/script.sh',
    '@@ -1,2 +1,2 @@',
    '-#!/bin/sh',
    ' echo hi',
    '+echo more',
    'diff --git a/sub b/sub',
    'new file mode 160000',
    'index 0000000000000000000000000000000000000000..2fe3df7469f0104ed7d1e0fe4faa18e67033aabb',
    '--- /dev/null',
    '+++ b/sub',
    '@@ -0,0 +1 @@',
    '+Subproject commit 2fe3df7469f0104ed7d1e0fe4faa18e67033aabb',
  );
}

function copyAndEmptyPatch(): string {
  return patch(
    'diff --git a/source.txt b/copied.txt',
    'similarity index 97%',
    'copy from source.txt',
    'copy to copied.txt',
    'index 8e8bf1ca7cd2e414a3c9d963a280c25653a64b39..426ecfa793e3ad7565fdf2c4233857f7f6ae185a 100644',
    '--- a/source.txt',
    '+++ b/copied.txt',
    '@@ -18,3 +18,4 @@ copy source 17',
    ' copy source 18',
    ' copy source 19',
    ' copy source 20',
    '+extra',
    'diff --git a/fresh empty.txt b/fresh empty.txt',
    'new file mode 100644',
    'index 0000000000000000000000000000000000000000..e69de29bb2d1d6434b8b29ae775ad8c2e48c5391',
    'diff --git a/gone empty.txt b/gone empty.txt',
    'deleted file mode 100644',
    'index e69de29bb2d1d6434b8b29ae775ad8c2e48c5391..0000000000000000000000000000000000000000',
  );
}
