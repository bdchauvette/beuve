import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { describeDiffDisplay } from './describe-diff-display.ts';

describe('describeDiffDisplay', () => {
  test('names the layout and whether whitespace is hidden', ({ expect }) => {
    expect(describeDiffDisplay({ layout: 'split', ignoreWhitespace: false }, false).text).toBe(
      'Split',
    );
    expect(describeDiffDisplay({ layout: 'unified', ignoreWhitespace: true }, false).text).toBe(
      'Inline · whitespace hidden',
    );
  });

  test('says when a split falls back to inline in a narrow window', ({ expect }) => {
    const label = describeDiffDisplay({ layout: 'split', ignoreWhitespace: false }, true);
    expect(label.text).toBe('Inline (narrow)');
    expect(label.title).toContain('too narrow');
    expect(label.title).toContain('s toggles split/inline, w toggles whitespace');
    expect(describeDiffDisplay({ layout: 'unified', ignoreWhitespace: false }, true).text).toBe(
      'Inline',
    );
  });
});
