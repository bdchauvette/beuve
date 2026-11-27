import { describe } from 'vitest';

import { test } from './testing/test.ts';
import { tokenMarksFrom } from './token-marks-from.ts';

describe('tokenMarksFrom', () => {
  test('marks each styled token from its offset with its custom properties', ({ expect }) => {
    const marks = tokenMarksFrom([
      [
        { content: 'const', offset: 0, htmlStyle: { '--diffs-token-light': '#60646C' } },
        { content: ' ', offset: 5 },
        {
          content: 'x',
          offset: 6,
          htmlStyle: {
            '--diffs-token-light': '#1C2024',
            '--diffs-token-light-font-weight': 'bold',
          },
        },
      ],
      [{ content: '', offset: 8, htmlStyle: { '--diffs-token-light': '#1C2024' } }],
    ]);
    expect(marks).toStrictEqual([
      { from: 0, to: 5, style: '--diffs-token-light:#60646C' },
      { from: 6, to: 7, style: '--diffs-token-light:#1C2024;--diffs-token-light-font-weight:bold' },
    ]);
  });
});
