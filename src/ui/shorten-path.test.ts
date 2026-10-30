import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { shortenPath } from './shorten-path.ts';

describe('shortenPath', () => {
  test('keeps the last two segments', ({ expect }) => {
    expect(shortenPath('/home/me/code/notes')).toBe('…/code/notes');
    expect(shortenPath('/code/notes')).toBe('/code/notes');
  });
});
