import { describe, expect, it } from 'vitest';

import { parseUnifiedDiff } from '#internal/git/parse-unified-diff.ts';

import { toFlowChangedLines } from './to-flow-changed-lines.ts';

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

const header = 'diff --git a/a.ts b/a.ts\nindex 1111111..2222222 100644\n--- a/a.ts\n+++ b/a.ts\n';

describe('toFlowChangedLines', () => {
  it('marks added lines, and an edit only by its new lines', () => {
    expect(
      changedBy(`${header}@@ -1,4 +1,5 @@\n one\n-two\n+TWO\n+two and a half\n three\n four\n`),
    ).toEqual([2, 3]);
  });

  it('marks the lines either side of a pure deletion', () => {
    expect(changedBy(`${header}@@ -1,4 +1,3 @@\n one\n-two\n three\n four\n`)).toEqual([1, 2]);
  });

  it('marks the last line, and the one past it, when a deletion ends the file', () => {
    expect(changedBy(`${header}@@ -1,3 +1,2 @@\n one\n two\n-three\n`)).toEqual([2, 3]);
  });
});
