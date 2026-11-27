import { describe } from 'vitest';

import { loadTokenMarks } from './load-token-marks.ts';
import { test } from './testing/test.ts';

describe('loadTokenMarks', () => {
  test('highlights with both of beuve’s themes, by the language of the path', async ({
    expect,
  }) => {
    const marks = await loadTokenMarks({ path: 'src/a.ts', text: 'const x = 1;' });
    const number = marks.find((mark) => mark.from === 10);
    expect(number?.to).toBe(11);
    expect(number?.style).toMatch(/--diffs-token-light:#\w+;.*--diffs-token-dark:#\w+/u);
    expect(number?.style).toContain('--diffs-token-light-font-weight:bold');
  });

  test('reads a script’s language from its #! line, and leaves other text plain', async ({
    expect,
  }) => {
    await expect(
      loadTokenMarks({ path: 'bin/run', text: '#!/bin/sh\necho hi' }),
    ).resolves.not.toStrictEqual([]);
    await expect(loadTokenMarks({ path: 'notes.txt', text: 'plain words' })).resolves.toStrictEqual(
      [],
    );
  });
});
