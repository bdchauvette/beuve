import { describe, expect, it } from 'vitest';

import { describeDiffDisplay } from './describe-diff-display.ts';

describe('describeDiffDisplay', () => {
  it('names the layout and whether whitespace is hidden', () => {
    expect(describeDiffDisplay({ layout: 'split', ignoreWhitespace: false }, false).text).toBe(
      'Split',
    );
    expect(describeDiffDisplay({ layout: 'unified', ignoreWhitespace: true }, false).text).toBe(
      'Inline · whitespace hidden',
    );
  });

  it('says when a split falls back to inline in a narrow window', () => {
    const label = describeDiffDisplay({ layout: 'split', ignoreWhitespace: false }, true);
    expect(label.text).toBe('Inline (narrow)');
    expect(label.title).toContain('too narrow');
    expect(label.title).toContain('s toggles split/inline, w toggles whitespace');
    expect(describeDiffDisplay({ layout: 'unified', ignoreWhitespace: false }, true).text).toBe(
      'Inline',
    );
  });
});
