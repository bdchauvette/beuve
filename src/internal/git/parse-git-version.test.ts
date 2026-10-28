import { describe, expect, it } from 'vitest';

import { parseGitVersion } from './parse-git-version.ts';

describe('parseGitVersion', () => {
  it('parses plain, vendor-suffixed and two-part versions', () => {
    expect(parseGitVersion('git version 2.43.0\n')).toEqual({
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

  it('rejects other programs', () => {
    expect(parseGitVersion('hg version 6')).toBeUndefined();
  });
});
