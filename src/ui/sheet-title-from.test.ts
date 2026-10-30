import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { sheetTitleFrom } from './sheet-title-from.ts';

describe('sheetTitleFrom', () => {
  test('names the path, the line and the short commit', ({ expect }) => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expect(sheetTitleFrom('src/a.ts', sha, 12)).toBe('src/a.ts:12 · 0123456');
    expect(sheetTitleFrom('src/a.ts', sha, undefined)).toBe('src/a.ts · 0123456');
  });
});
