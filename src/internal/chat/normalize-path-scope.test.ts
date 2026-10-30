import { describe, expect, it } from 'vitest';

import { normalizePathScope } from './normalize-path-scope.ts';

describe('normalizePathScope', () => {
  it('is empty for the whole change', () => {
    expect(normalizePathScope([])).toEqual([]);
    expect(normalizePathScope(['', '.', '/', '../x'])).toEqual([]);
  });

  it('cleans, sorts and de-duplicates prefixes', () => {
    expect(normalizePathScope(['./src//ui/', 'docs', 'src/ui', 'a.ts'])).toEqual([
      'a.ts',
      'docs',
      'src/ui',
    ]);
  });

  it('drops prefixes already covered by a shorter one, but not mere string prefixes', () => {
    expect(normalizePathScope(['src/auth.ts', 'src', 'src-extra', 'src/ui/x.ts'])).toEqual([
      'src',
      'src-extra',
    ]);
  });

  it('is independent of the order given', () => {
    expect(normalizePathScope(['b', 'a'])).toEqual(normalizePathScope(['a', 'b']));
  });
});
