import { describe, expect, it } from 'vitest';

import { findFirstChangedLine } from './find-first-changed-line.ts';

const header = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n';

describe('findFirstChangedLine', () => {
  it('finds the first added line on the head side', () => {
    expect(findFirstChangedLine(`${header}@@ -10,4 +10,5 @@ fn\n a\n b\n+c\n d\n`)).toBe(12);
  });

  it('uses the head line before a deletion', () => {
    expect(findFirstChangedLine(`${header}@@ -10,3 +10,2 @@\n a\n-b\n c\n`)).toBe(10);
    expect(findFirstChangedLine(`${header}@@ -10,2 +9,0 @@\n-a\n-b\n`)).toBe(9);
  });

  it('is undefined for deleted files and patches without hunks', () => {
    expect(findFirstChangedLine(`${header}@@ -1,2 +0,0 @@\n-a\n-b\n`)).toBeUndefined();
    expect(findFirstChangedLine('diff --git a/x b/x\nBinary files differ\n')).toBeUndefined();
  });

  it('never mistakes the file header for a change', () => {
    expect(findFirstChangedLine(`${header}@@ -1 +1 @@\n-x\n+y\n`)).toBe(1);
  });
});
