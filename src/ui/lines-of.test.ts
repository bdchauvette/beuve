import { describe } from 'vitest';

import { linesOf } from './lines-of.ts';
import { test } from './testing/test.ts';

describe('linesOf', () => {
  test('drops only the empty line after one final newline', ({ expect }) => {
    expect(linesOf('a\nb\n')).toStrictEqual(['a', 'b']);
    expect(linesOf('a\nb')).toStrictEqual(['a', 'b']);
    expect(linesOf('a\n\n')).toStrictEqual(['a', '']);
    expect(linesOf('')).toStrictEqual(['']);
  });
});
