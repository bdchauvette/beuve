import { describe } from 'vitest';

import { parseGitVersion } from './parse-git-version.ts';
import { test } from './testing/test.ts';

describe('parseGitVersion', () => {
  test('parses plain, vendor-suffixed and two-part versions', ({ expect }) => {
    expect(parseGitVersion('git version 2.43.0\n')).toStrictEqual({
      major: 2,
      minor: 43,
      patch: 0,
      raw: 'git version 2.43.0',
    });
    expect(parseGitVersion('git version 2.39.3 (Apple Git-145)')).toMatchObject({
      minor: 39,
      patch: 3,
    });
    expect(parseGitVersion('git version 2.45.windows.1')).toMatchObject({ minor: 45, patch: 0 });
    expect(parseGitVersion('git version 3.0')).toMatchObject({ major: 3, minor: 0, patch: 0 });
  });

  test('rejects other programs', ({ expect }) => {
    expect(parseGitVersion('hg version 6')).toBeUndefined();
  });
});
