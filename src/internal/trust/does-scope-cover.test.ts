import { describe } from 'vitest';

import { doesScopeCover } from './does-scope-cover.ts';
import type { TrustScope, TrustSubject } from './trust-scope.ts';
import { test } from './testing/test.ts';

describe('doesScopeCover (ADR 0090)', () => {
  test.for([
    ['the same path, no remote recorded', { kind: 'repository', path: '/r' }, subject(), true],
    [
      'the same path and remote',
      { kind: 'repository', path: '/r', remoteUrl: 'git@x:r' },
      subject(),
      true,
    ],
    [
      'a swapped remote',
      { kind: 'repository', path: '/r', remoteUrl: 'git@x:other' },
      subject(),
      false,
    ],
    [
      'a recorded remote the repository has lost',
      { kind: 'repository', path: '/r', remoteUrl: 'git@x:r' },
      { repositoryPath: '/r', remoteUrl: undefined },
      false,
    ],
    ['another path', { kind: 'repository', path: '/other' }, subject(), false],
  ] as const satisfies readonly (readonly [string, TrustScope, TrustSubject, boolean])[])(
    '%s',
    ([, scope, candidate, expected], { expect }) => {
      expect(doesScopeCover(scope, candidate)).toBe(expected);
    },
  );
});

function subject(): TrustSubject {
  return { repositoryPath: '/r', remoteUrl: 'git@x:r' };
}
