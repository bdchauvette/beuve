import { describe } from 'vitest';

import { rowDecorationsFrom } from './row-decorations-from.ts';
import { createDiffFileView } from './testing/create-diff-file-view.ts';
import { test } from './testing/test.ts';

describe('rowDecorationsFrom', () => {
  test('says how many lines a file adds and deletes, after its mark and generated flag', ({
    expect,
  }) => {
    const small = createDiffFileView('src/a.ts', ['+one', '+two', '-three', ' same']);
    const lock = createDiffFileView('package-lock.json', ['+x']);
    expect(
      rowDecorationsFrom({
        files: [small, lock],
        marks: new Map([['src/a.ts', 'yes']] as const),
        generated: new Set(['package-lock.json']),
      }),
    ).toStrictEqual(
      new Map([
        ['src/a.ts', { text: '✓ +2/−1', title: 'Reviewed\n+2 −1 lines' }],
        ['package-lock.json', { text: '⚙ +1/−0', title: 'Generated file\n+1 −0 lines' }],
      ]),
    );
  });

  test('abbreviates large counts and leaves a file with nothing to say out', ({ expect }) => {
    const big = createDiffFileView(
      'src/big.ts',
      Array.from({ length: 1234 }, (_unused, index) => `+line ${String(index)}`),
    );
    const binary = createDiffFileView('logo.png', [], { overrides: { binary: true } });
    const decorations = rowDecorationsFrom({
      files: [big, binary],
      marks: new Map(),
      generated: new Set(),
    });
    expect(decorations.get('src/big.ts')?.text).toBe('+1.2K/−0');
    expect(decorations.has('logo.png')).toBe(false);
  });
});
