import { describe } from 'vitest';

import { tableCellsFrom } from './table-cells-from.ts';
import { test } from './testing/test.ts';

describe('tableCellsFrom', () => {
  test.for<[string, string[]]>([
    ['| a | b |', ['a', 'b']],
    ['a | b', ['a', 'b']],
    ['| a | |', ['a', '']],
    ['| `a|b` | c\\|d |', ['`a|b`', 'c\\|d']],
    ['| ``x`|`y`` |', ['``x`|`y``']],
    ['| `open | b |', ['`open', 'b']],
    ['| one |', ['one']],
  ])('%j', ([row, expected], { expect }) => {
    expect(tableCellsFrom(row)).toStrictEqual(expected);
  });
});
