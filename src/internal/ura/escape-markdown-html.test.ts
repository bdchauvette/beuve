import { describe } from 'vitest';

import { escapeMarkdownHtml } from './escape-markdown-html.ts';
import { test } from './testing/test.ts';

describe('escapeMarkdownHtml', () => {
  test('escapes tag openers and keeps inline Markdown', ({ expect }) => {
    expect(escapeMarkdownHtml('Prefer <const> over `let` & *var*')).toBe(
      'Prefer &lt;const> over `let` & *var*',
    );
  });
});
