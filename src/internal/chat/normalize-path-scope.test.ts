import { describe } from 'vitest';

import { normalizePathScope } from './normalize-path-scope.ts';
import { test } from './testing/test.ts';

describe('normalizePathScope', () => {
  test('is empty for the whole change', ({ expect }) => {
    expect(normalizePathScope([])).toStrictEqual([]);
    expect(normalizePathScope(['', '.', '/', '../x'])).toStrictEqual([]);
  });

  test('cleans, sorts and de-duplicates prefixes', ({ expect }) => {
    expect(normalizePathScope(['./src//ui/', 'docs', 'src/ui', 'a.ts'])).toStrictEqual([
      'a.ts',
      'docs',
      'src/ui',
    ]);
  });

  test('drops prefixes already covered by a shorter one, but not mere string prefixes', ({
    expect,
  }) => {
    expect(normalizePathScope(['src/auth.ts', 'src', 'src-extra', 'src/ui/x.ts'])).toStrictEqual([
      'src',
      'src-extra',
    ]);
  });

  test('is independent of the order given', ({ expect }) => {
    expect(normalizePathScope(['b', 'a'])).toStrictEqual(normalizePathScope(['a', 'b']));
  });
});
