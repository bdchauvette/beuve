import type { DiffFileView } from '#contract/ipc-contract.ts';

/**
 * A modified file at `path` whose patch is one hunk of `body` lines (each starting with ` `, `+`
 * or `-`) from line `start` on both sides, with its counts, hunk and git header filled in.
 */
export function createDiffFileView(
  path: string,
  body: readonly string[],
  start = 1,
  overrides: Partial<DiffFileView> = {},
): DiffFileView {
  const oldCount = body.filter((line) => !line.startsWith('+')).length;
  const newCount = body.filter((line) => !line.startsWith('-')).length;
  const header = `@@ -${String(start)},${String(oldCount)} +${String(start)},${String(newCount)} @@`;
  const patch = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    header,
    ...body,
    '',
  ].join('\n');
  return {
    status: 'modified',
    path,
    additions: body.filter((line) => line.startsWith('+')).length,
    deletions: body.filter((line) => line.startsWith('-')).length,
    binary: false,
    hunks: [{ oldStart: start, oldCount, newStart: start, newCount, header }],
    patch,
    ...overrides,
  };
}
