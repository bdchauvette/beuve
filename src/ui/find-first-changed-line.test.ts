import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { findFirstChangedLine } from './find-first-changed-line.ts';

function header(): string {
  return 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n';
}

describe('findFirstChangedLine', () => {
  test('finds the first added line on the head side', ({ expect }) => {
    expect(findFirstChangedLine(`${header()}@@ -10,4 +10,5 @@ fn\n a\n b\n+c\n d\n`)).toBe(12);
  });

  test('uses the head line before a deletion', ({ expect }) => {
    expect(findFirstChangedLine(`${header()}@@ -10,3 +10,2 @@\n a\n-b\n c\n`)).toBe(10);
    expect(findFirstChangedLine(`${header()}@@ -10,2 +9,0 @@\n-a\n-b\n`)).toBe(9);
  });

  test('is undefined for deleted files and patches without hunks', ({ expect }) => {
    expect(findFirstChangedLine(`${header()}@@ -1,2 +0,0 @@\n-a\n-b\n`)).toBeUndefined();
    expect(findFirstChangedLine('diff --git a/x b/x\nBinary files differ\n')).toBeUndefined();
  });

  test('never mistakes the file header for a change', ({ expect }) => {
    expect(findFirstChangedLine(`${header()}@@ -1 +1 @@\n-x\n+y\n`)).toBe(1);
  });

  test('can look at one hunk only', ({ expect }) => {
    const patch = `${header()}@@ -1,2 +1,2 @@\n a\n+b\n@@ -20,3 +20,4 @@\n x\n y\n+z\n w\n`;
    expect(findFirstChangedLine(patch)).toBe(2);
    expect(findFirstChangedLine(patch, 0)).toBe(2);
    expect(findFirstChangedLine(patch, 1)).toBe(22);
    expect(findFirstChangedLine(patch, 2)).toBeUndefined();
  });
});
