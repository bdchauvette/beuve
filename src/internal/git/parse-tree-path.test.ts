import { describe } from 'vitest';

import { parseTreePath } from './parse-tree-path.ts';
import { hostilePathNames } from './testing/hostile-path-names.ts';
import { test } from './testing/test.ts';

describe('parseTreePath', () => {
  test.for(['a.ts', 'src/deep/b.ts', 'dir "with" quotes/x', 'gr\u{FC}\u{DF}e.ts', 'a b/c d.ts'])(
    'accepts %j',
    (text, { expect }) => {
      expect(parseTreePath(text)).toBe(text);
    },
  );

  test.for([
    '',
    '/etc/passwd',
    '../x',
    'a/../b',
    './a',
    'a/./b',
    'a//b',
    'a/',
    'new\nline.ts',
    'tab\there.ts',
    'cr\r',
    'nul\0',
    ' leading',
    'trailing ',
    'x'.repeat(5000),
  ])('refuses %j', (text, { expect }) => {
    expect(parseTreePath(text)).toBeUndefined();
  });

  test('refuses exactly the hostile names the line protocol cannot carry', ({ expect }) => {
    expect(hostilePathNames().filter((name) => parseTreePath(name) === undefined)).toStrictEqual([
      'tab\there.ts',
      'new\nline.ts',
      'dir "with" quotes/inner\tfile.ts',
    ]);
  });
});
