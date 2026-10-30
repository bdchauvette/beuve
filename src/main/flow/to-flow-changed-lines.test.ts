import { describe } from 'vitest';

import { parseUnifiedDiff } from '#internal/git/parse-unified-diff.ts';

import { toFlowChangedLines } from './to-flow-changed-lines.ts';
import { test } from '../testing/test.ts';

function changedBy(patch: string): number[] {
  const parsed = parseUnifiedDiff(patch);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  const [file] = parsed.value;
  if (file === undefined) {
    throw new Error('no file');
  }
  return [...toFlowChangedLines(file)].toSorted((a, b) => a - b);
}

function header(): string {
  return 'diff --git a/a.ts b/a.ts\nindex 1111111..2222222 100644\n--- a/a.ts\n+++ b/a.ts\n';
}

describe('toFlowChangedLines', () => {
  test('marks added lines, and an edit only by its new lines', ({ expect }) => {
    expect(
      changedBy(`${header()}@@ -1,4 +1,5 @@\n one\n-two\n+TWO\n+two and a half\n three\n four\n`),
    ).toStrictEqual([2, 3]);
  });

  test('marks the lines either side of a pure deletion', ({ expect }) => {
    expect(changedBy(`${header()}@@ -1,4 +1,3 @@\n one\n-two\n three\n four\n`)).toStrictEqual([
      1, 2,
    ]);
  });

  test('marks the last line, and the one past it, when a deletion ends the file', ({ expect }) => {
    expect(changedBy(`${header()}@@ -1,3 +1,2 @@\n one\n two\n-three\n`)).toStrictEqual([2, 3]);
  });
});
