import { describe } from 'vitest';

import { suggestionFieldsFrom } from './suggestion-fields-from.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';
import { test } from './testing/test.ts';

describe('suggestionFieldsFrom', () => {
  test('opens each suggestion from its replacement, keeping its id and saying why one is outdated', ({
    expect,
  }) => {
    const item = createUraItemView({
      headSha: 'b'.repeat(40),
      suggestions: [
        { id: 's1', path: 'src/a.ts', startLine: 3, endLine: 4, replacement: 'x' },
        {
          id: 's2',
          path: 'lib/b.ts',
          startLine: 2,
          endLine: 1,
          replacement: 'new',
          placement: { kind: 'outdated', reason: 'lines-changed' },
        },
      ],
    });
    expect(suggestionFieldsFrom(item)).toStrictEqual([
      {
        key: 's1',
        id: 's1',
        headSha: 'b'.repeat(40),
        path: 'src/a.ts',
        startLine: 3,
        endLine: 4,
        replacement: 'x',
      },
      {
        key: 's2',
        id: 's2',
        headSha: 'b'.repeat(40),
        path: 'lib/b.ts',
        startLine: 2,
        endLine: 1,
        replacement: 'new',
        outdated: 'Outdated: the lines changed since',
      },
    ]);
  });
});
