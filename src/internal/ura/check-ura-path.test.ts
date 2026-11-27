import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { checkUraPath } from './check-ura-path.ts';

describe('checkUraPath', () => {
  test.for([
    ['src/a.ts', undefined],
    ['a b/ü.ts', undefined],
    ['', 'the path is empty or contains control characters'],
    ['src/a\n.ts', 'the path is empty or contains control characters'],
    ['/etc/passwd', 'the path must be repository-relative, without empty, . or .. segments'],
    ['src/../a.ts', 'the path must be repository-relative, without empty, . or .. segments'],
    ['./a.ts', 'the path must be repository-relative, without empty, . or .. segments'],
    ['src//a.ts', 'the path must be repository-relative, without empty, . or .. segments'],
  ] as const)('checks %j', ([path, reason], { expect }) => {
    expect(checkUraPath(path)).toBe(reason);
  });
});
