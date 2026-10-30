import type { DiffFileView } from '#contract/ipc-contract.ts';

/**
 * `src/a.ts`, modified in two hunks, with any field overridden. Hunk 0 replaces base line 2 with
 * head lines 2–3; hunk 1 deletes base line 11. Between them every head line is one more than its
 * base line; after them the numbers agree again.
 *
 * ```text
 * base  head
 *    1     1   one
 *    2         -two
 *          2   +TWO
 *          3   +2b
 *    3     4   three
 *    4     5   four
 *   10    11   ten
 *   11         -eleven
 *   12    12   twelve
 * ```
 */
export function createTwoHunkFileView(overrides: Partial<DiffFileView> = {}): DiffFileView {
  return {
    status: 'modified',
    path: 'src/a.ts',
    additions: 2,
    deletions: 2,
    binary: false,
    hunks: [
      { oldStart: 1, oldCount: 4, newStart: 1, newCount: 5, header: '@@ -1,4 +1,5 @@' },
      { oldStart: 10, oldCount: 3, newStart: 11, newCount: 2, header: '@@ -10,3 +11,2 @@' },
    ],
    patch: [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,4 +1,5 @@',
      ' one',
      '-two',
      '+TWO',
      '+2b',
      ' three',
      ' four',
      '@@ -10,3 +11,2 @@',
      ' ten',
      '-eleven',
      ' twelve',
      '',
    ].join('\n'),
    ...overrides,
  };
}
