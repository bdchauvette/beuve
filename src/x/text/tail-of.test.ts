import { describe } from 'vitest';

import { tailOf } from './tail-of.ts';
import { test } from '#testing/test.ts';

describe('tailOf', () => {
  test.for([
    ['abcdef', 3, 'def'],
    ['abc', 3, 'abc'],
    ['abc', 10, 'abc'],
    ['abc', 0, ''],
    ['', 4, ''],
    ['aé🙂b', 3, '🙂b'],
  ] as const)('%j keeping %i units gives %j', ([text, maxLength, expected], { expect }) => {
    expect(tailOf(text, maxLength)).toBe(expected);
  });

  test('drops the half of an astral character the cut would leave', ({ expect }) => {
    const text = 'x🙂yz';

    expect(text.at(-3)).toBe('\u{DE42}');
    expect(tailOf(text, 3)).toBe('yz');
    expect(tailOf(text, 3).isWellFormed()).toBe(true);
  });

  test('keeps a whole astral character when the cut falls before it', ({ expect }) => {
    expect(tailOf('x🙂yz', 4)).toBe('🙂yz');
  });
});
