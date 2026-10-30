import { describe } from 'vitest';

import { fenceCodeBlock } from './fence-code-block.ts';
import { test } from './testing/test.ts';

describe('fenceCodeBlock', () => {
  test('fences content with three backticks', ({ expect }) => {
    expect(fenceCodeBlock('diff', '-a\n+b\n')).toBe('```diff\n-a\n+b\n```');
    expect(fenceCodeBlock('', 'x')).toBe('```\nx\n```');
  });

  test('outgrows backtick runs in the content', ({ expect }) => {
    expect(fenceCodeBlock('md', 'a ```js b ```` c')).toBe('`````md\na ```js b ```` c\n`````');
  });

  test('keeps an empty block empty', ({ expect }) => {
    expect(fenceCodeBlock('suggestion', '')).toBe('```suggestion\n```');
  });
});
