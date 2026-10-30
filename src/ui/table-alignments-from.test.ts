import { describe } from 'vitest';

import type { TableAlignment } from './markdown-tree.ts';
import { tableAlignmentsFrom } from './table-alignments-from.ts';
import { test } from './testing/test.ts';

describe('tableAlignmentsFrom', () => {
  test.for<[string, TableAlignment[] | undefined]>([
    ['| --- | :-- | :-: | --: |', [undefined, 'left', 'center', 'right']],
    ['-|-', [undefined, undefined]],
    ['| - - |', [undefined]],
    ['---', undefined],
    ['| a | --- |', undefined],
    ['| :: |', undefined],
  ])('%j', ([row, expected], { expect }) => {
    expect(tableAlignmentsFrom(row)).toStrictEqual(expected);
  });
});
