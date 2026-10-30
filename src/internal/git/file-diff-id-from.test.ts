import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import type { DiffFile } from './diff-model.ts';
import { fileDiffIdFrom } from './file-diff-id-from.ts';
import { parseUnifiedDiff } from './parse-unified-diff.ts';
import { test } from './testing/test.ts';

describe('fileDiffIdFrom', () => {
  test('is a SHA-256 digest', ({ expect }) => {
    expect(fileDiffIdFrom(modified('a.ts', ['one', '-two', '+TWO', 'three']))).toMatch(
      /^[\da-f]{64}$/u,
    );
  });

  test('ignores line numbers and context, which a rebase changes', ({ expect }) => {
    const before = modified('a.ts', ['one', '-two', '+TWO', 'three'], 10);
    const after = modified('a.ts', ['uno', 'dos', '-two', '+TWO', 'tres'], 250);
    expect(fileDiffIdFrom(before)).toBe(fileDiffIdFrom(after));
  });

  test('ignores the path, so a renamed file keeps its identity', ({ expect }) => {
    expect(fileDiffIdFrom(modified('a.ts', ['-x', '+y']))).toBe(
      fileDiffIdFrom(modified('dir/b.ts', ['-x', '+y'])),
    );
  });

  test('changes when a changed line changes, including whitespace', ({ expect }) => {
    const ids = [
      fileDiffIdFrom(modified('a.ts', ['-x', '+y'])),
      fileDiffIdFrom(modified('a.ts', ['-x', '+z'])),
      fileDiffIdFrom(modified('a.ts', ['-x', '+y '])),
      fileDiffIdFrom(modified('a.ts', ['-x', '+y', '+more'])),
    ];
    expect(new Set(ids).size).toBe(4);
  });

  test('joins hunks, so splitting a change differently keeps the identity', ({ expect }) => {
    const split = okValueFrom(
      parseUnifiedDiff(
        [
          'diff --git a/a.ts b/a.ts',
          'index 1111111..2222222 100644',
          '--- a/a.ts',
          '+++ b/a.ts',
          '@@ -1,1 +1,1 @@',
          '-x',
          '+y',
          '@@ -9,1 +9,1 @@',
          '-p',
          '+q',
          '',
        ].join('\n'),
      ),
    )[0];
    const joined = modified('a.ts', ['-x', '+y', 'mid', '-p', '+q']);
    expect(split === undefined ? '' : fileDiffIdFrom(split)).toBe(fileDiffIdFrom(joined));
  });

  test('sees a mode change and a binary content change', ({ expect }) => {
    const plain = modified('a.sh', []);
    const executable = okValueFrom(
      parseUnifiedDiff('diff --git a/a.sh b/a.sh\nold mode 100644\nnew mode 100755\n'),
    )[0];
    const binary = (newObject: string): DiffFile | undefined =>
      okValueFrom(
        parseUnifiedDiff(
          `diff --git a/b.bin b/b.bin\nindex 1111111..${newObject} 100644\nBinary files a/b.bin and b/b.bin differ\n`,
        ),
      )[0];
    const first = binary('2222222');
    const second = binary('3333333');
    expect(executable === undefined ? '' : fileDiffIdFrom(executable)).not.toBe(
      fileDiffIdFrom(plain),
    );
    expect(first === undefined ? '' : fileDiffIdFrom(first)).not.toBe(
      second === undefined ? '' : fileDiffIdFrom(second),
    );
  });
});

/** A one-hunk patch: lines starting with `-` or `+` are changes, the rest context. */
function modified(path: string, lines: readonly string[], start = 1): DiffFile {
  const body = lines.map((line) => (/^[-+]/u.test(line) ? line : ` ${line}`));
  const removed = body.filter((line) => !line.startsWith('+')).length;
  const added = body.filter((line) => !line.startsWith('-')).length;
  const patch = [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${String(start)},${String(removed)} +${String(start)},${String(added)} @@`,
    ...body,
    '',
  ].join('\n');
  const [file] = okValueFrom(parseUnifiedDiff(patch));
  if (file === undefined) {
    throw new Error('no file parsed');
  }
  return file;
}
