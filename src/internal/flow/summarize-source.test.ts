import { describe, expect, it } from 'vitest';

import { summarizeSource } from './summarize-source.ts';

describe('summarizeSource', () => {
  it('collapses whitespace and drops a trailing semicolon', () => {
    expect(summarizeSource('  return   x;  ', 40)).toBe('return x');
  });

  it('marks multi-line source with an ellipsis', () => {
    expect(summarizeSource('const f = () => {\n  return 1;\n};', 40)).toBe('const f = () => {…');
  });

  it('elides to the limit', () => {
    expect(summarizeSource('abcdefghij', 6)).toBe('abcde…');
  });
});
