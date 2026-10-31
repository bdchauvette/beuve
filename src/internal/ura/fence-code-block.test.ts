import { describe } from 'vitest';

import { fenceCodeBlock } from './fence-code-block.ts';
import { test } from './testing/test.ts';

describe('fenceCodeBlock', () => {
  test('fences content with three backticks', ({ expect }) => {
    expect(fenceCodeBlock({ info: 'diff', content: '-a\n+b\n' })).toBe('```diff\n-a\n+b\n```');
    expect(fenceCodeBlock({ info: '', content: 'x' })).toBe('```\nx\n```');
  });

  test('outgrows backtick runs in the content', ({ expect }) => {
    expect(fenceCodeBlock({ info: 'md', content: 'a ```js b ```` c' })).toBe(
      '`````md\na ```js b ```` c\n`````',
    );
  });

  test('keeps an empty block empty', ({ expect }) => {
    expect(fenceCodeBlock({ info: 'suggestion', content: '' })).toBe('```suggestion\n```');
  });
});
