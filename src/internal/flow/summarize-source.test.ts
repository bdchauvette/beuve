import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { summarizeSource } from './summarize-source.ts';

describe('summarizeSource', () => {
  test('collapses whitespace and drops a trailing semicolon', ({ expect }) => {
    expect(summarizeSource('  return   x;  ', 40)).toBe('return x');
  });

  test('marks multi-line source with an ellipsis', ({ expect }) => {
    expect(summarizeSource('const f = () => {\n  return 1;\n};', 40)).toBe('const f = () => {…');
  });

  test('elides to the limit', ({ expect }) => {
    expect(summarizeSource('abcdefghij', 6)).toBe('abcde…');
  });
});
