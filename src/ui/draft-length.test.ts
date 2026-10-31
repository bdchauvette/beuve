import { describe } from 'vitest';

import { draftLength } from './draft-length.ts';
import { test } from './testing/test.ts';

describe('draftLength', () => {
  test('counts text by character and a chip as one', ({ expect }) => {
    const mention = { path: 'src/a.ts', side: 'head', sha: 'a'.repeat(40) } as const;
    expect(
      draftLength([
        { kind: 'text', text: 'Why ' },
        { kind: 'mention', mention },
        { kind: 'text', text: '?' },
      ]),
    ).toBe(6);
    expect(draftLength([])).toBe(0);
  });
});
