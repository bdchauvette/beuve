import { describe, expect, it } from 'vitest';

import { symbolKindName } from './symbol-kind-name.ts';

describe('symbolKindName', () => {
  it('names every LSP symbol kind and tolerates unknown ones', () => {
    expect([1, 6, 9, 12, 26].map((kind) => symbolKindName(kind))).toEqual([
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
