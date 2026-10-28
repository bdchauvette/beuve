import { describe, expect, it } from 'vitest';

import { escapeMarkdownHtml } from './escape-markdown-html.ts';

describe('escapeMarkdownHtml', () => {
  it('escapes tag openers and keeps inline Markdown', () => {
    expect(escapeMarkdownHtml('Prefer <const> over `let` & *var*')).toBe(
      'Prefer &lt;const> over `let` & *var*',
    );
  });
});
