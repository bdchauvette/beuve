import { describe, expect, it } from 'vitest';

import { fenceCodeBlock } from './fence-code-block.ts';

describe('fenceCodeBlock', () => {
  it('fences content with three backticks', () => {
    expect(fenceCodeBlock('diff', '-a\n+b\n')).toBe('```diff\n-a\n+b\n```');
    expect(fenceCodeBlock('', 'x')).toBe('```\nx\n```');
  });

  it('outgrows backtick runs in the content', () => {
    expect(fenceCodeBlock('md', 'a ```js b ```` c')).toBe('`````md\na ```js b ```` c\n`````');
  });

  it('keeps an empty block empty', () => {
    expect(fenceCodeBlock('suggestion', '')).toBe('```suggestion\n```');
  });
});
