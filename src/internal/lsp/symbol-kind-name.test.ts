import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { symbolKindName } from './symbol-kind-name.ts';

describe('symbolKindName', () => {
  test('names every LSP symbol kind and tolerates unknown ones', ({ expect }) => {
    expect([1, 6, 9, 12, 26].map((kind) => symbolKindName(kind))).toStrictEqual([
      'file',
      'method',
      'constructor',
      'function',
      'type-parameter',
    ]);
    expect(symbolKindName(0)).toBe('unknown');
    expect(symbolKindName(27)).toBe('unknown');
  });
});
