import { describe } from 'vitest';

import { test } from '../testing/test.ts';

import { headingSlugsFrom } from './heading-slugs-from.ts';

describe('headingSlugsFrom', () => {
  test('slugs as GitHub does, numbering repeats', ({ expect }) => {
    expect(
      headingSlugsFrom([
        'Getting Started',
        'API: `parse()` & friends!',
        'Getting Started',
        'Getting Started',
        'getting-started-1',
        'Ünïcode Wörds 2',
        'snake_case and dash-ed',
      ]),
    ).toStrictEqual([
      'getting-started',
      'api-parse--friends',
      'getting-started-1',
      'getting-started-2',
      'getting-started-1-1',
      'ünïcode-wörds-2',
      'snake_case-and-dash-ed',
    ]);
  });
});
