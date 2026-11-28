import { describe } from 'vitest';

import { plainTitleFrom } from './plain-title-from.ts';
import { test } from './testing/test.ts';

describe('plainTitleFrom', () => {
  test('drops inline code, bold, italics and link syntax, keeping their text', ({ expect }) => {
    expect(plainTitleFrom('Rename `validate` to `isValid`')).toBe('Rename validate to isValid');
    expect(plainTitleFrom('**Never** retry [here](https://example.com) _twice_')).toBe(
      'Never retry here twice',
    );
  });

  test('keeps a title without Markdown as it is, on one line', ({ expect }) => {
    expect(plainTitleFrom('Handle it')).toBe('Handle it');
    expect(plainTitleFrom('Two\n lines')).toBe('Two lines');
  });
});
