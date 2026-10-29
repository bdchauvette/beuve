import { describe, expect, it } from 'vitest';

import { minimizePatchPreview } from './minimize-patch-preview.ts';
import { splitPatch } from './split-patch.ts';

function preview(body: string[]): string[] {
  const lines = splitPatch(['@@ -1 +1 @@', ...body, ''].join('\n')).slice(1);
  return minimizePatchPreview(lines).map((line) => line.text);
}

describe('minimizePatchPreview', () => {
  it('turns anchored lines the edit kept into context', () => {
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
    ).toEqual([
      ' before',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 20;',
      ' const c = 3;',
      ' after',
    ]);
  });

  it('shows pure insertions and deletions as they are', () => {
    expect(preview(['-gone', '-kept', '+kept'])).toEqual(['-gone', ' kept']);
    expect(preview(['-kept', '+kept', '+new'])).toEqual([' kept', '+new']);
  });

  it('hides context beyond two lines of a change, marking gaps between changes', () => {
    expect(
      preview([' 1', ' 2', ' 3', '-x', '+y', ' 4', ' 5', ' a', ' 6', ' 7', '-p', '+q', ' 8']),
    ).toEqual([' 2', ' 3', '-x', '+y', ' 4', ' 5', '⋯', ' 6', ' 7', '-p', '+q', ' 8']);
  });

  it('keeps the whole patch when nothing changes', () => {
    expect(preview([' a', ' b'])).toEqual([' a', ' b']);
  });

  it('leaves runs with no-newline markers alone', () => {
    expect(preview(['-a', '\\ No newline at end of file', '+a'])).toEqual([
      '-a',
      '\\ No newline at end of file',
      '+a',
    ]);
  });
});
