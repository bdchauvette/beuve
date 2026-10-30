import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { minimizePatchPreview } from './minimize-patch-preview.ts';
import { splitPatch } from './split-patch.ts';

function preview(body: string[]): string[] {
  const lines = splitPatch(['@@ -1 +1 @@', ...body, ''].join('\n')).slice(1);
  return minimizePatchPreview(lines).map((line) => line.text);
}

describe('minimizePatchPreview', () => {
  test('turns anchored lines the edit kept into context', ({ expect }) => {
    expect(
      preview([
        ' before',
        '-const a = 1;',
        '-const b = 2;',
        '-const c = 3;',
        '+const a = 1;',
        '+const b = 20;',
        '+const c = 3;',
        ' after',
      ]),
    ).toStrictEqual([
      ' before',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 20;',
      ' const c = 3;',
      ' after',
    ]);
  });

  test('shows pure insertions and deletions as they are', ({ expect }) => {
    expect(preview(['-gone', '-kept', '+kept'])).toStrictEqual(['-gone', ' kept']);
    expect(preview(['-kept', '+kept', '+new'])).toStrictEqual([' kept', '+new']);
  });

  test('hides context beyond two lines of a change, marking gaps between changes', ({ expect }) => {
    expect(
      preview([' 1', ' 2', ' 3', '-x', '+y', ' 4', ' 5', ' a', ' 6', ' 7', '-p', '+q', ' 8']),
    ).toStrictEqual([' 2', ' 3', '-x', '+y', ' 4', ' 5', '⋯', ' 6', ' 7', '-p', '+q', ' 8']);
  });

  test('keeps the whole patch when nothing changes', ({ expect }) => {
    expect(preview([' a', ' b'])).toStrictEqual([' a', ' b']);
  });

  test('leaves runs with no-newline markers alone', ({ expect }) => {
    expect(preview(['-a', '\\ No newline at end of file', '+a'])).toStrictEqual([
      '-a',
      '\\ No newline at end of file',
      '+a',
    ]);
  });
});
