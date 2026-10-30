import { describe } from 'vitest';

import { hasControlCharacters } from './has-control-characters.ts';
import { test } from '#testing/test.ts';

describe('hasControlCharacters', () => {
  test.for([
    ['plain text', false],
    ['tab\there', true],
    ['line\nbreak', true],
    ['nul\0', true],
    ['del\u{7F}', true],
    ['emoji 🙂 and é', false],
  ] as const)('%j: %s', ([value, expected], { expect }) => {
    expect(hasControlCharacters(value)).toBe(expected);
  });
});
