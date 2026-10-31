import { describe } from 'vitest';

import { isVersionAtLeast } from './is-version-at-least.ts';
import type { GitVersion } from './parse-git-version.ts';
import { readDiffAttributes } from './read-diff-attributes.ts';
import { test } from './testing/test.ts';

describe('readDiffAttributes', () => {
  test('reads the attributes of the commit, not of the working tree', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.write(
      '.gitattributes',
      ['gen/** linguist-generated', 'gen/keep.ts -linguist-generated', '*.snap -diff', ''].join(
        '\n',
      ),
    );
    repo.write('gen/api.ts', 'a\n');
    repo.write('gen/keep.ts', 'b\n');
    repo.write('src/a b.snap', 'c\n');
    repo.write('src/main.ts', 'd\n');
    const head = await repo.commit('attributes');
    repo.write('.gitattributes', 'src/main.ts linguist-generated\n');

    const read = await readDiffAttributes(git, head, [
      'gen/api.ts',
      'gen/keep.ts',
      'src/a b.snap',
      'src/main.ts',
      'gone/deleted.ts',
    ]);
    const attributes = new Map(
      Object.entries({
        'gen/api.ts': { generated: true },
        'gen/keep.ts': { generated: false },
        'src/a b.snap': { diff: false },
      }),
    );
    expect(read).toMatchObject(onGit240(git.version, { ok: true, value: attributes }));
  });

  test('answers an empty map for no paths', async ({ expect, repo, repository: git }) => {
    const head = await repo.commit('empty');
    const read = await readDiffAttributes(git, head, []);
    expect(read).toMatchObject(onGit240(git.version, { ok: true, value: new Map() }));
  });
});

/** `answer` on git 2.40 or later, which reads attributes; older git refuses. */
function onGit240(version: GitVersion, answer: object): object {
  if (isVersionAtLeast(version, { major: 2, minor: 40 })) {
    return answer;
  }
  return { ok: false, error: { kind: 'unsupported-git-version' } };
}
